/**
 * Serviço que fica rodando (npm run servico): coleta a cada 10 min, recupera buracos 1x por hora e
 * manda o relatório às 18:10 (HORA_RELATORIO). Se ficar desligado na hora do relatório, manda
 * assim que voltar. Para rodar sempre, use pm2, systemd ou o Agendador de Tarefas do Windows.
 */
import { abrirBanco } from "../src/banco/banco.ts";
import { RepositorioSqlite } from "../src/banco/leituras.ts";
import { ClienteEcowitt } from "../src/coletor/ecowitt.ts";
import { coletarAgora, recuperarLacunas } from "../src/coletor/coleta.ts";
import { configDoAmbiente, notificadoresDaConfig } from "../src/coletor/config.ts";
import { paraLocal, somarMinutos } from "../src/coletor/tempo.ts";
import { lerEstacao } from "../src/banco/fazenda.ts";
import { tarefasDoMinuto } from "../src/job/agenda.ts";
import { rodarDiario } from "../src/job/diario.ts";

const cfg = configDoAmbiente();
const db = abrirBanco(cfg.banco);
const repo = new RepositorioSqlite(db);
const notificadores = notificadoresDaConfig(cfg);
const cliente = cfg.ecowitt ? new ClienteEcowitt(cfg.ecowitt) : null;
const fuso = cfg.ecowitt?.fuso ?? lerEstacao(db)?.fuso ?? "America/Sao_Paulo";
if (!cliente) console.warn("Sem chaves da Ecowitt no .env: o serviço só vai gerar o relatório, sem coletar.");

const log = (msg: string) => console.log(`[${paraLocal(Date.now(), fuso)}] ${msg}`);
let relatorioFeitoEm = "";
let ocupado = false;

async function tick() {
  if (ocupado) return; // a rodada anterior ainda não terminou (ex.: recuperação longa)
  ocupado = true;
  try {
    const agora = paraLocal(Date.now(), fuso);
    const hoje = agora.slice(0, 10);
    for (const t of tarefasDoMinuto(agora.slice(11, 16), cfg.horaRelatorio, relatorioFeitoEm === hoje)) {
      try {
        if (t === "coletar" && cliente) {
          const r = await coletarAgora(cliente, repo);
          if (!r.gravada) log("coleta: estação sem dado novo");
        } else if (t === "recuperar" && cliente) {
          const r = await recuperarLacunas(cliente, repo, somarMinutos(agora, -2 * 1440), agora);
          if (r.lacunas.length) log(`recuperação: ${r.lacunas.length} lacuna(s), ${r.gravadas} leitura(s), ${r.erros.length} erro(s)`);
        } else if (t === "diario") {
          // Antes do relatório, tenta tapar buracos do dia para não decidir com dados faltando.
          if (cliente) await recuperarLacunas(cliente, repo, somarMinutos(agora, -1440), agora);
          const r = await rodarDiario(db, { notificadores });
          relatorioFeitoEm = hoje;
          log(`relatório ${r.data}: ${r.envios.map((e) => `${e.canal} ${e.status}${e.erro ? ` (${e.erro})` : ""}`).join(", ")}`);
        }
      } catch (e) {
        log(`${t}: ${(e as Error).message}`);
        if (t === "diario") relatorioFeitoEm = hoje; // não repete o erro a cada minuto; tenta de novo amanhã ou com npm run diario
      }
    }
  } finally {
    ocupado = false;
  }
}

function agendar() {
  const ms = 60_000 - (Date.now() % 60_000) + 2_000; // 2 s depois da virada do minuto
  setTimeout(async () => {
    await tick();
    agendar();
  }, ms);
}

log(`serviço iniciado — banco ${cfg.banco}, relatório às ${cfg.horaRelatorio}, canais: ${cfg.canais.join(", ")}`);
agendar();

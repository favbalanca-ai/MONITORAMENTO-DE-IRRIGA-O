/**
 * Coletor da estação.
 *
 *   npm run coletar                                   leitura ao vivo
 *   npm run coletar -- recuperar --dias 2             preenche buracos dos últimos 2 dias
 *   npm run coletar -- recuperar --de 2026-02-08 --ate 2026-10-08   recupera um período
 *
 * Normalmente quem chama isso é o serviço (npm run servico); os comandos servem para testar e recuperar.
 */
import { parseArgs } from "node:util";
import { abrirBanco } from "../src/banco/banco.ts";
import { RepositorioSqlite } from "../src/banco/leituras.ts";
import { ClienteEcowitt } from "../src/coletor/ecowitt.ts";
import { coletarAgora, recuperarLacunas } from "../src/coletor/coleta.ts";
import { configDoAmbiente, exigirEcowitt } from "../src/coletor/config.ts";
import { paraLocal, somarMinutos } from "../src/coletor/tempo.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { dias: { type: "string" }, de: { type: "string" }, ate: { type: "string" } },
});

try {
  const cfg = configDoAmbiente();
  const ecowitt = exigirEcowitt(cfg);
  const cliente = new ClienteEcowitt(ecowitt);
  const repo = new RepositorioSqlite(abrirBanco(cfg.banco));
  const agora = paraLocal(Date.now(), ecowitt.fuso);

  if (positionals[0] === "recuperar") {
    const ini = values.de ? `${values.de}T00:00:00` : somarMinutos(agora, -1440 * Number(values.dias ?? 2));
    const fim = values.ate ? `${values.ate}T23:59:59` : agora;
    const r = await recuperarLacunas(cliente, repo, ini, fim, { log: console.log });
    console.log(`${r.lacunas.length} lacuna(s), ${r.consultas} consulta(s), ${r.gravadas} leitura(s) recuperada(s).`);
    if (r.erros.length) {
      console.error(`${r.erros.length} erro(s) — rode de novo para tentar outra vez.`);
      process.exitCode = 1;
    }
  } else {
    const { leitura, gravada } = await coletarAgora(cliente, repo);
    console.log(`${gravada ? "Gravada" : "Repetida (estação sem dado novo)"}: ${JSON.stringify(leitura)}`);
  }
} catch (e) {
  console.error(`Falha na coleta: ${(e as Error).message}`);
  process.exitCode = 1;
}

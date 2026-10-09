/**
 * O job das 18h: fecha o dia, recalcula o balanço de todos os pivôs ativos, grava no banco e envia
 * o relatório. Pode rodar quantas vezes quiser: recalcula tudo e não reenvia canal que já recebeu.
 */
import { jaEnviado, listarPivos, lerEstacao, registrarEnvio, salvarBalanco, salvarClima, ajustesDoPivo, irrigacoesDoPivo } from "../banco/fazenda.ts";
import type { Banco } from "../banco/banco.ts";
import { RepositorioSqlite } from "../banco/leituras.ts";
import { paraLocal } from "../coletor/tempo.ts";
import { diaAnterior, HORA_FECHAMENTO } from "../motor/agregacao.ts";
import { MIN_LEITURAS, simularBalanco } from "../motor/balanco.ts";
import { climaCompleto } from "../motor/completar.ts";
import { et0Hargreaves, et0PenmanMonteith } from "../motor/et0.ts";
import type { DataISO } from "../motor/tipos.ts";
import { montarMensagem, type ItemRelatorio } from "./mensagem.ts";
import type { Notificador } from "./notificadores.ts";

/** Último dia com a janela 18h–18h já fechada no horário local `agora`. */
export function ultimoDiaFechado(agoraLocal: string): DataISO {
  const hoje = agoraLocal.slice(0, 10);
  return agoraLocal.slice(11) >= HORA_FECHAMENTO ? hoje : diaAnterior(hoje);
}

export interface OpcoesDiario {
  /** Dia do relatório; padrão = último dia fechado. */
  data?: DataISO;
  agoraMs?: number;
  notificadores?: Notificador[];
  /** Reenvia mesmo para canais que já receberam o relatório deste dia. */
  forcar?: boolean;
}

export interface ResultadoDiario {
  data: DataISO;
  assunto: string;
  texto: string;
  itens: ItemRelatorio[];
  envios: { canal: string; status: "enviado" | "já enviado" | "erro"; erro?: string }[];
}

export async function rodarDiario(db: Banco, { data, agoraMs = Date.now(), notificadores = [], forcar = false }: OpcoesDiario = {}): Promise<ResultadoDiario> {
  const estacao = lerEstacao(db);
  if (!estacao) throw new Error("Estação não cadastrada. Rode: npm run banco -- cadastro config/fazenda.json");
  const agoraLocal = paraLocal(agoraMs, estacao.fuso);
  const dia = data ?? ultimoDiaFechado(agoraLocal);
  const pivos = listarPivos(db, { soAtivos: true });
  if (pivos.length === 0) throw new Error("Nenhum pivô ativo cadastrado.");

  const inicioDe = (p: (typeof pivos)[number]) => p.inicioBalanco ?? p.plantio;
  const iniGeral = pivos.map(inicioDe).filter((d) => d <= dia).sort()[0] ?? dia;
  const leituras = await new RepositorioSqlite(db).intervalo(`${diaAnterior(iniGeral)}T${HORA_FECHAMENTO}`, `${dia}T${HORA_FECHAMENTO}`);
  const clima = climaCompleto(leituras, iniGeral, dia);
  if (clima.length === 0) throw new Error(`Nenhuma leitura da estação entre ${iniGeral} e ${dia}.`);

  salvarClima(db, clima.map((d) => ({ ...d, et0: et0PenmanMonteith(d, estacao), et0Hs: et0Hargreaves(d, estacao) })));
  const climaDoDia = clima.at(-1)!;

  const calculadoEm = agoraLocal;
  const itens: ItemRelatorio[] = pivos.map((pivo) => {
    const ini = inicioDe(pivo);
    if (ini > dia) return { pivo, aviso: `balanço começa em ${ini}` };
    const dias = clima.filter((d) => d.data >= ini);
    // chuvaMinimaMm: 0 — versão antiga (não usada) mantém o comportamento da planilha original
    const linhas = simularBalanco({ pivo, estacao, dias, irrigacoes: irrigacoesDoPivo(db, pivo.id), ajustes: ajustesDoPivo(db, pivo.id), chuvaMinimaMm: 0 });
    salvarBalanco(db, pivo.id, linhas, calculadoEm);
    const diasIncertos = dias.filter((d) => d.estimados?.length || d.n < MIN_LEITURAS).length;
    return { pivo, linha: linhas.at(-1), diasIncertos };
  });

  const { assunto, texto } = montarMensagem(dia, { ...climaDoDia, et0: et0PenmanMonteith(climaDoDia, estacao) }, itens);
  const envios: ResultadoDiario["envios"] = [];
  for (const n of notificadores) {
    if (!forcar && jaEnviado(db, dia, n.canal)) {
      envios.push({ canal: n.canal, status: "já enviado" });
      continue;
    }
    try {
      await n.enviar(dia, assunto, texto);
      registrarEnvio(db, { data: dia, canal: n.canal, ok: true, texto, em: paraLocal(Date.now(), estacao.fuso) });
      envios.push({ canal: n.canal, status: "enviado" });
    } catch (e) {
      const erro = (e as Error).message;
      registrarEnvio(db, { data: dia, canal: n.canal, ok: false, erro, texto, em: paraLocal(Date.now(), estacao.fuso) });
      envios.push({ canal: n.canal, status: "erro", erro });
    }
  }
  return { data: dia, assunto, texto, itens, envios };
}

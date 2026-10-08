import type { DataHoraLocal, Leitura } from "../motor/tipos.ts";
import { cicloParaIdade, type CicloHistorico, type ClienteEcowitt } from "./ecowitt.ts";
import { encontrarLacunas, type Lacuna } from "./lacunas.ts";
import type { RepositorioLeituras } from "./repositorio.ts";
import { minutosEntre, paraLocal, somarMinutos } from "./tempo.ts";

type Cliente = Pick<ClienteEcowitt, "tempoReal" | "historico" | "cfg">;

export interface ResultadoColeta {
  leitura: Leitura;
  gravada: boolean;
}

/** Uma leitura ao vivo. Se a estação não mandou dado novo (mesmo horário de medição), não grava de novo. */
export async function coletarAgora(cliente: Cliente, repo: RepositorioLeituras): Promise<ResultadoColeta> {
  const leitura = await cliente.tempoReal();
  const gravada = (await repo.salvar([leitura])) > 0;
  return { leitura, gravada };
}

export interface OpcoesRecuperacao {
  /** Agora, em ms (injeção para testes). */
  agoraMs?: number;
  /** Pausa entre chamadas ao histórico, para não estourar o limite da API (ms). */
  pausaMs?: number;
  /** Tamanho máximo de cada consulta ao histórico (min). */
  blocoMin?: number;
  log?: (msg: string) => void;
}

export interface ResultadoRecuperacao {
  lacunas: Lacuna[];
  consultas: number;
  gravadas: number;
  erros: string[];
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Procura buracos na série entre `ini` e `fim` e preenche com o histórico do ecowitt.net.
 * Cada buraco é consultado com 12 h de folga dos dois lados (não sabemos em que fuso a API lê
 * start_date/end_date) e em blocos de no máximo 1 dia; só entra o que cai dentro do buraco.
 */
export async function recuperarLacunas(
  cliente: Cliente,
  repo: RepositorioLeituras,
  ini: DataHoraLocal,
  fim: DataHoraLocal,
  { agoraMs = Date.now(), pausaMs = 1100, blocoMin = 1440, log = () => {} }: OpcoesRecuperacao = {},
): Promise<ResultadoRecuperacao> {
  const agora = paraLocal(agoraMs, cliente.cfg.fuso);
  // Não chama de buraco os últimos 15 min: a próxima leitura ao vivo ainda pode chegar.
  const fimUtil = [fim, somarMinutos(agora, -15)].sort()[0]!;
  const lacunas = encontrarLacunas(await repo.intervalo(ini, fimUtil), ini, fimUtil);
  const res: ResultadoRecuperacao = { lacunas, consultas: 0, gravadas: 0, erros: [] };

  for (const lac of lacunas) {
    const idadeDias = minutosEntre(lac.de, agora) / 1440;
    const ciclo: CicloHistorico = cicloParaIdade(idadeDias);
    let a = somarMinutos(lac.de, -720);
    const z = somarMinutos(lac.ate, 720);
    log(`Lacuna ${lac.de} → ${lac.ate} (${Math.round(minutosEntre(lac.de, lac.ate))} min), histórico ${ciclo}`);
    while (a < z) {
      const b = [somarMinutos(a, blocoMin), z].sort()[0]!;
      try {
        if (res.consultas > 0 && pausaMs > 0) await espera(pausaMs);
        res.consultas++;
        const dentro = (await cliente.historico(a, b, ciclo)).filter((l) => l.quando > lac.de && l.quando < lac.ate);
        res.gravadas += await repo.salvar(dentro);
      } catch (e) {
        const msg = `${a} → ${b}: ${(e as Error).message}`;
        res.erros.push(msg);
        log(`  erro ${msg}`);
      }
      a = b;
    }
  }
  return res;
}

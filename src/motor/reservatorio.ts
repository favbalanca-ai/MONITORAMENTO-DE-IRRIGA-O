import type { DataISO } from "./tipos.ts";
import { das } from "./cultura.ts";

/**
 * Reservatório (piscinão) que abastece um ou mais pivôs. A reposição é uma bomba que liga
 * algumas horas por dia: entra `bombaM3h × horasBombaDia` m³ por dia.
 */
export interface Reservatorio {
  nome: string;
  /** Volume útil quando está cheio (m³). */
  volumeUtilM3: number;
  /** Vazão da bomba de reposição (m³/h). */
  bombaM3h: number;
  /** Quantas horas por dia a bomba fica ligada. */
  horasBombaDia: number;
  /** Abaixo disso não dá pra puxar (m³). */
  reservaMinM3: number;
}

/** Nível lançado pelo operador (% do volume útil), válido no fim do dia. */
export interface NivelReservatorio {
  data: DataISO;
  pct: number;
}

/** Água bruta que saiu do reservatório num dia (m³). */
export interface RetiradaM3 {
  data: DataISO;
  m3: number;
}

/** O que cada pivô ligado ao reservatório precisa. */
export interface PivoDoReservatorio {
  nome: string;
  areaHa: number;
  /** Eficiência do pivô (%): a água puxada é a líquida ÷ eficiência. */
  eficienciaPct: number;
  /** Consumo líquido do dia (ETc, mm). */
  etcMm?: number;
  /** Lâmina bruta que o pivô pede hoje (mm), se a decisão foi IRRIGAR. */
  pedidoBrutoMm?: number;
}

export type SemaforoReservatorio = "bom" | "atencao" | "ruim" | "sem";

export interface BalancoReservatorio {
  nome: string;
  volumeUtilM3: number;
  reservaMinM3: number;
  /** Volume estimado hoje (m³) e % do útil; null quando nunca lançaram o nível. */
  volumeM3: number | null;
  pct: number | null;
  /** Último nível lançado e há quantos dias. */
  nivel: NivelReservatorio | null;
  diasDesdeNivel: number | null;
  /** O que entrou de reposição e o que saiu desde o nível lançado (m³). */
  reposicaoDesdeNivelM3: number;
  retiradoDesdeNivelM3: number;
  /** Bomba: m³ por dia. */
  reposicaoDiaM3: number;
  /** Consumo bruto diário dos pivôs ligados (m³/dia) e a área deles. */
  demandaDiaM3: number;
  areaHa: number;
  pivos: string[];
  /** Água que os pivôs pedem hoje (m³) e se o que tem cobre. */
  pedidoHojeM3: number;
  cobreHoje: boolean | null;
  faltaHojeM3: number;
  /** Horas de bomba para cobrir a falta de hoje. */
  horasParaCobrir: number | null;
  /** Dias de irrigação com o que tem + reposição; null = a reposição cobre o consumo. */
  diasAutonomia: number | null;
  /** Dias até encher, quando a reposição ganha do consumo. */
  diasAteEncher: number | null;
  semaforo: SemaforoReservatorio;
  alertas: string[];
}

export const DIAS_NIVEL_VELHO = 7;
export const DIAS_AUTONOMIA_ATENCAO = 3;

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** m³ brutos de uma lâmina líquida num pivô. */
export function retiradaM3(p: { areaHa: number; eficienciaPct: number }, liquidaMm: number): number {
  const ef = p.eficienciaPct > 0 ? p.eficienciaPct / 100 : 1;
  return (liquidaMm / ef) * p.areaHa * 10;
}

export function balancoReservatorio(
  r: Reservatorio,
  niveis: NivelReservatorio[],
  retiradas: RetiradaM3[],
  pivos: PivoDoReservatorio[],
  dia: DataISO,
): BalancoReservatorio {
  const reposicaoDiaM3 = Math.max(0, r.bombaM3h) * Math.max(0, r.horasBombaDia);
  const ultimo = niveis.filter((n) => n.data <= dia).sort((a, b) => (a.data < b.data ? -1 : 1)).pop() ?? null;
  let volumeM3: number | null = null, reposicao = 0, retirado = 0, diasDesde: number | null = null;
  if (ultimo) {
    diasDesde = das(dia, ultimo.data);
    reposicao = reposicaoDiaM3 * diasDesde;
    retirado = retiradas.filter((x) => x.data > ultimo.data && x.data <= dia).reduce((t, x) => t + x.m3, 0);
    volumeM3 = Math.min(r.volumeUtilM3, Math.max(0, (ultimo.pct / 100) * r.volumeUtilM3 + reposicao - retirado));
  }
  const demandaDiaM3 = pivos.reduce((t, p) => t + retiradaM3(p, p.etcMm ?? 0), 0);
  const pedidoHojeM3 = pivos.reduce((t, p) => t + (p.pedidoBrutoMm ? p.pedidoBrutoMm * p.areaHa * 10 : 0), 0);
  const areaHa = pivos.reduce((t, p) => t + p.areaHa, 0);
  const disponivel = volumeM3 === null ? null : Math.max(0, volumeM3 - r.reservaMinM3);
  const faltaHoje = disponivel === null ? 0 : Math.max(0, pedidoHojeM3 - disponivel);
  const cobreHoje = disponivel === null ? null : faltaHoje <= 0;
  const saldoDia = reposicaoDiaM3 - demandaDiaM3;
  let diasAutonomia: number | null = null, diasAteEncher: number | null = null;
  if (disponivel !== null && saldoDia < 0) diasAutonomia = r1(disponivel / -saldoDia);
  if (volumeM3 !== null && saldoDia > 0 && volumeM3 < r.volumeUtilM3) diasAteEncher = r1((r.volumeUtilM3 - volumeM3) / saldoDia);

  const alertas: string[] = [];
  let semaforo: SemaforoReservatorio = "bom";
  if (!ultimo) {
    alertas.push("Sem nível lançado: lance o nível do reservatório (%) para o cálculo valer.");
    semaforo = "sem";
  } else {
    if (diasDesde! > DIAS_NIVEL_VELHO) alertas.push(`Nível lançado há ${diasDesde} dias: confira e lance de novo.`);
    if (volumeM3! <= r.reservaMinM3) { alertas.push("No volume de reserva: não dá pra puxar mais água."); semaforo = "ruim"; }
    else if (cobreHoje === false) { alertas.push(`Falta água pra irrigação de hoje: ${r0(faltaHoje)} m³ a mais do que tem.`); semaforo = "ruim"; }
    else if (diasAutonomia !== null && diasAutonomia < DIAS_AUTONOMIA_ATENCAO) { alertas.push(`Água pra ${diasAutonomia} dia(s) de irrigação: ligue a bomba mais tempo ou escalone os pivôs.`); semaforo = "atencao"; }
    else if (diasDesde! > DIAS_NIVEL_VELHO) semaforo = "atencao";
  }
  return {
    nome: r.nome, volumeUtilM3: r.volumeUtilM3, reservaMinM3: r.reservaMinM3,
    volumeM3: volumeM3 === null ? null : r0(volumeM3),
    pct: volumeM3 === null || r.volumeUtilM3 <= 0 ? null : r0((volumeM3 / r.volumeUtilM3) * 100),
    nivel: ultimo, diasDesdeNivel: diasDesde,
    reposicaoDesdeNivelM3: r0(reposicao), retiradoDesdeNivelM3: r0(retirado),
    reposicaoDiaM3: r0(reposicaoDiaM3), demandaDiaM3: r0(demandaDiaM3), areaHa: r1(areaHa),
    pivos: pivos.map((p) => p.nome),
    pedidoHojeM3: r0(pedidoHojeM3), cobreHoje, faltaHojeM3: r0(faltaHoje),
    horasParaCobrir: faltaHoje > 0 && r.bombaM3h > 0 ? r1(faltaHoje / r.bombaM3h) : null,
    diasAutonomia, diasAteEncher, semaforo, alertas,
  };
}

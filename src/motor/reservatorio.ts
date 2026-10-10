import type { DataISO } from "./tipos.ts";
import { das } from "./cultura.ts";
import type { DiaPrevisao } from "./previsao.ts";
import { chuvaEfetiva, CHUVA_MINIMA_EFETIVA_MM } from "./balanco.ts";

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
  /** Kc de hoje: com a ET₀ prevista dá o consumo dos próximos dias. */
  kc?: number;
}

/** Um dia da projeção do reservatório. */
export interface DiaReservatorio {
  data: DataISO;
  /** Consumo previsto dos pivôs (m³ brutos), já descontada a chuva prevista. */
  consumoM3: number;
  entradaM3: number;
  /** Volume ao fim do dia (m³); null sem nível lançado. */
  volumeM3: number | null;
  chuvaMm: number;
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
  /** Movimento do dia: o que os pivôs puxaram (irrigações lançadas hoje), o que a bomba pôs, saldo. */
  saidaHojeM3: number;
  entradaHojeM3: number;
  saldoHojeM3: number;
  /** Próximos dias com a previsão (ET₀ × Kc, menos a chuva prevista). */
  projecao: DiaReservatorio[];
  /** Consumo médio previsto (m³/dia) e em que dia o volume chega na reserva, se chegar. */
  consumoPrevistoDiaM3: number | null;
  chegaNaReservaEm: DataISO | null;
  /** Horas de bomba por dia pra cobrir o consumo previsto (null sem bomba). */
  horasBombaSugeridas: number | null;
  sugestao: string;
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
  previsao: DiaPrevisao[] = [],
  chuvaMinimaMm = CHUVA_MINIMA_EFETIVA_MM,
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

  // movimento de hoje
  const saidaHoje = retiradas.filter((x) => x.data === dia).reduce((t, x) => t + x.m3, 0);
  const saldoHoje = reposicaoDiaM3 - saidaHoje;

  // próximos dias: consumo = Kc × ET₀ prevista (menos a chuva útil prevista), bruto; volume dia a dia
  const prox = previsao.filter((d) => d.data > dia && d.et0Mm !== null && d.et0Mm !== undefined).slice(0, 7);
  const projecao: DiaReservatorio[] = [];
  let vol = volumeM3, chegaNaReservaEm: DataISO | null = null;
  for (const d of prox) {
    const chuva = chuvaEfetiva(d.chuvaMm ?? 0, chuvaMinimaMm);
    const consumo = pivos.reduce((t, p) => t + retiradaM3(p, Math.max(0, (p.kc ?? 0) * (d.et0Mm as number) - chuva)), 0);
    if (vol !== null) {
      vol = Math.min(r.volumeUtilM3, Math.max(0, vol + reposicaoDiaM3 - consumo));
      if (chegaNaReservaEm === null && vol <= r.reservaMinM3) chegaNaReservaEm = d.data;
    }
    projecao.push({ data: d.data, consumoM3: r0(consumo), entradaM3: r0(reposicaoDiaM3), volumeM3: vol === null ? null : r0(vol), chuvaMm: d.chuvaMm ?? 0 });
  }
  const consumoPrevistoDiaM3 = projecao.length ? r0(projecao.reduce((t, d) => t + d.consumoM3, 0) / projecao.length) : null;
  const base = consumoPrevistoDiaM3 ?? demandaDiaM3;
  const horasBombaSugeridas = r.bombaM3h > 0 ? Math.min(24, r1(base / r.bombaM3h)) : null;
  let sugestao = "";
  if (!pivos.length) sugestao = "Nenhum pivô ligado a este reservatório: escolha-o em Fonte de água no cadastro do pivô.";
  else if (r.bombaM3h <= 0) sugestao = `Sem bomba de reposição cadastrada: o piscinão só esvazia (${n0_(base)} m³/dia previstos).`;
  else if (horasBombaSugeridas !== null && horasBombaSugeridas > r.horasBombaDia + 0.5) sugestao = `Pra segurar o nível, a bomba precisa de ${n1_(horasBombaSugeridas)} h/dia (hoje são ${n1_(r.horasBombaDia)} h): consumo previsto de ${n0_(base)} m³/dia contra ${n0_(reposicaoDiaM3)} m³/dia de entrada.`;
  else if (horasBombaSugeridas !== null && horasBombaSugeridas < r.horasBombaDia - 1 && volumeM3 !== null && volumeM3 >= r.volumeUtilM3 * 0.95) sugestao = `Piscinão cheio e consumo previsto de ${n0_(base)} m³/dia: ${n1_(horasBombaSugeridas)} h/dia de bomba bastam (economia de energia).`;
  else if (horasBombaSugeridas !== null) sugestao = `${n1_(r.horasBombaDia)} h/dia de bomba cobrem o consumo previsto de ${n0_(base)} m³/dia.`;
  if (chegaNaReservaEm) sugestao += ` Mantendo assim, chega na reserva em ${chegaNaReservaEm.slice(8, 10)}/${chegaNaReservaEm.slice(5, 7)}.`;

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
    diasAutonomia, diasAteEncher,
    saidaHojeM3: r0(saidaHoje), entradaHojeM3: r0(reposicaoDiaM3), saldoHojeM3: r0(saldoHoje),
    projecao, consumoPrevistoDiaM3, chegaNaReservaEm, horasBombaSugeridas, sugestao,
    semaforo, alertas,
  };
}

function n1_(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace(".", ",");
}
function n0_(x: number): string {
  return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

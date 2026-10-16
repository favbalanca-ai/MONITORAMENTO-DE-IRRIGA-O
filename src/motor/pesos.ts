/**
 * Placar dos modelos: compara o que cada modelo previu (1 a 7 dias antes) com o que a estação mediu e dá
 * peso a quem acertou mais nas últimas semanas. O peso vai mudando com o histórico recente (meia-vida de
 * 7 dias: um erro de 2 semanas atrás pesa um quarto de um erro de ontem).
 */
import type { DataISO } from "./tipos.ts";
import type { DiaPrevisao } from "./previsao.ts";

/** O que um modelo previu numa rodada para um dia-alvo. */
export interface RegistroModelo {
  emissao: DataISO;
  alvo: DataISO;
  modelo: string;
  chuvaMm: number | null;
  tmax: number | null;
  tmin: number | null;
}

/** O que a estação mediu num dia. */
export interface ObservacaoDia {
  data: DataISO;
  chuvaMm: number | null;
  tmax: number | null;
  tmin: number | null;
}

export interface PlacarModelo {
  modelo: string;
  /** Previsões comparadas (dias × antecedências). */
  n: number;
  /** Erro médio absoluto, ponderado pela idade (mm e °C). */
  maeChuva: number | null;
  maeTemp: number | null;
  /** % de dias em que acertou "chove ou não" (≥ 1 mm). */
  acertoChuvaPct: number | null;
  /** Peso final (soma 1 entre os modelos que entram no consenso). */
  peso: number;
}

export interface PesosModelos {
  calculadoEm: DataISO;
  /** Quantos dias de comparação havia (dias-alvo distintos já medidos). */
  diasComparados: number;
  /** false = pouca história (< 5 dias): pesos iguais. */
  suficiente: boolean;
  modelos: PlacarModelo[];
}

export interface OpcoesPesos {
  /** Só comparações com alvo nos últimos N dias. */
  janelaDias?: number;
  /** Meia-vida (dias) do peso de cada comparação. */
  meiaVidaDias?: number;
  /** Antecedência máxima (dias entre emissão e alvo) que entra na conta. */
  antecedenciaMax?: number;
  /** Mínimo de dias-alvo medidos para os pesos valerem. */
  minimoDias?: number;
}

const dias = (a: DataISO, b: DataISO): number => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Calcula o placar e os pesos. `hoje` é a data local; só entram alvos anteriores a hoje. */
export function calcularPesos(registros: RegistroModelo[], observacoes: ObservacaoDia[], hoje: DataISO, op: OpcoesPesos = {}): PesosModelos {
  const janela = op.janelaDias ?? 30, meiaVida = op.meiaVidaDias ?? 7, antMax = op.antecedenciaMax ?? 7, minimo = op.minimoDias ?? 5;
  const obs = new Map<DataISO, ObservacaoDia>();
  for (const o of observacoes) obs.set(o.data, o);
  type Acum = { wChuva: number; eChuva: number; wTemp: number; eTemp: number; wSim: number; acertos: number; n: number; alvos: Set<DataISO> };
  const acum = new Map<string, Acum>();
  const alvosGerais = new Set<DataISO>();
  for (const r of registros) {
    if (r.alvo >= hoje) continue;
    const idade = dias(r.alvo, hoje);
    if (idade > janela) continue;
    const ant = dias(r.emissao, r.alvo);
    if (ant < 1 || ant > antMax) continue;
    const o = obs.get(r.alvo);
    if (!o) continue;
    const w = Math.pow(0.5, idade / meiaVida);
    let a = acum.get(r.modelo);
    if (!a) { a = { wChuva: 0, eChuva: 0, wTemp: 0, eTemp: 0, wSim: 0, acertos: 0, n: 0, alvos: new Set() }; acum.set(r.modelo, a); }
    let contou = false;
    if (r.chuvaMm !== null && o.chuvaMm !== null) {
      a.wChuva += w; a.eChuva += w * Math.abs(r.chuvaMm - o.chuvaMm);
      a.wSim += w; if ((r.chuvaMm >= 1) === (o.chuvaMm >= 1)) a.acertos += w;
      contou = true;
    }
    const erros: number[] = [];
    if (r.tmax !== null && o.tmax !== null) erros.push(Math.abs(r.tmax - o.tmax));
    if (r.tmin !== null && o.tmin !== null) erros.push(Math.abs(r.tmin - o.tmin));
    if (erros.length) { a.wTemp += w; a.eTemp += (w * erros.reduce((s, x) => s + x, 0)) / erros.length; contou = true; }
    if (contou) { a.n++; a.alvos.add(r.alvo); alvosGerais.add(r.alvo); }
  }
  const placar: PlacarModelo[] = [];
  for (const [modelo, a] of acum) {
    if (!a.n) continue;
    placar.push({
      modelo, n: a.n,
      maeChuva: a.wChuva > 0 ? r2(a.eChuva / a.wChuva) : null,
      maeTemp: a.wTemp > 0 ? r2(a.eTemp / a.wTemp) : null,
      acertoChuvaPct: a.wSim > 0 ? Math.round((100 * a.acertos) / a.wSim) : null,
      peso: 0,
    });
  }
  const suficiente = alvosGerais.size >= minimo && placar.length >= 2;
  if (!suficiente) {
    // sem história: todos iguais (a lista pode estar vazia; quem consome trata)
    const n = placar.length || 1;
    for (const p of placar) p.peso = r2(1 / n);
    return { calculadoEm: hoje, diasComparados: alvosGerais.size, suficiente: false, modelos: placar.sort((x, y) => x.modelo.localeCompare(y.modelo)) };
  }
  // pontuação: quanto menor o erro em relação à mediana dos modelos, maior o peso (chuva 60 %, temperatura 40 %)
  const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };
  const medChuva = mediana(placar.map((p) => p.maeChuva).filter((x): x is number => x !== null));
  const medTemp = mediana(placar.map((p) => p.maeTemp).filter((x): x is number => x !== null));
  const razao = (ref: number, x: number | null) => (x === null ? 1 : (ref + 0.5) / (x + 0.5)); // +0,5 evita dividir por zero e exageros
  const bruto = placar.map((p) => {
    const s = 0.6 * razao(medChuva, p.maeChuva) + 0.4 * razao(medTemp, p.maeTemp);
    return Math.max(0.33, Math.min(3, s * s)); // ao quadrado para separar; entre 1/3 e 3× do peso igual
  });
  const soma = bruto.reduce((s, x) => s + x, 0);
  placar.forEach((p, i) => { p.peso = r2(bruto[i]! / soma); });
  return { calculadoEm: hoje, diasComparados: alvosGerais.size, suficiente: true, modelos: placar.sort((x, y) => y.peso - x.peso) };
}

export interface Consenso {
  chuvaMm: number;
  probPct: number | null;
  tmax: number | null;
  tmin: number | null;
  /** Modelos que entraram (os que têm número para o dia) e o peso somado deles. */
  modelos: number;
}

/**
 * Consenso ponderado de um dia: média dos modelos pela pontuação do placar. Modelo sem número no dia fica de
 * fora e os pesos se renormalizam. A chance = parcela ponderada dos modelos com ≥ 1 mm, misturada meio a meio
 * com o ensemble quando ele existe.
 */
export function consensoPonderado(dia: DiaPrevisao, pesos: PesosModelos | null): Consenso | null {
  if (!dia.modelos || dia.modelos.length < 2) return null;
  const peso = new Map<string, number>();
  if (pesos && pesos.suficiente) for (const p of pesos.modelos) peso.set(p.modelo, p.peso);
  let sw = 0, chuva = 0, swT = 0, tmax = 0, tmin = 0, comChuva = 0, n = 0;
  for (const m of dia.modelos) {
    const w = peso.size ? (peso.get(m.nome) ?? 0.5 / peso.size) : 1; // modelo novo no placar: meio peso
    if (m.chuvaMm !== null) { sw += w; chuva += w * m.chuvaMm; if (m.chuvaMm >= 1) comChuva += w; n++; }
    if (m.tmax !== null && m.tmin !== null) { swT += w; tmax += w * m.tmax; tmin += w * m.tmin; }
  }
  if (!sw) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  let prob: number | null = Math.round((100 * comChuva) / sw);
  if (dia.ensemble) prob = Math.round((dia.ensemble.probPct + prob) / 2);
  return { chuvaMm: r1(chuva / sw), probPct: prob, tmax: swT ? r1(tmax / swT) : null, tmin: swT ? r1(tmin / swT) : null, modelos: n };
}

/**
 * Aplica o consenso aos dias: `chuvaMm`, `probPct`, `tmax` e `tmin` passam a ser os ponderados e os valores
 * do "melhor ajuste" ficam guardados em `modeloMm`/`probModeloPct`. Sem placar suficiente, não mexe.
 */
export function aplicarPesos(dias: DiaPrevisao[], pesos: PesosModelos | null): DiaPrevisao[] {
  if (!pesos || !pesos.suficiente) return dias;
  return dias.map((d) => {
    const c = consensoPonderado(d, pesos);
    if (!c) return d;
    const e: DiaPrevisao = { ...d, consenso: c, modeloMm: d.chuvaMm, chuvaMm: c.chuvaMm };
    if (c.probPct !== null) { if (e.probModeloPct === undefined) e.probModeloPct = d.probPct; e.probPct = c.probPct; }
    if (c.tmax !== null && c.tmin !== null) { e.tmax = c.tmax; e.tmin = c.tmin; }
    return e;
  });
}

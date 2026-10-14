/**
 * Previsão do tempo para os próximos dias: números (mm, %) do Open-Meteo e texto oficial do INMET.
 * A previsão NÃO entra no balanço — chuva prevista nem sempre cai. Ela vira aviso quando a chuva
 * esperada cobre o déficit, para a dona decidir se adia a irrigação.
 */
import type { DataISO } from "./tipos.ts";

export interface DiaPrevisao {
  data: DataISO;
  /** Chuva prevista (mm). `null` quando só há o texto do INMET. */
  chuvaMm: number | null;
  /** Probabilidade máxima de chuva no dia (%). */
  probPct: number | null;
  tmin: number | null;
  tmax: number | null;
  /** ET₀ FAO prevista (mm), do Open-Meteo. */
  et0Mm?: number | null;
  /** Código WMO do tempo (0 = céu limpo … 99 = tempestade com granizo), do Open-Meteo. */
  codigoTempo?: number | null;
  /** Descrição do tempo em português, a partir do código WMO ("Sol", "Pancadas de chuva"…). */
  tempo?: string;
  /** Umidade relativa média do dia (%). */
  urPct?: number | null;
  /** Vento máximo a 10 m (km/h) e rajada máxima (km/h). */
  ventoKmh?: number | null;
  rajadaKmh?: number | null;
  /** Radiação solar do dia (MJ/m²). */
  radiacaoMJ?: number | null;
  /** Horas de sol no dia. */
  solH?: number | null;
  /** Índice UV máximo. */
  uvMax?: number | null;
  /** Horas com chuva no dia. */
  horasChuva?: number | null;
  /** O que cada modelo numérico prevê para o dia (ECMWF, GFS, ICON…). Vazio quando a resposta só tem um modelo. */
  modelos?: ModeloDia[];
  /** Faixa e concordância entre os modelos para a chuva do dia. */
  faixaChuva?: FaixaChuva;
  /** Conjunto (ensemble) do ECMWF: chance contada nas 51 rodadas e faixa. Quando existe, `probPct` vem dele. */
  ensemble?: EnsembleDia;
  /** Chance que o modelo "melhor ajuste" dava, guardada quando o ensemble assume `probPct`. */
  probModeloPct?: number | null;
  /** Como a previsão deste dia mudou de uma rodada para outra (a planilha anexa, do histórico). */
  tendencia?: TendenciaPrevisao;
  /** Texto do INMET por turno ("manhã: sol; tarde: pancadas de chuva…"). */
  resumo?: string;
}

export interface ModeloDia {
  /** Nome curto do modelo ("ECMWF", "GFS"…). */
  nome: string;
  chuvaMm: number | null;
  tmax: number | null;
  tmin: number | null;
}

export interface FaixaChuva {
  minMm: number;
  maxMm: number;
  medianaMm: number;
  /** Quantos modelos preveem chuva de pelo menos 1 mm, e quantos responderam. */
  comChuva: number;
  modelos: number;
}

/**
 * Modelos numéricos pedidos ao Open-Meteo além do "melhor ajuste" (best_match, que o Open-Meteo escolhe
 * para o lugar). Cada um vem de um centro meteorológico diferente — comparar ajuda a ver se a chuva é
 * consenso ou chute de um modelo só.
 */
export const MODELOS_PREVISAO: { id: string; nome: string; origem: string }[] = [
  { id: "best_match", nome: "Melhor ajuste", origem: "Open-Meteo" },
  { id: "ecmwf_ifs025", nome: "ECMWF", origem: "Europa" },
  { id: "gfs_seamless", nome: "GFS", origem: "EUA (NOAA)" },
  { id: "icon_seamless", nome: "ICON", origem: "Alemanha (DWD)" },
  { id: "gem_seamless", nome: "GEM", origem: "Canadá" },
  { id: "meteofrance_seamless", nome: "Météo-France", origem: "França" },
  { id: "ukmo_seamless", nome: "UKMO", origem: "Reino Unido (Met Office)" },
  { id: "jma_seamless", nome: "JMA", origem: "Japão" },
  { id: "ecmwf_aifs025", nome: "ECMWF AIFS", origem: "Europa (modelo de IA)" },
];

/** Resumo das 51 rodadas do conjunto (ensemble) do ECMWF para a chuva de um dia. */
export interface EnsembleDia {
  /** Rodadas com pelo menos 1 mm ÷ rodadas (%). É a chance de chuva "contada". */
  probPct: number;
  minMm: number;
  p10Mm: number;
  p50Mm: number;
  p90Mm: number;
  maxMm: number;
  membros: number;
}

export interface Previsao {
  /** Quando foi buscada (hora local da estação). */
  atualizadoEm: string;
  dias: DiaPrevisao[];
  /** Fontes que responderam ("Open-Meteo", "INMET"). */
  fontes: string[];
}

export const INMET_URL = "https://apiprevmet3.inmet.gov.br/previsao/";

/**
 * Pede 14 dias à frente (o máximo útil do Open-Meteo é 16) e os 7 passados: a ET₀ deles tapa dias em que a
 * estação ficou sem leituras. Vento em km/h.
 */
export function urlOpenMeteo(latitude: number, longitude: number, fuso: string, dias = 14, passados = 7, modelos: string[] = MODELOS_PREVISAO.map((m) => m.id)): string {
  return (
    "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
    "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration" +
    ",weather_code,relative_humidity_2m_mean,wind_speed_10m_max,wind_gusts_10m_max,shortwave_radiation_sum,sunshine_duration,uv_index_max,precipitation_hours" +
    "&wind_speed_unit=kmh&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias + "&past_days=" + passados +
    (modelos.length > 1 ? "&models=" + modelos.join(",") : "")
  );
}

/** Conjunto (ensemble) do ECMWF: chuva hora a hora de cada uma das 51 rodadas, 14 dias. */
export function urlOpenMeteoEnsemble(latitude: number, longitude: number, fuso: string, dias = 14): string {
  return (
    "https://ensemble-api.open-meteo.com/v1/ensemble?latitude=" + latitude + "&longitude=" + longitude +
    "&hourly=precipitation&models=ecmwf_ifs025&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias
  );
}

const quantil = (ordenado: number[], q: number): number => {
  if (!ordenado.length) return 0;
  const pos = (ordenado.length - 1) * q, i = Math.floor(pos), f = pos - i;
  return i + 1 < ordenado.length ? ordenado[i]! * (1 - f) + ordenado[i + 1]! * f : ordenado[i]!;
};

/**
 * Resposta do ensemble (`hourly.precipitation`, `hourly.precipitation_member01`… ou a série diária
 * `daily.precipitation_sum*`) → por dia, a chuva de cada rodada e o resumo (chance ≥ 1 mm, faixa).
 */
export function lerEnsemble(json: unknown): Map<DataISO, EnsembleDia> {
  const raiz = json as { hourly?: Record<string, unknown[]>; daily?: Record<string, unknown[]> } | null;
  const h = raiz?.hourly, dd = raiz?.daily;
  const serie = h && Array.isArray(h["time"]) ? h : dd && Array.isArray(dd["time"]) ? dd : null;
  if (!serie) throw new Error("Ensemble: resposta sem série de chuva.");
  const base = serie === h ? "precipitation" : "precipitation_sum";
  const chaves = Object.keys(serie).filter((k) => k === base || new RegExp("^" + base + "_member\\d+$").test(k));
  if (!chaves.length) throw new Error("Ensemble: resposta sem as rodadas de chuva.");
  const porDia = new Map<DataISO, number[]>();
  const tempos = serie["time"] as unknown[];
  tempos.forEach((t, i) => {
    const data = String(t).slice(0, 10);
    let v = porDia.get(data);
    if (!v) { v = new Array<number>(chaves.length).fill(0); porDia.set(data, v); }
    const soma = v;
    chaves.forEach((k, m) => { const x = num(serie[k]?.[i]); if (x !== null) soma[m] = (soma[m] ?? 0) + x; });
  });
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const out = new Map<DataISO, EnsembleDia>();
  for (const [data, v] of porDia) {
    const ord = [...v].sort((a, b) => a - b);
    out.set(data, {
      probPct: Math.round((100 * ord.filter((x) => x >= 1).length) / ord.length),
      minMm: r1(ord[0]!), p10Mm: r1(quantil(ord, 0.1)), p50Mm: r1(quantil(ord, 0.5)), p90Mm: r1(quantil(ord, 0.9)), maxMm: r1(ord[ord.length - 1]!),
      membros: ord.length,
    });
  }
  return out;
}

/** Anexa o ensemble aos dias: a chance de chuva passa a ser a contada nas rodadas; a do modelo fica em `probModeloPct`. */
export function aplicarEnsemble(dias: DiaPrevisao[], ensemble: Map<DataISO, EnsembleDia>): DiaPrevisao[] {
  return dias.map((d) => {
    const e = ensemble.get(d.data);
    if (!e) return d;
    return { ...d, ensemble: e, probModeloPct: d.probPct, probPct: e.probPct };
  });
}

/** Faixa de chuva entre os modelos do dia (mediana, mínimo, máximo e quantos preveem ≥ 1 mm). */
export function faixaChuva(modelos: ModeloDia[]): FaixaChuva | undefined {
  const v = modelos.map((m) => m.chuvaMm).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length < 2) return undefined;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const meio = v.length / 2;
  const mediana = v.length % 2 ? v[Math.floor(meio)]! : (v[meio - 1]! + v[meio]!) / 2;
  return { minMm: r1(v[0]!), maxMm: r1(v[v.length - 1]!), medianaMm: r1(mediana), comChuva: v.filter((x) => x >= 1).length, modelos: v.length };
}

/** Código WMO (Open-Meteo `weather_code`) → texto curto em português. */
export function descricaoTempo(codigo: number | null | undefined): string {
  if (codigo === null || codigo === undefined || !Number.isFinite(codigo)) return "";
  const c = Math.round(codigo);
  if (c === 0) return "Sol";
  if (c === 1) return "Sol com poucas nuvens";
  if (c === 2) return "Parcialmente nublado";
  if (c === 3) return "Nublado";
  if (c === 45 || c === 48) return "Nevoeiro";
  if (c === 51 || c === 53 || c === 55) return "Garoa";
  if (c === 56 || c === 57) return "Garoa gelada";
  if (c === 61) return "Chuva fraca";
  if (c === 63) return "Chuva moderada";
  if (c === 65) return "Chuva forte";
  if (c === 66 || c === 67) return "Chuva gelada";
  if (c >= 71 && c <= 77) return "Neve";
  if (c === 80) return "Pancadas de chuva fracas";
  if (c === 81) return "Pancadas de chuva";
  if (c === 82) return "Pancadas de chuva fortes";
  if (c === 85 || c === 86) return "Pancadas de neve";
  if (c === 95) return "Tempestade";
  if (c === 96 || c === 99) return "Tempestade com granizo";
  return "";
}

/** Ícone (emoji) para o código WMO — o app e o relatório usam. */
export function iconeTempo(codigo: number | null | undefined): string {
  if (codigo === null || codigo === undefined || !Number.isFinite(codigo)) return "";
  const c = Math.round(codigo);
  if (c === 0) return "☀️";
  if (c === 1) return "🌤️";
  if (c === 2) return "⛅";
  if (c === 3) return "☁️";
  if (c === 45 || c === 48) return "🌫️";
  if (c >= 51 && c <= 57) return "🌦️";
  if (c >= 61 && c <= 67) return "🌧️";
  if (c >= 71 && c <= 77) return "🌨️";
  if (c >= 80 && c <= 82) return "🌦️";
  if (c === 85 || c === 86) return "🌨️";
  if (c >= 95) return "⛈️";
  return "";
}

export interface ResumoPrevisao {
  dias: number;
  chuvaMm: number;
  et0Mm: number | null;
  /** chuva − ET₀ no período (mm): negativo = a cultura perde mais do que a chuva repõe. */
  saldoMm: number | null;
  diasComChuva: number;
  tmaxAbs: number | null;
  tminAbs: number | null;
  ate: DataISO | null;
}

/** Totais dos próximos `n` dias depois de `hoje` (chuva, ET₀, saldo, extremos de temperatura). */
export function resumoPrevisao(previsao: DiaPrevisao[], hoje: DataISO, n = 7): ResumoPrevisao {
  const prox = previsao.filter((d) => d.data > hoje).slice(0, n);
  let chuva = 0, et0 = 0, temEt0 = false, comChuva = 0;
  let tmax: number | null = null, tmin: number | null = null;
  for (const d of prox) {
    chuva += d.chuvaMm ?? 0;
    if ((d.chuvaMm ?? 0) >= 1) comChuva++;
    if (d.et0Mm !== null && d.et0Mm !== undefined) { et0 += d.et0Mm; temEt0 = true; }
    if (d.tmax !== null) tmax = tmax === null ? d.tmax : Math.max(tmax, d.tmax);
    if (d.tmin !== null) tmin = tmin === null ? d.tmin : Math.min(tmin, d.tmin);
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    dias: prox.length, chuvaMm: r1(chuva), et0Mm: temEt0 ? r1(et0) : null, saldoMm: temEt0 ? r1(chuva - et0) : null,
    diasComChuva: comChuva, tmaxAbs: tmax, tminAbs: tmin, ate: prox.length ? prox[prox.length - 1]!.data : null,
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Resposta do Open-Meteo (`daily.time[]` + séries) → um item por dia. Com vários modelos pedidos, cada
 * série vem com o sufixo do modelo (`precipitation_sum_ecmwf_ifs025`); o "melhor ajuste" vira o valor
 * principal e os demais entram em `modelos`.
 */
export function lerOpenMeteo(json: unknown): DiaPrevisao[] {
  const bruto = (json as { daily?: Record<string, unknown[]> } | null)?.daily;
  if (!bruto || !Array.isArray(bruto["time"])) throw new Error("Open-Meteo: resposta sem a série diária.");
  const multi = !bruto["precipitation_sum"] && !!bruto["precipitation_sum_best_match"];
  // d = séries principais (sem sufixo, ou as do best_match)
  const d: Record<string, unknown[]> = multi
    ? Object.fromEntries(Object.entries(bruto).map(([k, v]) => [k.replace(/_best_match$/, ""), v]))
    : bruto;
  const outros = multi
    ? MODELOS_PREVISAO.filter((m) => m.id !== "best_match" && Array.isArray(bruto["precipitation_sum_" + m.id]))
    : [];
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  return d["time"]!.map((t, i) => {
    const dia: DiaPrevisao = {
      data: String(t).slice(0, 10),
      chuvaMm: num(d["precipitation_sum"]?.[i]),
      probPct: num(d["precipitation_probability_max"]?.[i]),
      tmax: num(d["temperature_2m_max"]?.[i]),
      tmin: num(d["temperature_2m_min"]?.[i]),
      et0Mm: num(d["et0_fao_evapotranspiration"]?.[i]),
    };
    // campos novos: só entram quando a resposta os traz (respostas antigas guardadas continuam valendo)
    const cod = num(d["weather_code"]?.[i]);
    if (cod !== null) { dia.codigoTempo = cod; dia.tempo = descricaoTempo(cod); }
    if (d["relative_humidity_2m_mean"]) dia.urPct = num(d["relative_humidity_2m_mean"]?.[i]);
    if (d["wind_speed_10m_max"]) dia.ventoKmh = num(d["wind_speed_10m_max"]?.[i]);
    if (d["wind_gusts_10m_max"]) dia.rajadaKmh = num(d["wind_gusts_10m_max"]?.[i]);
    if (d["shortwave_radiation_sum"]) dia.radiacaoMJ = num(d["shortwave_radiation_sum"]?.[i]);
    if (d["sunshine_duration"]) dia.solH = r1(num(d["sunshine_duration"]?.[i]) === null ? null : num(d["sunshine_duration"]?.[i])! / 3600);
    if (d["uv_index_max"]) dia.uvMax = num(d["uv_index_max"]?.[i]);
    if (d["precipitation_hours"]) dia.horasChuva = num(d["precipitation_hours"]?.[i]);
    if (outros.length) {
      const modelos: ModeloDia[] = [{ nome: MODELOS_PREVISAO[0]!.nome, chuvaMm: dia.chuvaMm, tmax: dia.tmax, tmin: dia.tmin }];
      for (const m of outros) {
        modelos.push({ nome: m.nome, chuvaMm: num(bruto["precipitation_sum_" + m.id]?.[i]), tmax: num(bruto["temperature_2m_max_" + m.id]?.[i]), tmin: num(bruto["temperature_2m_min_" + m.id]?.[i]) });
      }
      // modelos que não chegam até esse dia (horizonte menor) ficam de fora
      dia.modelos = modelos.filter((m) => m.chuvaMm !== null || m.tmax !== null);
      const f = faixaChuva(dia.modelos);
      if (f) dia.faixaChuva = f;
    }
    return dia;
  });
}

/**
 * Resposta do INMET (`{ "<ibge>": { "dd/mm/aaaa": { manha, tarde, noite } | {...} } }`) → um item por dia,
 * com o resumo por turno. Os dois primeiros dias vêm por turno; os demais, inteiros.
 */
export function lerInmet(json: unknown): DiaPrevisao[] {
  const raiz = json as Record<string, Record<string, Record<string, unknown>>> | null;
  const porCidade = raiz && Object.values(raiz)[0];
  if (!porCidade || typeof porCidade !== "object") throw new Error("INMET: resposta sem previsão para o município.");
  const dias: DiaPrevisao[] = [];
  for (const [dataBr, v] of Object.entries(porCidade)) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr);
    if (!m || !v || typeof v !== "object") continue;
    const data = `${m[3]}-${m[2]}-${m[1]}`;
    const turnos = (["manha", "tarde", "noite"] as const).filter((t) => v[t] && typeof v[t] === "object");
    const partes = turnos.length ? turnos.map((t) => v[t] as Record<string, unknown>) : [v];
    const rotulo = { manha: "manhã", tarde: "tarde", noite: "noite" };
    const resumo = turnos.length
      ? turnos.map((t, i) => `${rotulo[t]}: ${String(partes[i]!["resumo"] ?? "").toLowerCase()}`).join("; ")
      : String(v["resumo"] ?? "").toLowerCase();
    const tmaxs = partes.map((p) => num(p["temp_max"])).filter((x): x is number => x !== null);
    const tmins = partes.map((p) => num(p["temp_min"])).filter((x): x is number => x !== null);
    dias.push({
      data,
      chuvaMm: null,
      probPct: null,
      tmax: tmaxs.length ? Math.max(...tmaxs) : null,
      tmin: tmins.length ? Math.min(...tmins) : null,
      resumo: resumo.replace(/\s+/g, " ").trim(),
    });
  }
  return dias.sort((a, b) => (a.data < b.data ? -1 : 1));
}

/** Junta números do Open-Meteo com o texto do INMET pela data. Qualquer uma das listas pode faltar. */
export function juntarPrevisao(openMeteo: DiaPrevisao[], inmet: DiaPrevisao[]): DiaPrevisao[] {
  const porData = new Map<DataISO, DiaPrevisao>();
  for (const d of openMeteo) porData.set(d.data, { ...d });
  for (const d of inmet) {
    const x = porData.get(d.data);
    if (x) {
      if (d.resumo) x.resumo = d.resumo;
      if (x.tmax === null) x.tmax = d.tmax;
      if (x.tmin === null) x.tmin = d.tmin;
    } else porData.set(d.data, { ...d });
  }
  return [...porData.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
}

/** Chuva prevista (mm) e probabilidade máxima nos próximos `dias` depois de `hoje`. */
export function chuvaPrevista(previsao: DiaPrevisao[], hoje: DataISO, dias = 2): { mm: number; probPct: number | null; ate: DataISO | null } {
  const prox = previsao.filter((d) => d.data > hoje).slice(0, dias);
  let mm = 0, prob: number | null = null;
  for (const d of prox) {
    mm += d.chuvaMm ?? 0;
    if (d.probPct !== null) prob = Math.max(prob ?? 0, d.probPct);
  }
  return { mm: Math.round(mm * 10) / 10, probPct: prob, ate: prox.length ? prox[prox.length - 1]!.data : null };
}

const dBr = (d: DataISO) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Aviso para um pivô com decisão IRRIGAR: se a chuva prevista nos próximos 2 dias cobre ≥ 80% do déficit
 * com probabilidade ≥ 50%, vale pensar em adiar. Sem previsão numérica, não avisa.
 */
export function avisoChuva(deficitMm: number, previsao: DiaPrevisao[], hoje: DataISO): string | null {
  const p = chuvaPrevista(previsao, hoje, 2);
  if (!p.ate || p.mm <= 0 || deficitMm <= 0) return null;
  if (p.mm < 0.8 * deficitMm || (p.probPct !== null && p.probPct < 50)) return null;
  const prob = p.probPct !== null ? ` (${Math.round(p.probPct)}% de chance)` : "";
  return `Previsão de ${p.mm.toFixed(1).replace(".", ",")} mm de chuva até ${dBr(p.ate)}${prob} cobre o déficit: avalie adiar a irrigação.`;
}

/* ------------------------------ pulverização: hora a hora ------------------------------ */

export interface HoraPrevisao {
  /** Hora local "YYYY-MM-DDTHH:00". */
  quando: string;
  tempC: number | null;
  urPct: number | null;
  ventoMs: number | null;
  rajadaMs: number | null;
  chuvaMm: number | null;
  probPct: number | null;
}

export function urlOpenMeteoHoras(latitude: number, longitude: number, fuso: string, dias = 3): string {
  return (
    "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
    "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability" +
    "&wind_speed_unit=ms&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias
  );
}

export function lerOpenMeteoHoras(json: unknown): HoraPrevisao[] {
  const h = (json as { hourly?: Record<string, unknown[]> } | null)?.hourly;
  if (!h || !Array.isArray(h["time"])) throw new Error("Open-Meteo: resposta sem a série horária.");
  return h["time"].map((t, i) => ({
    quando: String(t).slice(0, 13) + ":00",
    tempC: num(h["temperature_2m"]?.[i]),
    urPct: num(h["relative_humidity_2m"]?.[i]),
    ventoMs: num(h["wind_speed_10m"]?.[i]),
    rajadaMs: num(h["wind_gusts_10m"]?.[i]),
    chuvaMm: num(h["precipitation"]?.[i]),
    probPct: num(h["precipitation_probability"]?.[i]),
  }));
}

/** Temperatura de bulbo úmido (°C) por T e UR — Stull (2011). */
export function bulboUmido(tempC: number, urPct: number): number {
  return tempC * Math.atan(0.151977 * Math.sqrt(urPct + 8.313659)) + Math.atan(tempC + urPct) - Math.atan(urPct - 1.676331) +
    0.00391838 * Math.pow(urPct, 1.5) * Math.atan(0.023101 * urPct) - 4.686035;
}
export const deltaT = (tempC: number, urPct: number): number => tempC - bulboUmido(tempC, urPct);

export type NivelAplicacao = "bom" | "atencao" | "ruim";
export interface CondicoesAplicacao { deltaT: number; nivel: NivelAplicacao; motivos: [NivelAplicacao, string][] }

/** Faixas usuais (Embrapa/ANDEF), uma só para qualquer pulverização. Vento em km/h: [bom até, atenção até]. */
export const FAIXAS_APLICACAO = {
  deltaT: { minimo: 2, idealAte: 8, atencaoAte: 10 },
  ventoKmh: { minimo: 3, bomAte: 10, atencaoAte: 15 },
  ur: { atencaoAbaixo: 55, ruimAbaixo: 50 },
  temp: { atencaoAcima: 30, ruimAcima: 35 },
};

const dec1 = (x: number) => x.toFixed(1).replace(".", ",");
const int0 = (x: number) => String(Math.round(x));

/**
 * Condições de pulverização para um instante (leitura da estação ou hora prevista).
 * O nível é o pior item; os motivos explicam.
 */
export function condicoesAplicacao(x: { tempC: number; urPct: number; ventoMs?: number | null; rajadaMs?: number | null; chovendo?: boolean }): CondicoesAplicacao {
  const F = FAIXAS_APLICACAO;
  const dt = deltaT(x.tempC, x.urPct);
  const ventoKmh = x.ventoMs == null ? null : x.ventoMs * 3.6;
  const rajadaKmh = x.rajadaMs == null ? null : x.rajadaMs * 3.6;
  const ORDEM: Record<NivelAplicacao, number> = { bom: 0, atencao: 1, ruim: 2 };
  const motivos: [NivelAplicacao, string][] = [];
  let pior: NivelAplicacao = "bom";
  const marca = (nivel: NivelAplicacao, texto: string) => { motivos.push([nivel, texto]); if (ORDEM[nivel] > ORDEM[pior]) pior = nivel; };
  if (dt < F.deltaT.minimo) marca("ruim", `Delta T ${dec1(dt)} °C: abaixo de ${F.deltaT.minimo} — gota não seca, risco de inversão térmica`);
  else if (dt <= F.deltaT.idealAte) marca("bom", `Delta T ${dec1(dt)} °C: ideal (${F.deltaT.minimo} a ${F.deltaT.idealAte})`);
  else if (dt <= F.deltaT.atencaoAte) marca("atencao", `Delta T ${dec1(dt)} °C: alto — só com gota grossa`);
  else marca("ruim", `Delta T ${dec1(dt)} °C: acima de ${F.deltaT.atencaoAte} — a gota evapora antes de chegar`);
  if (ventoKmh !== null) {
    if (ventoKmh < F.ventoKmh.minimo) marca("atencao", `Vento ${int0(ventoKmh)} km/h: calmaria — deriva imprevisível, inversão`);
    else if (ventoKmh <= F.ventoKmh.bomAte) marca("bom", `Vento ${int0(ventoKmh)} km/h: ideal (${F.ventoKmh.minimo} a ${F.ventoKmh.bomAte})`);
    else if (ventoKmh <= F.ventoKmh.atencaoAte) marca("atencao", `Vento ${int0(ventoKmh)} km/h: no limite (${F.ventoKmh.bomAte} a ${F.ventoKmh.atencaoAte})`);
    else marca("ruim", `Vento ${int0(ventoKmh)} km/h: acima de ${F.ventoKmh.atencaoAte} — deriva`);
    if (rajadaKmh !== null && rajadaKmh > F.ventoKmh.atencaoAte && ventoKmh <= F.ventoKmh.atencaoAte) marca("atencao", `Rajadas de ${int0(rajadaKmh)} km/h`);
  }
  if (x.urPct < F.ur.ruimAbaixo) marca("ruim", `UR ${int0(x.urPct)}%: abaixo de ${F.ur.ruimAbaixo}`);
  else if (x.urPct < F.ur.atencaoAbaixo) marca("atencao", `UR ${int0(x.urPct)}%: entre ${F.ur.ruimAbaixo} e ${F.ur.atencaoAbaixo}`);
  if (x.tempC > F.temp.ruimAcima) marca("ruim", `Temperatura ${int0(x.tempC)} °C: acima de ${F.temp.ruimAcima}`);
  else if (x.tempC > F.temp.atencaoAcima) marca("atencao", `Temperatura ${int0(x.tempC)} °C: acima de ${F.temp.atencaoAcima}`);
  if (x.chovendo) marca("ruim", "Chovendo — lava o produto");
  return { deltaT: dt, nivel: pior, motivos };
}

export interface HoraAplicacao {
  quando: string;
  /** `false` = sem luz do dia (avião não aplica). Ausente quando não se sabe a posição. */
  luz?: boolean;
  deltaT: number;
  nivel: NivelAplicacao;
  ventoKmh: number | null;
  chuvaMm: number | null;
  tempC: number;
  urPct: number;
}

/**
 * Nível de aplicação hora a hora (chuva prevista ≥ 0,2 mm ou chance ≥ 60 % conta como "chovendo").
 * Com `temLuz` (ver `marcadorDeLuz`), cada hora ganha `luz`: fora da primeira–última luz o avião não voa.
 */
export function aplicacaoPorHora(horas: HoraPrevisao[], temLuz?: (quando: string) => boolean): HoraAplicacao[] {
  const out: HoraAplicacao[] = [];
  for (const h of horas) {
    if (h.tempC === null || h.urPct === null) continue;
    const c = condicoesAplicacao({ tempC: h.tempC, urPct: h.urPct, ventoMs: h.ventoMs, rajadaMs: h.rajadaMs, chovendo: (h.chuvaMm ?? 0) >= 0.2 || (h.probPct ?? 0) >= 60 });
    const x: HoraAplicacao = { quando: h.quando, deltaT: Math.round(c.deltaT * 10) / 10, nivel: c.nivel, ventoKmh: h.ventoMs === null ? null : Math.round(h.ventoMs * 3.6), chuvaMm: h.chuvaMm, tempC: h.tempC, urPct: h.urPct };
    if (temLuz) x.luz = temLuz(h.quando);
    out.push(x);
  }
  return out;
}

export interface Janela { inicio: string; fim: string; horas: number }

/** Janelas de horas seguidas no nível pedido ou melhor (mínimo `minHoras`), depois de `apartirDe`. */
export function janelasBoas(horas: HoraAplicacao[], apartirDe: string, minHoras = 2, max = 4, ateNivel: NivelAplicacao = "bom"): Janela[] {
  const ORDEM: Record<NivelAplicacao, number> = { bom: 0, atencao: 1, ruim: 2 };
  const janelas: Janela[] = [];
  let ini: string | null = null, n = 0, ultima = "";
  const fecha = () => { if (ini && n >= minHoras) janelas.push({ inicio: ini, fim: ultima, horas: n }); ini = null; n = 0; };
  for (const h of horas) {
    if (h.quando < apartirDe) continue;
    // hora sem luz do dia fecha a janela: o avião só aplica da primeira à última luz
    if (h.luz !== false && ORDEM[h.nivel] <= ORDEM[ateNivel]) { if (!ini) ini = h.quando; n++; ultima = h.quando; } else fecha();
  }
  fecha();
  return janelas.slice(0, max);
}

/**
 * Quando não há janela boa nem de atenção: a hora "menos ruim" — sem chuva, com o menor Delta T
 * (desempate pela maior UR). Devolve null se todas as horas têm chuva.
 */
export function horaMenosRuim(horas: HoraAplicacao[], apartirDe: string): HoraAplicacao | null {
  let melhor: HoraAplicacao | null = null;
  for (const h of horas) {
    if (h.quando < apartirDe || (h.chuvaMm ?? 0) >= 0.2 || h.luz === false) continue;
    if (!melhor || h.deltaT < melhor.deltaT || (h.deltaT === melhor.deltaT && h.urPct > melhor.urPct)) melhor = h;
  }
  return melhor;
}

/* ------------------------------ tendência: como a previsão de um dia mudou de uma rodada para outra ------------------------------ */

/** O que UMA rodada da previsão (emitida em `emissao`) disse sobre um dia-alvo. */
export interface PontoPrevisao {
  /** Dia em que a previsão foi buscada. */
  emissao: DataISO;
  probPct: number | null;
  chuvaMm: number | null;
  comChuva?: number | null;
  modelos?: number | null;
}

export type DirecaoPrevisao = "subindo" | "caindo" | "estavel" | "nova";
export type NivelConfianca = "alta" | "media" | "baixa";

export interface TendenciaPrevisao {
  /** Rodadas em ordem (a última é a atual). */
  pontos: PontoPrevisao[];
  emissoes: number;
  /** Chance atual − chance da rodada anterior (pontos percentuais). */
  deltaProb: number | null;
  /** Chuva atual − chuva da rodada anterior (mm). */
  deltaChuva: number | null;
  direcao: DirecaoPrevisao;
  /**
   * Índice de 0 a 100 que junta a chance atual (50%), a concordância dos modelos (30%) e a estabilidade
   * entre as últimas rodadas (20%). Alto = chuva firme; baixo = chute.
   */
  confianca: number;
  nivel: NivelConfianca;
  /** "89% → 60% → 50% · caindo" */
  texto: string;
}

/**
 * Tendência de um dia-alvo a partir do histórico de rodadas. Sobe/cai quando a chance mudou 10 pontos
 * ou mais em relação à rodada anterior; com uma rodada só é "nova".
 */
export function tendenciaPrevisao(pontos: PontoPrevisao[]): TendenciaPrevisao {
  const ps = [...pontos].sort((a, b) => (a.emissao < b.emissao ? -1 : a.emissao > b.emissao ? 1 : 0));
  const atual = ps[ps.length - 1];
  const anterior = ps.length > 1 ? ps[ps.length - 2] : undefined;
  const deltaProb = atual && anterior && atual.probPct !== null && anterior.probPct !== null ? Math.round(atual.probPct - anterior.probPct) : null;
  const deltaChuva = atual && anterior && atual.chuvaMm !== null && anterior.chuvaMm !== null ? Math.round((atual.chuvaMm - anterior.chuvaMm) * 10) / 10 : null;
  let direcao: DirecaoPrevisao = ps.length < 2 ? "nova" : "estavel";
  if (deltaProb !== null && deltaProb >= 10) direcao = "subindo";
  else if (deltaProb !== null && deltaProb <= -10) direcao = "caindo";
  else if (deltaProb === null && deltaChuva !== null && ps.length >= 2) direcao = deltaChuva >= 3 ? "subindo" : deltaChuva <= -3 ? "caindo" : "estavel";
  const prob = atual?.probPct ?? 0;
  const concord = atual && atual.modelos && atual.comChuva !== null && atual.comChuva !== undefined ? (100 * atual.comChuva) / atual.modelos : prob;
  const ultimas = ps.slice(-3).map((p) => p.probPct).filter((x): x is number => x !== null);
  const estab = ultimas.length >= 2 ? Math.max(0, 100 - 2 * (Math.max(...ultimas) - Math.min(...ultimas))) : 50;
  const confianca = Math.round(0.5 * prob + 0.3 * concord + 0.2 * estab);
  const nivel: NivelConfianca = confianca >= 70 ? "alta" : confianca >= 45 ? "media" : "baixa";
  const seq = ps.slice(-4).map((p) => (p.probPct === null ? (p.chuvaMm === null ? "?" : p.chuvaMm.toFixed(0) + " mm") : Math.round(p.probPct) + "%")).join(" → ");
  const rot: Record<DirecaoPrevisao, string> = { subindo: "subindo", caindo: "caindo", estavel: "estável", nova: "primeira rodada" };
  return { pontos: ps, emissoes: ps.length, deltaProb, deltaChuva, direcao, confianca, nivel, texto: seq + " · " + rot[direcao] };
}

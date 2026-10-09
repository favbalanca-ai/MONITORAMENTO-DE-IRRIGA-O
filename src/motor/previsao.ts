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
  /** Texto do INMET por turno ("manhã: sol; tarde: pancadas de chuva…"). */
  resumo?: string;
}

export interface Previsao {
  /** Quando foi buscada (hora local da estação). */
  atualizadoEm: string;
  dias: DiaPrevisao[];
  /** Fontes que responderam ("Open-Meteo", "INMET"). */
  fontes: string[];
}

export const INMET_URL = "https://apiprevmet3.inmet.gov.br/previsao/";

/** Pede também os 7 dias passados: a ET₀ deles tapa dias em que a estação ficou sem leituras. */
export function urlOpenMeteo(latitude: number, longitude: number, fuso: string, dias = 7, passados = 7): string {
  return (
    "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
    "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration" +
    "&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias + "&past_days=" + passados
  );
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Resposta do Open-Meteo (`daily.time[]` + séries) → um item por dia. */
export function lerOpenMeteo(json: unknown): DiaPrevisao[] {
  const d = (json as { daily?: Record<string, unknown[]> } | null)?.daily;
  if (!d || !Array.isArray(d["time"])) throw new Error("Open-Meteo: resposta sem a série diária.");
  return d["time"].map((t, i) => ({
    data: String(t).slice(0, 10),
    chuvaMm: num(d["precipitation_sum"]?.[i]),
    probPct: num(d["precipitation_probability_max"]?.[i]),
    tmax: num(d["temperature_2m_max"]?.[i]),
    tmin: num(d["temperature_2m_min"]?.[i]),
    et0Mm: num(d["et0_fao_evapotranspiration"]?.[i]),
  }));
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
  deltaT: number;
  nivel: NivelAplicacao;
  ventoKmh: number | null;
  chuvaMm: number | null;
  tempC: number;
  urPct: number;
}

/** Nível de aplicação hora a hora (chuva prevista ≥ 0,2 mm ou chance ≥ 60 % conta como "chovendo"). */
export function aplicacaoPorHora(horas: HoraPrevisao[]): HoraAplicacao[] {
  const out: HoraAplicacao[] = [];
  for (const h of horas) {
    if (h.tempC === null || h.urPct === null) continue;
    const c = condicoesAplicacao({ tempC: h.tempC, urPct: h.urPct, ventoMs: h.ventoMs, rajadaMs: h.rajadaMs, chovendo: (h.chuvaMm ?? 0) >= 0.2 || (h.probPct ?? 0) >= 60 });
    out.push({ quando: h.quando, deltaT: Math.round(c.deltaT * 10) / 10, nivel: c.nivel, ventoKmh: h.ventoMs === null ? null : Math.round(h.ventoMs * 3.6), chuvaMm: h.chuvaMm, tempC: h.tempC, urPct: h.urPct });
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
    if (ORDEM[h.nivel] <= ORDEM[ateNivel]) { if (!ini) ini = h.quando; n++; ultima = h.quando; } else fecha();
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
    if (h.quando < apartirDe || (h.chuvaMm ?? 0) >= 0.2) continue;
    if (!melhor || h.deltaT < melhor.deltaT || (h.deltaT === melhor.deltaT && h.urPct > melhor.urPct)) melhor = h;
  }
  return melhor;
}

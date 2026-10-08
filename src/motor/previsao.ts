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

export function urlOpenMeteo(latitude: number, longitude: number, fuso: string, dias = 7): string {
  return (
    "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
    "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min" +
    "&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias
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
      x.resumo = d.resumo;
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

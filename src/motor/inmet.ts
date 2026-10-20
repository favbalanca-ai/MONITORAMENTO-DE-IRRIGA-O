/**
 * Estações automáticas do INMET (API pública apitempo.inmet.gov.br): lista de estações, as mais próximas de um
 * ponto e as medições horárias agregadas por dia local. Servem para confirmar a chuva da estação da fazenda
 * e para calibrar os modelos quando a estação falha.
 */
import { paraLocal } from "../coletor/tempo.ts";
import type { DataISO } from "./tipos.ts";
import type { ObservacaoDia } from "./pesos.ts";

export const INMET_ESTACOES_URL = "https://apitempo.inmet.gov.br/estacoes/T";

export interface EstacaoInmet {
  codigo: string;
  nome: string;
  uf: string;
  latitude: number;
  longitude: number;
  /** "Operante" ou "Pane" (como o INMET informa). */
  situacao: string;
  distanciaKm?: number;
}

const numInmet_ = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Resposta de /estacoes/T → lista limpa. */
export function lerEstacoesInmet(json: unknown): EstacaoInmet[] {
  if (!Array.isArray(json)) throw new Error("INMET: lista de estações inválida.");
  const out: EstacaoInmet[] = [];
  for (const e of json as Record<string, unknown>[]) {
    const lat = numInmet_(e["VL_LATITUDE"]), lon = numInmet_(e["VL_LONGITUDE"]);
    if (!e["CD_ESTACAO"] || lat === null || lon === null) continue;
    out.push({ codigo: String(e["CD_ESTACAO"]), nome: String(e["DC_NOME"] ?? ""), uf: String(e["SG_ESTADO"] ?? ""), latitude: lat, longitude: lon, situacao: String(e["CD_SITUACAO"] ?? "") });
  }
  return out;
}

/** Distância em km entre dois pontos (haversine). */
export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** As `n` estações mais próximas de um ponto, com a distância. */
export function estacoesProximas(lista: EstacaoInmet[], latitude: number, longitude: number, n = 5): EstacaoInmet[] {
  return lista
    .map((e) => ({ ...e, distanciaKm: Math.round(distanciaKm(latitude, longitude, e.latitude, e.longitude)) }))
    .sort((a, b) => a.distanciaKm! - b.distanciaKm!)
    .slice(0, n);
}

/** Medições horárias de uma estação entre duas datas (AAAA-MM-DD, em UTC como o INMET guarda). */
export function urlInmetEstacao(ini: DataISO, fim: DataISO, codigo: string): string {
  return "https://apitempo.inmet.gov.br/estacao/" + ini + "/" + fim + "/" + encodeURIComponent(codigo);
}

export interface DiaInmet extends ObservacaoDia {
  /** Horas com medição no dia (24 = dia completo). */
  horas: number;
}

/**
 * Resposta horária (`DT_MEDICAO` + `HR_MEDICAO` em UTC, `CHUVA`, `TEM_MAX`, `TEM_MIN`) → um item por dia LOCAL.
 * Também aceita a resposta diária (`CHUVA`, `TEMP_MAX`, `TEMP_MIN`, sem hora).
 */
export function lerInmetEstacao(json: unknown, fuso: string): DiaInmet[] {
  if (!Array.isArray(json)) throw new Error("INMET: medições da estação inválidas.");
  const porDia = new Map<DataISO, { chuva: number | null; tmax: number | null; tmin: number | null; horas: number }>();
  for (const l of json as Record<string, unknown>[]) {
    const dt = String(l["DT_MEDICAO"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
    const hr = l["HR_MEDICAO"];
    let dia = dt;
    if (hr !== undefined && hr !== null && String(hr) !== "") {
      const h = String(hr).padStart(4, "0");
      const utcMs = Date.parse(dt + "T" + h.slice(0, 2) + ":" + h.slice(2, 4) + ":00Z");
      if (!Number.isFinite(utcMs)) continue;
      // a hora do INMET é o FIM do intervalo medido: a chuva "01:00 UTC" caiu entre 00 e 01 → conta no dia da hora anterior
      dia = paraLocal(utcMs - 1, fuso).slice(0, 10);
    }
    const chuva = numInmet_(l["CHUVA"]);
    const tmax = numInmet_(l["TEM_MAX"] ?? l["TEMP_MAX"]), tmin = numInmet_(l["TEM_MIN"] ?? l["TEMP_MIN"]);
    let d = porDia.get(dia);
    if (!d) { d = { chuva: null, tmax: null, tmin: null, horas: 0 }; porDia.set(dia, d); }
    if (chuva !== null) d.chuva = (d.chuva ?? 0) + chuva;
    if (tmax !== null) d.tmax = d.tmax === null ? tmax : Math.max(d.tmax, tmax);
    if (tmin !== null) d.tmin = d.tmin === null ? tmin : Math.min(d.tmin, tmin);
    d.horas++;
  }
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  return [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([data, d]) => ({ data, chuvaMm: r1(d.chuva), tmax: r1(d.tmax), tmin: r1(d.tmin), horas: d.horas }));
}

export interface ObservacaoConfirmada extends ObservacaoDia {
  /** "estacao" = estação da fazenda; "inmet" = só o INMET tinha o dia. */
  fonte: "estacao" | "inmet";
  /** Chuva do INMET no dia, para comparar (quando houver). */
  chuvaInmetMm?: number | null;
}

/**
 * Junta a estação da fazenda com o INMET: a estação manda; dias que ela não tem (ou sem chuva medida) vêm do
 * INMET. Dias incompletos do INMET (menos de 20 horas) não entram como fonte.
 */
export function juntarObservacoes(estacao: ObservacaoDia[], inmet: DiaInmet[]): ObservacaoConfirmada[] {
  const porDia = new Map<DataISO, ObservacaoConfirmada>();
  for (const e of estacao) porDia.set(e.data, { ...e, fonte: "estacao" });
  for (const i of inmet) {
    const x = porDia.get(i.data);
    if (x) { x.chuvaInmetMm = i.chuvaMm; if (x.chuvaMm === null && i.horas >= 20) x.chuvaMm = i.chuvaMm; if (x.tmax === null) x.tmax = i.tmax; if (x.tmin === null) x.tmin = i.tmin; continue; }
    if (i.horas >= 20) porDia.set(i.data, { data: i.data, chuvaMm: i.chuvaMm, tmax: i.tmax, tmin: i.tmin, fonte: "inmet", chuvaInmetMm: i.chuvaMm });
  }
  return [...porDia.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
}

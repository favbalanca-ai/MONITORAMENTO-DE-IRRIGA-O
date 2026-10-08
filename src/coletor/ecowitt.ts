/**
 * Cliente da API v3 da Ecowitt (ecowitt.net).
 *
 * Tempo real: GET /device/real_time → cada grandeza vem como { time, unit, value }.
 * Histórico:  GET /device/history   → cada grandeza vem como { unit, list: { "<unix>": "<valor>" } }.
 *
 * As unidades são pedidas em SI na URL, mas a conversão sempre olha o `.unit` da resposta.
 */
import { numero, paraCelsius, paraMm, paraMs, paraWm2 } from "../motor/unidades.ts";
import type { DataHoraLocal, Leitura } from "../motor/tipos.ts";
import { paraLocal } from "./tempo.ts";

export const URL_BASE = "https://api.ecowitt.net/api/v3";

/** ℃, km/h, mm, W/m² — mesmos ids usados por clientes da API v3. */
const UNIDADES = { temp_unitid: "1", wind_speed_unitid: "7", rainfall_unitid: "12", solar_irradiance_unitid: "16" };

export interface ConfigEcowitt {
  applicationKey: string;
  apiKey: string;
  mac: string;
  /** Fuso da estação (IANA), ex. "America/Sao_Paulo" ou "America/Cuiaba". */
  fuso: string;
  /** Grupo da chuva: "rainfall" (báscula) ou "rainfall_piezo" (WS90). */
  grupoChuva?: "rainfall" | "rainfall_piezo";
}

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ErroEcowitt extends Error {
  readonly codigo?: number;
  constructor(msg: string, codigo?: number) {
    super(msg);
    this.codigo = codigo;
  }
}

export type CicloHistorico = "5min" | "30min" | "4hour" | "1day";
export const MINUTOS_DO_CICLO: Record<CicloHistorico, number> = { "5min": 5, "30min": 30, "4hour": 240, "1day": 1440 };

/** Retenção do ecowitt.net: 5 min por ~90 dias, 30 min por ~1 ano, 4 h por ~2 anos. */
export function cicloParaIdade(dias: number): CicloHistorico {
  if (dias <= 89) return "5min";
  if (dias <= 364) return "30min";
  return "4hour";
}

type Valor = { time?: string | number; unit?: string; value?: unknown };
type Grupo = Record<string, Valor | undefined>;
type DadosTempoReal = Partial<Record<string, Grupo>>;

function credenciais(cfg: ConfigEcowitt): URLSearchParams {
  return new URLSearchParams({ application_key: cfg.applicationKey, api_key: cfg.apiKey, mac: cfg.mac, ...UNIDADES });
}

async function chamar(fetchFn: Fetch, url: string): Promise<unknown> {
  const resp = await fetchFn(url);
  if (!resp.ok) throw new ErroEcowitt(`HTTP ${resp.status} da Ecowitt`);
  const corpo = (await resp.json()) as { code?: number; msg?: string; data?: unknown };
  if (corpo.code !== 0) throw new ErroEcowitt(`Ecowitt recusou: ${corpo.msg ?? "sem mensagem"} (code ${corpo.code})`, corpo.code);
  return corpo.data;
}

const grupoChuva = (d: DadosTempoReal, cfg: ConfigEcowitt): Grupo | undefined =>
  d[cfg.grupoChuva ?? "rainfall"] ?? d.rainfall ?? d.rainfall_piezo;

function converter(v: Valor | undefined, conv: (x: number, u: string | undefined) => number): number | null {
  const x = numero(v?.value);
  return x === null ? null : conv(x, v?.unit);
}

/** Resposta do tempo real → uma leitura. O horário é o da medição na estação, não o da consulta. */
export function leituraDoTempoReal(data: unknown, cfg: ConfigEcowitt): Leitura {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ErroEcowitt("Ecowitt retornou dados vazios.");
  const d = data as DadosTempoReal;
  const campos = {
    temp: d.outdoor?.temperature,
    ur: d.outdoor?.humidity,
    rad: d.solar_and_uvi?.solar,
    chuva: grupoChuva(d, cfg)?.daily,
    vento: d.wind?.wind_speed,
  };
  const tempos = Object.values(campos).map((c) => Number(c?.time)).filter((t) => Number.isFinite(t) && t > 0);
  if (tempos.length === 0) throw new ErroEcowitt("Resposta da Ecowitt sem horário de medição.");
  return {
    quando: paraLocal(Math.max(...tempos) * 1000, cfg.fuso),
    chuvaAcumDia: converter(campos.chuva, paraMm),
    tempC: converter(campos.temp, paraCelsius),
    urPct: numero(campos.ur?.value),
    radWm2: converter(campos.rad, paraWm2),
    ventoMs: converter(campos.vento, paraMs),
    intervaloMin: 10,
    fonte: "ecowitt",
  };
}

type Serie = { unit?: string; list?: Record<string, unknown> };
type DadosHistorico = Partial<Record<string, Partial<Record<string, Serie>>>>;

/** Resposta do histórico → leituras, uma por instante, juntando as séries pelo timestamp. */
export function leiturasDoHistorico(data: unknown, cfg: ConfigEcowitt, ciclo: CicloHistorico): Leitura[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return []; // período sem dados vem como []
  const d = data as DadosHistorico;
  const porInstante = new Map<string, Leitura>();
  const leitura = (ts: string): Leitura => {
    let l = porInstante.get(ts);
    if (!l) {
      l = {
        quando: paraLocal(Number(ts) * 1000, cfg.fuso),
        chuvaAcumDia: null, tempC: null, urPct: null, radWm2: null, ventoMs: null,
        intervaloMin: MINUTOS_DO_CICLO[ciclo],
        fonte: `ecowitt-historico-${ciclo}`,
      };
      porInstante.set(ts, l);
    }
    return l;
  };
  const serie = (s: Serie | undefined, campo: keyof Pick<Leitura, "chuvaAcumDia" | "tempC" | "urPct" | "radWm2" | "ventoMs">,
    conv: (x: number, u: string | undefined) => number) => {
    for (const [ts, bruto] of Object.entries(s?.list ?? {})) {
      const x = numero(bruto);
      if (x !== null && Number.isFinite(Number(ts))) leitura(ts)[campo] = conv(x, s?.unit);
    }
  };
  serie(d.outdoor?.temperature, "tempC", paraCelsius);
  serie(d.outdoor?.humidity, "urPct", (x) => x);
  serie(d.solar_and_uvi?.solar, "radWm2", paraWm2);
  serie((d[cfg.grupoChuva ?? "rainfall"] ?? d.rainfall ?? d.rainfall_piezo)?.daily, "chuvaAcumDia", paraMm);
  serie(d.wind?.wind_speed, "ventoMs", paraMs);
  return [...porInstante.values()].sort((a, b) => (a.quando < b.quando ? -1 : 1));
}

export class ClienteEcowitt {
  readonly cfg: ConfigEcowitt;
  private readonly fetchFn: Fetch;
  constructor(cfg: ConfigEcowitt, fetchFn: Fetch = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  async tempoReal(): Promise<Leitura> {
    const p = credenciais(this.cfg);
    p.set("call_back", "all");
    return leituraDoTempoReal(await chamar(this.fetchFn, `${URL_BASE}/device/real_time?${p}`), this.cfg);
  }

  /** Datas no formato que a API espera ("YYYY-MM-DD HH:MM:SS"). */
  async historico(ini: DataHoraLocal, fim: DataHoraLocal, ciclo: CicloHistorico): Promise<Leitura[]> {
    const p = credenciais(this.cfg);
    p.set("start_date", ini.replace("T", " "));
    p.set("end_date", fim.replace("T", " "));
    p.set("cycle_type", ciclo);
    p.set("call_back", ["outdoor", "solar_and_uvi", this.cfg.grupoChuva ?? "rainfall", "wind"].join(","));
    return leiturasDoHistorico(await chamar(this.fetchFn, `${URL_BASE}/device/history?${p}`), this.cfg, ciclo);
  }
}

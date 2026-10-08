import type { DataHoraLocal } from "../motor/tipos.ts";

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Instante (ms desde 1970) → data e hora locais "YYYY-MM-DDTHH:MM:SS" no fuso da estação. */
export function paraLocal(ms: number, fuso: string): DataHoraLocal {
  const p = Object.fromEntries(formatador(fuso).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Data e hora locais → instante (ms). */
export function deLocal(local: DataHoraLocal, fuso: string): number {
  const comoUtc = Date.parse(local + "Z");
  const desvio = Date.parse(paraLocal(comoUtc, fuso) + "Z") - comoUtc;
  return comoUtc - desvio;
}

/** Minutos entre duas datas-hora locais (b − a). */
export const minutosEntre = (a: DataHoraLocal, b: DataHoraLocal): number =>
  (Date.parse(b + "Z") - Date.parse(a + "Z")) / 60_000;

/** Soma minutos a uma data-hora local. */
export const somarMinutos = (a: DataHoraLocal, min: number): DataHoraLocal =>
  new Date(Date.parse(a + "Z") + min * 60_000).toISOString().slice(0, 19);

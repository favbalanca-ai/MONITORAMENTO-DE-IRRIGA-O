import type { DataISO, DiaClima, Estacao } from "./tipos.ts";

/** Pressão de vapor de saturação (kPa) — FAO-56 eq. 11. */
export const eSat = (t: number): number => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

/** Dia do ano (1–366) de uma data "YYYY-MM-DD". */
export function diaDoAno(data: DataISO): number {
  const [a, m, d] = data.split("-").map(Number) as [number, number, number];
  return (Date.UTC(a, m - 1, d) - Date.UTC(a, 0, 0)) / 86_400_000;
}

/** Radiação extraterrestre diária Ra (MJ/m²/dia) — FAO-56 eq. 21. */
export function radiacaoExtraterrestre(latitude: number, data: DataISO): number {
  const j = diaDoAno(data);
  const phi = (latitude * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * j) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * j) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return (
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** Fotoperíodo: horas entre o nascer e o pôr do sol pela latitude e data — FAO-56 eq. 34 (N = 24/π · ωs). */
export function fotoperiodoH(latitude: number, data: DataISO): number {
  const j = diaDoAno(data);
  const phi = (latitude * Math.PI) / 180;
  const delta = 0.409 * Math.sin((2 * Math.PI * j) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return (24 / Math.PI) * ws;
}

/** Converte o vento medido na altura h para 2 m — FAO-56 eq. 47. */
export const ventoA2m = (u: number, h: number): number =>
  h === 2 ? u : (u * 4.87) / Math.log(67.8 * h - 5.42);

/** ET₀ Penman-Monteith FAO-56 (mm/dia), com G = 0. */
export function et0PenmanMonteith(dia: DiaClima, est: Estacao): number {
  const z = est.altitude;
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
  const gamma = 0.000665 * P;

  const es = (eSat(dia.tmax) + eSat(dia.tmin)) / 2;
  const ea = (dia.ur / 100) * es;
  const delta = (4098 * eSat(dia.tmed)) / Math.pow(dia.tmed + 237.3, 2);
  const u2 = ventoA2m(dia.vento, est.alturaAnemometro);

  const Ra = radiacaoExtraterrestre(est.latitude, dia.data);
  const Rso = (0.75 + 2e-5 * z) * Ra;
  const razao = Math.min(1, Math.max(0.3, dia.rad / Rso));
  const Rns = 0.77 * dia.rad;
  const Rnl =
    ((4.903e-9 * (Math.pow(dia.tmax + 273.16, 4) + Math.pow(dia.tmin + 273.16, 4))) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea)) *
    (1.35 * razao - 0.35);
  const Rn = Rns - Rnl;

  const et0 =
    (0.408 * delta * Rn + ((gamma * 900) / (dia.tmed + 273)) * u2 * (es - ea)) /
    (delta + gamma * (1 + 0.34 * u2));
  return Math.max(0, et0);
}

/** ET₀ Hargreaves-Samani (mm/dia) — usada só como conferência. */
export function et0Hargreaves(dia: DiaClima, est: Estacao): number {
  const Ra = radiacaoExtraterrestre(est.latitude, dia.data);
  return 0.0023 * 0.408 * Ra * (dia.tmed + 17.8) * Math.sqrt(Math.max(0, dia.tmax - dia.tmin));
}

/** Divergência relativa acima da qual a ET₀ PM é sinalizada frente à Hargreaves. */
export const LIMITE_DIVERGENCIA_HS = 0.35;

export function divergenciaHargreaves(pm: number, hs: number): number {
  return hs > 0 ? Math.abs(pm - hs) / hs : 0;
}

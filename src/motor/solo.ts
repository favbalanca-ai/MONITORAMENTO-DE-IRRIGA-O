import type { Solo } from "./tipos.ts";

/** Profundidade da raiz (cm): cresce em linha reta do plantio até `diasRaiz`. */
export function profundidadeRaiz(solo: Solo, diasAposSemeadura: number): number {
  const t = Math.min(1, Math.max(0, diasAposSemeadura / solo.diasRaiz));
  return solo.raizIniCm + (solo.raizMaxCm - solo.raizIniCm) * t;
}

/** Capacidade de água disponível (mm) para a raiz com `zCm`. */
export const cad = (solo: Solo, zCm: number): number => ((solo.cc - solo.pmp) / 100) * zCm * 10;

/** Fator de depleção variável pela ET₀ do dia (Embrapa). */
export function fatorDeplecaoPorEt0(et0: number): number {
  if (et0 <= 2.5) return 0.75;
  if (et0 <= 5) return 0.6;
  if (et0 <= 7.5) return 0.5;
  return 0.4;
}

export const fatorDeplecao = (solo: Solo, et0: number): number =>
  solo.fatorDeplecaoFixo ?? fatorDeplecaoPorEt0(et0);

/** Déficit (mm) correspondente a uma umidade medida θ (%). Nunca negativo. */
export const deficitDaUmidade = (solo: Solo, thetaPct: number, zCm: number): number =>
  Math.max(0, ((solo.cc - thetaPct) / 100) * zCm * 10);

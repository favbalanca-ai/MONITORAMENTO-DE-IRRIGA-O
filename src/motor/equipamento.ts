import type { Equipamento } from "./tipos.ts";

export interface Capacidade {
  areaHa: number;
  /** Tempo da volta com percentímetro em 100% (h). */
  t100h: number;
  /** Lâmina aplicada com percentímetro em 100% (mm) — a menor possível. */
  lamina100Mm: number;
  /** Lâmina aplicada no percentímetro mínimo (mm) — a maior possível. */
  laminaMaxMm: number;
}

export function capacidade(eq: Equipamento): Capacidade {
  const fracao = eq.anguloGraus / 360;
  const areaHa = (Math.PI * eq.raioM ** 2 * fracao) / 10_000;
  const t100h = (fracao * 2 * Math.PI * eq.raioM) / (eq.velocidadeUltimaTorreMMin * 60);
  const lamina100Mm = (eq.vazaoM3h * t100h) / (areaHa * 10);
  const laminaMaxMm = lamina100Mm / (eq.percentimetroMinPct / 100);
  return { areaHa, t100h, lamina100Mm, laminaMaxMm };
}

export interface Recomendacao extends Capacidade {
  laminaBrutaMm: number;
  percentimetroPct: number;
  tempoVoltaH: number;
  energiaKwh: number;
  custoRs: number;
  /** O déficit pede mais do que uma volta no percentímetro mínimo entrega. */
  limitadoPelaLaminaMax: boolean;
}

/** Ajuste do pivô para repor o déficit líquido (mm) em uma volta. */
export function recomendar(eq: Equipamento, deficitMm: number): Recomendacao {
  const cap = capacidade(eq);
  const necessaria = deficitMm / (eq.eficienciaPct / 100);
  const laminaBrutaMm = Math.min(cap.laminaMaxMm, Math.max(cap.lamina100Mm, necessaria));
  const percentimetroPct = (cap.lamina100Mm / laminaBrutaMm) * 100;
  const tempoVoltaH = cap.t100h / (percentimetroPct / 100);
  const energiaKwh = eq.potenciaKw * tempoVoltaH;
  return {
    ...cap,
    laminaBrutaMm,
    percentimetroPct,
    tempoVoltaH,
    energiaKwh,
    custoRs: energiaKwh * eq.tarifaRsKwh,
    limitadoPelaLaminaMax: necessaria > cap.laminaMaxMm,
  };
}

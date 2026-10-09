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
  /** Custo ligando na hora sugerida (R$). */
  custoRs: number;
  /** O déficit pede mais do que uma volta no percentímetro mínimo entrega. */
  limitadoPelaLaminaMax: boolean;
  /** Só com tarifa de ponta cadastrada. */
  ponta?: {
    /** Hora de ligar (hh:mm) para pegar o mínimo de ponta: logo depois que ela acaba. */
    inicioSugerido: string;
    /** Horas da volta que caem na ponta mesmo ligando na hora sugerida. */
    horasNaPonta: number;
    /** Custo se ligar no começo da ponta (o pior caso), para comparar. */
    custoPiorRs: number;
  };
}

/** Horário de ponta (hora decimal). Padrão da maioria das distribuidoras: 18h às 21h. */
export interface Ponta {
  inicioH: number;
  fimH: number;
}
export const PONTA_PADRAO: Ponta = { inicioH: 18, fimH: 21 };

/** Horas dentro da ponta numa volta que começa em `inicioH` (hora decimal do dia) e dura `duracaoH`. */
export function horasNaPonta(inicioH: number, duracaoH: number, ponta: Ponta = PONTA_PADRAO): number {
  let total = 0;
  for (let dia = 0; dia * 24 < inicioH + duracaoH + 24; dia++) {
    const a = Math.max(inicioH, dia * 24 + ponta.inicioH);
    const b = Math.min(inicioH + duracaoH, dia * 24 + ponta.fimH);
    if (b > a) total += b - a;
  }
  return total;
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** Lâmina líquida (mm) aplicada numa volta com o percentímetro em `pct` %. */
export function laminaDoPercentimetro(eq: Equipamento, pct: number): { brutaMm: number; liquidaMm: number } {
  const cap = capacidade(eq);
  const brutaMm = cap.lamina100Mm / (pct / 100);
  return { brutaMm, liquidaMm: brutaMm * (eq.eficienciaPct / 100) };
}

/** Ajuste do pivô para repor o déficit líquido (mm) em uma volta. */
export function recomendar(eq: Equipamento, deficitMm: number, ponta: Ponta = PONTA_PADRAO): Recomendacao {
  const cap = capacidade(eq);
  const necessaria = deficitMm / (eq.eficienciaPct / 100);
  const laminaBrutaMm = Math.min(cap.laminaMaxMm, Math.max(cap.lamina100Mm, necessaria));
  const percentimetroPct = (cap.lamina100Mm / laminaBrutaMm) * 100;
  const tempoVoltaH = cap.t100h / (percentimetroPct / 100);
  const energiaKwh = eq.potenciaKw * tempoVoltaH;
  const r: Recomendacao = {
    ...cap,
    laminaBrutaMm,
    percentimetroPct,
    tempoVoltaH,
    energiaKwh,
    custoRs: energiaKwh * eq.tarifaRsKwh,
    limitadoPelaLaminaMax: necessaria > cap.laminaMaxMm,
  };
  const tarifaPonta = eq.tarifaPontaRsKwh;
  if (tarifaPonta != null && tarifaPonta > 0) {
    const custo = (inicioH: number) => {
      const hp = horasNaPonta(inicioH, tempoVoltaH, ponta);
      return eq.potenciaKw * ((tempoVoltaH - hp) * eq.tarifaRsKwh + hp * tarifaPonta);
    };
    r.custoRs = custo(ponta.fimH);
    r.ponta = { inicioSugerido: hhmm(ponta.fimH), horasNaPonta: horasNaPonta(ponta.fimH, tempoVoltaH, ponta), custoPiorRs: custo(ponta.inicioH) };
  }
  return r;
}

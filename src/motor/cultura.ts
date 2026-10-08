import type { Cultura, DataISO, Estadio } from "./tipos.ts";

/**
 * Soja, ciclo de 120 dias. Mesmos Kc da aba KC da planilha.
 * Valores de referência — o agrônomo precisa validar.
 */
export const SOJA: Cultura = {
  nome: "Soja",
  cicloDias: 120,
  estadios: [
    { nome: "V1", ateFracao: 0.17, kc: 0.45 },
    { nome: "V3", ateFracao: 0.3, kc: 0.75 },
    { nome: "R1", ateFracao: 0.46, kc: 1.05 },
    { nome: "R3", ateFracao: 0.63, kc: 1.15 },
    { nome: "R5", ateFracao: 0.83, kc: 1.2 },
    { nome: "R7", ateFracao: 1.0, kc: 0.9 },
  ],
};

/** Dias após a semeadura. */
export function das(data: DataISO, plantio: DataISO): number {
  return Math.round((Date.parse(data + "T00:00:00Z") - Date.parse(plantio + "T00:00:00Z")) / 86_400_000);
}

/** Estádio pela fração do ciclo. Depois do fim do ciclo, fica no último estádio. */
export function estadioPorDas(cultura: Cultura, diasAposSemeadura: number): Estadio {
  const f = Math.max(0, diasAposSemeadura) / cultura.cicloDias;
  const e = cultura.estadios.find((x) => f <= x.ateFracao) ?? cultura.estadios.at(-1);
  if (!e) throw new Error(`Cultura ${cultura.nome} sem estádios cadastrados.`);
  return e;
}

/**
 * Kc do dia. Em plantio direto sobre palhada, o Kc do primeiro estádio cai pela metade
 * (Embrapa Milho e Sorgo; aplicado à soja por analogia).
 */
export function kcDoDia(cultura: Cultura, diasAposSemeadura: number, palhada: boolean): { estadio: Estadio; kc: number } {
  const estadio = estadioPorDas(cultura, diasAposSemeadura);
  const primeiro = estadio === cultura.estadios[0];
  return { estadio, kc: palhada && primeiro ? estadio.kc * 0.5 : estadio.kc };
}

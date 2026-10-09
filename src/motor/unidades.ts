/**
 * Normalização das unidades na entrada. Toda leitura da Ecowitt traz `.value` e `.unit`;
 * a conversão olha o `.unit` em vez de supor a unidade (a planilha já recebeu °F e W/m² misturados).
 */

/** Converte um valor que pode vir como texto ("75.9", "75,9") para número; inválido vira `null`. */
export function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const unidade = (u: string | undefined): string => (u ?? "").trim().toLowerCase().replace(/[º˚]/g, "°");

export class UnidadeDesconhecida extends Error {
  constructor(grandeza: string, u: string | undefined) {
    super(`Unidade de ${grandeza} desconhecida: "${u}"`);
  }
}

export function paraCelsius(v: number, u: string | undefined): number {
  const x = unidade(u);
  if (x === "℃" || x === "°c" || x === "c") return v;
  if (x === "℉" || x === "°f" || x === "f") return ((v - 32) * 5) / 9;
  throw new UnidadeDesconhecida("temperatura", u);
}

export function paraMm(v: number, u: string | undefined): number {
  const x = unidade(u);
  if (x === "mm") return v;
  if (x === "in" || x === "inch" || x === "inches") return v * 25.4;
  throw new UnidadeDesconhecida("chuva", u);
}

export function paraMs(v: number, u: string | undefined): number {
  const x = unidade(u);
  if (x === "m/s") return v;
  if (x === "mph") return v * 0.44704;
  if (x === "km/h" || x === "kmh") return v / 3.6;
  if (x === "knots" || x === "kn" || x === "knot") return v * 0.514444;
  if (x === "ft/s") return v * 0.3048;
  throw new UnidadeDesconhecida("vento", u);
}

export function paraWm2(v: number, u: string | undefined): number {
  const x = unidade(u).replace("²", "2");
  if (x === "w/m2") return v;
  if (x === "lux") return v / 126.7; // aproximação usual para luz solar
  throw new UnidadeDesconhecida("radiação", u);
}

/**
 * Converte para SI pelo texto da unidade, sem saber a grandeza (para os extras da estação).
 * Unidade desconhecida ou vazia: devolve o valor como veio.
 */
export function paraSI(v: number, u: string | undefined): { valor: number; unidade: string } {
  const x = unidade(u);
  if (x === "℉" || x === "°f" || x === "f") return { valor: ((v - 32) * 5) / 9, unidade: "°C" };
  if (x === "℃" || x === "°c" || x === "c") return { valor: v, unidade: "°C" };
  if (x === "in/hr" || x === "in/h") return { valor: v * 25.4, unidade: "mm/h" };
  if (x === "in" || x === "inch" || x === "inches") return { valor: v * 25.4, unidade: "mm" };
  if (x === "mph") return { valor: v * 0.44704, unidade: "m/s" };
  if (x === "km/h" || x === "kmh") return { valor: v / 3.6, unidade: "m/s" };
  if (x === "knots" || x === "kn" || x === "knot") return { valor: v * 0.514444, unidade: "m/s" };
  if (x === "ft/s") return { valor: v * 0.3048, unidade: "m/s" };
  if (x === "inhg") return { valor: v * 33.8639, unidade: "hPa" };
  if (x === "mmhg") return { valor: v * 1.33322, unidade: "hPa" };
  if (x === "lux") return { valor: v / 126.7, unidade: "W/m²" };
  if (x === "mi" || x === "mile" || x === "miles") return { valor: v * 1.609344, unidade: "km" };
  if (x === "ft" || x === "feet") return { valor: v * 0.3048, unidade: "m" };
  return { valor: v, unidade: u ?? "" };
}

/** Leitura média em W/m² → MJ/m²/dia. */
export const wm2ParaMJDia = (wm2: number): number => (wm2 * 86_400) / 1e6;

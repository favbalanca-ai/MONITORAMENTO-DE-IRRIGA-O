import type { DataHoraLocal, Leitura } from "../motor/tipos.ts";
import { minutosEntre } from "./tempo.ts";

export interface Lacuna {
  /** Última leitura antes do buraco (ou início do período), exclusivo. */
  de: DataHoraLocal;
  /** Primeira leitura depois do buraco (ou fim do período), exclusivo. */
  ate: DataHoraLocal;
}

/** Folga além do intervalo esperado antes de considerar que faltou leitura. */
const TOLERANCIA = 1.5;
const INTERVALO_PADRAO = 10;

const limite = (a?: Leitura, b?: Leitura) =>
  TOLERANCIA * Math.max(a?.intervaloMin ?? INTERVALO_PADRAO, b?.intervaloMin ?? INTERVALO_PADRAO);

/**
 * Buracos na série entre `ini` e `fim`. Um buraco é um espaço entre leituras maior que 1,5× o
 * intervalo delas (15 min para leituras ao vivo, 45 min para histórico de 30 min).
 */
export function encontrarLacunas(leituras: Leitura[], ini: DataHoraLocal, fim: DataHoraLocal): Lacuna[] {
  const ls = leituras.filter((l) => l.quando >= ini && l.quando <= fim).sort((a, b) => (a.quando < b.quando ? -1 : 1));
  const lacunas: Lacuna[] = [];
  let anterior: Leitura | undefined;
  let marco = ini;
  for (const l of ls) {
    if (minutosEntre(marco, l.quando) > limite(anterior, l)) lacunas.push({ de: marco, ate: l.quando });
    anterior = l;
    marco = l.quando;
  }
  if (minutosEntre(marco, fim) > limite(anterior)) lacunas.push({ de: marco, ate: fim });
  return lacunas;
}

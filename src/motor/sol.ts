/**
 * Nascer e pôr do sol e crepúsculo civil (primeira e última luz) para um lugar e um dia — algoritmo
 * simplificado da NOAA, erro de poucos minutos. Serve para a pulverização aérea, que só acontece com luz.
 */
import { paraLocal } from "../coletor/tempo.ts";
import type { DataISO } from "./tipos.ts";

export interface LuzDoDia {
  data: DataISO;
  /** Hora local "HH:MM". `null` quando o sol não nasce/não se põe (não acontece no Brasil). */
  primeiraLuz: string | null;
  nascer: string | null;
  por: string | null;
  ultimaLuz: string | null;
}

const RAD = Math.PI / 180;
const J2000 = 2451545.0;

/** Dia juliano às 0h UTC de uma data ISO. */
function julianoDe(data: DataISO): number {
  return Date.parse(data + "T00:00:00Z") / 86_400_000 + 2440587.5;
}

/** Instantes (ms UTC) em que o sol cruza o ângulo `anguloGraus` abaixo (negativo) do horizonte. */
function cruzamentos(data: DataISO, latitude: number, longitude: number, anguloGraus: number): [number, number] | null {
  const n = Math.round(julianoDe(data) - J2000 + 0.5);
  const jEstrela = n - longitude / 360;
  const M = ((357.5291 + 0.98560028 * jEstrela) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = ((M + C + 180 + 102.9372) % 360 + 360) % 360;
  const jTransito = J2000 + jEstrela + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const declinacao = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));
  const cosW = (Math.sin(anguloGraus * RAD) - Math.sin(latitude * RAD) * Math.sin(declinacao)) / (Math.cos(latitude * RAD) * Math.cos(declinacao));
  if (cosW > 1 || cosW < -1) return null;
  const w = Math.acos(cosW) / RAD;
  const paraMs = (jd: number) => (jd - 2440587.5) * 86_400_000;
  return [paraMs(jTransito - w / 360), paraMs(jTransito + w / 360)];
}

const horaMinutoLocal_ = (ms: number, fuso: string) => paraLocal(ms, fuso).slice(11, 16);

/** Primeira luz (crepúsculo civil, sol a −6°), nascer, pôr e última luz, em hora local do fuso. */
export function luzDoDia(data: DataISO, latitude: number, longitude: number, fuso: string): LuzDoDia {
  const sol = cruzamentos(data, latitude, longitude, -0.833);
  const civil = cruzamentos(data, latitude, longitude, -6);
  return {
    data,
    primeiraLuz: civil ? horaMinutoLocal_(civil[0], fuso) : null,
    nascer: sol ? horaMinutoLocal_(sol[0], fuso) : null,
    por: sol ? horaMinutoLocal_(sol[1], fuso) : null,
    ultimaLuz: civil ? horaMinutoLocal_(civil[1], fuso) : null,
  };
}

/** Função "tem luz nessa hora?" para marcar as horas previstas: `quando` = "YYYY-MM-DDTHH:00" local. */
export function marcadorDeLuz(latitude: number, longitude: number, fuso: string): (quando: string) => boolean {
  const cache = new Map<string, LuzDoDia>();
  return (quando) => {
    const data = quando.slice(0, 10);
    let l = cache.get(data);
    if (!l) { l = luzDoDia(data, latitude, longitude, fuso); cache.set(data, l); }
    if (!l.primeiraLuz || !l.ultimaLuz) return true;
    const h = quando.slice(11, 16);
    // a hora prevista vale de HH:00 a HH:59: conta como luz se qualquer parte dela tem luz
    const fim = h.slice(0, 2) + ":59";
    return fim >= l.primeiraLuz && h <= l.ultimaLuz;
  };
}

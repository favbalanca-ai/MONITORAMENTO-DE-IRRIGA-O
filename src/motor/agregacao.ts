import { wm2ParaMJDia } from "./unidades.ts";
import type { DataISO, DiaClima, Leitura } from "./tipos.ts";

/** Hora local que fecha a janela do dia. */
export const HORA_FECHAMENTO = "18:00:00";

export function diaAnterior(data: DataISO): DataISO {
  const t = Date.parse(data + "T00:00:00Z") - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const media = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const valores = (ls: Leitura[], k: keyof Omit<Leitura, "quando">): number[] =>
  ls.map((l) => l[k]).filter((v): v is number => v !== null && Number.isFinite(v));

/**
 * Agrega as leituras da janela do dia D: de 18:00 de D−1 até 18:00 de D.
 *
 * Chuva: a Ecowitt manda o acumulado do dia, que zera à meia-noite. Então a chuva da janela é
 * (máx − mín entre 18h e 0h de D−1) + máx entre 0h e 18h de D.
 *
 * Radiação: média das leituras (W/m²) convertida para o dia todo — nunca a soma, porque o
 * número de leituras varia (repetidas ou faltando).
 *
 * Devolve `null` se não houver nenhuma leitura com temperatura na janela.
 */
export function agregarDia(leituras: Leitura[], data: DataISO): DiaClima | null {
  const ini = `${diaAnterior(data)}T${HORA_FECHAMENTO}`;
  const meiaNoite = `${data}T00:00:00`;
  const fim = `${data}T${HORA_FECHAMENTO}`;
  const janela = leituras.filter((l) => l.quando >= ini && l.quando < fim);

  const temps = valores(janela, "tempC");
  if (temps.length === 0) return null;

  const noite = valores(janela.filter((l) => l.quando < meiaNoite), "chuvaAcumDia");
  const dia = valores(janela.filter((l) => l.quando >= meiaNoite), "chuvaAcumDia");
  const chuvaNoite = noite.length ? Math.max(...noite) - Math.min(...noite) : 0;
  const chuvaDia = dia.length ? Math.max(...dia) : 0;

  const urs = valores(janela, "urPct");
  const ventos = valores(janela, "ventoMs");
  const rads = valores(janela, "radWm2");

  return {
    data,
    tmax: Math.max(...temps),
    tmin: Math.min(...temps),
    tmed: media(temps),
    ur: urs.length ? media(urs) : NaN,
    vento: ventos.length ? media(ventos) : NaN,
    rad: rads.length ? wm2ParaMJDia(media(rads)) : NaN,
    chuva: chuvaNoite + chuvaDia,
    n: janela.length,
  };
}

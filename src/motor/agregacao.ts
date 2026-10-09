import { wm2ParaMJDia } from "./unidades.ts";
import type { DataISO, DiaClima, Leitura } from "./tipos.ts";

/** Hora local que fecha a janela do dia. */
export const HORA_FECHAMENTO = "18:00:00";

export function diaAnterior(data: DataISO): DataISO {
  const t = Date.parse(data + "T00:00:00Z") - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const media = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
type CampoNumerico = "chuvaAcumDia" | "tempC" | "urPct" | "radWm2" | "ventoMs";
const valores = (ls: Leitura[], k: CampoNumerico): number[] =>
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
 * `n` conta leituras em equivalentes de 10 min, para que um dia recuperado do histórico de 30 min
 * (48 leituras) valha o mesmo que um dia ao vivo (144).
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
    n: fatiasCobertas(janela, ini, fim),
    horasSol: horasDeSol(janela),
  };
}

/** Radiação a partir da qual a leitura conta como "sol" (W/m²) — o limiar clássico de insolação do heliógrafo. */
export const RAD_SOL_WM2 = 120;

/** Horas de sol efetivo: leituras com radiação acima do limiar, cada uma valendo o seu intervalo. */
export function horasDeSol(janela: Leitura[]): number {
  let min = 0;
  for (const l of janela) if (l.radWm2 !== null && l.radWm2 > RAD_SOL_WM2) min += l.intervaloMin ?? 10;
  return Math.round((min / 60) * 10) / 10;
}

/**
 * Quanto da janela tem leitura, em equivalentes de 10 min (máximo 144). Cada leitura "vale" o tempo do seu
 * intervalo a partir dela (10 min ao vivo, 30 min no histórico), cortado no fim da janela; o que se sobrepõe
 * conta uma vez só. Assim a coleta ao vivo às 08:32 e a recuperação do histórico às 08:30, ou duas leituras
 * segundos uma da outra, não somam — antes `n` passava de 144. As médias continuam usando todas as leituras
 * (repetidas têm o mesmo valor; é o que a planilha original fazia).
 */
export function fatiasCobertas(janela: Leitura[], ini: string, fim: string): number {
  const tFim = Date.parse(fim + "Z");
  const tramos = janela
    .map((l) => { const a = Date.parse(l.quando + "Z"); return [a, Math.min(tFim, a + (l.intervaloMin ?? 10) * 60_000)] as [number, number]; })
    .sort((a, b) => a[0] - b[0]);
  let coberto = 0, ate = Date.parse(ini + "Z");
  for (const [a, b] of tramos) {
    if (b <= ate) continue;
    coberto += b - Math.max(a, ate);
    ate = b;
  }
  return Math.min(144, Math.ceil(coberto / 600_000 - 1e-9));
}

/**
 * Resumo meteorológico do ciclo de uma área (pivô ou talhão): graus-dia, horas de luz, chuva, ET₀ e extremos
 * do plantio até o dia do cálculo. É o "relatório do ciclo" — serve também para talhão sem pivô.
 */
import { fotoperiodoH } from "./et0.ts";
import { grausDiaDoDia, das, fimDoCicloDas } from "./cultura.ts";
import type { Cultura, DataISO, DiaClima } from "./tipos.ts";

export interface ResumoCiclo {
  plantio: DataISO;
  ate: DataISO;
  dias: number;
  /** Dias do período com clima (os sem leitura ficam de fora das somas). */
  diasComClima: number;
  grausDia: number;
  /** Graus-dia da cultivar até a maturação, quando cadastrado, e a fração já cumprida. */
  grausDiaCiclo: number | null;
  fracaoGrausDia: number | null;
  tBaseC: number | null;
  fotoperiodoHojeH: number;
  fotoperiodoAcumH: number;
  horasSolAcumH: number | null;
  horasSolHojeH: number | null;
  chuvaMm: number;
  diasComChuva: number;
  et0Mm: number;
  tmaxAbs: number;
  tminAbs: number;
  tmedia: number;
  diasQuentes: number;
  diasFrios: number;
  /** Último DAS do ciclo e quantos dias faltam. */
  fimCicloDas: number;
  faltamDias: number;
  /** Série diária para o gráfico. */
  serie: { data: DataISO; gd: number; gdAcum: number; fotoperiodo: number; horasSol: number | null; chuva: number; et0: number; tmax: number; tmin: number }[];
}

export const TEMP_DIA_QUENTE = 32;
export const TEMP_DIA_FRIO = 10;

export function resumoCiclo(
  cultura: Cultura,
  plantio: DataISO,
  ate: DataISO,
  latitude: number,
  clima: DiaClima[],
  et0PorDia: Map<DataISO, number>,
  grausDiaCiclo?: number | null,
): ResumoCiclo {
  const porData = new Map(clima.map((d) => [d.data, d]));
  const serie: ResumoCiclo["serie"] = [];
  let gdAcum = 0, foto = 0, sol = 0, temSol = false, chuva = 0, diasChuva = 0, et0 = 0, tmaxAbs = -Infinity, tminAbs = Infinity, somaT = 0, nT = 0, quentes = 0, frios = 0, comClima = 0;
  let fotoHoje = 0, solHoje: number | null = null;
  for (let t = Date.parse(plantio + "T00:00:00Z"); t <= Date.parse(ate + "T00:00:00Z"); t += 86_400_000) {
    const data = new Date(t).toISOString().slice(0, 10);
    const fp = fotoperiodoH(latitude, data);
    foto += fp;
    fotoHoje = fp;
    const d = porData.get(data);
    if (!d || !Number.isFinite(d.tmed)) continue;
    comClima++;
    const gd = grausDiaDoDia(cultura, d.tmed);
    gdAcum += gd;
    if (d.horasSol !== undefined) { sol += d.horasSol; temSol = true; solHoje = d.horasSol; }
    chuva += d.chuva;
    if (d.chuva >= 1) diasChuva++;
    const e = et0PorDia.get(data) ?? 0;
    et0 += e;
    if (d.tmax > tmaxAbs) tmaxAbs = d.tmax;
    if (d.tmin < tminAbs) tminAbs = d.tmin;
    somaT += d.tmed; nT++;
    if (d.tmax >= TEMP_DIA_QUENTE) quentes++;
    if (d.tmin <= TEMP_DIA_FRIO) frios++;
    serie.push({ data, gd: Math.round(gd * 10) / 10, gdAcum: Math.round(gdAcum), fotoperiodo: Math.round(fp * 100) / 100, horasSol: d.horasSol ?? null, chuva: d.chuva, et0: Math.round(e * 100) / 100, tmax: d.tmax, tmin: d.tmin });
  }
  const fim = fimDoCicloDas(cultura);
  const dias = das(ate, plantio) + 1;
  return {
    plantio, ate, dias, diasComClima: comClima,
    grausDia: Math.round(gdAcum),
    grausDiaCiclo: grausDiaCiclo ?? null,
    fracaoGrausDia: grausDiaCiclo ? Math.round((gdAcum / grausDiaCiclo) * 1000) / 1000 : null,
    tBaseC: cultura.tBaseC ?? null,
    fotoperiodoHojeH: Math.round(fotoHoje * 100) / 100,
    fotoperiodoAcumH: Math.round(foto),
    horasSolAcumH: temSol ? Math.round(sol) : null,
    horasSolHojeH: solHoje,
    chuvaMm: Math.round(chuva * 10) / 10,
    diasComChuva: diasChuva,
    et0Mm: Math.round(et0 * 10) / 10,
    tmaxAbs: nT ? tmaxAbs : NaN,
    tminAbs: nT ? tminAbs : NaN,
    tmedia: nT ? Math.round((somaT / nT) * 10) / 10 : NaN,
    diasQuentes: quentes,
    diasFrios: frios,
    fimCicloDas: fim,
    faltamDias: fim - das(ate, plantio),
    serie,
  };
}

import { agregarDia, diaAnterior } from "./agregacao.ts";
import type { DataISO, DiaClima, Leitura } from "./tipos.ts";

const CAMPOS = ["tmax", "tmin", "tmed", "ur", "vento", "rad"] as const;

export function proximoDia(data: DataISO): DataISO {
  return new Date(Date.parse(data + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
}

export function datasEntre(ini: DataISO, fim: DataISO): DataISO[] {
  const r: DataISO[] = [];
  for (let d = ini; d <= fim; d = proximoDia(d)) r.push(d);
  return r;
}

/**
 * Clima de todos os dias de `ini` a `fim`, sem buracos (o balanço precisa de dias seguidos).
 *
 * Dia sem leitura nenhuma, ou com algum sensor sem dado, recebe o valor do dia válido anterior
 * mais próximo (ou do seguinte, se não houver anterior) e fica marcado em `estimados`.
 * Chuva nunca é estimada: sem leitura, conta 0. A decisão desses dias já sai "SEM DADOS" pelo `n`.
 * Devolve [] se não houver nenhum dia com dado no período.
 */
export function climaCompleto(leituras: Leitura[], ini: DataISO, fim: DataISO): DiaClima[] {
  const ordenadas = [...leituras].sort((a, b) => (a.quando < b.quando ? -1 : 1));
  const brutos = datasEntre(ini, fim).map((data) => {
    const de = `${diaAnterior(data)}T18:00:00`;
    const ate = `${data}T18:00:00`;
    const janela = ordenadas.filter((l) => l.quando >= de && l.quando < ate);
    return { data, dia: agregarDia(janela, data) };
  });

  const valido = (d: DiaClima | null, c: (typeof CAMPOS)[number]) => d !== null && Number.isFinite(d[c]);
  if (!brutos.some((b) => CAMPOS.every((c) => valido(b.dia, c)))) return [];

  return brutos.map(({ data, dia }, i) => {
    const r: DiaClima = dia ? { ...dia } : { data, tmax: NaN, tmin: NaN, tmed: NaN, ur: NaN, vento: NaN, rad: NaN, chuva: 0, n: 0 };
    const estimados: string[] = [];
    for (const c of CAMPOS) {
      if (Number.isFinite(r[c])) continue;
      const fonte =
        brutos.slice(0, i).reverse().find((b) => valido(b.dia, c)) ?? brutos.slice(i + 1).find((b) => valido(b.dia, c));
      if (!fonte?.dia) continue; // impossível: há ao menos um dia completo
      r[c] = fonte.dia[c];
      estimados.push(c);
    }
    if (!Number.isFinite(r.chuva)) r.chuva = 0;
    if (estimados.length) r.estimados = estimados;
    return r;
  });
}

import { readFileSync } from "node:fs";
import { numero, SOJA, type DiaClima, type Estacao, type Leitura, type Pivo } from "../src/motor/index.ts";

/** Parâmetros de exemplo da seção 7 do CONTEXT.md — não são medições da fazenda. */
export const ESTACAO_EXEMPLO: Estacao = { latitude: -14.74, altitude: 900, alturaAnemometro: 2 };

export const PIVO2_EXEMPLO: Pivo = {
  nome: "Pivô 2",
  cultura: SOJA,
  plantio: "2025-11-25",
  plantioDiretoPalhada: true,
  umidadeInicialPct: 30,
  solo: { cc: 32, pmp: 18, raizIniCm: 10, raizMaxCm: 50, diasRaiz: 55, fatorDeplecaoFixo: null },
  laminaMinimaMm: 5,
  tensaoIrrigarKpa: -70,
};

interface LinhaJson {
  d: string; t: number; ur: number; rad: number; vento: number; chuva: number;
  et0: number; etc: number; n: number; tmax: number; tmin: number;
}

export const JSON_PIVO2: LinhaJson[] = JSON.parse(
  readFileSync(new URL("./fixtures/dados_pivo2_exemplo.json", import.meta.url), "utf8"),
);

export const DIAS_PIVO2: DiaClima[] = JSON_PIVO2.map((l) => ({
  data: l.d, tmax: l.tmax, tmin: l.tmin, tmed: l.t, ur: l.ur, vento: l.vento, rad: l.rad, chuva: l.chuva, n: l.n,
}));

/**
 * Leituras brutas do METEO da planilha corrigida. Nessa aba a radiação está em MJ/m² por leitura
 * de 10 min (W/m² × 600 / 10⁶), então volta para W/m² aqui.
 */
export function leiturasMeteoCorrigido(): Leitura[] {
  const linhas = readFileSync(new URL("./fixtures/meteo_pivo2_corrigido.csv", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .slice(1);
  return linhas.map((linha) => {
    const [quando, chuva, temp, ur, radMJ, vento] = linha.split(",");
    const r = numero(radMJ);
    return {
      quando: quando!,
      chuvaAcumDia: numero(chuva),
      tempC: numero(temp),
      urPct: numero(ur),
      radWm2: r === null ? null : (r * 1e6) / 600,
      ventoMs: numero(vento),
    };
  });
}

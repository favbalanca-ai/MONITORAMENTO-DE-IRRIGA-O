/** Roda o motor no Pivô 2 de exemplo e imprime a tabela dia a dia. */
import { simularBalanco } from "../src/motor/index.ts";
import { DIAS_PIVO2, ESTACAO_EXEMPLO, PIVO2_EXEMPLO } from "../test/pivo2_exemplo.ts";

const linhas = simularBalanco({ pivo: PIVO2_EXEMPLO, estacao: ESTACAO_EXEMPLO, dias: DIAS_PIVO2 });
console.table(
  linhas.map((l) => ({
    dia: l.data,
    DAS: l.das,
    estadio: l.estadio,
    "ET0 PM": l.et0.toFixed(2),
    "ET0 HS": l.et0Hargreaves.toFixed(2),
    ETc: l.etc.toFixed(2),
    chuva: l.chuva.toFixed(1),
    "déficit": l.deficit.toFixed(1),
    AFD: l.afdMm.toFixed(1),
    "decisão": l.decisao,
    alertas: l.alertas.length,
  })),
);

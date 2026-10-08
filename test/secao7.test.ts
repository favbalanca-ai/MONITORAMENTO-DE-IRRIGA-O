import { test } from "node:test";
import assert from "node:assert/strict";
import { simularBalanco } from "../src/motor/index.ts";
import { DIAS_PIVO2, ESTACAO_EXEMPLO, JSON_PIVO2, PIVO2_EXEMPLO } from "./pivo2_exemplo.ts";

// Tabela da seção 7 do CONTEXT.md: dia, ET₀ PM, ET₀ HS, ET₀ da planilha original, déficit, decisão.
const REFERENCIA: [string, number, number, number, number, string][] = [
  ["2026-01-20", 0.61, 3.68, 0.03, 5.7, "IRRIGAR"],
  ["2026-01-21", 4.29, 3.70, 4.07, 0.0, "SEM DADOS"],
  ["2026-01-22", 3.21, 3.69, 2.78, 0.0, "NÃO IRRIGAR"],
  ["2026-01-23", 2.53, 3.96, 2.01, 0.0, "NÃO IRRIGAR"],
  ["2026-01-24", 3.54, 4.49, 2.87, 0.0, "NÃO IRRIGAR"],
  ["2026-01-25", 2.36, 3.32, 1.53, 2.2, "NÃO IRRIGAR"],
  ["2026-01-26", 3.77, 4.68, 2.97, 6.0, "IRRIGAR"],
  ["2026-01-27", 5.10, 5.18, 3.50, 11.9, "IRRIGAR"],
  ["2026-01-28", 4.52, 4.83, 3.23, 17.1, "IRRIGAR"],
  ["2026-01-29", 4.06, 4.94, 3.09, 21.5, "IRRIGAR"],
  ["2026-01-30", 3.50, 4.19, 2.74, 20.5, "IRRIGAR"],
  ["2026-01-31", 3.79, 4.36, 3.07, 19.7, "IRRIGAR"],
  ["2026-02-01", 4.23, 4.36, 3.47, 22.8, "IRRIGAR"],
  ["2026-02-02", 4.12, 4.34, 3.35, 25.3, "IRRIGAR"],
  ["2026-02-03", 2.59, 3.89, 2.16, 17.9, "IRRIGAR"],
  ["2026-02-04", 3.81, 4.15, 3.15, 17.9, "IRRIGAR"],
  ["2026-02-05", 2.30, 3.96, 1.62, 20.6, "IRRIGAR"],
  ["2026-02-06", 3.93, 4.75, 3.09, 25.1, "IRRIGAR"],
  ["2026-02-07", 3.19, 3.61, 2.21, 24.4, "IRRIGAR"],
  ["2026-02-08", 3.89, 4.44, 2.95, 24.6, "IRRIGAR"],
];

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

test("Pivô 2 de exemplo reproduz a tabela da seção 7, dia a dia", () => {
  const linhas = simularBalanco({ pivo: PIVO2_EXEMPLO, estacao: ESTACAO_EXEMPLO, dias: DIAS_PIVO2 });
  assert.equal(linhas.length, REFERENCIA.length);
  linhas.forEach((l, i) => {
    const [data, pm, hs, planilha, deficit, decisao] = REFERENCIA[i]!;
    assert.equal(l.data, data);
    assert.equal(r2(l.et0), pm, `${data} ET₀ PM`);
    assert.equal(r2(l.et0Hargreaves), hs, `${data} ET₀ HS`);
    assert.equal(r2(JSON_PIVO2[i]!.et0), planilha, `${data} ET₀ planilha`);
    assert.equal(r1(l.deficit), deficit, `${data} déficit`);
    assert.equal(l.decisao, decisao, `${data} decisão`);
  });
});

test("Pivô 2 de exemplo fica em R3 (Kc 1,15) com raiz máxima em todo o período", () => {
  const linhas = simularBalanco({ pivo: PIVO2_EXEMPLO, estacao: ESTACAO_EXEMPLO, dias: DIAS_PIVO2 });
  for (const l of linhas) {
    assert.equal(l.estadio, "R3");
    assert.equal(l.kc, 1.15);
    assert.equal(l.raizCm, 50);
    assert.ok(Math.abs(l.cadMm - 70) < 1e-9);
  }
  assert.equal(linhas[0]!.das, 56);
});

test("alertas do exemplo: radiação suspeita e divergência da Hargreaves em 20/01", () => {
  const [primeiro] = simularBalanco({ pivo: PIVO2_EXEMPLO, estacao: ESTACAO_EXEMPLO, dias: DIAS_PIVO2 });
  assert.ok(primeiro!.alertas.some((a) => a.includes("Radiação")));
  assert.ok(primeiro!.alertas.some((a) => a.includes("Hargreaves")));
});

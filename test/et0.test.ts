import { test } from "node:test";
import assert from "node:assert/strict";
import { diaDoAno, et0PenmanMonteith, radiacaoExtraterrestre, ventoA2m } from "../src/motor/index.ts";
import { ESTACAO_EXEMPLO } from "./pivo2_exemplo.ts";

test("Ra — FAO-56 exemplo 8: 20°S em 3 de setembro ≈ 32,2 MJ/m²/dia", () => {
  assert.equal(diaDoAno("2026-09-03"), 246);
  assert.equal(Math.round(radiacaoExtraterrestre(-20, "2026-09-03") * 10) / 10, 32.2);
});

test("vento — FAO-56 exemplo 14: 3,2 m/s a 10 m ≈ 2,4 m/s a 2 m", () => {
  assert.equal(Math.round(ventoA2m(3.2, 10) * 10) / 10, 2.4);
  assert.equal(ventoA2m(3, 2), 3);
});

test("ET₀ nunca é negativa, mesmo com radiação quase zero", () => {
  const dia = { data: "2026-01-20", tmax: 20, tmin: 19, tmed: 19.5, ur: 100, vento: 0.5, rad: 0, chuva: 0, n: 144 };
  assert.ok(et0PenmanMonteith(dia, ESTACAO_EXEMPLO) >= 0);
});

test("ET₀ cresce com radiação, vento e ar seco", () => {
  const base = { data: "2026-01-27", tmax: 29.7, tmin: 18.8, tmed: 23.4, ur: 70, vento: 3.7, rad: 20.8, chuva: 0, n: 144 };
  const e = (o: Partial<typeof base>) => et0PenmanMonteith({ ...base, ...o }, ESTACAO_EXEMPLO);
  assert.ok(e({ rad: 25 }) > e({}));
  assert.ok(e({ ur: 50 }) > e({}));
  assert.ok(e({ vento: 5 }) > e({}));
});

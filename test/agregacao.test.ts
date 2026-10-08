import { test } from "node:test";
import assert from "node:assert/strict";
import { agregarDia, type Leitura } from "../src/motor/index.ts";
import { JSON_PIVO2, leiturasMeteoCorrigido } from "./pivo2_exemplo.ts";

const leitura = (quando: string, c: Partial<Leitura> = {}): Leitura => ({
  quando, chuvaAcumDia: 0, tempC: 20, urPct: 80, radWm2: 0, ventoMs: 2, ...c,
});

test("leituras brutas do METEO corrigido reproduzem o JSON agregado", () => {
  const ls = leiturasMeteoCorrigido();
  for (const j of JSON_PIVO2) {
    const a = agregarDia(ls, j.d);
    assert.ok(a, j.d);
    assert.equal(a.n, j.n, `${j.d} leituras`);
    assert.equal(a.tmax, j.tmax, `${j.d} tmax`);
    assert.equal(a.tmin, j.tmin, `${j.d} tmin`);
    assert.ok(Math.abs(a.tmed - j.t) <= 0.05, `${j.d} tmed`);
    assert.ok(Math.abs(a.ur - j.ur) <= 0.5, `${j.d} UR`);
    assert.ok(Math.abs(a.vento - j.vento) <= 0.06, `${j.d} vento`);
    assert.ok(Math.abs(a.rad - j.rad) <= 0.005, `${j.d} radiação`);
    assert.ok(Math.abs(a.chuva - j.chuva) < 1e-6, `${j.d} chuva`);
  }
});

test("janela vai de 18h de D−1 (inclusive) até 18h de D (exclusive)", () => {
  const ls = [
    leitura("2026-01-09T17:59:59", { tempC: 99 }),
    leitura("2026-01-09T18:00:00", { tempC: 10 }),
    leitura("2026-01-10T17:59:59", { tempC: 30 }),
    leitura("2026-01-10T18:00:00", { tempC: -5 }),
  ];
  const a = agregarDia(ls, "2026-01-10")!;
  assert.deepEqual([a.tmin, a.tmax, a.n], [10, 30, 2]);
});

test("chuva soma a noite anterior e o dia, mesmo com o acumulado zerando à meia-noite", () => {
  const ls = [
    leitura("2026-01-09T18:00:00", { chuvaAcumDia: 4 }), // já tinha chovido 4 mm de tarde (fora da janela)
    leitura("2026-01-09T21:00:00", { chuvaAcumDia: 10 }),
    leitura("2026-01-09T23:50:00", { chuvaAcumDia: 12 }),
    leitura("2026-01-10T00:00:00", { chuvaAcumDia: 0 }),
    leitura("2026-01-10T06:00:00", { chuvaAcumDia: 3 }),
    leitura("2026-01-10T17:50:00", { chuvaAcumDia: 5 }),
  ];
  assert.equal(agregarDia(ls, "2026-01-10")!.chuva, 8 + 5);
});

test("radiação é a média por leitura levada ao dia, não a soma", () => {
  const poucas = [leitura("2026-01-10T12:00:00", { radWm2: 500 })];
  const repetidas = [...poucas, ...poucas, ...poucas];
  assert.equal(agregarDia(poucas, "2026-01-10")!.rad, agregarDia(repetidas, "2026-01-10")!.rad);
  assert.ok(Math.abs(agregarDia(poucas, "2026-01-10")!.rad - 43.2) < 1e-9);
});

test("valores inválidos são ignorados e janela sem temperatura devolve null", () => {
  const ls = [leitura("2026-01-10T10:00:00", { tempC: null }), leitura("2026-01-10T11:00:00", { tempC: 22, urPct: null })];
  const a = agregarDia(ls, "2026-01-10")!;
  assert.equal(a.tmed, 22);
  assert.equal(a.ur, 80);
  assert.equal(agregarDia([leitura("2026-01-10T10:00:00", { tempC: null })], "2026-01-10"), null);
});

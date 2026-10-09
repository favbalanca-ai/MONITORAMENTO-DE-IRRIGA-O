import { test } from "node:test";
import assert from "node:assert/strict";
import { fotoperiodoH, horasDeSol, resumoCiclo, SOJA, agregarDia } from "../src/motor/index.ts";
import { DIAS_PIVO2, ESTACAO_EXEMPLO } from "./pivo2_exemplo.ts";
import { et0PenmanMonteith } from "../src/motor/et0.ts";

test("fotoperíodo: ~12 h no equinócio, mais longo no verão do sul (lat −15)", () => {
  assert.ok(Math.abs(fotoperiodoH(-15, "2026-03-21") - 12) < 0.1);
  assert.ok(fotoperiodoH(-15, "2026-12-21") > 12.8 && fotoperiodoH(-15, "2026-12-21") < 13);
  assert.ok(fotoperiodoH(-15, "2026-06-21") > 11 && fotoperiodoH(-15, "2026-06-21") < 11.2);
  assert.ok(Math.abs(fotoperiodoH(0, "2026-06-21") - 12) < 0.1);
});

test("horas de sol: leituras com radiação acima de 120 W/m², cada uma valendo o intervalo", () => {
  const l = (rad: number | null, intervaloMin = 10) => ({ quando: "2026-02-08T12:00:00", chuvaAcumDia: 0, tempC: 25, urPct: 50, radWm2: rad, ventoMs: 1, intervaloMin });
  assert.equal(horasDeSol([l(800), l(500), l(100), l(null), l(130, 30)]), 0.8); // 10 + 10 + 30 min
  const dia = agregarDia(Array.from({ length: 144 }, (_, i) => ({ ...l(i >= 42 && i < 102 ? 600 : 50), quando: new Date(Date.parse("2026-02-07T18:00:00Z") + i * 600_000).toISOString().slice(0, 19) })), "2026-02-08")!;
  assert.equal(dia.horasSol, 10);
});

test("resumo do ciclo: graus-dia, fotoperíodo, chuva, ET₀, extremos e dias que faltam", () => {
  const et0 = new Map(DIAS_PIVO2.map((d) => [d.data, et0PenmanMonteith(d, ESTACAO_EXEMPLO)]));
  const r = resumoCiclo(SOJA, "2025-11-25", "2026-02-08", ESTACAO_EXEMPLO.latitude, DIAS_PIVO2, et0, 1300);
  assert.equal(r.dias, 76);
  assert.equal(r.diasComClima, 20); // só há clima de 20/01 a 08/02
  const gdEsperado = DIAS_PIVO2.reduce((t, d) => t + Math.max(0, d.tmed - 10), 0);
  assert.equal(r.grausDia, Math.round(gdEsperado));
  assert.equal(r.tBaseC, 10);
  assert.ok(Math.abs(r.fracaoGrausDia! - gdEsperado / 1300) < 0.002);
  assert.ok(r.fotoperiodoAcumH > 76 * 12.4 && r.fotoperiodoAcumH < 76 * 13);
  assert.ok(r.fotoperiodoHojeH > 12.4 && r.fotoperiodoHojeH < 12.9);
  assert.equal(r.horasSolAcumH, null); // a fixture não tem horas de sol
  assert.ok(Math.abs(r.chuvaMm - DIAS_PIVO2.reduce((t, d) => t + d.chuva, 0)) < 0.05);
  assert.equal(r.diasComChuva, DIAS_PIVO2.filter((d) => d.chuva >= 1).length);
  assert.ok(r.et0Mm > 50 && r.et0Mm < 70);
  assert.equal(r.tmaxAbs, Math.max(...DIAS_PIVO2.map((d) => d.tmax)));
  assert.equal(r.fimCicloDas, 120);
  assert.equal(r.faltamDias, 120 - 75);
  assert.equal(r.serie.length, 20);
  assert.equal(r.serie[19]!.gdAcum, r.grausDia);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { capacidade, recomendar, type Equipamento } from "../src/motor/index.ts";

// Valores de exemplo, não são os dados de placa do pivô.
const EQ: Equipamento = {
  raioM: 400, anguloGraus: 360, vazaoM3h: 200, velocidadeUltimaTorreMMin: 3,
  percentimetroMinPct: 10, eficienciaPct: 85, potenciaKw: 55, tarifaRsKwh: 0.5,
};
const perto = (a: number, b: number, tol = 1e-2) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

test("capacidade do pivô: área, volta a 100%, lâmina a 100% e máxima", () => {
  const c = capacidade(EQ);
  perto(c.areaHa, 50.27);
  perto(c.t100h, 13.96);
  perto(c.lamina100Mm, 5.56);
  perto(c.laminaMaxMm, 55.56);
  perto(capacidade({ ...EQ, anguloGraus: 180 }).lamina100Mm, c.lamina100Mm); // meia volta, mesma lâmina
});

test("recomendação para 20 mm de déficit com 85% de eficiência", () => {
  const r = recomendar(EQ, 20);
  perto(r.laminaBrutaMm, 23.53);
  perto(r.percentimetroPct, 23.6, 0.05);
  perto(r.tempoVoltaH, 59.1, 0.05);
  perto(r.energiaKwh, 55 * r.tempoVoltaH, 1e-9);
  perto(r.custoRs, r.energiaKwh * 0.5, 1e-9);
  assert.equal(r.limitadoPelaLaminaMax, false);
});

test("déficit pequeno fica no percentímetro 100%; déficit enorme trava no mínimo", () => {
  const pequeno = recomendar(EQ, 1);
  assert.equal(pequeno.percentimetroPct, 100);
  perto(pequeno.tempoVoltaH, pequeno.t100h, 1e-9);
  const enorme = recomendar(EQ, 100);
  perto(enorme.percentimetroPct, 10, 1e-9);
  assert.equal(enorme.limitadoPelaLaminaMax, true);
});

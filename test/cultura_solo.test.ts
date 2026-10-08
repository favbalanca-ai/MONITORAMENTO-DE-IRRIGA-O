import { test } from "node:test";
import assert from "node:assert/strict";
import { cad, das, deficitDaUmidade, estadioPorDas, fatorDeplecao, kcDoDia, profundidadeRaiz, SOJA } from "../src/motor/index.ts";
import { PIVO2_EXEMPLO } from "./pivo2_exemplo.ts";

const solo = PIVO2_EXEMPLO.solo;

test("DAS conta dias corridos, atravessando a virada do ano", () => {
  assert.equal(das("2026-01-20", "2025-11-25"), 56);
  assert.equal(das("2025-11-25", "2025-11-25"), 0);
});

test("estádio da soja pela fração do ciclo, com limites inclusivos", () => {
  const nomes = [0, 20, 21, 36, 37, 55, 56, 75, 76, 99, 100, 120, 150].map((d) => estadioPorDas(SOJA, d).nome);
  assert.deepEqual(nomes, ["V1", "V1", "V3", "V3", "R1", "R1", "R3", "R3", "R5", "R5", "R7", "R7", "R7"]);
});

test("palhada corta pela metade só o Kc do primeiro estádio", () => {
  assert.equal(kcDoDia(SOJA, 5, true).kc, 0.225);
  assert.equal(kcDoDia(SOJA, 5, false).kc, 0.45);
  assert.equal(kcDoDia(SOJA, 30, true).kc, 0.75);
});

test("raiz cresce em linha reta de 10 a 50 cm em 55 dias e para", () => {
  assert.equal(profundidadeRaiz(solo, 0), 10);
  assert.equal(profundidadeRaiz(solo, 27.5), 30);
  assert.equal(profundidadeRaiz(solo, 55), 50);
  assert.equal(profundidadeRaiz(solo, 90), 50);
  assert.equal(profundidadeRaiz(solo, -3), 10);
});

test("CAD, déficit pela umidade e fator de depleção", () => {
  assert.ok(Math.abs(cad(solo, 50) - 70) < 1e-9);
  assert.equal(deficitDaUmidade(solo, 30, 50), 10);
  assert.equal(deficitDaUmidade(solo, 35, 50), 0); // acima da CC não vira déficit negativo
  assert.deepEqual([2.5, 2.51, 5, 7.5, 8].map((e) => fatorDeplecao(solo, e)), [0.75, 0.6, 0.6, 0.5, 0.4]);
  assert.equal(fatorDeplecao({ ...solo, fatorDeplecaoFixo: 0.5 }, 1), 0.5);
});

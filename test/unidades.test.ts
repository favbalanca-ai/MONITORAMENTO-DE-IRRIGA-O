import { test } from "node:test";
import assert from "node:assert/strict";
import { numero, paraCelsius, paraMm, paraMs, paraWm2, UnidadeDesconhecida } from "../src/motor/index.ts";

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≈ ${b}`);

test("temperatura em °F vira °C pelo .unit (as duas leituras que escaparam na planilha)", () => {
  perto(paraCelsius(75.9, "ºF"), 24.389);
  perto(paraCelsius(66.2, "℉"), 19.0);
  assert.equal(paraCelsius(21.2, "℃"), 21.2);
});

test("chuva em polegadas, vento em mph e km/h, radiação em W/m²", () => {
  perto(paraMm(0.01, "in"), 0.254);
  assert.equal(paraMm(3, "mm"), 3);
  perto(paraMs(5.4, "mph"), 2.414);
  perto(paraMs(36, "km/h"), 10);
  assert.equal(paraWm2(800, "W/m²"), 800);
});

test("unidade desconhecida é erro, não chute", () => {
  assert.throws(() => paraCelsius(20, "K"), UnidadeDesconhecida);
  assert.throws(() => paraMm(1, undefined), UnidadeDesconhecida);
});

test("texto numérico vira número; lixo vira null", () => {
  assert.equal(numero("75.9"), 75.9);
  assert.equal(numero("75,9"), 75.9);
  assert.equal(numero(""), null);
  assert.equal(numero("abc"), null);
  assert.equal(numero(NaN), null);
  assert.equal(numero(null), null);
});

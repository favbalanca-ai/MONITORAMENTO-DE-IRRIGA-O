import { test } from "node:test";
import assert from "node:assert/strict";
import { ALGODAO, cad, comCiclo, CULTURAS, curvaKc, dae, fimDoCicloDas, das, deficitDaUmidade, estadioPorDas, fatorDeplecao, FEIJAO, FEIJAO_PD, kcDoDia, MILHO, profundidadeRaiz, SOJA, TRIGO } from "../src/motor/index.ts";
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

test("catálogo tem as culturas da Embrapa, cada uma com fonte e estádios em ordem", () => {
  assert.deepEqual(Object.keys(CULTURAS), ["soja", "milho", "sorgo", "feijao", "feijao pd", "trigo", "algodao"]);
  for (const c of Object.values(CULTURAS)) {
    assert.ok(c.fonte, c.nome);
    const fr = c.estadios.map((e) => e.ateFracao);
    assert.deepEqual([...fr].sort((a, b) => a - b), fr, c.nome);
    assert.equal(fr[fr.length - 1], 1, c.nome);
    for (let d = 0; d <= c.cicloDias + 30; d++) {
      const kc = kcDoDia(c, d, false).kc;
      assert.ok(kc > 0.2 && kc < 1.45, `${c.nome} DAS ${d}: Kc ${kc}`);
    }
  }
});

test("milho: Kc sobe em linha reta no vegetativo e desce na maturação", () => {
  const kc = (d: number) => kcDoDia(MILHO, d, false).kc;
  assert.equal(kc(10), 0.5);
  assert.equal(kc(20.4), 0.5); // fim da fase inicial (17% de 120)
  assert.ok(Math.abs(kc(37.2) - 0.85) < 1e-9); // meio do vegetativo
  assert.ok(Math.abs(kc(54) - 1.2) < 1e-9);
  assert.equal(kc(80), 1.2);
  assert.ok(Math.abs(kc(120) - 0.6) < 1e-9);
  assert.ok(Math.abs(kc(150) - 0.6) < 1e-9); // passou do ciclo: fica no final
  assert.equal(kcDoDia(MILHO, 10, true).kc, 0.25); // palhada corta a fase inicial
});

test("feijão conta pelos dias após a emergência", () => {
  assert.equal(dae(FEIJAO, 3), 0);
  assert.equal(kcDoDia(FEIJAO, 21, false).kc, 0.49); // 14 DAE
  assert.equal(kcDoDia(FEIJAO, 22, false).kc, 0.69); // 15 DAE
  assert.equal(kcDoDia(FEIJAO, 7 + 50, false).kc, 1.06);
  assert.equal(kcDoDia(FEIJAO, 7 + 90, false).estadio.nome, "Maturação (85–94 DAE)");
  // plantio direto: Kc já medido sobre palhada, não corta de novo
  assert.equal(kcDoDia(FEIJAO_PD, 10, true).kc, 0.69);
  assert.equal(kcDoDia(FEIJAO_PD, 7 + 40, true).kc, 1.28);
});

test("trigo e algodão seguem a equação da Embrapa por DAE", () => {
  const trigo = (x: number) => -0.000268 * x * x + 0.032979 * x + 0.392945;
  assert.ok(Math.abs(kcDoDia(TRIGO, 5 + 60, false).kc - trigo(60)) < 1e-12);
  assert.ok(Math.abs(kcDoDia(TRIGO, 5 + 60, false).kc - 1.4069) < 1e-3); // pico ~1,41
  assert.ok(Math.abs(kcDoDia(TRIGO, 300, false).kc - trigo(115)) < 1e-12); // trava no fim do ciclo
  assert.ok(Math.abs(kcDoDia(ALGODAO, 5 + 75, false).kc - 0.9695) < 1e-9);
  assert.equal(kcDoDia(TRIGO, 5 + 60, false).estadio.nome, "Alongamento/emborrachamento");
});

test("ciclo diferente do padrão estica a curva na mesma proporção", () => {
  const m140 = comCiclo(MILHO, 140);
  assert.equal(m140.cicloDias, 140);
  assert.equal(comCiclo(MILHO, null), MILHO);
  assert.ok(Math.abs(kcDoDia(m140, 63, false).kc - 1.2) < 1e-9); // 45% de 140
  assert.equal(kcDoDia(m140, 20, false).kc, 0.5);
  const t130 = comCiclo(TRIGO, 130);
  assert.ok(Math.abs(kcDoDia(t130, 5 + 130, false).kc - kcDoDia(TRIGO, 5 + 115, false).kc) < 1e-9);
  assert.equal(fimDoCicloDas(FEIJAO), 101);
  const curva = curvaKc(MILHO, true);
  assert.equal(curva.length, 121);
  assert.equal(curva[0], 0.25);
  assert.equal(curva[120], 0.6);
});

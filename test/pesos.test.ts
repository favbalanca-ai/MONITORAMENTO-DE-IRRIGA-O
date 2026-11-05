import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcularPesos, consensoPonderado, aplicarPesos, lerOpenMeteo, vereditoPrevisao, type RegistroModelo, type ObservacaoDia } from "../src/motor/index.ts";

const omModelos = JSON.parse(readFileSync(new URL("./fixtures/previsao_openmeteo_modelos.json", import.meta.url), "utf8"));

/** 10 dias medidos; ECMWF acerta quase tudo, GFS erra a chuva pela metade, GEM nunca vê chuva. */
function cenario() {
  const obs: ObservacaoDia[] = [], reg: RegistroModelo[] = [];
  const chuva = [0, 12, 8, 0, 0, 3, 15, 0, 6, 0];
  for (let i = 0; i < 10; i++) {
    const data = "2026-03-" + String(1 + i).padStart(2, "0");
    obs.push({ data, chuvaMm: chuva[i]!, tmax: 30 + (i % 3), tmin: 18 + (i % 2) });
    for (let ant = 1; ant <= 3; ant++) {
      const emissao = "2026-02-" + String(28 - ant + 1 + i).padStart(2, "0"); // só a diferença de dias importa
      const em = new Date(Date.parse(data + "T00:00:00Z") - ant * 86_400_000).toISOString().slice(0, 10);
      void emissao;
      reg.push({ emissao: em, alvo: data, modelo: "ECMWF", chuvaMm: chuva[i]! + 0.5, tmax: 30 + (i % 3) + 0.3, tmin: 18 + (i % 2) - 0.2 });
      reg.push({ emissao: em, alvo: data, modelo: "GFS", chuvaMm: chuva[i]! * 0.5, tmax: 30 + (i % 3) + 1.5, tmin: 18 + (i % 2) + 1 });
      reg.push({ emissao: em, alvo: data, modelo: "GEM", chuvaMm: 0, tmax: 30 + (i % 3) + 3, tmin: 18 + (i % 2) + 3 });
    }
  }
  return { obs, reg };
}

test("placar: quem erra menos ganha mais peso; o peso decai com a idade e precisa de história mínima", () => {
  const { obs, reg } = cenario();
  const p = calcularPesos(reg, obs, "2026-03-11");
  assert.equal(p.suficiente, true);
  assert.equal(p.diasComparados, 10);
  assert.deepEqual(p.modelos.map((m) => m.modelo), ["ECMWF", "GFS", "GEM"]); // ordem: do maior peso ao menor
  const [e, g, m] = p.modelos;
  assert.equal(e!.maeChuva, 0.5);
  assert.ok(g!.maeChuva! > 1.5 && m!.maeChuva! > 3, JSON.stringify(p.modelos));
  assert.equal(e!.acertoChuvaPct, 100);
  assert.ok(m!.acertoChuvaPct! < 60); // GEM só acerta os dias secos
  assert.ok(e!.peso > g!.peso && g!.peso > m!.peso);
  assert.ok(Math.abs(p.modelos.reduce((s, x) => s + x.peso, 0) - 1) < 0.02);
  assert.ok(e!.peso >= 0.5 && m!.peso <= 0.15, "ECMWF " + e!.peso + " GEM " + m!.peso);
  // só 3 dias medidos: pesos iguais, sem consenso
  const pouco = calcularPesos(reg.filter((r) => r.alvo >= "2026-03-08"), obs, "2026-03-11");
  assert.equal(pouco.suficiente, false);
  assert.equal(pouco.diasComparados, 3);
  assert.ok(pouco.modelos.every((x) => Math.abs(x.peso - 1 / 3) < 0.01));
  // antecedência acima de 7 dias e alvos no futuro não entram; só erro recente conta mais
  const velho = reg.map((r) => ({ ...r, emissao: "2026-02-01" }));
  assert.equal(calcularPesos(velho, obs, "2026-03-11").diasComparados, 0);
  assert.equal(calcularPesos(reg, obs, "2026-03-01").diasComparados, 0);
  // erro recente pesa mais: GFS que acertava e passou a errar nos últimos dias cai abaixo de quem fez o inverso
  const recente: RegistroModelo[] = reg.filter((r) => r.modelo !== "GEM").map((r) => {
    const i = Number(r.alvo.slice(8, 10)) - 1;
    const o = obs[i]!;
    if (r.modelo === "ECMWF") return { ...r, chuvaMm: i < 5 ? o.chuvaMm! + 10 : o.chuvaMm }; // errava antes, acerta agora
    return { ...r, chuvaMm: i < 5 ? o.chuvaMm : o.chuvaMm! + 10 }; // GFS acertava antes, erra agora
  });
  const pr = calcularPesos(recente, obs, "2026-03-11");
  assert.equal(pr.modelos[0]!.modelo, "ECMWF");
});

test("consenso ponderado: chuva e temperatura pela média dos pesos; chance mistura modelos e ensemble", () => {
  const { obs, reg } = cenario();
  const pesos = calcularPesos(reg, obs, "2026-03-11");
  // dia com três modelos: ECMWF 10 mm, GFS 2 mm, GEM 0 mm → o consenso puxa para o ECMWF
  const dia = { ...lerOpenMeteo(omModelos)[8]!, modelos: [
    { nome: "ECMWF", chuvaMm: 10, tmax: 28, tmin: 18 }, { nome: "GFS", chuvaMm: 2, tmax: 30, tmin: 19 }, { nome: "GEM", chuvaMm: 0, tmax: 33, tmin: 21 }] };
  const c = consensoPonderado(dia, pesos)!;
  assert.ok(c.chuvaMm > 6 && c.chuvaMm < 10, "chuva " + c.chuvaMm);
  assert.ok(c.tmax! < 30 && c.tmin! < 19.5);
  assert.equal(c.modelos, 3);
  // chance: parcela ponderada com ≥ 1 mm (ECMWF + GFS ≈ 90 %) misturada com o ensemble (100 % no fixture? não há) → só modelos
  const semEns = { ...dia, ensemble: undefined };
  assert.ok(consensoPonderado(semEns, pesos)!.probPct! >= 85);
  const comEns = { ...dia, ensemble: { probPct: 20, minMm: 0, p10Mm: 0, p50Mm: 1, p90Mm: 3, maxMm: 4, membros: 51 } };
  const pc = consensoPonderado(comEns, pesos)!.probPct!;
  assert.ok(pc > 50 && pc < 65, "chance " + pc); // (≈90 + 20) / 2
  // modelo que não está no placar entra com meio peso; sem pesos suficientes, média simples
  const iguais = consensoPonderado(dia, null)!;
  assert.equal(iguais.chuvaMm, 4);
  assert.equal(consensoPonderado({ ...dia, modelos: [] }, pesos), null);
  // aplicar: chuvaMm vira o consenso e o melhor ajuste fica guardado; sem história, nada muda
  const dias = aplicarPesos([dia], pesos);
  assert.equal(dias[0]!.modeloMm, dia.chuvaMm);
  assert.equal(dias[0]!.chuvaMm, c.chuvaMm);
  assert.equal(dias[0]!.consenso!.modelos, 3);
  assert.equal(aplicarPesos([dia], { ...pesos, suficiente: false })[0]!.consenso, undefined);
});


test("veredito de ontem: chove ou não (chance ≥ 70 % / < 30 % × medido ≥ 1 mm), meio = indefinida; se choveu, a quantidade", () => {
  // não choveu e a chance era 24 %: a previsão foi decisiva ("não chove") e acertou
  const seco = vereditoPrevisao(1.0, 24, 0);
  assert.equal(seco.veredito, "acertou");
  assert.equal(seco.texto, "não choveu, como previsto (24%)");
  assert.deepEqual([seco.choveu, seco.disseChuva, seco.indefinida, seco.acertoChuva, seco.acertoQtd], [false, false, false, true, null]);
  // chance entre 30 % e 70 %: em cima do muro, não vale acerto nem erro
  const muro = vereditoPrevisao(0.8, 46, 0);
  assert.equal(muro.veredito, "indefinida");
  assert.equal(muro.texto, "não choveu; a previsão ficou em cima do muro (46%)");
  assert.equal(muro.acertoChuva, false);
  assert.equal(vereditoPrevisao(5, 60, 6).texto, "choveu 6,0 mm; a previsão ficou em cima do muro (60%)");
  assert.equal(vereditoPrevisao(5, 69, 6).veredito, "indefinida");
  assert.equal(vereditoPrevisao(5, 70, 6).veredito, "acertou");
  assert.equal(vereditoPrevisao(0.5, 29, 0).veredito, "acertou");
  assert.equal(vereditoPrevisao(0.5, 30, 0).veredito, "indefinida");
  // não choveu com chance alta: errou
  const furou = vereditoPrevisao(8, 93, 0.4);
  assert.equal(furou.veredito, "errou");
  assert.equal(furou.texto, "não choveu; a previsão dava 93% e 8,0 mm");
  // choveu sem a previsão avisar: errou
  const surpresa = vereditoPrevisao(0.5, 20, 7.1);
  assert.equal(surpresa.veredito, "errou");
  assert.equal(surpresa.texto, "choveu 7,1 mm; a previsão dava só 20%");
  // choveu como previsto e a quantidade bateu: acertou
  const cheio = vereditoPrevisao(8, 93, 7.1);
  assert.equal(cheio.veredito, "acertou");
  assert.equal(cheio.acertoQtd, true);
  assert.equal(cheio.texto, "choveu 7,1 mm; previsto 8,0 mm (93%)");
  // choveu como previsto mas bem menos: parcial
  const pouco = vereditoPrevisao(12, 80, 2);
  assert.equal(pouco.veredito, "parcial");
  assert.equal(pouco.texto, "choveu 2,0 mm; previsto 12,0 mm (80%): veio menos");
  assert.equal(vereditoPrevisao(4, 70, 15).texto, "choveu 15,0 mm; previsto 4,0 mm (70%): veio mais");
  // sem chance guardada: "disse chuva" pela quantidade prevista
  assert.equal(vereditoPrevisao(3, null, 0).texto, "não choveu; a previsão dava 3,0 mm e 3,0 mm");
  assert.equal(vereditoPrevisao(0.3, null, 0).veredito, "acertou");
});

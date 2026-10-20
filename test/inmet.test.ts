import { test } from "node:test";
import assert from "node:assert/strict";
import { lerEstacoesInmet, estacoesProximas, lerInmetEstacao, juntarObservacoes, urlInmetEstacao, distanciaKm } from "../src/motor/index.ts";

test("estações do INMET: lista limpa e as mais próximas da fazenda, com distância", () => {
  const lista = lerEstacoesInmet([
    { CD_ESTACAO: "A001", DC_NOME: "LONGE", SG_ESTADO: "RS", VL_LATITUDE: "-30.0", VL_LONGITUDE: "-51.0", CD_SITUACAO: "Operante" },
    { CD_ESTACAO: "A002", DC_NOME: "PERTO", SG_ESTADO: "GO", VL_LATITUDE: "-14.5", VL_LONGITUDE: "-46.4", CD_SITUACAO: "Operante" },
    { CD_ESTACAO: "A003", DC_NOME: "MEDIA", SG_ESTADO: "MG", VL_LATITUDE: "-15.3", VL_LONGITUDE: "-45.6", CD_SITUACAO: "Pane" },
    { CD_ESTACAO: "", DC_NOME: "SEM CODIGO", VL_LATITUDE: "-14.7", VL_LONGITUDE: "-46.2" },
    { CD_ESTACAO: "A004", DC_NOME: "SEM POSICAO", VL_LATITUDE: "", VL_LONGITUDE: "" },
  ]);
  assert.equal(lista.length, 3);
  const prox = estacoesProximas(lista, -14.74, -46.24, 2);
  assert.deepEqual(prox.map((e) => [e.codigo, e.distanciaKm]), [["A002", 32], ["A003", 93]]);
  assert.ok(Math.abs(distanciaKm(-14.74, -46.24, -14.5, -46.4) - 32) < 1);
  assert.throws(() => lerEstacoesInmet({}), /lista de estações/);
  assert.equal(urlInmetEstacao("2026-02-01", "2026-02-08", "A002"), "https://apitempo.inmet.gov.br/estacao/2026-02-01/2026-02-08/A002");
});

test("medições horárias do INMET (UTC) viram dias locais: chuva soma, máxima e mínima; dia incompleto marcado", () => {
  // 03:00 UTC de 09/02 = 00:00 local; a hora é o fim do intervalo → a chuva "03:00" (02–03 UTC) cai em 08/02 local
  const linhas = [];
  for (let h = 0; h < 48; h++) {
    const dt = h < 24 ? "2026-02-09" : "2026-02-10", hr = String(h % 24).padStart(2, "0") + "00";
    linhas.push({ DT_MEDICAO: dt, HR_MEDICAO: hr, CHUVA: h === 3 ? "5.0" : h === 20 ? "2.5" : "0.0", TEM_MAX: String(20 + (h % 24) / 2), TEM_MIN: String(18 + (h % 24) / 2) });
  }
  const dias = lerInmetEstacao(linhas, "America/Sao_Paulo");
  assert.deepEqual(dias.map((d) => [d.data, d.chuvaMm, d.horas]), [["2026-02-08", 5, 4], ["2026-02-09", 2.5, 24], ["2026-02-10", 0, 20]]);
  assert.equal(dias[1]!.tmax, 31.5); // hora 23 UTC do dia 09 (20h local): 20 + 23/2
  assert.equal(dias[1]!.tmin, 18);
  // resposta diária (sem hora) também vale
  const diaria = lerInmetEstacao([{ DT_MEDICAO: "2026-02-09", CHUVA: "12,4", TEMP_MAX: "31", TEMP_MIN: "19" }], "America/Sao_Paulo");
  assert.deepEqual(diaria, [{ data: "2026-02-09", chuvaMm: 12.4, tmax: 31, tmin: 19, horas: 1 }]);
  assert.throws(() => lerInmetEstacao({}, "America/Sao_Paulo"), /medições/);
});

test("juntar: a estação da fazenda manda; o INMET confirma e preenche o que falta (só dias completos)", () => {
  const estacao = [{ data: "2026-02-09", chuvaMm: 10, tmax: 30, tmin: 19 }, { data: "2026-02-10", chuvaMm: null, tmax: null, tmin: null }];
  const inmet = [
    { data: "2026-02-09", chuvaMm: 12, tmax: 31, tmin: 18, horas: 24 },
    { data: "2026-02-10", chuvaMm: 3, tmax: 29, tmin: 17, horas: 24 },
    { data: "2026-02-11", chuvaMm: 0, tmax: 32, tmin: 20, horas: 24 },
    { data: "2026-02-12", chuvaMm: 8, tmax: 30, tmin: 19, horas: 10 },
  ];
  const j = juntarObservacoes(estacao, inmet);
  assert.deepEqual(j.map((d) => [d.data, d.fonte, d.chuvaMm, d.chuvaInmetMm]), [["2026-02-09", "estacao", 10, 12], ["2026-02-10", "estacao", 3, 3], ["2026-02-11", "inmet", 0, 0]]);
  assert.equal(j[1]!.tmax, 29); // temperatura que faltava veio do INMET
});

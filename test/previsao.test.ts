import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avisoChuva, chuvaPrevista, juntarPrevisao, lerInmet, lerOpenMeteo, urlOpenMeteo } from "../src/motor/index.ts";
import { montarMensagem } from "../src/job/mensagem.ts";

const om = JSON.parse(readFileSync(new URL("./fixtures/previsao_openmeteo.json", import.meta.url), "utf8"));
const inmet = JSON.parse(readFileSync(new URL("./fixtures/previsao_inmet.json", import.meta.url), "utf8"));

test("Open-Meteo: um item por dia com mm, %, tmin e tmax", () => {
  const d = lerOpenMeteo(om);
  assert.equal(d.length, 14); // 7 passados + 7 à frente
  assert.deepEqual(d[8], { data: "2026-02-09", chuvaMm: 12.4, probPct: 80, tmax: 28.4, tmin: 18.5, et0Mm: 4.1 });
  assert.throws(() => lerOpenMeteo({}), /série diária/);
  assert.match(urlOpenMeteo(-14.9, -46.25, "America/Sao_Paulo"), /latitude=-14\.9&longitude=-46\.25.*et0_fao_evapotranspiration.*timezone=America%2FSao_Paulo&forecast_days=7&past_days=7/);
});

test("INMET: data brasileira vira ISO, turnos viram resumo, dias inteiros também entram", () => {
  const d = lerInmet(inmet);
  assert.deepEqual(d.map((x) => x.data), ["2026-02-08", "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12"]);
  assert.equal(d[0]!.resumo, "manhã: muitas nuvens; tarde: pancadas de chuva; noite: chuva isolada");
  assert.equal(d[0]!.tmax, 31);
  assert.equal(d[0]!.tmin, 19);
  assert.equal(d[2]!.resumo, "pancadas de chuva");
  assert.equal(d[2]!.chuvaMm, null);
  assert.throws(() => lerInmet({}), /INMET/);
});

test("juntar: números do Open-Meteo + texto do INMET; aviso de chuva só quando cobre o déficit", () => {
  const j = juntarPrevisao(lerOpenMeteo(om), lerInmet(inmet));
  assert.equal(j.length, 14);
  assert.equal(j[8]!.chuvaMm, 12.4);
  assert.match(j[8]!.resumo!, /pancadas de chuva/);
  assert.equal(j[13]!.resumo, undefined);
  assert.deepEqual(chuvaPrevista(j, "2026-02-08"), { mm: 20.5, probPct: 80, ate: "2026-02-10" });
  assert.match(avisoChuva(24.5, j, "2026-02-08")!, /20,5 mm de chuva até 10\/02 \(80% de chance\)/);
  assert.equal(avisoChuva(40, j, "2026-02-08"), null); // 20,5 < 80% de 40
  assert.match(avisoChuva(10, j, "2026-02-12")!, /17,0 mm.*14\/02 \(70%/); // 2 + 15 = 17 mm cobre 10 mm
});

test("aviso respeita a probabilidade mínima de 50%", () => {
  const p = [{ data: "2026-03-02", chuvaMm: 30, probPct: 30, tmin: null, tmax: null }];
  assert.equal(avisoChuva(10, p, "2026-03-01"), null);
  assert.match(avisoChuva(10, [{ ...p[0]!, probPct: null }], "2026-03-01")!, /30,0 mm/);
});

test("relatório das 18h ganha a linha da previsão e o aviso no pivô que vai irrigar", () => {
  const j = juntarPrevisao(lerOpenMeteo(om), lerInmet(inmet));
  const clima = { data: "2026-02-08", tmax: 31, tmin: 19, tmed: 25, ur: 70, vento: 1, rad: 20, chuva: 0, n: 144, et0: 4.5 };
  const linha = { data: "2026-02-08", das: 75, estadio: "R3", kc: 1.15, et0: 4.5, et0Hargreaves: 4, etc: 5.2, chuva: 0, irrigacao: 0, raizCm: 50, cadMm: 70, fatorDeplecao: 0.6, afdMm: 42, deficit: 24.5, ajustado: false, decisao: "IRRIGAR" as const, alertas: [], leituras: 144 };
  const m = montarMensagem("2026-02-08", clima, [{ pivo: { nome: "Pivô 2", cultura: { nome: "Soja" } }, linha }], j);
  assert.match(m.texto, /🌧 Previsão: 09\/02 12,4 mm \(80%\) · 10\/02 8,1 mm \(65%\) · 11\/02 0,3 mm \(20%\) — 20,5 mm em 2 dias/);
  assert.match(m.texto, /INMET amanhã: manhã: chuva/);
  assert.match(m.texto, /🌧 Previsão de 20,5 mm de chuva até 10\/02 .* avalie adiar/);
  const sem = montarMensagem("2026-02-08", clima, [{ pivo: { nome: "Pivô 2", cultura: { nome: "Soja" } }, linha }]);
  assert.doesNotMatch(sem.texto, /Previsão/);
});

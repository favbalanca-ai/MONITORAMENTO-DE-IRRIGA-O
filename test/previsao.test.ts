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

test("pulverização: Delta T, semáforo por instante e janelas boas nas horas previstas", async () => {
  const { condicoesAplicacao, deltaT, aplicacaoPorHora, janelasBoas, lerOpenMeteoHoras, urlOpenMeteoHoras } = await import("../src/motor/previsao.ts");
  assert.ok(Math.abs(deltaT(27.4, 61) - 5.6) < 0.05);
  assert.ok(Math.abs(deltaT(31.5, 27) - 12.7) < 0.05);
  const c = condicoesAplicacao({ tempC: 27.4, urPct: 61, ventoMs: 3.1, rajadaMs: 6.5, chovendo: true });
  assert.equal(c.terrestre.nivel, "ruim");
  assert.ok(c.terrestre.motivos.some((m) => /Vento 11 km\/h: no limite \(10 a 12\)/.test(m[1])));
  assert.ok(c.aerea.motivos.some((m) => /Vento 11 km\/h: ideal \(3 a 12\)/.test(m[1])));
  const bom = condicoesAplicacao({ tempC: 24, urPct: 70, ventoMs: 1.5 });
  assert.equal(bom.terrestre.nivel, "bom");
  assert.equal(bom.aerea.nivel, "bom");
  assert.equal(condicoesAplicacao({ tempC: 33, urPct: 40, ventoMs: 1.5 }).terrestre.nivel, "ruim");
  assert.match(urlOpenMeteoHoras(-14.9, -46.25, "America/Sao_Paulo"), /hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability&wind_speed_unit=ms/);
  // 24 h: madrugada boa (6 h), manhã quente/seca, tarde ventosa, noite chove
  const time = [], temperature_2m = [], relative_humidity_2m = [], wind_speed_10m = [], wind_gusts_10m = [], precipitation = [], precipitation_probability = [];
  for (let h = 0; h < 24; h++) {
    time.push("2026-02-09T" + String(h).padStart(2, "0") + ":00");
    const madrugada = h < 7, tarde = h >= 12 && h < 18, noite = h >= 20;
    temperature_2m.push(madrugada ? 22 : tarde ? 33 : 27); relative_humidity_2m.push(madrugada ? 75 : tarde ? 35 : 60);
    wind_speed_10m.push(tarde ? 4.5 : 1.5); wind_gusts_10m.push(tarde ? 7 : 2); precipitation.push(noite ? 1.2 : 0); precipitation_probability.push(noite ? 80 : 5);
  }
  const horas = lerOpenMeteoHoras({ hourly: { time, temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, precipitation, precipitation_probability } });
  assert.equal(horas.length, 24);
  const ap = aplicacaoPorHora(horas);
  assert.equal(ap[3]!.terrestre, "bom");
  assert.equal(ap[14]!.terrestre, "ruim"); // 33 °C e UR 35 → Delta T alto
  assert.equal(ap[21]!.aerea, "ruim");     // chuva
  const j = janelasBoas(ap, "terrestre", "2026-02-09T01:00");
  // 27 °C / UR 60 / calmo de manhã também é bom: a janela vai de 1h a 11h direto; à noite 18h–19h antes da chuva
  assert.deepEqual(j, [{ inicio: "2026-02-09T01:00", fim: "2026-02-09T11:00", horas: 11 }, { inicio: "2026-02-09T18:00", fim: "2026-02-09T19:00", horas: 2 }]);
});

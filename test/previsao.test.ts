import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avisoChuva, chuvaPrevista, descricaoTempo, iconeTempo, juntarPrevisao, lerInmet, lerOpenMeteo, resumoPrevisao, urlOpenMeteo } from "../src/motor/index.ts";
import { montarMensagem } from "../src/job/mensagem.ts";

const om = JSON.parse(readFileSync(new URL("./fixtures/previsao_openmeteo.json", import.meta.url), "utf8"));
const inmet = JSON.parse(readFileSync(new URL("./fixtures/previsao_inmet.json", import.meta.url), "utf8"));
const omModelos = JSON.parse(readFileSync(new URL("./fixtures/previsao_openmeteo_modelos.json", import.meta.url), "utf8"));

test("Open-Meteo: um item por dia com mm, %, tmin e tmax", () => {
  const d = lerOpenMeteo(om);
  assert.equal(d.length, 14); // 7 passados + 7 à frente
  assert.deepEqual(d[8], {
    data: "2026-02-09", chuvaMm: 12.4, probPct: 80, tmax: 28.4, tmin: 18.5, et0Mm: 4.1,
    codigoTempo: 80, tempo: "Pancadas de chuva fracas", urPct: 67, ventoKmh: 12, rajadaKmh: 25, radiacaoMJ: 18.5, solH: 7.5, uvMax: 11, horasChuva: 3,
  });
  // resposta antiga (sem os campos novos) continua valendo: só os 6 campos de sempre
  const velho = lerOpenMeteo({ daily: { time: ["2026-02-09"], precipitation_sum: [1], precipitation_probability_max: [10], temperature_2m_max: [30], temperature_2m_min: [20], et0_fao_evapotranspiration: [4] } });
  assert.deepEqual(velho, [{ data: "2026-02-09", chuvaMm: 1, probPct: 10, tmax: 30, tmin: 20, et0Mm: 4 }]);
  assert.throws(() => lerOpenMeteo({}), /série diária/);
  assert.match(urlOpenMeteo(-14.9, -46.25, "America/Sao_Paulo"), /latitude=-14\.9&longitude=-46\.25.*et0_fao_evapotranspiration,weather_code,relative_humidity_2m_mean,wind_speed_10m_max,wind_gusts_10m_max,shortwave_radiation_sum,sunshine_duration,uv_index_max,precipitation_hours&wind_speed_unit=kmh&timezone=America%2FSao_Paulo&forecast_days=14&past_days=7/);
});

test("vários modelos: o melhor ajuste é o principal, os outros entram em `modelos` com faixa e concordância", () => {
  const d = lerOpenMeteo(omModelos);
  assert.equal(d.length, 14);
  const dia = d[8]!;
  assert.equal(dia.chuvaMm, 12.4); // best_match
  assert.equal(dia.tempo, "Pancadas de chuva fracas");
  assert.deepEqual(dia.modelos!.map((m) => [m.nome, m.chuvaMm]), [["Melhor ajuste", 12.4], ["ECMWF", 14.9], ["GFS", 6.2], ["ICON", 12.4], ["GEM", 0], ["Météo-France", 18.6]]);
  assert.deepEqual(dia.faixaChuva, { minMm: 0, maxMm: 18.6, medianaMm: 12.4, comChuva: 5, modelos: 6 });
  // modelos de horizonte curto somem nos dias que não cobrem (Météo-France: 4 dias; GEM: 3)
  assert.deepEqual(d[12]!.modelos!.map((m) => m.nome), ["Melhor ajuste", "ECMWF", "GFS", "ICON"]);
  assert.equal(d[12]!.faixaChuva!.modelos, 4);
  // URL pede todos os modelos; sem modelos, não manda o parâmetro
  assert.match(urlOpenMeteo(-14.9, -46.25, "America/Sao_Paulo"), /&models=best_match,ecmwf_ifs025,gfs_seamless,icon_seamless,gem_seamless,meteofrance_seamless$/);
  assert.doesNotMatch(urlOpenMeteo(-14.9, -46.25, "America/Sao_Paulo", 14, 7, []), /models=/);
  // um modelo só: nada de faixa
  assert.equal(lerOpenMeteo(om)[8]!.modelos, undefined);
  assert.equal(lerOpenMeteo(om)[8]!.faixaChuva, undefined);
});

test("tempo em português pelo código WMO e resumo dos próximos dias (chuva, ET₀, saldo)", () => {
  assert.equal(descricaoTempo(0), "Sol");
  assert.equal(descricaoTempo(3), "Nublado");
  assert.equal(descricaoTempo(63), "Chuva moderada");
  assert.equal(descricaoTempo(95), "Tempestade");
  assert.equal(descricaoTempo(99), "Tempestade com granizo");
  assert.equal(descricaoTempo(null), "");
  assert.equal(iconeTempo(0), "☀️");
  assert.equal(iconeTempo(81), "🌦️");
  assert.equal(iconeTempo(undefined), "");
  const r = resumoPrevisao(lerOpenMeteo(om), "2026-02-08", 7);
  assert.equal(r.dias, 6); // a resposta guardada só tem 6 dias depois de 08/02
  assert.equal(r.ate, "2026-02-14");
  assert.equal(r.chuvaMm, 37.8);
  assert.equal(r.et0Mm, 25.5);
  assert.equal(r.saldoMm, 12.3);
  assert.equal(r.diasComChuva, 4);
  assert.equal(r.tmaxAbs, 31.5);
  assert.equal(r.tminAbs, 18.1);
  const vazio = resumoPrevisao([{ data: "2026-03-01", chuvaMm: 2, probPct: null, tmin: null, tmax: null }], "2026-02-28");
  assert.deepEqual(vazio, { dias: 1, chuvaMm: 2, et0Mm: null, saldoMm: null, diasComChuva: 1, tmaxAbs: null, tminAbs: null, ate: "2026-03-01" });
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
  assert.equal(c.nivel, "ruim");
  assert.ok(c.motivos.some((m) => /Vento 11 km\/h: no limite \(10 a 15\)/.test(m[1])));
  assert.ok(c.motivos.some((m) => /Rajadas de 23 km\/h/.test(m[1])));
  const bom = condicoesAplicacao({ tempC: 24, urPct: 70, ventoMs: 1.5 });
  assert.equal(bom.nivel, "bom");
  assert.equal(condicoesAplicacao({ tempC: 33, urPct: 40, ventoMs: 1.5 }).nivel, "ruim");
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
  assert.equal(ap[3]!.nivel, "bom");
  assert.equal(ap[14]!.nivel, "ruim"); // 33 °C e UR 35 → Delta T alto
  assert.equal(ap[21]!.nivel, "ruim"); // chuva
  const j = janelasBoas(ap, "2026-02-09T01:00");
  // 27 °C / UR 60 / calmo de manhã também é bom: a janela vai de 1h a 11h direto; à noite 18h–19h antes da chuva
  assert.deepEqual(j, [{ inicio: "2026-02-09T01:00", fim: "2026-02-09T11:00", horas: 11 }, { inicio: "2026-02-09T18:00", fim: "2026-02-09T19:00", horas: 2 }]);
  // seca: UR 40 o dia todo → nada bom; "atenção" também não (UR < 50 é ruim); menos ruim = menor Delta T sem chuva
  const seca = aplicacaoPorHora(horas.map((h) => ({ ...h, urPct: 40, tempC: h.quando < "2026-02-09T06:00" ? 20 : 30 })));
  const { horaMenosRuim } = await import("../src/motor/previsao.ts");
  assert.equal(janelasBoas(seca, "2026-02-09T00:00", 2, 4, "atencao").length, 0);
  const m = horaMenosRuim(seca, "2026-02-09T00:00")!;
  assert.equal(m.quando.slice(11), "00:00"); // 20 °C e UR 40: o menor Delta T do dia
  assert.equal(m.urPct, 40);
});

test("tendência: a chance de chuva de um dia-alvo firmando ou caindo de uma rodada para outra", async () => {
  const { tendenciaPrevisao } = await import("../src/motor/previsao.ts");
  const caindo = tendenciaPrevisao([
    { emissao: "2026-10-13", probPct: 89, chuvaMm: 18, comChuva: 6, modelos: 6 },
    { emissao: "2026-10-14", probPct: 60, chuvaMm: 9, comChuva: 4, modelos: 6 },
    { emissao: "2026-10-15", probPct: 50, chuvaMm: 6, comChuva: 2, modelos: 6 },
  ]);
  assert.equal(caindo.direcao, "caindo");
  assert.equal(caindo.deltaProb, -10);
  assert.equal(caindo.deltaChuva, -3);
  assert.equal(caindo.emissoes, 3);
  assert.equal(caindo.texto, "89% → 60% → 50% · caindo");
  // 0,5·50 + 0,3·33 + 0,2·(100 − 2·39 = 22) = 25 + 10 + 4,4 ≈ 39 → baixa
  assert.equal(caindo.confianca, 39);
  assert.equal(caindo.nivel, "baixa");
  // fora de ordem entra em ordem
  const subindo = tendenciaPrevisao([
    { emissao: "2026-10-15", probPct: 85, chuvaMm: 20, comChuva: 6, modelos: 6 },
    { emissao: "2026-10-13", probPct: 40, chuvaMm: 5, comChuva: 2, modelos: 6 },
    { emissao: "2026-10-14", probPct: 70, chuvaMm: 15, comChuva: 5, modelos: 6 },
  ]);
  assert.equal(subindo.direcao, "subindo");
  assert.deepEqual(subindo.pontos.map((p) => p.emissao), ["2026-10-13", "2026-10-14", "2026-10-15"]);
  assert.equal(subindo.confianca, 75); // 0,5·85 + 0,3·100 + 0,2·10 = 74,5 → 75
  assert.equal(subindo.nivel, "alta");
  const estavel = tendenciaPrevisao([{ emissao: "2026-10-13", probPct: 80, chuvaMm: 10 }, { emissao: "2026-10-14", probPct: 75, chuvaMm: 12 }]);
  assert.equal(estavel.direcao, "estavel");
  assert.equal(estavel.texto, "80% → 75% · estável");
  const nova = tendenciaPrevisao([{ emissao: "2026-10-13", probPct: 30, chuvaMm: 2 }]);
  assert.equal(nova.direcao, "nova");
  assert.equal(nova.deltaProb, null);
  assert.equal(nova.confianca, Math.round(0.5 * 30 + 0.3 * 30 + 0.2 * 50)); // sem modelos, concordância = chance; estabilidade desconhecida = 50
  // só mm (INMET sem %): usa a chuva
  const mm = tendenciaPrevisao([{ emissao: "2026-10-13", probPct: null, chuvaMm: 2 }, { emissao: "2026-10-14", probPct: null, chuvaMm: 9 }]);
  assert.equal(mm.direcao, "subindo");
  assert.equal(mm.texto, "2 mm → 9 mm · subindo");
});

test("luz do dia: nascer, pôr e crepúsculo civil na fazenda; a janela de aplicação aérea fecha de noite", async () => {
  const { luzDoDia, marcadorDeLuz, aplicacaoPorHora, janelasBoas, horaMenosRuim } = await import("../src/motor/index.ts");
  // Fazenda Água Viva (−14,74 / −46,24), 8 de fevereiro: sol ~05:55–18:35, luz civil ~05:30–19:00 (UTC−3)
  const l = luzDoDia("2026-02-08", -14.74, -46.24, "America/Sao_Paulo");
  assert.ok(l.nascer! >= "05:45" && l.nascer! <= "06:05", "nascer " + l.nascer);
  assert.ok(l.por! >= "18:25" && l.por! <= "18:45", "pôr " + l.por);
  assert.ok(l.primeiraLuz! < l.nascer! && l.primeiraLuz! >= "05:20", "primeira luz " + l.primeiraLuz);
  assert.ok(l.ultimaLuz! > l.por! && l.ultimaLuz! <= "19:10", "última luz " + l.ultimaLuz);
  // julho: dias mais curtos
  const inverno = luzDoDia("2026-07-01", -14.74, -46.24, "America/Sao_Paulo");
  assert.ok(inverno.nascer! >= "06:20" && inverno.nascer! <= "06:45", "nascer inverno " + inverno.nascer);
  assert.ok(inverno.por! >= "17:30" && inverno.por! <= "17:55", "pôr inverno " + inverno.por);
  // marcador por hora: 05h conta (a primeira luz cai dentro dela), 04h e 20h não
  const temLuz = marcadorDeLuz(-14.74, -46.24, "America/Sao_Paulo");
  assert.equal(temLuz("2026-02-08T04:00"), false);
  assert.equal(temLuz("2026-02-08T05:00"), true);
  assert.equal(temLuz("2026-02-08T12:00"), true);
  assert.equal(temLuz("2026-02-08T18:00"), true);
  assert.equal(temLuz("2026-02-08T20:00"), false);
  // 48 h perfeitas para aplicar, mas só com luz: as janelas param na última luz e recomeçam na primeira
  const horas = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(Date.UTC(2026, 1, 8, i)); const q = d.toISOString().slice(0, 13) + ":00";
    horas.push({ quando: q, tempC: 24, urPct: 70, ventoMs: 1.5, rajadaMs: 2, chuvaMm: 0, probPct: 5 });
  }
  const ap = aplicacaoPorHora(horas, temLuz);
  const fimLuz = "T" + l.ultimaLuz!.slice(0, 2) + ":00"; // última hora com luz (a última luz cai dentro dela)
  const horasLuz = Number(l.ultimaLuz!.slice(0, 2)) - 5 + 1;
  assert.equal(ap.filter((h) => h.luz === false).length, 48 - 2 * horasLuz);
  const j = janelasBoas(ap, "2026-02-08T00:00", 2, 4);
  assert.deepEqual(j.map((x) => [x.inicio, x.fim, x.horas]), [["2026-02-08T05:00", "2026-02-08" + fimLuz, horasLuz], ["2026-02-09T05:00", "2026-02-09" + fimLuz, horasLuz]]);
  assert.equal(horaMenosRuim(ap, "2026-02-08T20:00")!.quando, "2026-02-09T05:00");
  // sem marcador, nada muda
  assert.equal(aplicacaoPorHora(horas)[0]!.luz, undefined);
  assert.equal(janelasBoas(aplicacaoPorHora(horas), "2026-02-08T00:00", 2, 4)[0]!.horas, 48);
});

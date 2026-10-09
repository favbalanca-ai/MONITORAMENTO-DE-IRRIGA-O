import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cicloParaIdade, ClienteEcowitt, ErroEcowitt, leiturasDoHistorico, leituraDoTempoReal,
  type CicloHistorico, type ConfigEcowitt, type Fetch,
} from "../src/coletor/ecowitt.ts";
import { coletarAgora, recuperarLacunas } from "../src/coletor/coleta.ts";
import { encontrarLacunas } from "../src/coletor/lacunas.ts";
import { RepositorioCsv } from "../src/coletor/repositorio.ts";
import { deLocal, paraLocal, somarMinutos } from "../src/coletor/tempo.ts";
import { agregarDia, type Leitura } from "../src/motor/index.ts";

const CFG: ConfigEcowitt = { applicationKey: "app", apiKey: "api", mac: "AA:BB", fuso: "America/Sao_Paulo" };
const fixture = async (nome: string) => JSON.parse(await readFile(new URL(`./fixtures/${nome}`, import.meta.url), "utf8"));
const perto = (a: number | null | undefined, b: number, tol = 1e-3) => assert.ok(a != null && Math.abs(a - b) < tol, `${a} ≈ ${b}`);

const respostaFake = (corpo: unknown, status = 200): Fetch => async () => ({ ok: status === 200, status, json: async () => corpo });

async function repoTemp() {
  const pasta = await mkdtemp(join(tmpdir(), "leituras-"));
  return { repo: new RepositorioCsv(pasta), limpar: () => rm(pasta, { recursive: true, force: true }) };
}

const leitura = (quando: string, extra: Partial<Leitura> = {}): Leitura => ({
  quando, chuvaAcumDia: 0, tempC: 22, urPct: 80, radWm2: 100, ventoMs: 2, intervaloMin: 10, fonte: "teste", ...extra,
});

test("fuso: horário da estação em Brasília e em Cuiabá", () => {
  const ms = 1769018400 * 1000; // 2026-01-21 18:00 UTC
  assert.equal(paraLocal(ms, "America/Sao_Paulo"), "2026-01-21T15:00:00");
  assert.equal(paraLocal(ms, "America/Cuiaba"), "2026-01-21T14:00:00");
  assert.equal(deLocal("2026-01-21T15:00:00", "America/Sao_Paulo"), ms);
});

test("tempo real em °F, polegadas e mph vira SI, com o horário da medição", async () => {
  const corpo = await fixture("ecowitt_tempo_real.json");
  const l = leituraDoTempoReal(corpo.data, CFG);
  assert.equal(l.quando, "2026-01-21T15:00:00");
  perto(l.tempC, 24.389);
  perto(l.chuvaAcumDia, 5.08);
  perto(l.ventoMs, 2.012);
  assert.equal(l.urPct, 76);
  assert.equal(l.radWm2, 812.5);
  assert.equal(l.intervaloMin, 10);
});

test("chuva de pluviômetro piezo (WS90) também é lida", async () => {
  const corpo = await fixture("ecowitt_tempo_real.json");
  const { rainfall, ...resto } = corpo.data;
  const l = leituraDoTempoReal({ ...resto, rainfall_piezo: rainfall }, { ...CFG, grupoChuva: "rainfall_piezo" });
  perto(l.chuvaAcumDia, 5.08);
});

test("erro da API vira ErroEcowitt com o code; resposta vazia também", async () => {
  const c1 = new ClienteEcowitt(CFG, respostaFake({ code: 40010, msg: "Illegal Application_Key Parameter", data: [] }));
  await assert.rejects(c1.tempoReal(), (e: unknown) => e instanceof ErroEcowitt && e.codigo === 40010);
  const c2 = new ClienteEcowitt(CFG, respostaFake({}, 503));
  await assert.rejects(c2.tempoReal(), /HTTP 503/);
  assert.throws(() => leituraDoTempoReal([], CFG), ErroEcowitt);
});

test("URL leva credenciais, unidades em SI e período do histórico", async () => {
  const urls: string[] = [];
  const fetchFn: Fetch = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ code: 0, data: [] }) }; };
  await new ClienteEcowitt(CFG, fetchFn).historico("2026-02-08T13:00:00", "2026-02-09T13:00:00", "30min");
  const u = new URL(urls[0]!);
  assert.equal(u.pathname, "/api/v3/device/history");
  assert.equal(u.searchParams.get("mac"), "AA:BB");
  assert.equal(u.searchParams.get("start_date"), "2026-02-08 13:00:00");
  assert.equal(u.searchParams.get("cycle_type"), "30min");
  assert.equal(u.searchParams.get("temp_unitid"), "1");
  assert.equal(u.searchParams.get("rainfall_unitid"), "12");
});

test("histórico junta as séries por instante e ignora valor vazio", async () => {
  const corpo = await fixture("ecowitt_historico_30min.json");
  const ls = leiturasDoHistorico(corpo.data, CFG, "30min");
  assert.deepEqual(ls.map((l) => l.quando), ["2026-01-21T14:30:00", "2026-01-21T15:00:00", "2026-01-21T15:30:00"]);
  assert.equal(ls[1]!.tempC, 24);
  assert.equal(ls[1]!.ventoMs, null);
  perto(ls[2]!.ventoMs, 3);
  assert.equal(ls[0]!.intervaloMin, 30);
  assert.equal(ls[0]!.fonte, "ecowitt-historico-30min");
  assert.deepEqual(leiturasDoHistorico([], CFG, "5min"), []);
});

test("ciclo do histórico pela idade do dado (retenção do ecowitt.net)", () => {
  assert.deepEqual([1, 80, 120, 300, 400].map(cicloParaIdade), ["5min", "5min", "30min", "30min", "4hour"]);
});

test("lacunas: buraco > 15 min ao vivo, > 45 min no histórico de 30 min, e nas pontas", () => {
  const ls = [
    leitura("2026-02-01T00:10:00"), leitura("2026-02-01T00:20:00"),
    leitura("2026-02-01T01:00:00"), // buraco de 40 min
    leitura("2026-02-01T01:30:00", { intervaloMin: 30 }), leitura("2026-02-01T02:00:00", { intervaloMin: 30 }),
  ];
  assert.deepEqual(encontrarLacunas(ls, "2026-02-01T00:00:00", "2026-02-01T03:00:00"), [
    { de: "2026-02-01T00:20:00", ate: "2026-02-01T01:00:00" },
    { de: "2026-02-01T02:00:00", ate: "2026-02-01T03:00:00" },
  ]);
  assert.deepEqual(encontrarLacunas([], "2026-02-01T00:00:00", "2026-02-01T01:00:00"), [
    { de: "2026-02-01T00:00:00", ate: "2026-02-01T01:00:00" },
  ]);
});

test("repositório CSV: grava por mês, não duplica e devolve em ordem", async () => {
  const { repo, limpar } = await repoTemp();
  try {
    assert.equal(await repo.ultima(), null);
    assert.equal(await repo.salvar([leitura("2026-02-01T10:00:00"), leitura("2026-01-31T23:50:00", { tempC: null })]), 2);
    assert.equal(await repo.salvar([leitura("2026-02-01T10:00:00"), leitura("2026-02-01T09:50:00")]), 1);
    const todas = await repo.intervalo("2026-01-01T00:00:00", "2026-02-28T23:59:59");
    assert.deepEqual(todas.map((l) => l.quando), ["2026-01-31T23:50:00", "2026-02-01T09:50:00", "2026-02-01T10:00:00"]);
    assert.equal(todas[0]!.tempC, null);
    assert.deepEqual(todas[1], leitura("2026-02-01T09:50:00"));
    assert.equal((await repo.ultima())!.quando, "2026-02-01T10:00:00");
  } finally {
    await limpar();
  }
});

test("coleta ao vivo não grava duas vezes a mesma medição", async () => {
  const { repo, limpar } = await repoTemp();
  try {
    const cliente = new ClienteEcowitt(CFG, respostaFake(await fixture("ecowitt_tempo_real.json")));
    assert.equal((await coletarAgora(cliente, repo)).gravada, true);
    assert.equal((await coletarAgora(cliente, repo)).gravada, false);
  } finally {
    await limpar();
  }
});

test("recuperação: preenche só o buraco, em blocos de 1 dia, e o dia volta a ter dados", async () => {
  const { repo, limpar } = await repoTemp();
  try {
    // Ao vivo até 08/02 13:30 (quando a planilha parou) e de novo a partir de 10/02 00:00.
    const aoVivo: Leitura[] = [];
    for (let q = "2026-02-07T18:00:00"; q <= "2026-02-08T13:30:00"; q = somarMinutos(q, 10)) aoVivo.push(leitura(q));
    for (let q = "2026-02-10T00:00:00"; q <= "2026-02-10T06:00:00"; q = somarMinutos(q, 10)) aoVivo.push(leitura(q));
    await repo.salvar(aoVivo);

    const pedidos: [string, string, CicloHistorico][] = [];
    const cliente = {
      cfg: CFG,
      tempoReal: async () => { throw new Error("não usado"); },
      historico: async (a: string, b: string, ciclo: CicloHistorico) => {
        pedidos.push([a, b, ciclo]);
        const ls: Leitura[] = [];
        for (let q = a; q < b; q = somarMinutos(q, 30)) ls.push(leitura(q, { intervaloMin: 30, fonte: "hist", tempC: 25 }));
        return ls;
      },
    };
    const agoraMs = deLocal("2026-10-08T12:00:00", CFG.fuso); // ~240 dias depois → histórico de 30 min
    const r = await recuperarLacunas(cliente, repo, "2026-02-07T18:00:00", "2026-02-10T06:00:00", { agoraMs, pausaMs: 0 });

    assert.deepEqual(r.lacunas, [{ de: "2026-02-08T13:30:00", ate: "2026-02-10T00:00:00" }]);
    assert.ok(pedidos.every(([, , c]) => c === "30min"));
    assert.ok(pedidos.length === 3, `consultas: ${pedidos.length}`); // 34,5 h + 24 h de folga em blocos de 24 h
    assert.equal(r.erros.length, 0);

    const salvas = await repo.intervalo("2026-02-07T18:00:00", "2026-02-10T06:00:00");
    assert.ok(salvas.filter((l) => l.fonte === "hist").every((l) => l.quando > "2026-02-08T13:30:00" && l.quando < "2026-02-10T00:00:00"));
    // O dia 09/02 (janela 08/02 18h → 09/02 18h) só tem histórico de 30 min: 48 leituras = 144 equivalentes.
    assert.equal(agregarDia(salvas, "2026-02-09")!.n, 144);

    // Rodar de novo não acha mais buraco nem consulta a API.
    const r2 = await recuperarLacunas(cliente, repo, "2026-02-07T18:00:00", "2026-02-10T06:00:00", { agoraMs, pausaMs: 0 });
    assert.equal(r2.lacunas.length, 0);
    assert.equal(r2.consultas, 0);
  } finally {
    await limpar();
  }
});

test("recuperação segue em frente quando um bloco falha e reporta o erro", async () => {
  const { repo, limpar } = await repoTemp();
  try {
    let n = 0;
    const cliente = {
      cfg: CFG,
      tempoReal: async () => { throw new Error("não usado"); },
      historico: async (a: string) => {
        if (n++ === 0) throw new ErroEcowitt("System is busy", -1);
        return [leitura(somarMinutos(a, 30), { intervaloMin: 5 })];
      },
    };
    const agoraMs = deLocal("2026-03-01T12:00:00", CFG.fuso);
    const r = await recuperarLacunas(cliente, repo, "2026-02-01T00:00:00", "2026-02-02T00:00:00", { agoraMs, pausaMs: 0 });
    assert.equal(r.erros.length, 1);
    assert.match(r.erros[0]!, /System is busy/);
    assert.ok(r.consultas > 1);
  } finally {
    await limpar();
  }
});

test("tempo real: todos os sensores viram extras em SI (°F→°C, in→mm, mph→m/s, inHg→hPa)", async () => {
  const { extrasDoTempoReal } = await import("../src/coletor/ecowitt.ts");
  const e = extrasDoTempoReal({
    outdoor: { temperature: { unit: "ºF", value: "75.9" }, feels_like: { unit: "ºF", value: "76.4" }, dew_point: { unit: "ºF", value: "60" } },
    wind: { wind_gust: { unit: "mph", value: "10" }, wind_direction: { unit: "º", value: "120" } },
    pressure: { relative: { unit: "inHg", value: "29.92" } },
    rainfall: { rain_rate: { unit: "in/hr", value: "0.10" }, event: { unit: "in", value: "0.5" } },
    solar_and_uvi: { uvi: { unit: "", value: "7" } },
    soil_ch1: { soilmoisture: { unit: "%", value: "34" } },
    lightning: { distance: { unit: "mi", value: "12" }, count: { unit: "", value: "3" }, time: { unit: "", value: "texto" } },
  });
  assert.equal(e["outdoor.temperature"], 24.39);
  assert.equal(e["outdoor.dew_point"], 15.56);
  assert.equal(e["wind.wind_gust"], 4.47);
  assert.equal(e["wind.wind_direction"], 120);
  assert.equal(e["pressure.relative"], 1013.21);
  assert.equal(e["rainfall.rain_rate"], 2.54);
  assert.equal(e["rainfall.event"], 12.7);
  assert.equal(e["solar_and_uvi.uvi"], 7);
  assert.equal(e["soil_ch1.soilmoisture"], 34);
  assert.equal(e["lightning.distance"], 19.31);
  assert.equal("lightning.time" in e, false);
});

/**
 * O app de app/ (o mesmo que vai para o GitHub Pages) num Chromium de verdade, servido localmente.
 * As chamadas ao endereço /exec da planilha são desviadas para a planilha simulada (sync/Code.gs no Node).
 * Prints em test/e2e/prints/.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { extname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { deLocal } from "../../src/coletor/tempo.ts";
import { criarAmbiente, type Ambiente } from "../apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "../pivo2_exemplo.ts";

const PASTA_APP = new URL("../../app/", import.meta.url).pathname;
const PRINTS = new URL("./prints/", import.meta.url).pathname;
const EXEC = "https://script.google.com/macros/s/TESTE123/exec";
const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

let servidor: Server, base: string, browser: Browser;
before(async () => {
  mkdirSync(PRINTS, { recursive: true });
  servidor = createServer((req, res) => {
    const caminho = join(PASTA_APP, decodeURIComponent((req.url || "/").split("?")[0]!.replace(/\/$/, "/index.html")));
    if (!caminho.startsWith(PASTA_APP) || !existsSync(caminho)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TIPOS[extname(caminho)] || "application/octet-stream" });
    res.end(readFileSync(caminho));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); servidor?.close(); });

function planilha(): Ambiente {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  amb.chamar("gravarLeituras_", leiturasMeteoCorrigido());
  amb.agoraMs = deLocal("2026-02-08T19:00:00", "America/Sao_Paulo");
  amb.chamar("gravarUsuario_", { salvar: { nome: "Fabiana", login: "fabiana", perfil: "ADMIN", pin: "1234" } });
  amb.chamar("gravarUsuario_", { salvar: { nome: "José", login: "jose", perfil: "OPERADOR", pin: "4321" } });
  return amb;
}

/** Abre o app num "celular", com o /exec desviado para a planilha simulada. */
async function abrir(amb: Ambiente): Promise<{ ctx: BrowserContext; page: Page; chamadas: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block", isMobile: true, hasTouch: true });
  const chamadas: string[] = [];
  await ctx.route(EXEC + "**", async (route) => {
    const req = route.request();
    let corpo: unknown;
    if (req.method() === "GET") {
      const params = Object.fromEntries(new URL(req.url()).searchParams);
      chamadas.push("GET " + params["acao"]);
      corpo = amb.get(params);
    } else {
      const c = JSON.parse(req.postData() || "{}");
      chamadas.push("POST " + Object.keys(c).filter((k) => k.startsWith("__")).join(","));
      corpo = amb.post(c);
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo), headers: { "Access-Control-Allow-Origin": "*" } });
  });
  // Mapa: o Leaflet do CDN vem da cópia local (node_modules) e as imagens de satélite viram um pixel
  const LEAFLET = new URL("../../node_modules/leaflet/dist/", import.meta.url).pathname;
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.(js|css)/, (r) => {
    const js = r.request().url().endsWith(".js");
    r.fulfill({ status: 200, contentType: js ? "text/javascript" : "text/css", body: readFileSync(join(LEAFLET, js ? "leaflet.js" : "leaflet.css")) });
  });
  const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  await ctx.route(/arcgisonline\.com|openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  const page = await ctx.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("dialog", (d) => d.accept());
  (page as unknown as { erros: string[] }).erros = erros;
  await page.goto(base);
  return { ctx, page, chamadas };
}

async function configurarEEntrar(page: Page, login: string, pin: string) {
  await page.getByText("Abrir Ajustes").click();
  await page.fill("#s-url", EXEC);
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.locator("#f-login").waitFor();
  await page.fill("#lg-login", login);
  await page.fill("#lg-pin", pin);
  await page.locator("#f-login button[type=submit]").click();
  await page.getByText(/Olá,/).waitFor();
}

test("primeiro uso: endereço, login e a decisão do dia", async () => {
  const amb = planilha();
  const { ctx, page } = await abrir(amb);
  await page.getByText("cole o endereço da planilha").waitFor();
  await page.screenshot({ path: PRINTS + "0_primeiro_uso.png" });
  await page.getByText("Abrir Ajustes").click();
  await page.fill("#s-url", "https://exemplo.com/qualquer");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByText(/deve começar com https:\/\/script.google.com/).waitFor();
  await page.fill("#s-url", EXEC);
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.locator("#f-login").waitFor();
  await page.screenshot({ path: PRINTS + "1_entrar.png" });
  await page.fill("#lg-login", "fabiana");
  await page.fill("#lg-pin", "9999");
  await page.locator("#f-login button[type=submit]").click();
  await page.getByText("Login ou PIN errado.").waitFor();
  await page.fill("#lg-pin", "1234");
  await page.locator("#f-login button[type=submit]").click();
  await page.locator(".badge.irrigar").first().waitFor();
  const card = await page.locator(".card.pivo").first().innerText();
  assert.match(card, /Pivô 2/);
  assert.match(card, /Soja\s+R3\s+75 DAS/);
  assert.match(card, /Déficit 2\d,\d mm/);
  assert.match(card, /PERCENTÍMETRO\s+\d+%/i);
  assert.match(await page.locator(".resumo").innerText(), /1 pivô pra irrigar/);
  assert.match(await page.locator("#user-chip").innerText(), /Fabiana/);
  assert.ok(await page.locator("#sync-status.ok").count() === 1, "estado sincronizado");
  await page.screenshot({ path: PRINTS + "2_hoje.png", fullPage: true });
  assert.deepEqual((page as unknown as { erros: string[] }).erros, []);
  await ctx.close();
});

test("operador lança irrigação, a decisão muda e a planilha recebe com o nome dele", async () => {
  const amb = planilha();
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "jose", "4321");
  await page.getByRole("link", { name: /Lançar/ }).click();
  assert.equal(await page.locator("#l-data").inputValue(), "2026-02-08");
  await page.getByRole("button", { name: "Pela lâmina (mm)" }).click();
  await page.fill("#l-mm", "25");
  await page.fill("#l-obs", "percentímetro 30%");
  await page.locator("#f-lanc button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector(".badge.pend"));
  await page.getByText(/· José/).waitFor();
  const linhas = amb.aba("IRRIGACOES").objetos();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!["Por"], "José");
  assert.equal(linhas[0]!["Lâmina líquida aplicada (mm)"], 25);
  await page.screenshot({ path: PRINTS + "3_lancar.png", fullPage: true });
  await page.getByRole("link", { name: /Hoje/ }).click();
  await page.getByText("NÃO IRRIGAR").first().waitFor();

  await page.getByRole("link", { name: /Lançar/ }).click();
  await page.getByRole("button", { name: "Apagar" }).click();
  await page.getByText("Nada lançado ainda.").waitFor();
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);

  // pelo percentímetro: o app mostra a lâmina estimada e a planilha grava a lâmina líquida do equipamento
  await page.getByRole("button", { name: "Pelo percentímetro" }).click();
  await page.fill("#l-pct", "40");
  await page.getByText(/≈ 11,8 mm líquidos \(13,9 brutos\)/).waitFor();
  await page.locator("#f-lanc button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector(".badge.pend"));
  const l2 = amb.aba("IRRIGACOES").objetos();
  assert.equal(l2.length, 1);
  assert.equal(l2[0]!["Lâmina líquida aplicada (mm)"], 11.8);
  assert.match(String(l2[0]!["Obs."]), /percentímetro 40%/);
  await ctx.close();
});

test("sem internet: o lançamento fica na fila e sobe quando o sinal volta, sem duplicar", async () => {
  const amb = planilha();
  const { ctx, page, chamadas } = await abrir(amb);
  await configurarEEntrar(page, "jose", "4321");
  await page.getByRole("link", { name: /Lançar/ }).click();
  await ctx.setOffline(true);
  await ctx.unroute(EXEC + "**");
  await ctx.route(EXEC + "**", (r) => r.abort("internetdisconnected"));
  await page.getByRole("button", { name: "🌱 Umidade do solo" }).click();
  await page.fill("#l-raiz", "28");
  await page.locator("#f-lanc button[type=submit]").click();
  await page.locator(".badge.pend").waitFor();
  assert.match(await page.locator("#fila-bar").innerText(), /1 lançamento\(s\) esperando internet/);
  await page.waitForFunction(() => /Sem (internet|conexão)/.test(document.querySelector("#sync-status")!.textContent || ""));
  assert.equal(amb.aba("UMIDADE").getLastRow(), 1);
  await page.screenshot({ path: PRINTS + "4_sem_internet.png", fullPage: true });

  // volta a internet (e a planilha)
  await ctx.unroute(EXEC + "**");
  await ctx.route(EXEC + "**", async (route) => {
    const req = route.request();
    const corpo = req.method() === "GET" ? amb.get(Object.fromEntries(new URL(req.url()).searchParams)) : amb.post(JSON.parse(req.postData() || "{}"));
    chamadas.push(req.method());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) });
  });
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.querySelector("#fila-bar")!.hasAttribute("hidden"), null, { timeout: 15000 });
  assert.equal(amb.aba("UMIDADE").getLastRow(), 2);
  // reenvio do mesmo id (ex.: resposta perdida) não duplica
  const id = amb.aba("UMIDADE").objetos()[0]!["ID"];
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("irrigacao_sessao")!).token);
  amb.post({ s, __lancamento: { id, tipo: "umidade", pivo: "Pivô 2", data: "2026-02-08", umidadeRaiz: 28 } });
  assert.equal(amb.aba("UMIDADE").getLastRow(), 2);
  await ctx.close();
});

test("histórico desenha gráfico e tabela", async () => {
  const amb = planilha();
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "jose", "4321");
  await page.getByRole("link", { name: /Histórico/ }).click();
  await page.locator("#grafico svg").waitFor();
  assert.equal(await page.locator("#grafico svg circle").count(), 20);
  assert.equal(await page.locator("#tab-hist tbody tr").count(), 20);
  await page.selectOption("#h-dias", "15");
  await page.waitForFunction(() => document.querySelectorAll("#grafico svg circle").length === 15);
  await page.screenshot({ path: PRINTS + "5_historico.png", fullPage: true });
  await ctx.close();
});

test("pivôs: operador só vê; administrador edita e a planilha valida", async () => {
  const amb = planilha();
  let { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "jose", "4321");
  await page.getByRole("link", { name: /Pivôs/ }).click();
  await page.getByText("Só o administrador edita os pivôs.").waitFor();
  await page.getByRole("link", { name: "Ver" }).click();
  assert.equal(await page.locator("#p_raioM").isDisabled(), true);
  await ctx.close();

  ({ ctx, page } = await abrir(amb));
  await configurarEEntrar(page, "fabiana", "1234");
  await page.getByRole("link", { name: /Pivôs/ }).click();
  await page.getByRole("link", { name: "Editar" }).click();
  await page.fill("#p_pmp", "40");
  await page.locator("#f-pivo button[type=submit]").click();
  await page.getByText(/PMP precisa ser menor que a CC/).waitFor();
  await page.fill("#p_pmp", "18");
  await page.fill("#p_laminaMinimaMm", "6,5");
  await page.locator("#f-pivo button[type=submit]").click();
  await page.getByText("✅ Pivô salvo").waitFor();
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Lâmina mínima p/ irrigar (mm)"], 6.5);
  await page.screenshot({ path: PRINTS + "6_pivos.png", fullPage: true });
  await ctx.close();
});

test("administrador cria usuário pelo app; computador mostra o menu lateral", async () => {
  const amb = planilha();
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "fabiana", "1234");
  await page.goto(base + "#/usuarios");
  await page.getByText("José").waitFor();
  await page.fill("#u-nome", "Ana");
  await page.fill("#u-login", "ana");
  await page.fill("#u-pin", "5555");
  await page.locator("#f-user button[type=submit]").click();
  await page.getByText("Usuário salvo.").waitFor();
  assert.ok(amb.aba("USUÁRIOS APP").objetos().some((u) => u["LOGIN"] === "ana"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + "#/hoje");
  await page.locator(".badge.irrigar").first().waitFor();
  assert.equal(await page.locator(".brand-title").isVisible(), true);
  assert.deepEqual((await page.locator("#nav a.active").allInnerTexts()).map((t) => t.replace(/\W*\n/, "")), ["Hoje"]);
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: PRINTS + "7_computador.png" });
  await ctx.close();
});

test("link do menu (?exec=) já liga o app à planilha", async () => {
  const amb = planilha();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await ctx.route(EXEC + "**", async (route) => {
    const req = route.request();
    const corpo = req.method() === "GET" ? amb.get(Object.fromEntries(new URL(req.url()).searchParams)) : amb.post(JSON.parse(req.postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) });
  });
  const page = await ctx.newPage();
  await page.goto(base + "?exec=" + encodeURIComponent(EXEC));
  await page.getByText("App ligado à planilha").waitFor();
  assert.equal(new URL(page.url()).search, "", "o endereço sai da barra");
  await page.locator("#f-login").waitFor();
  await page.fill("#lg-login", "jose");
  await page.fill("#lg-pin", "4321");
  await page.locator("#f-login button[type=submit]").click();
  await page.locator(".badge.irrigar").first().waitFor();
  await ctx.close();
});

test("pivôs: culturas com nome, sugestão da Embrapa preenche o solo e a curva de Kc aparece", async () => {
  const amb = planilha();
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "fabiana", "1234");
  await page.getByText("Detalhes").first().click();
  await page.getByText("Curva de Kc do ciclo").first().click();
  await page.locator("svg[aria-label='Curva de Kc']").first().waitFor();
  await page.getByRole("link", { name: /Pivôs/ }).click();
  await page.getByText(/Soja · plantio/).waitFor();
  await page.getByRole("link", { name: "Editar" }).click();
  assert.equal(await page.locator("#p_cultura option:checked").textContent(), "Soja (120 dias)");
  await page.selectOption("#p_cultura", "trigo");
  await page.getByText(/raiz máxima 40 cm em 50 dias, fator fixo 0,40/).waitFor();
  await page.getByRole("button", { name: "Usar", exact: true }).click();
  assert.equal(await page.inputValue("#p_raizMaxCm"), "40");
  assert.equal(await page.inputValue("#p_fatorFixo"), "0,4");
  await page.fill("#p_cicloDias", "130");
  await page.locator("#f-pivo button[type=submit]").click();
  await page.getByText("✅ Pivô salvo").waitFor();
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Ciclo (dias, vazio = padrão)"], 130);
  await page.getByText(/Trigo \(130 dias\)/).waitFor();
  await page.screenshot({ path: PRINTS + "9_culturas.png", fullPage: true });
  await ctx.close();
});

/** KML com um desenho por pivô (contorno circular aproximado) — nomes como vêm do Google Earth. */
function kmlExemplo(nomes: string[]): string {
  const pm = nomes.map((n, i) => {
    const lat0 = -14.9 - i * 0.02, lon0 = -46.25, r = 0.0036; // ~400 m
    const pts = Array.from({ length: 36 }, (_, k) => { const a = (k / 36) * 2 * Math.PI; return `${(lon0 + r * Math.cos(a)).toFixed(6)},${(lat0 + r * Math.sin(a)).toFixed(6)},0`; });
    return `<Placemark><name>${n}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${pts.join(" ")} ${pts[0]}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Pivôs</name>${pm.join("")}</Document></kml>`;
}
/** .kmz = zip com um doc.kml dentro (deflate), como o Google Earth salva. */
function kmzDe(kml: string): Buffer {
  const nome = Buffer.from("doc.kml"), dados = Buffer.from(kml, "utf8"), comp = deflateRawSync(dados);
  const crc = (() => { let c = ~0; for (const b of dados) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; })();
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(nome.length, 28); cen.writeUInt32LE(0, 42);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(cen.length + nome.length, 12); fim.writeUInt32LE(local.length + nome.length + comp.length, 16);
  return Buffer.concat([local, nome, comp, cen, nome, fim]);
}

test("previsão na tela Hoje e semáforo no cartão do pivô", async () => {
  const amb = planilha();
  const om = JSON.parse(readFileSync(new URL("../fixtures/previsao_openmeteo.json", import.meta.url), "utf8"));
  const inmet = JSON.parse(readFileSync(new URL("../fixtures/previsao_inmet.json", import.meta.url), "utf8"));
  // horas previstas a partir de agora (o app só mostra o futuro): madrugada boa, dia quente e seco
  const time: string[] = [], temperature_2m: number[] = [], relative_humidity_2m: number[] = [], wind_speed_10m: number[] = [], wind_gusts_10m: number[] = [], precipitation: number[] = [], precipitation_probability: number[] = [];
  const h0 = new Date(); h0.setMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    const d = new Date(h0.getTime() + i * 3600_000);
    const loc = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 13) + ":00";
    const noite = d.getHours() < 7 || d.getHours() >= 19;
    time.push(loc); temperature_2m.push(noite ? 22 : 33); relative_humidity_2m.push(noite ? 75 : 35); wind_speed_10m.push(1.5); wind_gusts_10m.push(2); precipitation.push(0); precipitation_probability.push(5);
  }
  const omHoras = { hourly: { time, temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, precipitation, precipitation_probability } };
  amb.respostaHttp = (url) => (url.includes("hourly=") ? { code: 200, corpo: omHoras } : url.includes("open-meteo") ? { code: 200, corpo: om } : url.includes("inmet") ? { code: 200, corpo: inmet } : { code: 500, corpo: {} });
  amb.chamar("atualizarPrevisao");
  // leitura ao vivo com todos os sensores (vento forte, chovendo, UV, pressão, sensor de solo 2)
  const t = String(Math.floor(Date.UTC(2026, 1, 8, 21, 50) / 1000));
  const v = (unit: string, value: string) => ({ time: t, unit, value });
  const corpo = { code: 0, msg: "success", data: {
    outdoor: { temperature: v("ºC", "27.4"), feels_like: v("ºC", "29"), humidity: v("%", "61"), dew_point: v("ºC", "19") },
    solar_and_uvi: { solar: v("W/m²", "640"), uvi: v("", "8") }, rainfall: { daily: v("mm", "4.3"), rain_rate: v("mm/hr", "3.2") },
    wind: { wind_speed: v("m/s", "3.1"), wind_gust: v("m/s", "6.5"), wind_direction: v("º", "135") }, pressure: { relative: v("hPa", "1012.4") },
    soil_ch2: { soilmoisture: v("%", "33") }, temp_ch2: { temperature: v("ºC", "24.1") } } };
  amb.props.set("ECOWITT_APPLICATION_KEY", "app"); amb.props.set("ECOWITT_API_KEY", "api"); amb.props.set("ECOWITT_MAC", "AA:BB");
  const respPrev = amb.respostaHttp;
  amb.respostaHttp = (url) => (url.includes("ecowitt") ? { code: 200, corpo } : respPrev(url));
  amb.chamar("coletar");
  const cabP = amb.aba("PIVOS").getRange(1, 1, 1, amb.aba("PIVOS").getLastColumn()).getValues()[0]!;
  amb.aba("PIVOS").set(2, cabP.indexOf("Sensor de solo da estação (canal 1-8)") + 1, 2);
  amb.chamar("calcular_", "2026-02-08");
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "jose", "4321");
  // Hoje só decide; o clima fica na aba Clima
  await page.getByText(/prev. 2 dias 20,5 mm/).waitFor();
  assert.equal(await page.locator(".card.estacao").count(), 0);
  await page.getByRole("link", { name: /Clima/ }).click();
  await page.getByText("Próximos dias").waitFor();
  await page.locator("svg[aria-label='Clima da estação']").waitFor();
  const est = await page.locator(".card.estacao").innerText();
  assert.match(est, /27,4\s*°C/);
  assert.match(est, /sensação 29° · UR 61% · orvalho 19°/);
  assert.match(est, /rajada 6,5/);
  assert.match(est, /UV 8 · Muito alto/);
  assert.match(est, /1012 hPa/);
  assert.match(est, /Solo 2 · Pivô 2\s+33%/);
  assert.match(est, /Chovendo agora \(3,2 mm\/h\)/);
  assert.match(est, /Vento forte \(6,5 m\/s\)/);
  assert.match(est, /SE/);
  // pulverização: T 27,4 / UR 61 → Delta T 5,6 (ideal); vento 11 km/h = atenção terrestre, bom aérea; chovendo = ruim nos dois
  assert.match(est, /Delta T\s+5,6\s*°C\s+ideal 2–8/);
  assert.match(est, /Terrestre[\s\S]*Ruim[\s\S]*Vento 11 km\/h: no limite \(10 a 12\)[\s\S]*Chovendo agora/);
  assert.match(est, /Aérea[\s\S]*Ruim[\s\S]*Chovendo agora/);
  assert.doesNotMatch(est.split("Aérea")[1]!, /Vento 11 km\/h: no limite/);
  await page.locator(".j48").waitFor();
  const j48 = await page.locator(".j48").innerText();
  assert.match(j48, /Próximas 48 h \(previsão\)/i);
  assert.equal(await page.locator(".horas48 i").count(), 96); // 48 h × 2 modalidades
  assert.match(j48, /Terrestre: (hoje|amanhã) \d\dh–\d\dh \(\d+ h\)/);
  await page.getByText("20,5 mm em 2 dias").waitFor();
  await page.getByText(/INMET amanhã — manhã: chuva/).waitFor();
  await page.screenshot({ path: PRINTS + "12_clima.png", fullPage: true });
  await page.getByRole("link", { name: /Hoje/ }).click();
  await page.getByText("Detalhes").first().click();
  await page.getByText(/Sensor de solo 2: 33%/).waitFor();
  // com a chuva mínima de 2 mm o déficit sobe a ~27,6 mm e os 20,5 mm previstos não cobrem: sem aviso de adiar
  assert.equal(await page.getByText(/avalie adiar a irrigação/).count(), 0);
  await page.getByText(/Ao fim da volta o déficit chega a ≈/).waitFor();
  assert.equal(await page.locator(".card.sem-ruim").count(), 1);
  // irrigando bastante hoje, a decisão vira NÃO IRRIGAR e aparece a próxima irrigação prevista
  amb.post({ __login: { login: "jose", pin: "4321" } });
  const s = amb.post({ __login: { login: "jose", pin: "4321" } }).token;
  amb.post({ s, __lancamento: { id: "E2e1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "27" } });
  await page.getByRole("button", { name: /Recalcular/ }).click();
  await page.getByText(/Próxima irrigação prevista: \d\d\/\d\d \(em \d+ dias?, sem chuva\)/).waitFor();
  await page.getByText("Detalhes").first().click();
  await page.getByText(/Déficit previsto \(sem chuva\):/).waitFor();
  await page.screenshot({ path: PRINTS + "10_previsao.png", fullPage: true });
  await ctx.close();
});

test("mapa: KMZ importa o contorno de cada pivô pelo nome; KML no cadastro preenche centro e raio", async () => {
  const amb = planilha();
  const adm = amb.post({ __login: { login: "fabiana", pin: "1234" } }).token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], nome: "Pivô 3", raioM: "" }, original: null } });
  const { ctx, page } = await abrir(amb);
  await configurarEEntrar(page, "fabiana", "1234");
  await page.getByRole("link", { name: /Mapa/ }).click();
  await page.getByText("Nenhum pivô com posição ainda.").waitFor();
  await page.getByText(/Sem posição: Pivô 2, Pivô 3/).waitFor();

  await page.goto(base + "#/pivos");
  await page.locator("#kmz-todos").setInputFiles({ name: "pivos.kmz", mimeType: "application/vnd.google-earth.kmz", buffer: kmzDe(kmlExemplo(["PIVO 02", "P3", "Reservatório"])) });
  await page.getByText(/raio ≈ [34]\d\d m/).first().waitFor();
  assert.equal(await page.locator("select[data-desenho='0'] option:checked").textContent(), "Pivô 2");
  assert.equal(await page.locator("select[data-desenho='1'] option:checked").textContent(), "Pivô 3");
  assert.equal(await page.locator("select[data-desenho='2'] option:checked").textContent(), "— não importar —");
  await page.locator("#kmz-salvar").click();
  await page.getByText("✅ 2 pivô(s) com posição salva.").waitFor();
  const linhas = amb.aba("PIVOS").objetos();
  assert.ok(Math.abs(Number(linhas[0]!["Latitude (centro)"]) - -14.9) < 0.001);
  assert.ok(String(linhas[0]!["Contorno (do KMZ)"]).startsWith("[["));
  assert.ok(Math.abs(Number(linhas[1]!["Raio (m)"]) - 400) < 30, "raio estimado pelo contorno só onde não havia");
  assert.equal(linhas[0]!["Raio (m)"], 400);

  await page.locator(".leaflet-interactive").first().waitFor();
  assert.equal(await page.locator(".leaflet-interactive").count(), 2);
  await page.getByText("Pivô 2", { exact: true }).first().waitFor();
  await page.screenshot({ path: PRINTS + "11_mapa.png", fullPage: true });

  // cadastro de um pivô: KML de um desenho só
  await page.goto(base + "#/pivos/1");
  await page.locator("#p_arquivo").setInputFiles({ name: "p3.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(kmlExemplo(["Pivô 3"])) });
  await page.getByText(/Desenho "Pivô 3" · raio ≈ [34]\d\d m · 37 pontos/).waitFor();
  assert.equal(await page.inputValue("#p_latitude"), "-14,9");
  await ctx.close();
});

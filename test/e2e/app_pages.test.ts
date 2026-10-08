/**
 * O app de app/ (o mesmo que vai para o GitHub Pages) num Chromium de verdade, servido localmente.
 * As chamadas ao endereço /exec da planilha são desviadas para a planilha simulada (sync/Code.gs no Node).
 * Prints em test/e2e/prints/.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
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
  await page.getByText("🚿 IRRIGAR").waitFor();
  const card = await page.locator(".card").nth(1).innerText();
  assert.match(card, /Pivô 2/);
  assert.match(card, /Soja R3 · 75 DAS/);
  assert.match(card, /Déficit 24,\d mm/);
  assert.match(card, /PERCENTÍMETRO\s+\d+%/i);
  assert.match(await page.locator("#user-chip").innerText(), /Fabiana/);
  assert.match(await page.locator("#sync-status").innerText(), /Sincronizado/);
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
  await page.getByText("🚿 IRRIGAR").waitFor();
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
  await page.getByText("🚿 IRRIGAR").waitFor();
  await ctx.close();
});

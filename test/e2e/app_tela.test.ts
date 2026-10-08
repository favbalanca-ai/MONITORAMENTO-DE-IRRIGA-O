/**
 * Abre o App.html num Chromium de verdade, com o google.script.run ligado à planilha simulada.
 * Confere as quatro telas e salva prints em test/e2e/prints/.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { deLocal } from "../../src/coletor/tempo.ts";
import { criarAmbiente, type Ambiente } from "../apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "../pivo2_exemplo.ts";

const PRINTS = new URL("./prints/", import.meta.url).pathname;
const html = readFileSync(new URL("../../apps-script/App.html", import.meta.url), "utf8");

/** Substitui o google.script.run por uma ponte para a planilha simulada (no Node). */
const PONTE = `<script>
  window.google = { script: { run: (function criar(ok, falha) {
    return new Proxy({}, { get: function (_t, nome) {
      if (nome === "withSuccessHandler") return function (f) { return criar(f, falha); };
      if (nome === "withFailureHandler") return function (f) { return criar(ok, f); };
      return function () {
        window.__chamar(nome, JSON.stringify(Array.prototype.slice.call(arguments))).then(function (r) {
          var x = JSON.parse(r);
          if (x.erro) { falha && falha(new Error(x.erro)); } else { ok && ok(x.valor); }
        });
      };
    } });
  })() } };
</script>`;

let browser: Browser;
before(async () => {
  mkdirSync(PRINTS, { recursive: true });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function abrir(amb: Ambiente, esquema: "light" | "dark" = "light"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: esquema });
  page.on("pageerror", (e) => { throw e; });
  page.on("dialog", (d) => d.accept());
  await page.exposeFunction("__chamar", (nome: string, args: string) => {
    try {
      const valor = amb.chamar(nome, ...JSON.parse(args));
      return JSON.stringify({ valor: valor === undefined ? null : valor });
    } catch (e) {
      return JSON.stringify({ erro: (e as Error).message });
    }
  });
  await page.setContent(html.replace("<head>", "<head>" + PONTE));
  return page;
}

function pronto(): Ambiente {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  amb.chamar("gravarLeituras_", leiturasMeteoCorrigido());
  amb.agoraMs = deLocal("2026-02-08T19:00:00", "America/Sao_Paulo");
  return amb;
}

const semCarregando = (page: Page) => page.waitForFunction(() => !document.querySelector("#carregando")!.classList.contains("on"));

test("tela Hoje mostra a decisão do Pivô 2 com percentímetro e custo", async () => {
  const page = await abrir(pronto());
  await page.getByText("🚿 IRRIGAR").waitFor();
  await semCarregando(page);
  const card = await page.locator("#cartoesPivos .cartao").first().innerText();
  assert.match(card, /Pivô 2/);
  assert.match(card, /Soja R3 · 75 DAS/);
  assert.match(card, /Déficit 24,\d mm/);
  assert.match(card, /Percentímetro\s+\d+%/);
  assert.match(await page.locator("#clima").innerText(), /ET₀ 3,9 mm/);
  assert.match(await page.locator("#subtitulo").innerText(), /Dia 08\/02/);
  await page.screenshot({ path: PRINTS + "1_hoje.png", fullPage: true });
  await page.close();
});

test("tela Lançar grava irrigação, recalcula e permite apagar", async () => {
  const amb = pronto();
  const page = await abrir(amb);
  await page.getByText("🚿 IRRIGAR").waitFor();
  await page.getByRole("button", { name: /Lançar/ }).first().click();
  await semCarregando(page);
  assert.equal(await page.locator("#lData").inputValue(), "2026-02-08");
  await page.fill("#lMm", "25");
  await page.fill("#lObs", "percentímetro 30%");
  await page.locator("#formLancar button[type=submit]").click();
  await page.getByText("✅ Lançado").waitFor();
  await semCarregando(page);
  assert.match(await page.locator("#listaLancamentos").innerText(), /08\/02 · Pivô 2\s+🚿 25,0 mm · percentímetro 30%/);
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 2);
  await page.screenshot({ path: PRINTS + "2_lancar.png", fullPage: true });

  await page.getByRole("button", { name: "Hoje" }).click();
  assert.match(await page.locator("#cartoesPivos").innerText(), /NÃO IRRIGAR/);

  await page.getByRole("button", { name: /Lançar/ }).first().click();
  await semCarregando(page);
  await page.getByRole("button", { name: "Apagar" }).click();
  await page.getByText("Nada lançado ainda.").waitFor();
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);

  await page.getByRole("button", { name: "🌱 Umidade" }).click();
  await page.fill("#lRaiz", "28");
  await page.locator("#formLancar button[type=submit]").click();
  await page.getByText("✅ Lançado").waitFor();
  assert.equal(amb.aba("UMIDADE").getLastRow(), 2);
  await page.close();
});

test("erro de lançamento aparece na tela", async () => {
  const page = await abrir(pronto());
  await page.getByText("🚿 IRRIGAR").waitFor();
  await page.getByRole("button", { name: /Lançar/ }).first().click();
  await semCarregando(page);
  await page.fill("#lMm", "500");
  await page.locator("#formLancar button[type=submit]").click();
  await page.getByText(/lâmina deve ser um número entre/).waitFor();
  await page.close();
});

test("tela Histórico desenha o gráfico e a tabela", async () => {
  const page = await abrir(pronto());
  await page.getByText("🚿 IRRIGAR").waitFor();
  await page.getByRole("button", { name: "Histórico" }).click();
  await page.locator("#grafico svg").waitFor();
  await semCarregando(page);
  assert.equal(await page.locator("#grafico svg circle").count(), 20);
  assert.equal(await page.locator("#tabelaHistorico tbody tr").count(), 20);
  assert.match(await page.locator("#tabelaHistorico tbody tr").first().innerText(), /08\/02/);
  await page.screenshot({ path: PRINTS + "3_historico.png", fullPage: true });
  await page.close();
});

test("tela Pivôs edita e cria pivô, e mostra erro de cadastro", async () => {
  const amb = pronto();
  const page = await abrir(amb);
  await page.getByText("🚿 IRRIGAR").waitFor();
  await page.getByRole("button", { name: "Pivôs" }).click();
  await page.getByRole("button", { name: "Editar" }).click();
  assert.equal(await page.locator("#p_plantio").inputValue(), "2025-11-25");
  assert.equal(await page.locator("#p_raioM").inputValue(), "400");
  await page.screenshot({ path: PRINTS + "4_pivo_editar.png", fullPage: true });

  await page.fill("#p_pmp", "40");
  await page.locator("#formPivo button[type=submit]").click();
  await page.getByText(/PMP precisa ser menor que a CC/).waitFor();
  await page.fill("#p_pmp", "18");
  await page.fill("#p_laminaMinimaMm", "6,5");
  await page.locator("#formPivo button[type=submit]").click();
  await page.locator("#listaPivos .cartao").first().waitFor({ state: "visible" });
  await semCarregando(page);
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Lâmina mínima p/ irrigar (mm)"], 6.5);

  await page.getByRole("button", { name: "+ Novo pivô" }).click();
  await page.fill("#p_nome", "Pivô 5");
  await page.fill("#p_plantio", "2026-01-10");
  await page.fill("#p_umidadeInicialPct", "28");
  for (const [k, v] of [["cc", "33"], ["pmp", "19"], ["raizIniCm", "10"], ["raizMaxCm", "45"], ["diasRaiz", "50"]]) await page.fill(`#p_${k}`, v!);
  await page.locator("#formPivo button[type=submit]").click();
  await page.locator("#listaPivos").getByText("Pivô 5").waitFor();
  await semCarregando(page);
  await page.screenshot({ path: PRINTS + "5_pivos.png", fullPage: true });
  await page.getByRole("button", { name: "Hoje" }).click();
  assert.match(await page.locator("#cartoesPivos").innerText(), /Pivô 5/);
  await page.close();
});

test("modo escuro também fica legível", async () => {
  const page = await abrir(pronto(), "dark");
  await page.getByText("🚿 IRRIGAR").waitFor();
  await semCarregando(page);
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(fundo, "rgb(17, 22, 20)");
  await page.screenshot({ path: PRINTS + "6_hoje_escuro.png", fullPage: true });
  await page.close();
});

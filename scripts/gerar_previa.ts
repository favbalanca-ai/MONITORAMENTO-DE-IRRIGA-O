/**
 * Gera previa/previa_app.html: as telas reais do App.html com os dados de exemplo do Pivô 2,
 * calculados pela planilha simulada, e um backend falso no navegador (nada é gravado).
 *
 *   node scripts/gerar_previa.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deLocal } from "../src/coletor/tempo.ts";
import { criarAmbiente } from "../test/apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "../test/pivo2_exemplo.ts";

const amb = criarAmbiente();
amb.chamar("instalar");
amb.chamar("gravarLeituras_", leiturasMeteoCorrigido());
amb.agoraMs = deLocal("2026-02-08T19:00:00", "America/Sao_Paulo");
const j = (x: unknown) => JSON.parse(JSON.stringify(x));
const dados = {
  resumo: j(amb.chamar("apiHoje", true)),
  historico: { "Pivô 2": j(amb.chamar("apiHistorico", "Pivô 2", 365)) },
  pivos: j(amb.chamar("apiPivos")),
};

let html = readFileSync("apps-script/App.html", "utf8");
// A página do artifact já vem com doctype/html/head/body.
html = html.replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>/i, "").replace(/<base[^>]*>\s*/, "")
  .replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/, "")
  .replace(/<\/head>\s*<body>/, "").replace(/<\/body>\s*<\/html>\s*$/, "");
html = html.replace("<title>Manejo de Irrigação</title>", "<title>Manejo Água Viva</title>");
// Tema: respeita a escolha explícita do visualizador além do sistema.
const escuro = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}\s*\}/.exec(html)![1]!;
html = html.replace(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[\s\S]*?\}\s*\}/,
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${escuro} color-scheme: dark; } }\n  :root[data-theme="dark"] {${escuro} color-scheme: dark; }`);
html = html.replace("html, body { margin: 0; background: var(--fundo); color: var(--texto); }", "body { margin: 0; background: var(--fundo); color: var(--texto); }");
html = html.replace("position: sticky; top: 0; z-index: 5;", "position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5;");
html = html.replace("padding: calc(12px + env(safe-area-inset-top)) 16px 12px;", "padding: 12px 16px;");
html = html.replace("  .vazio {", "  .faixa-previa { background: var(--alerta-fundo); color: var(--alerta); font-size: 13px; padding: 8px 16px; text-align: center; }\n  .vazio {");
html = html.replace("<header>", '<div class="faixa-previa">Prévia com dados de exemplo (Pivô 2, fev/2026). Nada é gravado na planilha.</div>\n<header>');

const mock = `<script>
/* Backend falso da prévia: imita as funções api* do App.gs com os dados de exemplo. */
(function () {
  var D = ${JSON.stringify(dados)};
  var base = JSON.parse(JSON.stringify(D.resumo));
  var lancs = [];
  var seq = 100;
  window.confirm = function () { return true; }; // o visualizador não mostra diálogos
  function solo(nome) {
    var p = D.pivos.pivos.filter(function (x) { return x.nome === nome; })[0];
    return p ? { cc: Number(p.cc), z: Number(p.raizMaxCm) } : null;
  }
  function resumoAtual() {
    var r = JSON.parse(JSON.stringify(base));
    r.pivos.forEach(function (p) {
      if (!p.decisao) return;
      var ls = lancs.filter(function (l) { return l.pivo === p.nome && l.data === r.dia; });
      ls.forEach(function (l) {
        if (l.tipo === "irrigacao") { p.deficit = Math.max(0, p.deficit - l.valores[0]); p.irrigacao += l.valores[0]; }
        else { var s = solo(p.nome); if (s) p.deficit = Math.max(0, (s.cc - l.valores[0]) / 100 * s.z * 10); }
      });
      if (p.decisao !== "SEM DADOS") p.decisao = p.deficit >= p.laminaMinimaMm ? "IRRIGAR" : "NÃO IRRIGAR";
      if (ls.some(function (l) { return l.tipo === "umidade"; })) p.alertas = p.alertas.filter(function (a) { return a.indexOf("Última medição") !== 0; });
      if (p.rec && p.decisao === "IRRIGAR" && ls.length) {
        var f = p.deficit / base.pivos.filter(function (b) { return b.nome === p.nome; })[0].deficit;
        p.rec.laminaBrutaMm *= f; p.rec.tempoVoltaH *= f; p.rec.energiaKwh *= f; p.rec.custoRs *= f;
        p.rec.percentimetroPct = Math.min(100, Math.round(p.rec.percentimetroPct / f));
      }
    });
    return r;
  }
  function num(v) { var n = Number(String(v).replace(",", ".")); return String(v).trim() === "" || isNaN(n) ? null : n; }
  var api = {
    apiHoje: function () { return resumoAtual(); },
    apiLancar: function (tipo, d) {
      if (d.data > D.resumo.hoje) throw new Error("A data não pode ser no futuro.");
      if (tipo === "irrigacao") {
        var mm = num(d.mm);
        if (mm === null || mm < 0.1 || mm > 100) throw new Error("A lâmina deve ser um número entre 0.1 e 100.");
        lancs.push({ tipo: tipo, linha: seq++, data: d.data, pivo: d.pivo, valores: [mm, d.obs || ""] });
      } else {
        var u = num(d.umidadeRaiz);
        if (u === null || u < 0 || u > 100) throw new Error("A umidade na raiz deve ser um número entre 0 e 100.");
        var pr = num(d.umidadeProfunda), t = num(d.tensao);
        lancs.push({ tipo: tipo, linha: seq++, data: d.data, pivo: d.pivo, valores: [u, pr === null ? "" : pr, t === null ? "" : t, d.fonte || ""] });
      }
      return { ok: true, resumo: resumoAtual(), aviso: "" };
    },
    apiLancamentos: function () { return lancs.slice().reverse(); },
    apiApagarLancamento: function (tipo, linha) { lancs = lancs.filter(function (l) { return l.linha !== linha; }); return { ok: true }; },
    apiHistorico: function (nome, dias) {
      var h = D.historico[nome];
      if (!h) return { pivo: nome, laminaMinimaMm: null, linhas: [] };
      var c = JSON.parse(JSON.stringify(h));
      var hoje = resumoAtual().pivos.filter(function (p) { return p.nome === nome; })[0];
      var ult = c.linhas[c.linhas.length - 1];
      if (hoje && ult) { ult.deficit = hoje.deficit; ult.decisao = hoje.decisao; ult.irrigacao = hoje.irrigacao; }
      c.linhas = c.linhas.slice(-dias);
      return c;
    },
    apiPivos: function () { return D.pivos; },
    apiSalvarPivo: function (dados, original) {
      if (!String(dados.nome || "").trim()) throw new Error("Dê um nome ao pivô.");
      if (num(dados.pmp) !== null && num(dados.cc) !== null && num(dados.pmp) >= num(dados.cc))
        throw new Error("Cadastro com problemas:\\n- PMP precisa ser menor que a CC");
      var i = D.pivos.pivos.map(function (p) { return p.nome; }).indexOf(original);
      var novo = Object.assign({}, i >= 0 ? D.pivos.pivos[i] : {}, dados);
      if (i >= 0) D.pivos.pivos[i] = novo; else D.pivos.pivos.push(novo);
      if (i < 0) base.pivos.push({ nome: novo.nome, cultura: "Soja", aviso: "Prévia: o cálculo deste pivô aparece no app de verdade." });
      return D.pivos;
    },
  };
  function runner(ok, falha) {
    return new Proxy({}, { get: function (_t, nome) {
      if (nome === "withSuccessHandler") return function (f) { return runner(f, falha); };
      if (nome === "withFailureHandler") return function (f) { return runner(ok, f); };
      return function () {
        var args = arguments;
        setTimeout(function () {
          try { var v = api[nome].apply(null, args); ok && ok(JSON.parse(JSON.stringify(v === undefined ? null : v))); }
          catch (e) { falha && falha(e); }
        }, 250);
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>
`;
html = html.replace("<script>\n(function () {", mock + "<script>\n(function () {");
writeFileSync("previa/previa_app.html", html);
console.log("previa/previa_app.html", (html.length / 1024).toFixed(0) + " KB");

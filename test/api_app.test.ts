/** API do app (doGet/doPost do sync/Code.gs) com a planilha simulada. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deLocal } from "../src/coletor/tempo.ts";
import { criarAmbiente, setFazenda, type Ambiente } from "./apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "./pivo2_exemplo.ts";

/** Planilha instalada, leituras de jan/fev, "agora" = 08/02 19h e um admin e um operador. */
function pronto(): Ambiente {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  amb.chamar("gravarLeituras_", leiturasMeteoCorrigido());
  amb.agoraMs = deLocal("2026-02-08T19:00:00", "America/Sao_Paulo");
  amb.chamar("gravarUsuario_", { salvar: { nome: "Fabiana", login: "fabiana", perfil: "ADMIN", pin: "1234" } });
  const u = amb.aba("USUÁRIOS APP");
  u.appendRow(["José", "jose", "OPERADOR", "4321", "", "SIM", 1, ""]);
  return amb;
}
const entrar = (amb: Ambiente, login: string, pin: string) => amb.post({ __login: { login, pin } });

test("sem login, o app recebe só o pedido para entrar", () => {
  const amb = pronto();
  assert.deepEqual(amb.get({ acao: "dados" }), { login: true, erro: "Entre com seu login e PIN." });
  const r = amb.post({ __lancamento: { id: "x1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: 10 } });
  assert.equal(r.login, true);
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);
});

test("login com PIN: admin, PIN NOVO da planilha vira hash, PIN errado bloqueia depois de 5", () => {
  const amb = pronto();
  const a = entrar(amb, "FABIANA", "1234");
  assert.equal(a.ok, true);
  assert.deepEqual({ ...a.usuario, fazendas: [...a.usuario.fazendas] }, { nome: "Fabiana", login: "fabiana", perfil: "ADMIN", fazendas: [] });
  assert.ok(a.token.includes("."));

  const j = entrar(amb, "jose", "4321");
  assert.equal(j.ok, true);
  const linhaJose = amb.aba("USUÁRIOS APP").objetos().find((l) => l["LOGIN"] === "jose")!;
  assert.equal(linhaJose["PIN NOVO"], "");
  assert.notEqual(linhaJose["PIN"], "4321");
  assert.equal(entrar(amb, "jose", "4321").ok, true, "depois de virar hash o mesmo PIN continua valendo");

  for (let i = 0; i < 5; i++) assert.equal(entrar(amb, "jose", "0000").ok, false);
  const bloqueado = entrar(amb, "jose", "4321");
  assert.equal(bloqueado.ok, false);
  assert.match(bloqueado.erro, /Muitas tentativas/);
});

test("dados: resumo do dia, cadastro, lançamentos e hash", () => {
  const amb = pronto();
  const s = entrar(amb, "fabiana", "1234").token;
  const d = amb.get({ acao: "dados", s });
  assert.equal(d.ok, true);
  assert.equal(d.hoje, "2026-02-08");
  assert.equal(d.usuario.perfil, "ADMIN");
  assert.equal(d.resumo.dia, "2026-02-08");
  assert.equal(d.resumo.pivos[0].decisao, "IRRIGAR");
  assert.equal(d.cadastro.pivos[0].nome, "Pivô 2");
  assert.deepEqual(d.lancamentos, []);
  assert.equal(amb.get({ acao: "hash", s }).hash, d.hash);
});

test("operador lança irrigação; reenviar o mesmo id não duplica; apagar desfaz", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  amb.get({ acao: "dados", s });
  const lanc = { id: "Lk7a1", tipo: "irrigacao", pivo: "pivô 2", data: "2026-02-08", mm: "25,5", obs: "=SOMA(A1)" };
  const r1 = amb.post({ s, __lancamento: lanc });
  assert.equal(r1.ok, true);
  assert.equal(r1.resumo.pivos[0].decisao, "NÃO IRRIGAR");
  const r2 = amb.post({ s, __lancamento: { ...lanc, mm: "27" } });
  assert.equal(r2.ok, true);
  const linhas = amb.aba("IRRIGACOES").objetos();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!["Lâmina líquida aplicada (mm)"], 27);
  assert.equal(linhas[0]!["Obs."], "'=SOMA(A1)", "texto do usuário não vira fórmula");
  assert.equal(linhas[0]!["Por"], "José");
  assert.equal(linhas[0]!["ID"], "Lk7a1");

  const lista = amb.get({ acao: "dados", s }).lancamentos;
  assert.deepEqual(lista.map((l: { id: string; tipo: string; por: string }) => [l.id, l.tipo, l.por]), [["Lk7a1", "irrigacao", "José"]]);

  assert.equal(amb.post({ s, __apagar: { id: "Lk7a1" } }).resumo.pivos[0].decisao, "IRRIGAR");
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);
  assert.equal(amb.post({ s, __apagar: { id: "Lk7a1" } }).jaApagado, true);
});

test("medição de umidade e lançamentos feitos à mão na planilha ganham id", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  const r = amb.post({ s, __lancamento: { id: "U1", tipo: "umidade", pivo: "Pivô 2", data: "2026-02-08", umidadeRaiz: "29", umidadeProfunda: "", tensao: "-40", fonte: "TDR" } });
  assert.equal(r.resumo.pivos[0].deficit, 15);
  amb.aba("IRRIGACOES").appendRow(["2026-02-07", "Pivô 2", 8, "à mão"]);
  const lista = amb.get({ acao: "dados", s }).lancamentos;
  assert.equal(lista.length, 2);
  const manual = lista.find((l: { tipo: string }) => l.tipo === "irrigacao");
  assert.match(manual.id, /^P[0-9a-f]{10}$/);
  assert.equal(amb.post({ s, __apagar: { id: manual.id } }).ok, true);
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);
});

test("validação: pivô, data futura, números e tipo de pedido", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  const erro = (lanc: Record<string, unknown>) => amb.post({ s, __lancamento: { id: "x", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: 10, ...lanc } }).erro;
  assert.match(erro({ pivo: "Pivô 9" }), /não está na aba PIVOS/);
  assert.match(erro({ data: "2026-02-09" }), /futuro/);
  assert.match(erro({ mm: "abc" }), /lâmina deve ser um número/);
  assert.match(amb.post({ s, __lancamento: {}, __apagar: {} }).erro, /um tipo de gravação por pedido/);
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);
});

test("só o admin edita pivôs e usuários; operador recebe recusa", () => {
  const amb = pronto();
  const op = entrar(amb, "jose", "4321").token;
  const adm = entrar(amb, "fabiana", "1234").token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  const novo = { ...cad.pivos[0], nome: "Pivô 3", raioM: "350,5" };
  assert.match(amb.post({ s: op, __pivo: { dados: novo } }).erro, /Só o administrador/);
  assert.match(amb.get({ acao: "usuarios", s: op }).erro, /Só o administrador/);

  const r = amb.post({ s: adm, __pivo: { dados: novo, original: null } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.cadastro.pivos.map((p: { nome: string }) => p.nome), ["Pivô 2", "Pivô 3"]);
  assert.match(amb.post({ s: adm, __pivo: { dados: { ...novo, pmp: "40" }, original: "Pivô 3" } }).erro, /PMP precisa ser menor/);

  const us = amb.post({ s: adm, __usuario: { salvar: { nome: "Ana", login: "ana", perfil: "OPERADOR", pin: "5555" } } });
  assert.deepEqual(us.usuarios.map((u: { login: string }) => u.login), ["fabiana", "jose", "ana"]);
  assert.match(amb.post({ s: adm, __usuario: { excluir: "fabiana" } }).erro, /pelo menos um administrador/);
});

test("trocar PIN ou desativar derruba as sessões antigas", () => {
  const amb = pronto();
  const velho = entrar(amb, "jose", "4321").token;
  const novo = amb.post({ s: velho, __trocarPin: { atual: "4321", novo: "9876" } }).token;
  assert.equal(amb.get({ acao: "dados", s: velho }).login, true);
  assert.equal(amb.get({ acao: "dados", s: novo }).ok, true);
  assert.equal(entrar(amb, "jose", "9876").ok, true);

  const adm = entrar(amb, "fabiana", "1234").token;
  amb.post({ s: adm, __usuario: { salvar: { nome: "José", login: "jose", perfil: "OPERADOR", ativo: "NÃO" } } });
  assert.match(amb.get({ acao: "dados", s: novo }).erro, /acesso mudou/);
  assert.equal(entrar(amb, "jose", "9876").ok, false);
});

test("sessão adulterada ou vencida é recusada", () => {
  const amb = pronto();
  const s: string = entrar(amb, "jose", "4321").token;
  const [corpo, assinatura] = s.split(".");
  const falso = Buffer.from(Buffer.from(corpo!, "base64url").toString().replace("jose", "fabiana")).toString("base64url") + "." + assinatura;
  assert.match(amb.get({ acao: "dados", s: falso }).erro, /Sessão inválida/);
  amb.agoraMs! += 31 * 86400000;
  assert.match(amb.get({ acao: "dados", s }).erro, /Sessão vencida/);
});

test("EXIGIR LOGIN = NÃO: funciona sem entrar", () => {
  const amb = pronto();
  amb.aba("CONFIG APP").set(2, 2, "NÃO");
  assert.equal(amb.get({ acao: "dados" }).ok, true);
  const r = amb.post({ __lancamento: { id: "a1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: 5 } });
  assert.equal(r.ok, true);
});

test("histórico pelo GET", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  amb.get({ acao: "dados", s });
  const h = amb.get({ acao: "historico", pivo: "Pivô 2", dias: "7", s }).historico;
  assert.equal(h.linhas.length, 7);
  assert.equal(h.linhas.at(-1).data, "2026-02-08");
});

test("menu cria o administrador e mostra o endereço para o app", () => {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  const respostas = ["Fabiana", "fabiana", "2468"];
  (amb.ctx.SpreadsheetApp as { getUi: () => unknown }).getUi = () => ({
    alert: (t: string) => amb.alertas.push(t),
    prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => respostas.shift() }),
    ButtonSet: { OK_CANCEL: 1 }, Button: { OK: "OK" },
  });
  amb.chamar("menuCriarAdmin");
  assert.equal(entrar(amb, "fabiana", "2468").ok, true);
  (amb.ctx.SpreadsheetApp as { getUi: () => unknown }).getUi = () => ({
    showModalDialog: (saida: { html: string }, titulo: string) => amb.alertas.push(titulo + "\n" + saida.html),
  });
  amb.chamar("menuLinkApp");
  const janela = amb.alertas.at(-1)!;
  assert.match(janela, /Ligar o app/);
  assert.match(janela, /value="https:\/\/script\.google\.com\/macros\/s\/TESTE\/exec"/);
  assert.ok(janela.includes("https://favbalanca-ai.github.io/MONITORAMENTO-DE-IRRIGA-O/?exec=" + encodeURIComponent("https://script.google.com/macros/s/TESTE/exec")));
  assert.match(janela, /qrcode-generator@1\.4\.4/);
});

test("catálogo de culturas vai com nome, ciclo, curva de Kc e sugestão da Embrapa", () => {
  const amb = pronto();
  const adm = entrar(amb, "fabiana", "1234").token;
  const cs = amb.get({ acao: "dados", s: adm }).cadastro.culturas;
  assert.deepEqual(cs.map((c: { chave: string }) => c.chave), ["soja", "milho", "sorgo", "feijao", "feijao pd", "trigo", "algodao"]);
  const trigo = cs.find((c: { chave: string }) => c.chave === "trigo");
  assert.equal(trigo.nome, "Trigo");
  assert.equal(trigo.cicloDias, 115);
  assert.equal(trigo.emergenciaDias, 5);
  assert.equal(trigo.curvaKc.length, 121);
  assert.equal(trigo.sugestao.fatorDeplecaoFixo, 0.4);
  assert.match(trigo.fonte, /Embrapa Cerrados/);
  const resumo = amb.get({ acao: "dados", s: adm }).resumo;
  assert.equal(resumo.pivos[0].fimCicloDas, 120);
  assert.equal(resumo.pivos[0].curvaKc.length, 121);
  assert.equal(resumo.pivos[0].dae, resumo.pivos[0].das);
});

test("coluna Ciclo é opcional: planilha antiga sem ela funciona, e salvar pelo app cria a coluna", () => {
  const amb = pronto();
  const piv = amb.aba("PIVOS");
  const cab = piv.getRange(1, 1, 1, piv.getLastColumn()).getValues()[0]!;
  const idx = cab.indexOf("Ciclo (dias, vazio = padrão)");
  assert.ok(idx >= 0);
  piv.deleteColumns(idx + 1, 1); // planilha instalada antes desta versão
  const adm = entrar(amb, "fabiana", "1234").token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  assert.equal(cad.pivos[0].cicloDias, "");
  type Calc = { itens: { pivo: { cultura: { cicloDias: number; cicloPadraoDias?: number } }; linha: { alertas: string[] } }[] };
  assert.equal((amb.chamar("calcular_", "2026-02-08") as Calc).itens[0]!.pivo.cultura.cicloDias, 120);

  const r = amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], cultura: "milho", cicloDias: "140" }, original: "Pivô 2" } });
  assert.equal(r.ok, true);
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Ciclo (dias, vazio = padrão)"], 140);
  const it = (amb.chamar("calcular_", "2026-02-08") as Calc).itens[0]!;
  assert.equal(it.pivo.cultura.cicloDias, 140);
  assert.equal(it.pivo.cultura.cicloPadraoDias, 120);
  assert.match(amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], cicloDias: "10" }, original: "Pivô 2" } }).erro, /cicloDias/);
});

test("ciclo encerrado vira alerta no balanço", () => {
  const amb = pronto();
  amb.aba("PIVOS").set(2, 5, "2025-10-01"); // plantio 130 dias antes de 08/02
  amb.aba("PIVOS").set(2, 6, "2026-01-20");
  const it = (amb.chamar("calcular_", "2026-02-08") as { itens: { linha: { alertas: string[] } }[] }).itens[0]!;
  assert.ok(it.linha.alertas.some((a: string) => /Ciclo da cultura encerrado há 10 dia/.test(a)));
});

test("previsão: Open-Meteo dá os mm, INMET o texto; vai para a aba, o app e o relatório", () => {
  const amb = pronto();
  const om = JSON.parse(readFileSync(new URL("./fixtures/previsao_openmeteo.json", import.meta.url), "utf8"));
  const inmet = JSON.parse(readFileSync(new URL("./fixtures/previsao_inmet.json", import.meta.url), "utf8"));
  const time = [], temperature_2m = [], relative_humidity_2m = [], wind_speed_10m = [], wind_gusts_10m = [], precipitation = [], precipitation_probability = [];
  for (let h = 0; h < 48; h++) { time.push("2026-02-0" + (h < 24 ? 8 : 9) + "T" + String(h % 24).padStart(2, "0") + ":00"); temperature_2m.push(h % 24 < 8 ? 22 : 31); relative_humidity_2m.push(h % 24 < 8 ? 75 : 45); wind_speed_10m.push(1.5); wind_gusts_10m.push(2); precipitation.push(0); precipitation_probability.push(5); }
  const omHoras = { hourly: { time, temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, precipitation, precipitation_probability } };
  amb.respostaHttp = (url) => (url.includes("hourly=") ? { code: 200, corpo: omHoras } : url.includes("open-meteo") ? { code: 200, corpo: om } : url.includes("inmet") ? { code: 200, corpo: inmet } : { code: 500, corpo: {} });
  const p = amb.chamar("atualizarPrevisao") as { dias: { data: string; chuvaMm: number | null; resumo?: string }[]; fontes: string[]; horas: { quando: string; nivel: string }[] };
  assert.equal(p.horas.length, 48);
  assert.equal(p.horas[3]!.nivel, "bom");
  assert.equal(p.horas[12]!.nivel, "ruim");
  assert.deepEqual([...p.fontes], ["Open-Meteo", "INMET"]);
  assert.ok(amb.urls.some((u) => /open-meteo.*latitude=-14\.74&longitude=-46\.24/.test(u)));
  assert.ok(amb.urls.some((u) => u.endsWith("/previsao/3126208")));
  assert.equal(p.dias[8]!.chuvaMm, 12.4);
  assert.match(p.dias[8]!.resumo!, /pancadas/);
  assert.equal(amb.aba("PREVISAO").objetos().length, 14);

  const adm = entrar(amb, "fabiana", "1234").token;
  const d = amb.get({ acao: "dados", s: adm });
  assert.equal(d.previsao.dias.length, 14);
  const pv = d.resumo.pivos[0];
  assert.equal(pv.avisoChuva, null, "20,5 mm previstos não cobrem 80% do déficit de " + pv.deficit);
  assert.equal(pv.projecao.dias.length, 6, "projeção com a ET₀ prevista de 09/02 a 14/02");
  assert.equal(pv.projecao.emDias, 0);
  assert.ok(pv.projecao.deficitFimVoltaMm > pv.deficit);
  amb.aba("PIVOS").set(2, 15, 40); // lâmina mínima alta: hoje não irriga, projeção aponta o dia
  const pv2 = amb.chamar<{ itens: { linha: { decisao: string; projecao: { proximaIrrigacao: string | null; emDias: number | null } } }[] }>("calcular_", "2026-02-08").itens[0]!.linha;
  assert.equal(pv2.decisao, "NÃO IRRIGAR");
  assert.ok(pv2.projecao.emDias !== null && pv2.projecao.emDias >= 1, JSON.stringify(pv2.projecao));
  amb.aba("PIVOS").set(2, 15, 5);
  assert.match(amb.chamar<{ texto: string }>("calcular_", "2026-02-08").texto, /🌧 Previsão: 09\/02 12,4 mm/);

  // INMET fora do ar: continua com o Open-Meteo e registra no LOG
  amb.respostaHttp = (url) => (url.includes("hourly=") ? { code: 200, corpo: omHoras } : url.includes("open-meteo") ? { code: 200, corpo: om } : { code: 503, corpo: {} });
  const p2 = amb.chamar("atualizarPrevisao") as { fontes: string[] };
  assert.deepEqual([...p2.fontes], ["Open-Meteo"]);
  assert.ok(amb.aba("LOG").objetos().some((l) => l["Ação"] === "previsão" && l["Status"] === "parcial" && /INMET: HTTP 503/.test(String(l["Detalhe"]))));
});

test("pivô com latitude/longitude e contorno vai para o resumo; latitude sem longitude é recusada", () => {
  const amb = pronto();
  const adm = entrar(amb, "fabiana", "1234").token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  const contorno = [[-14.9, -46.25], [-14.9, -46.24], [-14.91, -46.24], [-14.91, -46.25]];
  const r = amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], latitude: "-14,905", longitude: "-46,245", contorno: JSON.stringify(contorno) }, original: "Pivô 2" } });
  assert.equal(r.ok, true);
  const p = r.recalculo.resumo.pivos[0];
  assert.equal(p.latitude, -14.905);
  assert.equal(p.longitude, -46.245);
  assert.deepEqual(p.contorno, contorno);
  assert.equal(p.raioM, 400);
  assert.match(amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], latitude: "-14,9", longitude: "" }, original: "Pivô 2" } }).erro, /precisam vir juntas/);
});

test("relatório em PDF pelo GET (base64) e pelo menu", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  const r = amb.get({ acao: "pdf", s });
  assert.equal(r.ok, true);
  assert.equal(r.nome, "2026-02-08.pdf");
  assert.match(r.url, /drive\.google\.com/);
  assert.match(Buffer.from(r.base64, "base64").toString("utf8"), /^%PDF-FAKE[\s\S]*Manejo de irrigação — 08\/02/);
  amb.alertas.length = 0;
  amb.chamar("menuPdf");
  assert.match(amb.alertas[0]!, /PDF salvo na pasta RELATORIOS:\n2026-02-08\.pdf/);
});

test("rosa dos ventos por período pelo GET", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  // três leituras ao vivo com direção nos extras, em dias diferentes
  const base = { chuvaAcumDia: 0, tempC: 25, urPct: 60, radWm2: 300, intervaloMin: 10, fonte: "ecowitt" };
  amb.chamar("gravarLeituras_", [
    { ...base, quando: "2026-02-01T10:01:00", ventoMs: 2, extras: { "wind.wind_direction": 90 } },
    { ...base, quando: "2026-02-02T10:01:00", ventoMs: 4, extras: { "wind.wind_direction": 95 } },
    { ...base, quando: "2026-02-05T10:01:00", ventoMs: 0.5, extras: { "wind.wind_direction": 200 } },
  ]);
  const r = amb.get({ acao: "rosa", s, de: "2026-02-01", ate: "2026-02-03" }).rosa;
  assert.equal(r.total, 2);
  assert.equal(r.predominante, 4); // L
  assert.deepEqual([...r.setores[4].faixas], [0, 1, 1, 0]);
  const r2 = amb.get({ acao: "rosa", s, de: "2026-02-05", ate: "2026-02-05" }).rosa;
  assert.equal(r2.total, 1);
  assert.equal(r2.calmaria, 1);
  assert.match(amb.get({ acao: "rosa", s, de: "2026-02-05", ate: "2026-02-01" }).erro, /final vem antes/);
  assert.match(amb.get({ acao: "rosa", s, de: "2025-01-01", ate: "2026-02-01" }).erro, /120 dias/);
});

test("lançar pelo percentímetro: a lâmina líquida sai do equipamento e a observação registra", () => {
  const amb = pronto();
  const s = entrar(amb, "jose", "4321").token;
  const r = amb.post({ s, __lancamento: { id: "Pc1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "", percentimetro: "50", obs: "noite" } });
  assert.equal(r.ok, true);
  const l = amb.aba("IRRIGACOES").objetos()[0]!;
  assert.equal(l["Lâmina líquida aplicada (mm)"], 9.4); // 5,56 mm a 100% → 11,1 brutos a 50% × 85%
  assert.match(String(l["Obs."]), /percentímetro 50% \(11\.1 mm brutos\) · noite/);
  assert.match(amb.post({ s, __lancamento: { id: "Pc2", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "", percentimetro: "5" } }).erro, /percentímetro/);
});

test("ESTACAO: chuva mínima e horário de ponta entram no cálculo; tarifa de ponta dá a hora de ligar", () => {
  const amb = pronto();
  const cab = amb.aba("PIVOS").getRange(1, 1, 1, amb.aba("PIVOS").getLastColumn()).getValues()[0]!;
  amb.aba("PIVOS").set(2, cab.indexOf("Tarifa na ponta (R$/kWh, vazio = única)") + 1, 2.5);
  const it = amb.chamar<{ itens: { linha: { recomendacao: { ponta: { inicioSugerido: string; custoPiorRs: number }; custoRs: number }; chuva: number; alertas: string[] } }[]; texto: string }>("calcular_", "2026-02-08");
  const l = it.itens[0]!.linha;
  assert.equal(l.recomendacao.ponta.inicioSugerido, "21:00");
  assert.ok(l.recomendacao.ponta.custoPiorRs > l.recomendacao.custoRs);
  assert.match(it.texto, /Ligar às \*21:00\* \(fora da ponta\)/);
  // chuva de 4,3 mm no dia conta (≥ 2); muda o mínimo para 5 e ela deixa de contar
  assert.equal(Math.round(l.chuva * 10) / 10, 4.3);
  setFazenda(amb, "Chuva mínima que conta (mm)", 5);
  const l2 = amb.chamar<{ itens: { linha: { chuva: number; alertas: string[] } }[] }>("calcular_", "2026-02-08").itens[0]!.linha;
  assert.equal(l2.chuva, 0);
  assert.ok(l2.alertas.some((a) => /abaixo de 5 mm/.test(a)));
});

test("duas fazendas: cada usuário vê só a sua; talhão sem pivô tem só o relatório do ciclo", () => {
  const amb = pronto();
  // segunda fazenda sem estação: o clima vem do Open-Meteo (92 dias passados)
  const faz = amb.aba("FAZENDAS");
  faz.appendRow(["Novo Pago", "", -15.2, -46.5, 850, 2, "America/Sao_Paulo", "rainfall", "novo@exemplo.com", 3126208, 2, 18, 21]);
  const time: string[] = [], tmax: number[] = [], tmin: number[] = [], tmean: number[] = [], ur: number[] = [], vento: number[] = [], rad: number[] = [], chuva: number[] = [], et0: number[] = [], sol: number[] = [];
  for (let i = 92; i >= -1; i--) {
    const d = new Date(Date.parse("2026-02-08T00:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    time.push(d); tmax.push(30); tmin.push(18); tmean.push(24); ur.push(60); vento.push(2); rad.push(20); chuva.push(i % 7 === 0 ? 8 : 0); et0.push(4.2); sol.push(8 * 3600);
  }
  const omDiario = { daily: { time, temperature_2m_max: tmax, temperature_2m_min: tmin, temperature_2m_mean: tmean, relative_humidity_2m_mean: ur, wind_speed_10m_mean: vento, shortwave_radiation_sum: rad, precipitation_sum: chuva, et0_fao_evapotranspiration: et0, sunshine_duration: sol } };
  amb.respostaHttp = (url) => (url.includes("past_days=92") ? { code: 200, corpo: omDiario } : { code: 500, corpo: {} });
  // áreas da fazenda nova: um pivô (copiando o Pivô 2) e um talhão só com cultura e plantio
  const adm = entrar(amb, "fabiana", "1234").token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  assert.deepEqual([...cad.fazendas.map((f: { nome: string }) => f.nome)], ["Água Viva", "Novo Pago"]);
  let r = amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], nome: "Pivô 1", fazenda: "Novo Pago", plantio: "2026-01-10", inicioBalanco: "2026-01-10" }, original: null } });
  assert.equal(r.ok, true, r.erro);
  r = amb.post({ s: adm, __pivo: { dados: { nome: "Talhão 1", fazenda: "Novo Pago", tipo: "talhão", ativo: "SIM", cultura: "milho", plantio: "2026-01-05", palhada: "NÃO" }, original: null } });
  assert.equal(r.ok, true, r.erro);
  // mesmo nome em fazendas diferentes é permitido
  r = amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], nome: "Pivô 2", fazenda: "Novo Pago" }, original: null } });
  assert.equal(r.ok, true, r.erro);
  assert.match(amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], nome: "Pivô 2", fazenda: "Novo Pago" }, original: null } }).erro, /Já existe uma área chamada Pivô 2 nessa fazenda/);

  const calc = amb.chamar<{ fazendas: { cfg: { nome: string }; itens: { pivo: { nome: string; semBalanco: boolean }; linha?: unknown; aviso?: string; ciclo: { grausDia: number; horasSolAcumH: number | null; fotoperiodoAcumH: number } }[]; assunto: string; texto: string }[] }>("calcular_", "2026-02-08");
  assert.deepEqual([...calc.fazendas.map((f) => f.cfg.nome)], ["Água Viva", "Novo Pago"]);
  const np = calc.fazendas[1]!;
  assert.match(np.assunto, /Manejo 08\/02 · Novo Pago/);
  const talhao = np.itens.find((i) => i.pivo.nome === "Talhão 1")!;
  assert.equal(talhao.pivo.semBalanco, true);
  assert.equal(talhao.linha, undefined);
  assert.match(talhao.aviso!, /talhão sem balanço/);
  assert.equal(talhao.ciclo.grausDia, 35 * 14); // 35 dias (05/01–08/02) × (24 − 10)
  assert.equal(talhao.ciclo.horasSolAcumH, 35 * 8);
  assert.match(np.texto, /🌱 \*Talhão 1\* — Milho \(talhão\)[\s\S]*Ciclo 35 d: 490 GD/);
  const p1 = np.itens.find((i) => i.pivo.nome === "Pivô 1")!;
  assert.ok(p1.linha, "pivô da fazenda sem estação tem balanço pelo Open-Meteo");
  assert.ok((p1.linha as { alertas: string[] }).alertas.some((a) => /Open-Meteo/.test(a)));

  // operador restrito ao Novo Pago
  amb.aba("USUÁRIOS APP").appendRow(["Carlos", "carlos", "OPERADOR", "9999", "", "SIM", 1, "", "Novo Pago"]);
  const op = entrar(amb, "carlos", "9999").token;
  const d = amb.get({ acao: "dados", s: op });
  assert.deepEqual([...d.fazendas.map((f: { nome: string }) => f.nome)], ["Novo Pago"]);
  assert.deepEqual([...d.resumo.pivos.map((p: { nome: string }) => p.nome)].sort(), ["Pivô 1", "Pivô 2", "Talhão 1"]);
  assert.ok(d.resumo.pivos.every((p: { fazenda: string }) => p.fazenda === "Novo Pago"));
  assert.deepEqual([...d.cadastro.pivos.map((p: { nome: string }) => p.nome)].sort(), ["Pivô 1", "Pivô 2", "Talhão 1"]);
  assert.equal(d.estacoes["novo pago"].temEstacao, false);
  // lançar na fazenda do outro: recusa; na própria, com o nome repetido, precisa dizer a fazenda
  assert.match(amb.post({ s: op, __lancamento: { id: "L1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "10", fazenda: "Água Viva" } }).erro, /não tem acesso à fazenda/);
  assert.match(amb.post({ s: op, __lancamento: { id: "L1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "10" } }).erro, /mais de uma área chamada/);
  const ok = amb.post({ s: op, __lancamento: { id: "L1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-08", mm: "10", fazenda: "Novo Pago" } });
  assert.equal(ok.ok, true, ok.erro);
  assert.equal(amb.aba("IRRIGACOES").objetos()[0]!["Fazenda"], "Novo Pago");
  assert.match(amb.post({ s: op, __lancamento: { id: "L2", tipo: "irrigacao", pivo: "Talhão 1", data: "2026-02-08", mm: "10", fazenda: "Novo Pago" } }).erro, /talhão sem balanço/);
  // o admin (sem restrição) vê tudo, e a irrigação ficou na área certa
  const tudo = amb.get({ acao: "dados", s: adm });
  assert.equal(tudo.resumo.pivos.length, 4);
  const p2np = tudo.resumo.pivos.find((p: { nome: string; fazenda: string }) => p.nome === "Pivô 2" && p.fazenda === "Novo Pago");
  const p2av = tudo.resumo.pivos.find((p: { nome: string; fazenda: string }) => p.nome === "Pivô 2" && p.fazenda === "Água Viva");
  assert.equal(p2np.irrigacao, 10);
  assert.equal(p2av.irrigacao, 0);
  assert.equal(tudo.lancamentos[0].fazenda, "Novo Pago");
  // histórico e rosa respeitam a fazenda
  assert.match(amb.get({ acao: "historico", s: op, pivo: "Pivô 2", fazenda: "Água Viva" }).erro, /não tem acesso/);
  assert.equal(amb.get({ acao: "historico", s: op, pivo: "Pivô 2", fazenda: "Novo Pago" }).historico.fazenda, "Novo Pago");
});

test("reservatório: pivô abastecido por piscinão, nível lançado, volume estimado e dias de irrigação", () => {
  const amb = pronto();
  amb.aba("RESERVATORIOS").appendRow(["Água Viva", "Piscinão 1", 20000, 200, 10, 2000, "bomba do rio"]);
  const adm = entrar(amb, "fabiana", "1234").token;
  const cad = amb.get({ acao: "dados", s: adm }).cadastro;
  assert.deepEqual([...cad.reservatorios.map((r: { nome: string; volumeUtilM3: number }) => [r.nome, r.volumeUtilM3])], [["Piscinão 1", 20000]]);
  // fonte que não existe é recusada; a certa (sem acento, caixa diferente) é aceita
  assert.match(amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], fonte: "Piscinão 9" }, original: "Pivô 2" } }).erro, /fonte de água "Piscinão 9" não está na aba RESERVATORIOS/);
  let r = amb.post({ s: adm, __pivo: { dados: { ...cad.pivos[0], fonte: "piscinao 1" }, original: "Pivô 2" } });
  assert.equal(r.ok, true, r.erro);
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Fonte de água (vazio = direto)"], "piscinao 1");
  // nível de 60 % no dia 05 e uma irrigação de 10 mm no dia 06
  r = amb.post({ s: adm, __lancamento: { id: "N1", tipo: "nivel", pivo: "Piscinão 1", data: "2026-02-05", nivel: "60", obs: "régua" } });
  assert.equal(r.ok, true, r.erro);
  assert.equal(amb.aba("NIVEL RESERVATORIO").objetos()[0]!["Nível (%)"], 60);
  assert.equal(amb.aba("NIVEL RESERVATORIO").objetos()[0]!["Fazenda"], "Água Viva");
  assert.match(amb.post({ s: adm, __lancamento: { id: "N2", tipo: "nivel", pivo: "Piscinão 1", data: "2026-02-05", nivel: "140" } }).erro, /O nível deve ser um número entre 0 e 100/);
  r = amb.post({ s: adm, __lancamento: { id: "L1", tipo: "irrigacao", pivo: "Pivô 2", data: "2026-02-06", mm: "10" } });
  assert.equal(r.ok, true, r.erro);

  const calc = amb.chamar<{ fazendas: { reservatorios: { nome: string; volumeM3: number; pct: number; reposicaoDiaM3: number; retiradoDesdeNivelM3: number; demandaDiaM3: number; pivos: string[]; diasAutonomia: number | null; semaforo: string }[]; texto: string; html: string }[] }>("calcular_", "2026-02-08");
  const b = calc.fazendas[0]!.reservatorios[0]!;
  assert.equal(b.nome, "Piscinão 1");
  assert.deepEqual([...b.pivos], ["Pivô 2"]);
  // Pivô 2: raio 400 m → 50,27 ha; 10 mm líquidos ÷ 0,85 × 50,27 × 10 = 5.914 m³
  assert.equal(b.retiradoDesdeNivelM3, 5914);
  assert.equal(b.reposicaoDiaM3, 2000);
  assert.equal(b.volumeM3, 12000 + 3 * 2000 - 5914);
  assert.equal(b.pct, 60);
  assert.ok(b.demandaDiaM3 > 0);
  assert.ok(b.diasAutonomia === null || b.diasAutonomia > 0);
  assert.match(calc.fazendas[0]!.texto, /\*Piscinão 1\* — 12\.086 m³ \(60% de 20\.000 m³\) · nível 60% lançado 05\/02[\s\S]*Entra 2\.000 m³\/dia na bomba · Pivô 2 consome/);
  assert.match(calc.fazendas[0]!.html, /🏞 Piscinão 1/);
  assert.match(calc.fazendas[0]!.texto, /água do Piscinão 1/);

  const d = amb.get({ acao: "dados", s: adm });
  assert.equal(d.resumo.reservatorios.length, 1);
  assert.equal(d.resumo.reservatorios[0].chaveFazenda, "agua viva");
  assert.equal(d.resumo.pivos.find((p: { nome: string }) => p.nome === "Pivô 2").fonte, "Piscinão 1");
  const niv = d.lancamentos.find((l: { id: string }) => l.id === "N1");
  assert.equal(niv.tipo, "nivel");
  assert.equal(niv.pivo, "Piscinão 1");
  assert.deepEqual([...niv.valores], [60, "régua"]);
  // apagar o nível: o reservatório fica "sem nível lançado"
  r = amb.post({ s: adm, __apagar: { id: "N1" } });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resumo.reservatorios[0].volumeM3, null);
  assert.equal(r.resumo.reservatorios[0].semaforo, "sem");
  // painel tem a linha do reservatório
  assert.ok(amb.aba("PAINEL").dados.some((l) => String(l[0]).includes("Piscinão 1")));
});

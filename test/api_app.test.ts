/** API do app (doGet/doPost do sync/Code.gs) com a planilha simulada. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deLocal } from "../src/coletor/tempo.ts";
import { criarAmbiente, type Ambiente } from "./apps_script/fake.ts";
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
  assert.deepEqual(a.usuario, { nome: "Fabiana", login: "fabiana", perfil: "ADMIN" });
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
  const lanc = { id: "Lk7a1", tipo: "irrigacao", pivo: "pivô 2", data: "2026-02-08", mm: "20,5", obs: "=SOMA(A1)" };
  const r1 = amb.post({ s, __lancamento: lanc });
  assert.equal(r1.ok, true);
  assert.equal(r1.resumo.pivos[0].decisao, "NÃO IRRIGAR");
  const r2 = amb.post({ s, __lancamento: { ...lanc, mm: "22" } });
  assert.equal(r2.ok, true);
  const linhas = amb.aba("IRRIGACOES").objetos();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!["Lâmina líquida aplicada (mm)"], 22);
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
  amb.chamar("menuLinkApp");
  assert.match(amb.alertas.at(-1)!, /exec[\s\S]*Sincronizar/);
});

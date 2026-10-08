import { test } from "node:test";
import assert from "node:assert/strict";
import { deLocal } from "../src/coletor/tempo.ts";
import { criarAmbiente, type Ambiente } from "./apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "./pivo2_exemplo.ts";

/** Planilha instalada, com as leituras de jan/fev e "agora" = 08/02 às 19h. */
function pronto(): Ambiente {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  amb.chamar("gravarLeituras_", leiturasMeteoCorrigido());
  amb.agoraMs = deLocal("2026-02-08T19:00:00", "America/Sao_Paulo");
  return amb;
}
const json = <T>(x: unknown) => JSON.parse(JSON.stringify(x)) as T; // como o google.script.run entrega

type Resumo = {
  dia: string; hoje: string; calculadoEm: string; clima: { et0: number; chuva: number; n: number };
  ultimaLeitura: { quando: string } | null;
  pivos: { nome: string; decisao: string; deficit: number; afd: number; rec?: { percentimetroPct: number; custoRs: number } }[];
};

test("doGet serve a tela App", () => {
  const amb = pronto();
  assert.equal(amb.chamar<{ nome: string }>("doGet").nome, "App");
});

test("Hoje: calcula na primeira vez, depois lê o resumo guardado", () => {
  const amb = pronto();
  const r = json<Resumo>(amb.chamar("apiHoje", false));
  assert.equal(r.dia, "2026-02-08");
  assert.equal(r.hoje, "2026-02-08");
  assert.equal(r.ultimaLeitura!.quando, "2026-02-08T13:30:39");
  const p = r.pivos[0]!;
  assert.equal(p.nome, "Pivô 2");
  assert.equal(p.decisao, "IRRIGAR");
  assert.ok(Math.abs(p.deficit - 24.6) <= 0.15, String(p.deficit));
  assert.ok(p.rec!.percentimetroPct > 0 && p.rec!.custoRs > 0);

  // o resumo fica guardado: sem recalcular, não mexe no BALANCO
  amb.aba("BALANCO").clearContents();
  amb.chamar("apiHoje", false);
  assert.equal(amb.aba("BALANCO").getLastRow(), 0);
  amb.chamar("apiHoje", true);
  assert.equal(amb.aba("BALANCO").getLastRow(), 21);
});

test("Lançar irrigação recalcula e entra na lista; apagar desfaz", () => {
  const amb = pronto();
  amb.chamar("apiHoje", true);
  const r = json<{ ok: boolean; resumo: Resumo; aviso: string }>(
    amb.chamar("apiLancar", "irrigacao", { pivo: "pivô 2", data: "2026-02-08", mm: "20,5", obs: "perc 30%" }));
  assert.equal(r.ok, true);
  assert.equal(r.aviso, "");
  assert.equal(r.resumo.pivos[0]!.decisao, "NÃO IRRIGAR");
  const ls = json<{ tipo: string; linha: number; data: string; pivo: string; valores: unknown[] }[]>(amb.chamar("apiLancamentos", 10));
  assert.equal(ls.length, 1);
  assert.deepEqual([ls[0]!.tipo, ls[0]!.data, ls[0]!.pivo, ls[0]!.valores[0]], ["irrigacao", "2026-02-08", "Pivô 2", 20.5]);

  assert.throws(() => amb.chamar("apiApagarLancamento", "irrigacao", ls[0]!.linha, "2026-02-07", "Pivô 2"), /planilha mudou/);
  amb.chamar("apiApagarLancamento", "irrigacao", ls[0]!.linha, ls[0]!.data, ls[0]!.pivo);
  assert.equal(json<unknown[]>(amb.chamar("apiLancamentos", 10)).length, 0);
  assert.equal(json<Resumo>(amb.chamar("apiHoje", false)).pivos[0]!.decisao, "IRRIGAR");
});

test("Lançar umidade substitui o déficit do dia", () => {
  const amb = pronto();
  const r = json<{ resumo: Resumo }>(amb.chamar("apiLancar", "umidade", { pivo: "Pivô 2", data: "2026-02-08", umidadeRaiz: "29", umidadeProfunda: "", tensao: "-40", fonte: "TDR" }));
  assert.equal(r.resumo.pivos[0]!.deficit, 15);
});

test("Lançamentos inválidos são recusados com mensagem clara", () => {
  const amb = pronto();
  assert.throws(() => amb.chamar("apiLancar", "irrigacao", { pivo: "Pivô 9", data: "2026-02-08", mm: "10" }), /Pivô "Pivô 9" não está/);
  assert.throws(() => amb.chamar("apiLancar", "irrigacao", { pivo: "Pivô 2", data: "2026-02-09", mm: "10" }), /futuro/);
  assert.throws(() => amb.chamar("apiLancar", "irrigacao", { pivo: "Pivô 2", data: "2026-02-08", mm: "abc" }), /lâmina deve ser um número/);
  assert.throws(() => amb.chamar("apiLancar", "umidade", { pivo: "Pivô 2", data: "2026-02-08", umidadeRaiz: "120" }), /umidade na raiz/);
  assert.equal(amb.aba("IRRIGACOES").getLastRow(), 1);
});

test("Histórico devolve a série do pivô no período", () => {
  const amb = pronto();
  amb.chamar("apiHoje", true);
  const h = json<{ laminaMinimaMm: number; linhas: { data: string; deficit: number; chuva: number; decisao: string }[] }>(amb.chamar("apiHistorico", "pivô 2", 7));
  assert.equal(h.linhas.length, 7);
  assert.equal(h.linhas.at(-1)!.data, "2026-02-08");
  assert.equal(h.laminaMinimaMm, 5);
  assert.ok(h.linhas.every((l) => typeof l.deficit === "number"));
});

test("Pivôs: lista, cria novo validado e recusa cadastro errado sem estragar a planilha", () => {
  const amb = pronto();
  const c = json<{ colunas: string[][]; pivos: Record<string, unknown>[]; culturas: string[] }>(amb.chamar("apiPivos"));
  assert.deepEqual(c.culturas, ["soja"]);
  assert.equal(c.pivos[0]!["nome"], "Pivô 2");
  assert.equal(c.pivos[0]!["plantio"], "2025-11-25");

  const novo = { ...c.pivos[0]!, nome: "Pivô 3", raioM: "350,5", inicioBalanco: "2026-01-25" };
  const depois = json<{ pivos: Record<string, unknown>[] }>(amb.chamar("apiSalvarPivo", novo, null));
  assert.deepEqual(depois.pivos.map((p) => p["nome"]), ["Pivô 2", "Pivô 3"]);
  assert.equal(depois.pivos[1]!["raioM"], 350.5);

  const ruim = { ...novo, pmp: "40" };
  assert.throws(() => amb.chamar("apiSalvarPivo", ruim, "Pivô 3"), /PMP precisa ser menor que a CC/);
  assert.equal(json<{ pivos: Record<string, unknown>[] }>(amb.chamar("apiPivos")).pivos[1]!["pmp"], 18);
  assert.throws(() => amb.chamar("apiSalvarPivo", { ...novo, pmp: "40", nome: "Pivô 4" }, null), /PMP/);
  assert.equal(json<{ pivos: unknown[] }>(amb.chamar("apiPivos")).pivos.length, 2);
  assert.throws(() => amb.chamar("apiSalvarPivo", { ...novo, nome: "pivô 2" }, "Pivô 3"), /Já existe/);

  amb.chamar("apiSalvarPivo", { ...novo, nome: "Pivô 3 Norte", ativo: "NÃO" }, "Pivô 3");
  const fim = json<{ pivos: Record<string, unknown>[] }>(amb.chamar("apiPivos"));
  assert.deepEqual(fim.pivos.map((p) => [p["nome"], p["ativo"]]), [["Pivô 2", "SIM"], ["Pivô 3 Norte", "NÃO"]]);
  const r = json<Resumo>(amb.chamar("apiHoje", true));
  assert.deepEqual(r.pivos.map((p) => p.nome), ["Pivô 2"]);
});

test("menu mostra o link do app", () => {
  const amb = pronto();
  amb.chamar("menuLinkApp");
  assert.match(amb.alertas.at(-1)!, /script\.google\.com\/macros\/s\/TESTE\/exec/);
});

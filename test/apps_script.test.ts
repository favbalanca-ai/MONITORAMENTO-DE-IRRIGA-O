import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gerarMotorGs, DESTINO } from "../scripts/gerar_apps_script.ts";
import { deLocal } from "../src/coletor/tempo.ts";
import { criarAmbiente, type Ambiente } from "./apps_script/fake.ts";
import { leiturasMeteoCorrigido } from "./pivo2_exemplo.ts";

const fixture = async (nome: string) => JSON.parse(await readFile(new URL(`./fixtures/${nome}`, import.meta.url), "utf8"));
const EMAIL = "teste@exemplo.com";

function instalado(): Ambiente {
  const amb = criarAmbiente();
  amb.chamar("instalar");
  const est = amb.aba("ESTACAO");
  const linhaEmail = est.dados.findIndex((l) => String(l[0]).startsWith("E-mails"));
  est.set(linhaEmail + 1, 2, EMAIL);
  return amb;
}

function comLeiturasPivo2(): Ambiente {
  const amb = instalado();
  const n = amb.chamar<number>("gravarLeituras_", leiturasMeteoCorrigido());
  assert.equal(n, 2834);
  return amb;
}

function pivo2(amb: Ambiente) {
  return amb.aba("BALANCO").objetos().filter((l) => l["Pivô"] === "Pivô 2");
}

test("Motor.gs está em dia com o TypeScript (rode npm run gerar:apps-script)", async () => {
  assert.equal(await readFile(DESTINO, "utf8"), gerarMotorGs());
});

test("instalar cria abas, exemplo do Pivô 2, pastas no Drive e gatilhos — e pode rodar de novo", () => {
  const amb = instalado();
  for (const a of ["PAINEL", "PIVOS", "ESTACAO", "IRRIGACOES", "UMIDADE", "BALANCO", "CLIMA", "LEITURAS", "LOG"]) assert.ok(amb.abas.has(a), a);
  assert.equal(amb.aba("PIVOS").objetos()[0]!["Pivô"], "Pivô 2");
  assert.deepEqual(amb.pastaApp.pastas.map((p) => p.nome).sort(), ["BACKUP", "RELATORIOS"]);
  assert.deepEqual(amb.gatilhos.map((g) => g.funcao).sort(), ["atualizarPrevisao", "backupDiario", "coletar", "recuperarRecentes", "relatorioDiario"]);
  const rel = amb.gatilhos.find((g) => g.funcao === "relatorioDiario")!;
  assert.deepEqual(rel.chamadas.find(([n]) => n === "atHour")![1], [18]);

  amb.chamar("instalar");
  assert.equal(amb.gatilhos.length, 5);
  assert.equal(amb.aba("PIVOS").objetos().length, 1);
  assert.equal(amb.pastaApp.pastas.length, 2);
});

test("relatório na planilha reproduz a seção 7 e manda e-mail uma vez só", () => {
  const amb = comLeiturasPivo2();
  amb.chamar("calcularEEnviar_", "2026-02-08", false);

  const bal = pivo2(amb);
  assert.equal(bal.length, 20);
  const def = (d: string) => Number(bal.find((l) => l["Data"] === d)!["Déficit (mm)"]);
  for (const [d, esperado] of [["2026-01-20", 5.7], ["2026-01-29", 21.5], ["2026-02-08", 24.6]] as const)
    assert.ok(Math.abs(def(d) - esperado) <= 0.15, `${d}: ${def(d)}`);
  assert.equal(bal.find((l) => l["Data"] === "2026-01-21")!["Decisão"], "SEM DADOS");
  assert.equal(amb.aba("CLIMA").objetos().length, 20);

  const painel = amb.aba("PAINEL").dados;
  const linhaPivo = painel.find((l) => l[0] === "Pivô 2")!;
  assert.equal(linhaPivo[3], "IRRIGAR");
  assert.ok(Number(linhaPivo[7]) > 10 && Number(linhaPivo[7]) <= 100, `percentímetro ${linhaPivo[7]}`);

  assert.equal(amb.emails.length, 1);
  assert.equal(amb.emails[0]!.to, EMAIL);
  assert.match(amb.emails[0]!.subject, /Manejo 08\/02: irrigar 1 pivô/);
  assert.match(amb.emails[0]!.body, /IRRIGAR — repor 24,\d mm/);
  assert.doesNotMatch(amb.emails[0]!.body, /\*/);
  const rel = amb.pastaApp.pastas.find((p) => p.nome === "RELATORIOS")!;
  assert.equal(rel.getFilesByName("2026-02-08.txt").hasNext(), true);

  amb.chamar("calcularEEnviar_", "2026-02-08", false);
  assert.equal(amb.emails.length, 1, "não reenvia");
  amb.chamar("calcularEEnviar_", "2026-02-08", true);
  assert.equal(amb.emails.length, 2, "forçado reenvia");
  assert.equal(rel.arquivos.filter((f) => !f.lixeira).length, 1, "um arquivo por dia");
});

test("irrigação e medição lançadas nas abas (com data de célula) entram no balanço", () => {
  const amb = comLeiturasPivo2();
  amb.chamar("calcular_", "2026-02-08");
  const antes = Number(pivo2(amb).at(-1)!["Déficit (mm)"]);
  amb.aba("IRRIGACOES").appendRow([new Date("2026-02-08T12:00:00-03:00"), "pivô 2", 20, ""]);
  amb.chamar("calcular_", "2026-02-08");
  const depois = pivo2(amb).at(-1)!;
  assert.ok(Math.abs(antes - 20 - Number(depois["Déficit (mm)"])) < 1e-9);
  assert.equal(depois["Decisão"], "NÃO IRRIGAR");
  amb.aba("UMIDADE").appendRow(["08/02/2026", "Pivô 2", 29, "", "", "TDR"]);
  amb.chamar("calcular_", "2026-02-08");
  assert.equal(Number(pivo2(amb).at(-1)!["Déficit (mm)"]), 15);
});

test("cadastro com erro não calcula e explica o problema", () => {
  const amb = comLeiturasPivo2();
  amb.aba("PIVOS").set(2, 3, "girassol");
  assert.throws(() => amb.chamar("calcular_", "2026-02-08"), /Cadastro com problemas[\s\S]*girassol/);
});

test("cultura escrita com acento e maiúscula na planilha é reconhecida", () => {
  const amb = comLeiturasPivo2();
  amb.aba("PIVOS").set(2, 3, " Feijão  PD ");
  const r = amb.chamar("calcular_", "2026-02-08") as { itens: { pivo: { cultura: { nome: string } } }[] };
  assert.equal(r.itens[0]!.pivo.cultura.nome, "Feijão plantio direto");
});

test("relatório do gatilho sem chaves da Ecowitt ainda sai com o que tem, e o erro vai pro LOG", () => {
  const amb = comLeiturasPivo2();
  amb.agoraMs = deLocal("2026-02-08T18:20:00", "America/Sao_Paulo");
  amb.chamar("relatorioDiario");
  assert.equal(amb.emails.length, 1);
  const log = amb.aba("LOG").objetos();
  assert.ok(log.some((l) => l["Ação"] === "recuperar" && /Chaves da Ecowitt/.test(String(l["Detalhe"]))));
  assert.ok(log.some((l) => l["Ação"] === "e-mail" && l["Status"] === "enviado" && l["Dia do relatório"] === "2026-02-08"));
});

test("relatório que falha avisa por e-mail", () => {
  const amb = instalado(); // sem leituras
  amb.agoraMs = deLocal("2026-02-08T18:20:00", "America/Sao_Paulo");
  amb.chamar("relatorioDiario");
  assert.equal(amb.emails.length, 1);
  assert.match(amb.emails[0]!.subject, /relatório não saiu/);
  assert.match(amb.emails[0]!.body, /Nenhuma leitura/);
});

test("coleta ao vivo grava a leitura convertida e não duplica", async () => {
  const amb = instalado();
  amb.props.set("ECOWITT_APPLICATION_KEY", "app");
  amb.props.set("ECOWITT_API_KEY", "api");
  amb.props.set("ECOWITT_MAC", "AA:BB");
  const corpo = await fixture("ecowitt_tempo_real.json");
  amb.respostaHttp = () => ({ code: 200, corpo });
  amb.chamar("coletar");
  amb.chamar("coletar");
  const ls = amb.aba("LEITURAS").objetos();
  assert.equal(ls.length, 1);
  assert.equal(ls[0]!["Quando (hora local)"], "2026-01-21T15:00:00");
  assert.ok(Math.abs(Number(ls[0]!["Temp (°C)"]) - 24.389) < 1e-3);
  assert.match(amb.urls[0]!, /real_time\?application_key=app&api_key=api&mac=AA%3ABB/);
  assert.ok(amb.aba("LOG").objetos().some((l) => l["Status"] === "repetida"));
});

test("recuperação preenche o buraco pelo histórico e mantém a aba em ordem", async () => {
  const amb = instalado();
  for (const [k, v] of [["ECOWITT_APPLICATION_KEY", "a"], ["ECOWITT_API_KEY", "b"], ["ECOWITT_MAC", "c"]]) amb.props.set(k!, v!);
  // leituras ao vivo antes e depois de um buraco
  const leitura = (q: string) => ({ quando: q, chuvaAcumDia: 0, tempC: 22, urPct: 80, radWm2: 100, ventoMs: 2, intervaloMin: 10, fonte: "ecowitt" });
  amb.chamar("gravarLeituras_", [leitura("2026-09-30T08:00:00"), leitura("2026-09-30T08:10:00"), leitura("2026-09-30T12:00:00"), leitura("2026-09-30T12:10:00")]);
  const base = await fixture("ecowitt_historico_30min.json");
  amb.respostaHttp = (url) => {
    const ini = new URL(url).searchParams.get("start_date")!;
    const t0 = deLocal(ini.replace(" ", "T"), "America/Sao_Paulo") / 1000;
    const lista = (v: string) => Object.fromEntries(Array.from({ length: 48 }, (_, i) => [String(t0 + i * 1800), v]));
    return { code: 200, corpo: { ...base, data: { outdoor: { temperature: { unit: "℃", list: lista("25") } } } } };
  };
  amb.agoraMs = deLocal("2026-09-30T12:20:00", "America/Sao_Paulo");
  const r = amb.chamar<{ lacunas: number; gravadas: number; erros: string[] }>("recuperar_", "2026-09-30T08:00:00", "2026-09-30T12:10:00", Date.now());
  assert.equal(r.lacunas, 1);
  assert.equal(r.erros.length, 0);
  assert.ok(amb.urls.every((u) => u.includes("cycle_type=5min")));
  const qs = amb.aba("LEITURAS").objetos().map((l) => String(l["Quando (hora local)"]));
  assert.deepEqual(qs, [...qs].sort());
  const novas = qs.filter((q) => q > "2026-09-30T08:10:00" && q < "2026-09-30T12:00:00");
  assert.equal(novas.length, r.gravadas);
  assert.ok(novas.length >= 7, `recuperadas ${novas.length}`);
});

test("recuperação longa para antes do limite e agenda a continuação", () => {
  const amb = instalado();
  for (const [k, v] of [["ECOWITT_APPLICATION_KEY", "a"], ["ECOWITT_API_KEY", "b"], ["ECOWITT_MAC", "c"]]) amb.props.set(k!, v!);
  amb.agoraMs = deLocal("2026-10-08T10:00:00", "America/Sao_Paulo");
  let chamadas = 0;
  amb.respostaHttp = () => {
    chamadas++;
    if (chamadas === 3) amb.agoraMs! += 5 * 60 * 1000; // estoura o tempo na 3ª consulta
    return { code: 200, corpo: { code: 0, msg: "success", data: [] } };
  };
  amb.chamar("recuperarPeriodo", "2026-02-08", "2026-10-08");
  const estado = JSON.parse(amb.props.get("RECUPERACAO")!);
  assert.ok(estado.de > "2026-02-08T00:00:00" && estado.de < "2026-02-12", estado.de);
  assert.equal(amb.gatilhos.filter((g) => g.funcao === "continuarRecuperacao").length, 1);
  assert.equal(chamadas, 3);
});

test("importar METEO antigo converte °F e radiação em MJ por leitura", () => {
  const amb = instalado();
  const antiga = new (amb.aba("LOG").constructor as new (n: string) => import("./apps_script/fake.ts").FakeSheet)("METEO");
  antiga.dados = [
    ["DataHora", "Chuva_mm", "Temp_C", "UR_pct", "Radiacao_MJ", "Vento_m_s", "Fonte"],
    [new Date("2026-03-06T10:05:41-03:00"), 5.334, 19.11, 96, 0.09552, 4.69, "Ecowitt"],
    [new Date("2026-03-06T10:15:38-03:00"), 5.588, 66.2, 96, 812, 3.3, "Ecowitt"],
  ];
  (amb.ctx.SpreadsheetApp as Record<string, unknown>).openByUrl = () => ({ getSheetByName: () => antiga, getName: () => "MASTER" });
  assert.equal(amb.chamar("importarMeteo", "https://docs.google.com/spreadsheets/d/x/edit"), 2);
  const [a, b] = amb.aba("LEITURAS").objetos();
  assert.equal(a!["Quando (hora local)"], "2026-03-06T10:05:41");
  assert.ok(Math.abs(Number(a!["Radiação (W/m²)"]) - 159.2) < 1e-6);
  assert.ok(Math.abs(Number(b!["Temp (°C)"]) - 19) < 1e-9);
  assert.equal(Number(b!["Radiação (W/m²)"]), 812);
});

test("backup copia a planilha na pasta BACKUP e mantém só as 30 mais novas", () => {
  const amb = instalado();
  const backup = amb.pastaApp.pastas.find((p) => p.nome === "BACKUP")!;
  for (let d = 1; d <= 31; d++) backup.createFile(`MANEJO_IRRIGACAO_BACKUP_2026-08-${String(d).padStart(2, "0")}`, "");
  amb.agoraMs = deLocal("2026-10-08T04:00:00", "America/Sao_Paulo");
  amb.chamar("backupDiario");
  const vivos = backup.arquivos.filter((f) => !f.lixeira).map((f) => f.nome).sort();
  assert.equal(vivos.length, 30);
  assert.equal(vivos.at(-1), "MANEJO_IRRIGACAO_BACKUP_2026-10-08");
  assert.ok(!vivos.includes("MANEJO_IRRIGACAO_BACKUP_2026-08-02"));
});

test("coleta pelo menu mostra a leitura ou o erro na tela", async () => {
  const amb = instalado();
  amb.alertas.length = 0;
  amb.chamar("menuColetar");
  assert.match(amb.alertas.at(-1)!, /Não coletou[\s\S]*Chaves da Ecowitt não configuradas/);

  for (const [k, v] of [["ECOWITT_APPLICATION_KEY", "A1B2C3D4E5F6"], ["ECOWITT_API_KEY", "0000-uuid"], ["ECOWITT_MAC", "AA:BB"]]) amb.props.set(k!, v!);
  amb.respostaHttp = () => ({ code: 200, corpo: { code: 40010, msg: "Illegal Application_Key Parameter", data: [] } });
  amb.chamar("menuColetar");
  assert.match(amb.alertas.at(-1)!, /Illegal Application_Key/);

  const corpo = await fixture("ecowitt_tempo_real.json");
  amb.respostaHttp = () => ({ code: 200, corpo });
  amb.chamar("menuColetar");
  assert.match(amb.alertas.at(-1)!, /Leitura gravada[\s\S]*Temperatura: 24\.4 °C/);
  amb.chamar("menuColetar");
  assert.match(amb.alertas.at(-1)!, /não mandou leitura nova/);
});

test("teste de conexão mostra o que a Ecowitt mandou sem revelar as chaves", async () => {
  const amb = instalado();
  for (const [k, v] of [["ECOWITT_APPLICATION_KEY", "A1B2C3D4E5F60718"], ["ECOWITT_API_KEY", "0000aaaa-1111"], ["ECOWITT_MAC", "AA:BB"]]) amb.props.set(k!, v!);
  const corpo = await fixture("ecowitt_tempo_real.json");
  amb.respostaHttp = () => ({ code: 200, corpo });
  const linhas = amb.chamar<string[]>("testarEcowitt").join("\n");
  assert.match(linhas, /code 0 — success/);
  assert.match(linhas, /outdoor\.temperature: 75\.9 ºF/);
  assert.match(linhas, /rainfall\.daily: 0\.20 in/);
  assert.doesNotMatch(linhas, /0718|1111/);
  assert.match(linhas, /A1B2…18 \(16 caracteres\)/);

  amb.respostaHttp = () => ({ code: 200, corpo: { code: 0, msg: "success", data: [] } });
  assert.match(amb.chamar<string[]>("testarEcowitt").join("\n"), /lista vazia/);
});

test("chaves: limpa invisíveis, desfaz troca e o teste aponta formato errado", () => {
  const amb = instalado();
  const APP = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
  const API = "0000aaaa-1111-4222-8333-444455556666";
  const g = amb.chamar<{ trocadas: boolean }>("guardarChaves_", ` ${API}​\n`, `${APP} `, "aa:bb:cc:dd:ee:ff ");
  assert.equal(g.trocadas, true);
  assert.equal(amb.props.get("ECOWITT_APPLICATION_KEY"), APP);
  assert.equal(amb.props.get("ECOWITT_API_KEY"), API);
  assert.equal(amb.props.get("ECOWITT_MAC"), "AA:BB:CC:DD:EE:FF");

  amb.props.set("ECOWITT_APPLICATION_KEY", API + "​");
  amb.respostaHttp = (url) => {
    assert.ok(!url.includes("%E2%80%8B"), "não manda caractere invisível");
    return { code: 200, corpo: { code: 40010, msg: "Invalid application Key", data: [] } };
  };
  const t = amb.chamar<string[]>("testarEcowitt").join("\n");
  assert.match(t, /Application Key: 0000…66 \(36 caracteres, tinha 1 caractere\(s\) invisível\(is\)\) — PARECE A OUTRA CHAVE/);
  assert.match(t, /API Key: 0000…66 \(36 caracteres\) — formato OK/);
  assert.match(t, /code 40010 — Invalid application Key/);
});

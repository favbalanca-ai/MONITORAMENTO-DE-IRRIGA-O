import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco, type Banco } from "../src/banco/banco.ts";
import {
  carregarCadastro, lancarAjuste, lancarIrrigacao, listarPivos, pivoPorNome, validarCadastro, type CadastroFazenda,
} from "../src/banco/fazenda.ts";
import { RepositorioSqlite } from "../src/banco/leituras.ts";
import { deLocal } from "../src/coletor/tempo.ts";
import { tarefasDoMinuto } from "../src/job/agenda.ts";
import { rodarDiario, ultimoDiaFechado } from "../src/job/diario.ts";
import { NotificadorArquivo, type Notificador } from "../src/job/notificadores.ts";
import { climaCompleto, type Leitura } from "../src/motor/index.ts";
import { leiturasMeteoCorrigido } from "./pivo2_exemplo.ts";

const cadastroExemplo = async (): Promise<CadastroFazenda> =>
  JSON.parse(await readFile(new URL("../config/fazenda.exemplo.json", import.meta.url), "utf8"));

async function bancoComPivo2(): Promise<Banco> {
  const db = abrirBanco(":memory:");
  carregarCadastro(db, await cadastroExemplo());
  await new RepositorioSqlite(db).salvar(leiturasMeteoCorrigido());
  return db;
}

class NotificadorMemoria implements Notificador {
  readonly canal: string;
  enviados: string[] = [];
  falhar = false;
  constructor(canal = "memoria") {
    this.canal = canal;
  }
  async enviar(_d: string, _a: string, texto: string) {
    if (this.falhar) throw new Error("SMTP fora do ar");
    this.enviados.push(texto);
  }
}

// Déficits da seção 7 (calculados lá com o clima já arredondado do JSON).
const DEFICIT_SECAO7: Record<string, number> = {
  "2026-01-20": 5.7, "2026-01-25": 2.2, "2026-01-26": 6.0, "2026-01-29": 21.5, "2026-02-02": 25.3,
  "2026-02-03": 17.9, "2026-02-06": 25.1, "2026-02-08": 24.6,
};

test("cadastro de exemplo é válido e erros vêm em português", async () => {
  const c = await cadastroExemplo();
  assert.deepEqual(validarCadastro(c), []);
  const ruim = structuredClone(c);
  ruim.pivos[0]!.cultura = "algodão";
  ruim.pivos[0]!.solo.pmp = 40;
  ruim.estacao.fuso = "Brasil/Goias";
  const erros = validarCadastro(ruim);
  assert.equal(erros.length, 3, erros.join("\n"));
  assert.throws(() => carregarCadastro(abrirBanco(":memory:"), ruim), /Cadastro com problemas/);
});

test("cadastro atualiza pelo nome e o pivô volta igual do banco", async () => {
  const db = abrirBanco(":memory:");
  const c = await cadastroExemplo();
  carregarCadastro(db, c);
  carregarCadastro(db, { ...c, pivos: [{ ...c.pivos[0]!, laminaMinimaMm: 8 }] });
  const ps = listarPivos(db);
  assert.equal(ps.length, 1);
  assert.equal(ps[0]!.laminaMinimaMm, 8);
  assert.deepEqual(ps[0]!.equipamento, c.pivos[0]!.equipamento);
  assert.equal(pivoPorNome(db, "pivô 2").id, ps[0]!.id);
  assert.throws(() => pivoPorNome(db, "Pivô 9"), /não encontrado.*Pivô 2/);
});

test("repositório SQLite não duplica leituras e devolve em ordem", async () => {
  const repo = new RepositorioSqlite(abrirBanco(":memory:"));
  const l = (quando: string): Leitura => ({ quando, chuvaAcumDia: 0, tempC: 20, urPct: 80, radWm2: 1, ventoMs: 1, intervaloMin: 10, fonte: "t" });
  assert.equal(await repo.salvar([l("2026-01-01T10:10:00"), l("2026-01-01T10:00:00")]), 2);
  assert.equal(await repo.salvar([l("2026-01-01T10:00:00")]), 0);
  assert.deepEqual((await repo.intervalo("2026-01-01T00:00:00", "2026-01-02T00:00:00")).map((x) => x.quando), ["2026-01-01T10:00:00", "2026-01-01T10:10:00"]);
  assert.equal((await repo.ultima())!.quando, "2026-01-01T10:10:00");
});

test("job do dia, a partir das leituras brutas, reproduz a seção 7 e grava o balanço", async () => {
  const db = await bancoComPivo2();
  const n = new NotificadorMemoria();
  const r = await rodarDiario(db, { data: "2026-02-08", notificadores: [n] });

  const linhas = db.prepare("SELECT data, deficit, decisao FROM balanco_diario ORDER BY data").all() as { data: string; deficit: number; decisao: string }[];
  assert.equal(linhas.length, 20);
  for (const [data, esperado] of Object.entries(DEFICIT_SECAO7)) {
    const l = linhas.find((x) => x.data === data)!;
    assert.ok(Math.abs(l.deficit - esperado) <= 0.15, `${data}: ${l.deficit.toFixed(2)} vs ${esperado}`);
  }
  assert.equal(linhas.find((x) => x.data === "2026-01-21")!.decisao, "SEM DADOS");
  assert.equal(r.itens[0]!.linha!.decisao, "IRRIGAR");

  const clima = db.prepare("SELECT COUNT(*) AS n FROM clima_diario").get() as { n: number };
  assert.equal(clima.n, 20);
  assert.equal(n.enviados.length, 1);
  assert.match(n.enviados[0]!, /Pivô 2\* — Soja R3, 75 DAS/);
  assert.match(n.enviados[0]!, /IRRIGAR\* — repor 24,\d mm/);
  assert.match(n.enviados[0]!, /Percentímetro \*\d+%\*/);
});

test("job não reenvia no mesmo dia, mas reenvia com --forcar e tenta de novo canal que falhou", async () => {
  const db = await bancoComPivo2();
  const ok = new NotificadorMemoria("ok");
  const ruim = new NotificadorMemoria("ruim");
  ruim.falhar = true;
  const r1 = await rodarDiario(db, { data: "2026-02-08", notificadores: [ok, ruim] });
  assert.deepEqual(r1.envios.map((e) => e.status), ["enviado", "erro"]);
  ruim.falhar = false;
  const r2 = await rodarDiario(db, { data: "2026-02-08", notificadores: [ok, ruim] });
  assert.deepEqual(r2.envios.map((e) => e.status), ["já enviado", "enviado"]);
  const r3 = await rodarDiario(db, { data: "2026-02-08", notificadores: [ok], forcar: true });
  assert.deepEqual(r3.envios.map((e) => e.status), ["enviado"]);
  assert.equal(ok.enviados.length, 2);
});

test("irrigação e medição lançadas entram no balanço do job", async () => {
  const db = await bancoComPivo2();
  const p = pivoPorNome(db, "Pivô 2");
  const antes = (await rodarDiario(db, { data: "2026-02-08" })).itens[0]!.linha!.deficit;
  lancarIrrigacao(db, p.id, { data: "2026-02-08", mm: 20 });
  const depois = (await rodarDiario(db, { data: "2026-02-08" })).itens[0]!.linha!;
  assert.ok(Math.abs(antes - 20 - depois.deficit) < 1e-9);
  assert.equal(depois.decisao, "NÃO IRRIGAR");
  lancarAjuste(db, p.id, { data: "2026-02-08", umidadeRaizPct: 29 });
  assert.equal((await rodarDiario(db, { data: "2026-02-08" })).itens[0]!.linha!.deficit, 15);
});

test("dia sem nenhuma leitura usa o clima do dia anterior, chuva zero e sai SEM DADOS", async () => {
  const leituras = leiturasMeteoCorrigido();
  const dias = climaCompleto(leituras, "2026-02-07", "2026-02-10");
  assert.equal(dias.length, 4);
  const [, d8, d9, d10] = dias;
  assert.equal(d9!.n, 0);
  assert.equal(d9!.chuva, 0);
  assert.equal(d9!.tmax, d8!.tmax);
  assert.deepEqual(d9!.estimados, ["tmax", "tmin", "tmed", "ur", "vento", "rad"]);
  assert.equal(d10!.n, 0);

  const db = await bancoComPivo2();
  const r = await rodarDiario(db, { data: "2026-02-10" });
  assert.equal(r.itens[0]!.linha!.decisao, "SEM DADOS");
  assert.match(r.texto, /SEM DADOS/);
  assert.match(r.texto, /Estação sem dado de/);
});

test("dia padrão do relatório: antes das 18h é ontem, depois é hoje", async () => {
  assert.equal(ultimoDiaFechado("2026-10-08T17:59:59"), "2026-10-07");
  assert.equal(ultimoDiaFechado("2026-10-08T18:10:00"), "2026-10-08");
  const db = await bancoComPivo2();
  const r = await rodarDiario(db, { agoraMs: deLocal("2026-02-09T09:00:00", "America/Sao_Paulo") });
  assert.equal(r.data, "2026-02-08");
});

test("relatório em arquivo", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "relatorios-"));
  try {
    const db = await bancoComPivo2();
    await rodarDiario(db, { data: "2026-02-08", notificadores: [new NotificadorArquivo(pasta)] });
    assert.match(await readFile(join(pasta, "2026-02-08.txt"), "utf8"), /^Manejo 08\/02: irrigar 1 pivô/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("agenda: coleta a cada 10 min, recuperação no :07, relatório a partir das 18:10 uma vez", () => {
  assert.deepEqual(tarefasDoMinuto("10:00", "18:10", false), ["coletar"]);
  assert.deepEqual(tarefasDoMinuto("10:07", "18:10", false), ["recuperar"]);
  assert.deepEqual(tarefasDoMinuto("10:03", "18:10", false), []);
  assert.deepEqual(tarefasDoMinuto("18:10", "18:10", false), ["coletar", "diario"]);
  assert.deepEqual(tarefasDoMinuto("21:43", "18:10", false), ["diario"]); // serviço voltou depois da hora
  assert.deepEqual(tarefasDoMinuto("21:43", "18:10", true), []);
});

test("banco em arquivo: migração roda uma vez e os dados persistem", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "banco-"));
  try {
    const caminho = join(pasta, "sub", "manejo.db");
    const db1 = abrirBanco(caminho);
    carregarCadastro(db1, await cadastroExemplo());
    db1.close();
    const db2 = abrirBanco(caminho);
    assert.equal(listarPivos(db2).length, 1);
    assert.equal((db2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    db2.close();
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

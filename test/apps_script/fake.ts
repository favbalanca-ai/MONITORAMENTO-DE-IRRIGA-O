/**
 * Imitação mínima do ambiente do Google Apps Script (planilha, Drive, e-mail, gatilhos...)
 * para rodar Motor.gs + Codigo.gs no Node e testar o fluxo inteiro.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { paraLocal } from "../../src/coletor/tempo.ts";

type Celula = unknown;

class FakeRange {
  readonly aba: FakeSheet;
  readonly r: number;
  readonly c: number;
  readonly nr: number;
  readonly nc: number;
  constructor(aba: FakeSheet, r: number, c: number, nr: number, nc: number) {
    this.aba = aba; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
  }
  getValues(): Celula[][] {
    const out: Celula[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const linha: Celula[] = [];
      for (let j = 0; j < this.nc; j++) linha.push(this.aba.dados[this.r - 1 + i]?.[this.c - 1 + j] ?? "");
      out.push(linha);
    }
    return out;
  }
  setValues(v: Celula[][]) {
    if (v.length !== this.nr || v.some((l) => l.length !== this.nc)) throw new Error(`setValues: tamanho ${v.length}x${v[0]?.length} ≠ ${this.nr}x${this.nc}`);
    v.forEach((l, i) => l.forEach((x, j) => this.aba.set(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x: Celula) { this.aba.set(this.r, this.c, x); return this; }
  getValue() { return this.aba.dados[this.r - 1]?.[this.c - 1] ?? ""; }
  sort({ column, ascending }: { column: number; ascending: boolean }) {
    const linhas = this.getValues();
    linhas.sort((a, b) => {
      const x = String(a[column - this.c]), y = String(b[column - this.c]);
      return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
    });
    this.setValues(linhas);
    return this;
  }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.aba.set(this.r + i, this.c + j, ""); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

export class FakeSheet {
  readonly nome: string;
  dados: Celula[][] = [];
  constructor(nome: string) { this.nome = nome; }
  set(r: number, c: number, x: Celula) {
    while (this.dados.length < r) this.dados.push([]);
    const linha = this.dados[r - 1]!;
    while (linha.length < c) linha.push("");
    linha[c - 1] = x;
  }
  getName() { return this.nome; }
  getLastRow() {
    for (let i = this.dados.length; i > 0; i--) if (this.dados[i - 1]!.some((x) => x !== "" && x !== null && x !== undefined)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.dados.map((l) => { let k = l.length; while (k > 0 && (l[k - 1] === "" || l[k - 1] == null)) k--; return k; })); }
  getRange(a: number | string, c = 1, nr = 1, nc = 1) {
    if (typeof a === "string") return new FakeRange(this, 1, 1, 0, 0); // só usado para formatar coluna inteira
    return new FakeRange(this, a, c, nr, nc);
  }
  appendRow(v: Celula[]) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
  clearContents() { this.dados = []; }
  deleteRows(ini: number, n: number) { this.dados.splice(ini - 1, n); }
  setFrozenRows() {}
  hideSheet() {}
  /** Linhas como objetos pelo cabeçalho (para os testes). */
  objetos(): Record<string, Celula>[] {
    const [cab, ...resto] = this.dados;
    return resto.map((l) => Object.fromEntries((cab ?? []).map((h, i) => [String(h), l[i] ?? ""])));
  }
}

class FakeFile {
  nome: string;
  conteudo: string;
  lixeira = false;
  readonly pai: FakeFolder;
  constructor(nome: string, conteudo: string, pai: FakeFolder) { this.nome = nome; this.conteudo = conteudo; this.pai = pai; }
  getName() { return this.nome; }
  setTrashed(v: boolean) { this.lixeira = v; }
  getParents() { return iterador([this.pai]); }
  makeCopy(nome: string, pasta: FakeFolder) { const f = new FakeFile(nome, this.conteudo, pasta); pasta.arquivos.push(f); return f; }
}

class FakeFolder {
  readonly nome: string;
  pastas: FakeFolder[] = [];
  arquivos: FakeFile[] = [];
  constructor(nome: string) { this.nome = nome; }
  getName() { return this.nome; }
  getFoldersByName(n: string) { return iterador(this.pastas.filter((p) => p.nome === n)); }
  createFolder(n: string) { const p = new FakeFolder(n); this.pastas.push(p); return p; }
  createFile(n: string, c: string) { const f = new FakeFile(n, c, this); this.arquivos.push(f); return f; }
  getFilesByName(n: string) { return iterador(this.arquivos.filter((f) => f.nome === n && !f.lixeira)); }
  getFiles() { return iterador(this.arquivos.filter((f) => !f.lixeira)); }
}

function iterador<T>(xs: T[]) {
  let i = 0;
  return { hasNext: () => i < xs.length, next: () => xs[i++]! };
}

/** Encadeia qualquer método (menu, construtor de gatilho...). */
function encadeavel(ao: (chamadas: [string, unknown[]][]) => unknown = () => undefined): unknown {
  const chamadas: [string, unknown[]][] = [];
  const p: unknown = new Proxy(() => {}, {
    get: (_t, nome: string) => (...args: unknown[]) => {
      chamadas.push([nome, args]);
      if (nome === "create" || nome === "addToUi") return ao(chamadas);
      return p;
    },
  });
  return p;
}

export interface Ambiente {
  ctx: vm.Context;
  abas: Map<string, FakeSheet>;
  emails: { to: string; subject: string; body: string }[];
  props: Map<string, string>;
  gatilhos: { funcao: string; chamadas: [string, unknown[]][] }[];
  raiz: FakeFolder;
  pastaApp: FakeFolder;
  urls: string[];
  alertas: string[];
  respostaHttp: (url: string) => { code: number; corpo: unknown };
  agoraMs: number | null;
  aba(nome: string): FakeSheet;
  chamar<T = unknown>(fn: string, ...args: unknown[]): T;
}

export function criarAmbiente(): Ambiente {
  const abas = new Map<string, FakeSheet>();
  const raiz = new FakeFolder("Meu Drive");
  const pastaApp = raiz.createFolder("MANEJO_IRRIGACAO_APP");
  const arquivoPlanilha = pastaApp.createFile("MANEJO_IRRIGACAO", "");
  const amb = {
    abas, raiz, pastaApp,
    emails: [] as Ambiente["emails"],
    props: new Map<string, string>(),
    gatilhos: [] as Ambiente["gatilhos"],
    urls: [] as string[],
    alertas: [] as string[],
    respostaHttp: (() => ({ code: 500, corpo: {} })) as Ambiente["respostaHttp"],
    agoraMs: null as number | null,
  } as Ambiente;

  const ss = {
    getSheetByName: (n: string) => abas.get(n) ?? null,
    insertSheet: (n: string) => { const s = new FakeSheet(n); abas.set(n, s); return s; },
    getId: () => "ID_PLANILHA",
    getName: () => "MANEJO_IRRIGACAO",
    setSpreadsheetTimeZone: () => {},
    getUi: () => ({
      alert: (t: string) => { amb.alertas.push(t); },
      createMenu: () => encadeavel(),
      prompt: () => { throw new Error("prompt não disponível no teste"); },
    }),
  };

  const DateReal = Date;
  class DateFake extends DateReal {
    constructor(...a: unknown[]) {
      if (a.length === 0 && amb.agoraMs !== null) super(amb.agoraMs);
      else super(...(a as [string]));
    }
    static now() { return amb.agoraMs ?? DateReal.now(); }
    static [Symbol.hasInstance](x: unknown) { return x instanceof DateReal; }
  }

  const globais = {
    console,
    Date: DateFake,
    SpreadsheetApp: { getActive: () => ss, getActiveSpreadsheet: () => ss, getUi: () => ss.getUi() },
    UrlFetchApp: {
      fetch: (url: string) => {
        amb.urls.push(url);
        const r = amb.respostaHttp(url);
        return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.corpo) };
      },
    },
    MailApp: { sendEmail: (m: Ambiente["emails"][number]) => { amb.emails.push(m); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => amb.props.get(k) ?? null,
        setProperty: (k: string, v: string) => { amb.props.set(k, v); },
        deleteProperty: (k: string) => { amb.props.delete(k); },
      }),
    },
    Utilities: {
      formatDate: (d: Date, fuso: string, fmt: string) => {
        const l = paraLocal(d.getTime(), fuso);
        if (fmt === "yyyy-MM-dd'T'HH:mm:ss") return l;
        if (fmt === "yyyy-MM-dd") return l.slice(0, 10);
        if (fmt === "yyyy") return l.slice(0, 4);
        throw new Error(`formato não suportado no fake: ${fmt}`);
      },
      sleep: () => {},
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => amb.gatilhos.map((g) => ({ getHandlerFunction: () => g.funcao, _g: g })),
      deleteTrigger: (t: { _g: Ambiente["gatilhos"][number] }) => { amb.gatilhos = amb.gatilhos.filter((g) => g !== t._g); },
      newTrigger: (funcao: string) => encadeavel((chamadas) => { amb.gatilhos.push({ funcao, chamadas: [...chamadas] }); }),
      getService: () => ({ getUrl: () => "https://script.google.com/macros/s/TESTE/exec" }),
    },
    HtmlService: {
      createHtmlOutputFromFile: (nome: string) => encadeavel(() => undefined) && { nome, ...Object.fromEntries(["setTitle", "addMetaTag"].map((m) => [m, function (this: unknown) { return this; }])) },
    },
    DriveApp: {
      getFileById: () => arquivoPlanilha,
      getRootFolder: () => raiz,
    },
  };
  const ctx = vm.createContext(globais);
  const codigo = ["Motor.gs", "Codigo.gs", "App.gs"].map((f) => readFileSync(new URL(`../../apps-script/${f}`, import.meta.url), "utf8")).join("\n");
  vm.runInContext(codigo, ctx, { filename: "apps-script" });
  amb.ctx = ctx;
  amb.aba = (n) => { const a = abas.get(n); if (!a) throw new Error(`aba ${n} não existe`); return a; };
  amb.chamar = (fn, ...args) => (ctx[fn] as (...a: unknown[]) => unknown)(...args) as never;
  return amb;
}

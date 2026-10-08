/**
 * Onde as leituras brutas ficam guardadas. Por enquanto em CSV, um arquivo por mês, até decidirmos
 * o banco (pergunta 2 da seção 10). Trocar o banco = escrever outra classe com a mesma interface.
 */
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { numero } from "../motor/unidades.ts";
import type { DataHoraLocal, Leitura } from "../motor/tipos.ts";

export interface RepositorioLeituras {
  /** Grava as leituras novas e ignora as que já existem no mesmo instante. Devolve quantas entraram. */
  salvar(leituras: Leitura[]): Promise<number>;
  /** Leituras com `ini <= quando <= fim`, em ordem. */
  intervalo(ini: DataHoraLocal, fim: DataHoraLocal): Promise<Leitura[]>;
  ultima(): Promise<Leitura | null>;
}

const COLUNAS = ["quando", "chuvaAcumDia", "tempC", "urPct", "radWm2", "ventoMs", "intervaloMin", "fonte"] as const;

const paraLinha = (l: Leitura): string =>
  COLUNAS.map((c) => (l[c] === null || l[c] === undefined ? "" : String(l[c]))).join(",");

function deLinha(linha: string): Leitura {
  const [quando, chuva, temp, ur, rad, vento, intervalo, fonte] = linha.split(",");
  return {
    quando: quando!,
    chuvaAcumDia: numero(chuva),
    tempC: numero(temp),
    urPct: numero(ur),
    radWm2: numero(rad),
    ventoMs: numero(vento),
    intervaloMin: numero(intervalo) ?? undefined,
    fonte: fonte || undefined,
  };
}

export class RepositorioCsv implements RepositorioLeituras {
  private readonly pasta: string;
  constructor(pasta: string) {
    this.pasta = pasta;
  }

  private arquivo(mes: string) {
    return join(this.pasta, `${mes}.csv`);
  }

  private async lerMes(mes: string): Promise<Leitura[]> {
    try {
      const txt = await readFile(this.arquivo(mes), "utf8");
      return txt.split("\n").slice(1).filter(Boolean).map(deLinha);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  private async meses(): Promise<string[]> {
    try {
      return (await readdir(this.pasta)).filter((f) => /^\d{4}-\d{2}\.csv$/.test(f)).map((f) => f.slice(0, 7)).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async salvar(leituras: Leitura[]): Promise<number> {
    const porMes = Map.groupBy(leituras, (l) => l.quando.slice(0, 7));
    let novas = 0;
    await mkdir(this.pasta, { recursive: true });
    for (const [mes, doMes] of porMes) {
      const existentes = await this.lerMes(mes);
      const vistos = new Set(existentes.map((l) => l.quando));
      const entrar = doMes.filter((l) => !vistos.has(l.quando) && vistos.add(l.quando));
      if (entrar.length === 0) continue;
      const todas = [...existentes, ...entrar].sort((a, b) => (a.quando < b.quando ? -1 : 1));
      const tmp = this.arquivo(mes) + ".tmp";
      await writeFile(tmp, [COLUNAS.join(","), ...todas.map(paraLinha)].join("\n") + "\n");
      await rename(tmp, this.arquivo(mes)); // troca atômica: não corrompe se cair no meio
      novas += entrar.length;
    }
    return novas;
  }

  async intervalo(ini: DataHoraLocal, fim: DataHoraLocal): Promise<Leitura[]> {
    const meses = (await this.meses()).filter((m) => m >= ini.slice(0, 7) && m <= fim.slice(0, 7));
    const todas = (await Promise.all(meses.map((m) => this.lerMes(m)))).flat();
    return todas.filter((l) => l.quando >= ini && l.quando <= fim);
  }

  async ultima(): Promise<Leitura | null> {
    const meses = await this.meses();
    for (const m of meses.reverse()) {
      const ls = await this.lerMes(m);
      if (ls.length) return ls.at(-1)!;
    }
    return null;
  }
}

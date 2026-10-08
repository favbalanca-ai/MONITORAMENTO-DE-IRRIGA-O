import type { RepositorioLeituras } from "../coletor/repositorio.ts";
import type { DataHoraLocal, Leitura } from "../motor/tipos.ts";
import { transacao, type Banco } from "./banco.ts";

type Linha = {
  quando: string; chuva_acum_dia: number | null; temp_c: number | null; ur_pct: number | null;
  rad_wm2: number | null; vento_ms: number | null; intervalo_min: number | null; fonte: string | null;
};

const deLinha = (r: Linha): Leitura => ({
  quando: r.quando,
  chuvaAcumDia: r.chuva_acum_dia,
  tempC: r.temp_c,
  urPct: r.ur_pct,
  radWm2: r.rad_wm2,
  ventoMs: r.vento_ms,
  intervaloMin: r.intervalo_min ?? undefined,
  fonte: r.fonte ?? undefined,
});

/** Leituras brutas no SQLite. Mesma interface do CSV: o coletor não muda. */
export class RepositorioSqlite implements RepositorioLeituras {
  private readonly db: Banco;
  constructor(db: Banco) {
    this.db = db;
  }

  async salvar(leituras: Leitura[]): Promise<number> {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO leituras (quando, chuva_acum_dia, temp_c, ur_pct, rad_wm2, vento_ms, intervalo_min, fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return transacao(this.db, () => {
      let n = 0;
      for (const l of leituras) {
        n += Number(
          ins.run(l.quando, l.chuvaAcumDia, l.tempC, l.urPct, l.radWm2, l.ventoMs, l.intervaloMin ?? null, l.fonte ?? null).changes,
        );
      }
      return n;
    });
  }

  async intervalo(ini: DataHoraLocal, fim: DataHoraLocal): Promise<Leitura[]> {
    const rs = this.db.prepare("SELECT * FROM leituras WHERE quando BETWEEN ? AND ? ORDER BY quando").all(ini, fim);
    return (rs as unknown as Linha[]).map(deLinha);
  }

  async ultima(): Promise<Leitura | null> {
    const r = this.db.prepare("SELECT * FROM leituras ORDER BY quando DESC LIMIT 1").get();
    return r ? deLinha(r as unknown as Linha) : null;
  }
}

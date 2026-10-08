/**
 * Banco SQLite (node:sqlite, embutido no Node — nada para instalar). Um arquivo só, fácil de
 * copiar como backup. As migrações rodam sozinhas ao abrir, controladas por PRAGMA user_version.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Banco = DatabaseSync;

const MIGRACOES: string[] = [
  `
  CREATE TABLE estacao (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    latitude           REAL NOT NULL,
    altitude           REAL NOT NULL,
    altura_anemometro  REAL NOT NULL,
    fuso               TEXT NOT NULL
  );

  CREATE TABLE leituras (
    quando          TEXT PRIMARY KEY,          -- hora local da estação, YYYY-MM-DDTHH:MM:SS
    chuva_acum_dia  REAL,
    temp_c          REAL,
    ur_pct          REAL,
    rad_wm2         REAL,
    vento_ms        REAL,
    intervalo_min   REAL,
    fonte           TEXT
  ) WITHOUT ROWID;

  CREATE TABLE pivos (
    id                 INTEGER PRIMARY KEY,
    nome               TEXT NOT NULL UNIQUE,
    ativo              INTEGER NOT NULL DEFAULT 1,
    cultura            TEXT NOT NULL,           -- chave do catálogo de culturas (ex.: "soja")
    plantio            TEXT NOT NULL,
    inicio_balanco     TEXT,                    -- data em que vale a umidade inicial (padrão: plantio)
    palhada            INTEGER NOT NULL,
    umidade_inicial    REAL NOT NULL,
    cc                 REAL NOT NULL,
    pmp                REAL NOT NULL,
    raiz_ini_cm        REAL NOT NULL,
    raiz_max_cm        REAL NOT NULL,
    dias_raiz          REAL NOT NULL,
    fator_fixo         REAL,                    -- NULL = fator variável pela ET₀
    lamina_min_mm      REAL NOT NULL,
    tensao_irrigar_kpa REAL NOT NULL,
    equipamento        TEXT                     -- JSON com o tipo Equipamento, ou NULL
  );

  CREATE TABLE irrigacoes (
    id       INTEGER PRIMARY KEY,
    pivo_id  INTEGER NOT NULL REFERENCES pivos(id) ON DELETE CASCADE,
    data     TEXT NOT NULL,
    mm       REAL NOT NULL CHECK (mm >= 0)
  );
  CREATE INDEX irrigacoes_pivo_data ON irrigacoes(pivo_id, data);

  CREATE TABLE ajustes_umidade (
    id                INTEGER PRIMARY KEY,
    pivo_id           INTEGER NOT NULL REFERENCES pivos(id) ON DELETE CASCADE,
    data              TEXT NOT NULL,
    fonte             TEXT,
    umidade_raiz      REAL NOT NULL,
    umidade_profunda  REAL,
    tensao_kpa        REAL,
    UNIQUE (pivo_id, data)
  );

  CREATE TABLE safras (
    id                   INTEGER PRIMARY KEY,
    pivo_id              INTEGER NOT NULL REFERENCES pivos(id) ON DELETE CASCADE,
    nome                 TEXT NOT NULL,
    cultura              TEXT NOT NULL,
    plantio              TEXT NOT NULL,
    colheita             TEXT,
    produtividade        REAL,
    irrigacao_total_mm   REAL,
    chuva_total_mm       REAL
  );

  CREATE TABLE clima_diario (
    data       TEXT PRIMARY KEY,
    tmax REAL, tmin REAL, tmed REAL, ur REAL, vento REAL, rad REAL, chuva REAL,
    n          INTEGER NOT NULL,
    estimados  TEXT,
    et0        REAL,
    et0_hs     REAL
  ) WITHOUT ROWID;

  CREATE TABLE balanco_diario (
    pivo_id        INTEGER NOT NULL REFERENCES pivos(id) ON DELETE CASCADE,
    data           TEXT NOT NULL,
    das            INTEGER, estadio TEXT, kc REAL,
    et0 REAL, etc REAL, chuva REAL, irrigacao REAL,
    raiz_cm REAL, cad_mm REAL, fator REAL, afd_mm REAL,
    deficit        REAL NOT NULL,
    ajustado       INTEGER NOT NULL,
    decisao        TEXT NOT NULL,
    recomendacao   TEXT,                        -- JSON
    alertas        TEXT NOT NULL,               -- JSON (lista)
    calculado_em   TEXT NOT NULL,
    PRIMARY KEY (pivo_id, data)
  ) WITHOUT ROWID;

  CREATE TABLE envios (
    id         INTEGER PRIMARY KEY,
    data       TEXT NOT NULL,                   -- dia do relatório
    canal      TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    erro       TEXT,
    texto      TEXT NOT NULL,
    enviado_em TEXT NOT NULL
  );
  CREATE INDEX envios_data_canal ON envios(data, canal);
  `,
];

export function abrirBanco(caminho: string): Banco {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const { user_version: versao } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = versao; v < MIGRACOES.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRACOES[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

/** Roda `fn` numa transação. */
export function transacao<T>(db: Banco, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

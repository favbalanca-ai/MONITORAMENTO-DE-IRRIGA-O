/**
 * Cadastro da fazenda (estação e pivôs), lançamentos (irrigações e medições de umidade) e
 * resultados (clima e balanço diários, envios).
 */
import { CULTURAS } from "../motor/cultura.ts";
import type { LinhaBalanco } from "../motor/balanco.ts";
import type {
  AjusteUmidade, DataISO, DiaClima, Equipamento, Estacao, Irrigacao, Pivo, Solo,
} from "../motor/tipos.ts";
import { transacao, type Banco } from "./banco.ts";

export interface EstacaoCadastro extends Estacao {
  fuso: string;
}

/** Pivô como vem do arquivo de cadastro: a cultura é uma chave do catálogo. */
export interface PivoCadastro {
  nome: string;
  ativo?: boolean;
  cultura: string;
  plantio: DataISO;
  inicioBalanco?: DataISO;
  plantioDiretoPalhada: boolean;
  umidadeInicialPct: number;
  solo: Solo;
  laminaMinimaMm: number;
  tensaoIrrigarKpa: number;
  equipamento?: Equipamento;
}

export interface CadastroFazenda {
  estacao: EstacaoCadastro;
  pivos: PivoCadastro[];
}

export interface PivoSalvo extends Pivo {
  id: number;
  ativo: boolean;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o cadastro e devolve a lista de problemas (vazia = ok). */
export function validarCadastro(c: CadastroFazenda): string[] {
  const erros: string[] = [];
  const num = (v: unknown, onde: string, min = -Infinity, max = Infinity) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) erros.push(`${onde}: número inválido (${v})`);
  };
  num(c.estacao?.latitude, "estacao.latitude", -90, 90);
  num(c.estacao?.altitude, "estacao.altitude", -500, 6000);
  num(c.estacao?.alturaAnemometro, "estacao.alturaAnemometro", 0.5, 20);
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: c.estacao?.fuso });
  } catch {
    erros.push(`estacao.fuso: fuso desconhecido (${c.estacao?.fuso})`);
  }
  const nomes = new Set<string>();
  (c.pivos ?? []).forEach((p, i) => {
    const o = `pivos[${i}] (${p.nome})`;
    if (!p.nome) erros.push(`pivos[${i}]: falta o nome`);
    if (nomes.has(p.nome)) erros.push(`${o}: nome repetido`);
    nomes.add(p.nome);
    if (!CULTURAS[p.cultura]) erros.push(`${o}: cultura "${p.cultura}" não cadastrada (há: ${Object.keys(CULTURAS).join(", ")})`);
    if (!DATA.test(p.plantio ?? "")) erros.push(`${o}: plantio deve ser AAAA-MM-DD`);
    if (p.inicioBalanco !== undefined && !DATA.test(p.inicioBalanco)) erros.push(`${o}: inicioBalanco deve ser AAAA-MM-DD`);
    num(p.umidadeInicialPct, `${o}.umidadeInicialPct`, 0, 100);
    num(p.solo?.cc, `${o}.solo.cc`, 0, 100);
    num(p.solo?.pmp, `${o}.solo.pmp`, 0, 100);
    if (p.solo && p.solo.pmp >= p.solo.cc) erros.push(`${o}: PMP precisa ser menor que a CC`);
    num(p.solo?.raizIniCm, `${o}.solo.raizIniCm`, 0, 300);
    num(p.solo?.raizMaxCm, `${o}.solo.raizMaxCm`, 0, 300);
    num(p.solo?.diasRaiz, `${o}.solo.diasRaiz`, 1, 400);
    if (p.solo?.fatorDeplecaoFixo != null) num(p.solo.fatorDeplecaoFixo, `${o}.solo.fatorDeplecaoFixo`, 0.05, 1);
    num(p.laminaMinimaMm, `${o}.laminaMinimaMm`, 0, 100);
    num(p.tensaoIrrigarKpa, `${o}.tensaoIrrigarKpa`, -1500, 0);
    if (p.equipamento) {
      const e = p.equipamento;
      num(e.raioM, `${o}.equipamento.raioM`, 1);
      num(e.anguloGraus, `${o}.equipamento.anguloGraus`, 1, 360);
      num(e.vazaoM3h, `${o}.equipamento.vazaoM3h`, 0.1);
      num(e.velocidadeUltimaTorreMMin, `${o}.equipamento.velocidadeUltimaTorreMMin`, 0.01);
      num(e.percentimetroMinPct, `${o}.equipamento.percentimetroMinPct`, 1, 100);
      num(e.eficienciaPct, `${o}.equipamento.eficienciaPct`, 1, 100);
      num(e.potenciaKw, `${o}.equipamento.potenciaKw`, 0);
      num(e.tarifaRsKwh, `${o}.equipamento.tarifaRsKwh`, 0);
    }
  });
  return erros;
}

/** Grava estação e pivôs (atualiza pelo nome). Pivôs que não estão no arquivo ficam como estão. */
export function carregarCadastro(db: Banco, c: CadastroFazenda): void {
  const erros = validarCadastro(c);
  if (erros.length) throw new Error(`Cadastro com problemas:\n- ${erros.join("\n- ")}`);
  transacao(db, () => {
    const e = c.estacao;
    db.prepare(
      `INSERT INTO estacao (id, latitude, altitude, altura_anemometro, fuso) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude, altitude=excluded.altitude,
         altura_anemometro=excluded.altura_anemometro, fuso=excluded.fuso`,
    ).run(e.latitude, e.altitude, e.alturaAnemometro, e.fuso);
    const up = db.prepare(
      `INSERT INTO pivos (nome, ativo, cultura, plantio, inicio_balanco, palhada, umidade_inicial, cc, pmp,
         raiz_ini_cm, raiz_max_cm, dias_raiz, fator_fixo, lamina_min_mm, tensao_irrigar_kpa, equipamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(nome) DO UPDATE SET ativo=excluded.ativo, cultura=excluded.cultura, plantio=excluded.plantio,
         inicio_balanco=excluded.inicio_balanco, palhada=excluded.palhada, umidade_inicial=excluded.umidade_inicial,
         cc=excluded.cc, pmp=excluded.pmp, raiz_ini_cm=excluded.raiz_ini_cm, raiz_max_cm=excluded.raiz_max_cm,
         dias_raiz=excluded.dias_raiz, fator_fixo=excluded.fator_fixo, lamina_min_mm=excluded.lamina_min_mm,
         tensao_irrigar_kpa=excluded.tensao_irrigar_kpa, equipamento=excluded.equipamento`,
    );
    for (const p of c.pivos) {
      up.run(
        p.nome, p.ativo === false ? 0 : 1, p.cultura, p.plantio, p.inicioBalanco ?? null, p.plantioDiretoPalhada ? 1 : 0,
        p.umidadeInicialPct, p.solo.cc, p.solo.pmp, p.solo.raizIniCm, p.solo.raizMaxCm, p.solo.diasRaiz,
        p.solo.fatorDeplecaoFixo ?? null, p.laminaMinimaMm, p.tensaoIrrigarKpa,
        p.equipamento ? JSON.stringify(p.equipamento) : null,
      );
    }
  });
}

export function lerEstacao(db: Banco): EstacaoCadastro | null {
  const r = db.prepare("SELECT * FROM estacao WHERE id = 1").get() as
    | { latitude: number; altitude: number; altura_anemometro: number; fuso: string }
    | undefined;
  return r ? { latitude: r.latitude, altitude: r.altitude, alturaAnemometro: r.altura_anemometro, fuso: r.fuso } : null;
}

type LinhaPivo = {
  id: number; nome: string; ativo: number; cultura: string; plantio: string; inicio_balanco: string | null;
  palhada: number; umidade_inicial: number; cc: number; pmp: number; raiz_ini_cm: number; raiz_max_cm: number;
  dias_raiz: number; fator_fixo: number | null; lamina_min_mm: number; tensao_irrigar_kpa: number; equipamento: string | null;
};

function pivoDaLinha(r: LinhaPivo): PivoSalvo {
  const cultura = CULTURAS[r.cultura];
  if (!cultura) throw new Error(`Pivô ${r.nome}: cultura "${r.cultura}" não está no catálogo.`);
  return {
    id: r.id,
    ativo: r.ativo === 1,
    nome: r.nome,
    cultura,
    plantio: r.plantio,
    inicioBalanco: r.inicio_balanco ?? undefined,
    plantioDiretoPalhada: r.palhada === 1,
    umidadeInicialPct: r.umidade_inicial,
    solo: {
      cc: r.cc, pmp: r.pmp, raizIniCm: r.raiz_ini_cm, raizMaxCm: r.raiz_max_cm, diasRaiz: r.dias_raiz,
      fatorDeplecaoFixo: r.fator_fixo,
    },
    laminaMinimaMm: r.lamina_min_mm,
    tensaoIrrigarKpa: r.tensao_irrigar_kpa,
    equipamento: r.equipamento ? (JSON.parse(r.equipamento) as Equipamento) : undefined,
  };
}

export function listarPivos(db: Banco, { soAtivos = false } = {}): PivoSalvo[] {
  const rs = db.prepare(`SELECT * FROM pivos ${soAtivos ? "WHERE ativo = 1" : ""} ORDER BY nome`).all();
  return (rs as unknown as LinhaPivo[]).map(pivoDaLinha);
}

export function pivoPorNome(db: Banco, nome: string): PivoSalvo {
  const r = db.prepare("SELECT * FROM pivos WHERE nome = ? COLLATE NOCASE").get(nome);
  if (!r) {
    const existentes = listarPivos(db).map((p) => p.nome).join(", ") || "nenhum";
    throw new Error(`Pivô "${nome}" não encontrado (cadastrados: ${existentes}).`);
  }
  return pivoDaLinha(r as unknown as LinhaPivo);
}

export function lancarIrrigacao(db: Banco, pivoId: number, i: Irrigacao): void {
  if (!DATA.test(i.data)) throw new Error("Data deve ser AAAA-MM-DD.");
  if (!(i.mm >= 0)) throw new Error("Lâmina deve ser um número ≥ 0.");
  db.prepare("INSERT INTO irrigacoes (pivo_id, data, mm) VALUES (?, ?, ?)").run(pivoId, i.data, i.mm);
}

/** Uma medição por pivô por dia: lançar de novo no mesmo dia substitui. */
export function lancarAjuste(db: Banco, pivoId: number, a: AjusteUmidade): void {
  if (!DATA.test(a.data)) throw new Error("Data deve ser AAAA-MM-DD.");
  db.prepare(
    `INSERT INTO ajustes_umidade (pivo_id, data, fonte, umidade_raiz, umidade_profunda, tensao_kpa) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pivo_id, data) DO UPDATE SET fonte=excluded.fonte, umidade_raiz=excluded.umidade_raiz,
       umidade_profunda=excluded.umidade_profunda, tensao_kpa=excluded.tensao_kpa`,
  ).run(pivoId, a.data, a.fonte ?? null, a.umidadeRaizPct, a.umidadeProfundaPct ?? null, a.tensaoKpa ?? null);
}

export function irrigacoesDoPivo(db: Banco, pivoId: number): Irrigacao[] {
  return db.prepare("SELECT data, mm FROM irrigacoes WHERE pivo_id = ? ORDER BY data").all(pivoId) as unknown as Irrigacao[];
}

export function ajustesDoPivo(db: Banco, pivoId: number): AjusteUmidade[] {
  const rs = db.prepare("SELECT * FROM ajustes_umidade WHERE pivo_id = ? ORDER BY data").all(pivoId) as unknown as {
    data: string; fonte: string | null; umidade_raiz: number; umidade_profunda: number | null; tensao_kpa: number | null;
  }[];
  return rs.map((r) => ({
    data: r.data,
    fonte: r.fonte ?? undefined,
    umidadeRaizPct: r.umidade_raiz,
    umidadeProfundaPct: r.umidade_profunda ?? undefined,
    tensaoKpa: r.tensao_kpa ?? undefined,
  }));
}

export function salvarClima(db: Banco, dias: (DiaClima & { et0: number; et0Hs: number })[]): void {
  const up = db.prepare(
    `INSERT OR REPLACE INTO clima_diario (data, tmax, tmin, tmed, ur, vento, rad, chuva, n, estimados, et0, et0_hs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  transacao(db, () => {
    for (const d of dias)
      up.run(d.data, d.tmax, d.tmin, d.tmed, d.ur, d.vento, d.rad, d.chuva, d.n,
        d.estimados?.length ? d.estimados.join(",") : null, d.et0, d.et0Hs);
  });
}

/** Substitui o balanço do pivô pelas linhas recalculadas. */
export function salvarBalanco(db: Banco, pivoId: number, linhas: LinhaBalanco[], calculadoEm: string): void {
  const up = db.prepare(
    `INSERT OR REPLACE INTO balanco_diario (pivo_id, data, das, estadio, kc, et0, etc, chuva, irrigacao, raiz_cm, cad_mm,
       fator, afd_mm, deficit, ajustado, decisao, recomendacao, alertas, calculado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  transacao(db, () => {
    db.prepare("DELETE FROM balanco_diario WHERE pivo_id = ?").run(pivoId);
    for (const l of linhas)
      up.run(pivoId, l.data, l.das, l.estadio, l.kc, l.et0, l.etc, l.chuva, l.irrigacao, l.raizCm, l.cadMm, l.fatorDeplecao,
        l.afdMm, l.deficit, l.ajustado ? 1 : 0, l.decisao, l.recomendacao ? JSON.stringify(l.recomendacao) : null,
        JSON.stringify(l.alertas), calculadoEm);
  });
}

export function jaEnviado(db: Banco, data: DataISO, canal: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM envios WHERE data = ? AND canal = ? AND ok = 1 LIMIT 1").get(data, canal));
}

export function registrarEnvio(db: Banco, e: { data: DataISO; canal: string; ok: boolean; erro?: string; texto: string; em: string }): void {
  db.prepare("INSERT INTO envios (data, canal, ok, erro, texto, enviado_em) VALUES (?, ?, ?, ?, ?, ?)").run(
    e.data, e.canal, e.ok ? 1 : 0, e.erro ?? null, e.texto, e.em,
  );
}

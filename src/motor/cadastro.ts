/** Cadastro da fazenda (estação e pivôs) e sua validação — usado pelo banco e pela planilha. */
import { CULTURAS } from "./cultura.ts";
import type { DataISO, Equipamento, Estacao, Solo } from "./tipos.ts";

export interface EstacaoCadastro extends Estacao {
  fuso: string;
}

/** Pivô como vem do arquivo de cadastro: a cultura é uma chave do catálogo. */
export interface PivoCadastro {
  nome: string;
  ativo?: boolean;
  cultura: string;
  /** Ciclo da cultivar plantada (dias). Vazio = o padrão do catálogo. */
  cicloDias?: number | null;
  plantio: DataISO;
  inicioBalanco?: DataISO;
  plantioDiretoPalhada: boolean;
  umidadeInicialPct: number;
  solo: Solo;
  laminaMinimaMm: number;
  tensaoIrrigarKpa: number;
  equipamento?: Equipamento;
  /** Centro do pivô (graus decimais), para o mapa. */
  latitude?: number | null;
  longitude?: number | null;
  /** Contorno do pivô [[lat, lon], …] vindo do KMZ. */
  contorno?: [number, number][];
  /** Graus-dia da cultivar até a maturação. Vazio = estádio por dias corridos. */
  grausDiaCiclo?: number | null;
}

export interface CadastroFazenda {
  estacao: EstacaoCadastro;
  pivos: PivoCadastro[];
}

export const DATA = /^\d{4}-\d{2}-\d{2}$/;

function fusoValidoIntl(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Confere o cadastro e devolve a lista de problemas (vazia = ok). */
export function validarCadastro(c: CadastroFazenda, fusoValido: (fuso: string) => boolean = fusoValidoIntl): string[] {
  const erros: string[] = [];
  const num = (v: unknown, onde: string, min = -Infinity, max = Infinity) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) erros.push(`${onde}: número inválido (${v})`);
  };
  num(c.estacao?.latitude, "estacao.latitude", -90, 90);
  num(c.estacao?.altitude, "estacao.altitude", -500, 6000);
  num(c.estacao?.alturaAnemometro, "estacao.alturaAnemometro", 0.5, 20);
  if (!c.estacao?.fuso || !fusoValido(c.estacao.fuso)) erros.push(`estacao.fuso: fuso desconhecido (${c.estacao?.fuso})`);
  const nomes = new Set<string>();
  (c.pivos ?? []).forEach((p, i) => {
    const o = `pivos[${i}] (${p.nome})`;
    if (!p.nome) erros.push(`pivos[${i}]: falta o nome`);
    if (nomes.has(p.nome)) erros.push(`${o}: nome repetido`);
    nomes.add(p.nome);
    if (!CULTURAS[p.cultura]) erros.push(`${o}: cultura "${p.cultura}" não cadastrada (há: ${Object.keys(CULTURAS).join(", ")})`);
    if (p.cicloDias != null) num(p.cicloDias, `${o}.cicloDias`, 30, 400);
    if (p.grausDiaCiclo != null) num(p.grausDiaCiclo, `${o}.grausDiaCiclo`, 200, 6000);
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
    if (p.latitude != null) num(p.latitude, `${o}.latitude`, -90, 90);
    if (p.longitude != null) num(p.longitude, `${o}.longitude`, -180, 180);
    if ((p.latitude == null) !== (p.longitude == null)) erros.push(`${o}: latitude e longitude precisam vir juntas`);
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
      if (e.tarifaPontaRsKwh != null) num(e.tarifaPontaRsKwh, `${o}.equipamento.tarifaPontaRsKwh`, 0);
    }
  });
  return erros;
}

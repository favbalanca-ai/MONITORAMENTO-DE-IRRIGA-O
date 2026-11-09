/**
 * Sinais da estação: o saber local diz que vento vindo do oeste é indicativo de chuva, e a pressão caindo
 * também. Em vez de fixar um peso, a planilha anota todo dia o que a estação viu (de onde veio o vento,
 * quanto a pressão mudou) e se choveu nos 2 dias seguintes, e APRENDE quanto cada sinal muda a chance de
 * chuva nesta fazenda. O fator aprendido corrige a chance dos modelos (regra de Bayes nas chances).
 *
 * Sem histórico, vale um palpite moderado (oeste ×1,5 e pressão caindo ×1,3 nas chances); conforme os dias
 * acumulam, o dado da estação toma o lugar do palpite (com 40 dias o palpite já não pesa nada).
 */
import type { DataISO } from "./tipos.ts";
import type { DiaPrevisao } from "./previsao.ts";

/** Uma leitura da estação com o que interessa aqui. */
export interface LeituraSinal {
  /** Hora local, ISO (`AAAA-MM-DDTHH:MM`). */
  quando: string;
  ventoMs: number | null;
  direcaoGraus: number | null;
  pressaoHpa: number | null;
}

/** O que a estação viu num dia. */
export interface SinalDia {
  data: DataISO;
  /** % das leituras com vento (≥ 3 km/h) vindo do oeste (SW a NW). `null` sem leituras com direção. */
  oestePct: number | null;
  /** Setor predominante do dia (N, NNE, …) entre as leituras com vento. */
  direcao: string | null;
  pressaoMediaHpa: number | null;
  /** Pressão média de hoje menos a de ontem (hPa); negativo = caindo. */
  pressao24hHpa: number | null;
  /** Leituras com direção ou pressão. */
  leituras: number;
  /** Chuva somada dos 2 dias seguintes (mm), quando já se sabe. */
  chuvaDepoisMm: number | null;
}

export interface LimiaresSinais {
  /** % mínima do dia com vento de oeste para contar como "vento de oeste". */
  oesteMinPct: number;
  /** Queda mínima da pressão em 24 h (hPa, positivo) para contar como "pressão caindo". */
  quedaPressaoHpa: number;
  /** Chuva nos 2 dias seguintes que conta como "choveu" (mm). */
  chuvaContaMm: number;
}

export const LIMIARES_SINAIS: LimiaresSinais = { oesteMinPct: 40, quedaPressaoHpa: 2, chuvaContaMm: 1 };

/** O que a estação ensinou sobre um sinal. */
export interface AprendizadoSinal {
  /** Dias com o sinal presente e, desses, quantos tiveram chuva depois. */
  com: number;
  comChuva: number;
  /** Dias sem o sinal e, desses, quantos tiveram chuva depois. */
  sem: number;
  semChuva: number;
  /** % de dias com chuva depois, com e sem o sinal (null com menos de 3 dias). */
  chuvaComPct: number | null;
  chuvaSemPct: number | null;
  /** Fator aplicado às chances (odds) quando o sinal está presente. > 1 aumenta a chance. */
  fator: number;
}

export interface AprendizadoSinais {
  /** Dias com o resultado conhecido. */
  dias: number;
  /** % de dias com chuva nos 2 dias seguintes, no geral. */
  basePct: number | null;
  oeste: AprendizadoSinal;
  pressao: AprendizadoSinal;
  /** Quanto o dado pesa frente ao palpite inicial (0 a 1). */
  pesoDado: number;
  limiares: LimiaresSinais;
}

/** O ajuste feito num dia da previsão. */
export interface SinalAplicado {
  oeste: boolean;
  pressaoCai: boolean;
  fator: number;
  /** Chance dos modelos antes do ajuste. */
  probModelosPct: number | null;
}

const SETORES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
/** Oeste "com uma variação pequena": de sudoeste a noroeste (SW, WSW, W, WNW, NW). */
const OESTE = new Set(["SW", "WSW", "W", "WNW", "NW"]);
const PALPITE = { oeste: 1.5, pressao: 1.3 };
const DIAS_PARA_CONFIAR = 40;
const FATOR_MIN = 0.4, FATOR_MAX = 3;

const umaCasaSinal_ = (x: number) => Math.round(x * 10) / 10;

export function setorDoVento(graus: number): string {
  return SETORES[Math.round((((graus % 360) + 360) % 360) / 22.5) % 16]!;
}

/** Resume as leituras de um dia (e as de ontem, para a variação da pressão). */
export function sinalDoDia(data: DataISO, hoje: LeituraSinal[], ontem: LeituraSinal[] = []): SinalDia {
  const cont = new Array<number>(16).fill(0);
  let comVento = 0, oeste = 0, leituras = 0;
  const pressoes: number[] = [];
  for (const l of hoje) {
    const temDir = l.direcaoGraus !== null && Number.isFinite(l.direcaoGraus);
    const temP = l.pressaoHpa !== null && Number.isFinite(l.pressaoHpa);
    if (!temDir && !temP) continue;
    leituras++;
    if (temP) pressoes.push(l.pressaoHpa!);
    if (temDir && (l.ventoMs ?? 0) * 3.6 >= 3) {
      comVento++;
      const s = setorDoVento(l.direcaoGraus!);
      cont[SETORES.indexOf(s)]!++;
      if (OESTE.has(s)) oeste++;
    }
  }
  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const pHoje = media(pressoes);
  const pOntem = media(ontem.map((l) => l.pressaoHpa).filter((x): x is number => x !== null && Number.isFinite(x)));
  let idx = -1, maior = 0;
  cont.forEach((n, i) => { if (n > maior) { maior = n; idx = i; } });
  return {
    data,
    oestePct: comVento ? Math.round((100 * oeste) / comVento) : null,
    direcao: idx >= 0 ? SETORES[idx]! : null,
    pressaoMediaHpa: pHoje === null ? null : umaCasaSinal_(pHoje),
    pressao24hHpa: pHoje === null || pOntem === null ? null : umaCasaSinal_(pHoje - pOntem),
    leituras,
    chuvaDepoisMm: null,
  };
}

export function temOeste(s: SinalDia, lim: LimiaresSinais = LIMIARES_SINAIS): boolean | null {
  return s.oestePct === null ? null : s.oestePct >= lim.oesteMinPct;
}
export function temPressaoCaindo(s: SinalDia, lim: LimiaresSinais = LIMIARES_SINAIS): boolean | null {
  return s.pressao24hHpa === null ? null : s.pressao24hHpa <= -lim.quedaPressaoHpa;
}

function aprenderUm(hist: SinalDia[], presente: (s: SinalDia) => boolean | null, palpite: number, pesoDado: number, lim: LimiaresSinais): AprendizadoSinal {
  let com = 0, comChuva = 0, sem = 0, semChuva = 0;
  for (const s of hist) {
    const p = presente(s);
    if (p === null || s.chuvaDepoisMm === null) continue;
    const choveu = s.chuvaDepoisMm >= lim.chuvaContaMm;
    if (p) { com++; if (choveu) comChuva++; } else { sem++; if (choveu) semChuva++; }
  }
  // razão de verossimilhança P(sinal | chuva) / P(sinal | seca), suavizada (+1 em cada conta) para não explodir com poucos dias
  const chuva = comChuva + semChuva, seca = com + sem - chuva;
  const pSinalChuva = (comChuva + 1) / (chuva + 2), pSinalSeca = (com - comChuva + 1) / (seca + 2);
  const doDado = Math.min(FATOR_MAX, Math.max(FATOR_MIN, pSinalChuva / pSinalSeca));
  // mistura (em log) o palpite inicial com o que o dado diz, conforme o histórico cresce
  const fator = Math.exp((1 - pesoDado) * Math.log(palpite) + pesoDado * Math.log(doDado));
  return {
    com, comChuva, sem, semChuva,
    chuvaComPct: com >= 3 ? Math.round((100 * comChuva) / com) : null,
    chuvaSemPct: sem >= 3 ? Math.round((100 * semChuva) / sem) : null,
    fator: Math.round(fator * 100) / 100,
  };
}

/** Aprende com o histórico (dias com `chuvaDepoisMm` conhecido). */
export function aprenderSinais(hist: SinalDia[], lim: LimiaresSinais = LIMIARES_SINAIS): AprendizadoSinais {
  const validos = hist.filter((s) => s.chuvaDepoisMm !== null && (s.oestePct !== null || s.pressao24hHpa !== null));
  const pesoDado = Math.min(1, validos.length / DIAS_PARA_CONFIAR);
  const comChuva = validos.filter((s) => s.chuvaDepoisMm! >= lim.chuvaContaMm).length;
  return {
    dias: validos.length,
    basePct: validos.length >= 3 ? Math.round((100 * comChuva) / validos.length) : null,
    oeste: aprenderUm(validos, (s) => temOeste(s, lim), PALPITE.oeste, pesoDado, lim),
    pressao: aprenderUm(validos, (s) => temPressaoCaindo(s, lim), PALPITE.pressao, pesoDado, lim),
    pesoDado: Math.round(pesoDado * 100) / 100,
    limiares: lim,
  };
}

/** Preenche `chuvaDepoisMm` (chuva de D+1 e D+2) com o que a estação mediu. */
export function completarChuvaDepois(hist: SinalDia[], chuvaPorDia: Map<DataISO, number | null>, proximoDia: (d: DataISO, n: number) => DataISO): SinalDia[] {
  return hist.map((s) => {
    if (s.chuvaDepoisMm !== null) return s;
    const a = chuvaPorDia.get(proximoDia(s.data, 1)), b = chuvaPorDia.get(proximoDia(s.data, 2));
    if (a === undefined || a === null || b === undefined || b === null) return s;
    return { ...s, chuvaDepoisMm: umaCasaSinal_(a + b) };
  });
}

/**
 * Aplica o sinal de hoje à chance de amanhã e depois de amanhã. Só mexe na `probPct` (guarda a dos modelos em
 * `sinalEstacao.probModelosPct`); a chuva em mm dos modelos fica como está.
 */
export function aplicarSinais(dias: DiaPrevisao[], hojeSinal: SinalDia | null, ap: AprendizadoSinais, hoje: DataISO, proximoDia: (d: DataISO, n: number) => DataISO): DiaPrevisao[] {
  if (!hojeSinal) return dias;
  const oeste = temOeste(hojeSinal, ap.limiares) === true;
  const cai = temPressaoCaindo(hojeSinal, ap.limiares) === true;
  if (!oeste && !cai) return dias;
  const fator = (oeste ? ap.oeste.fator : 1) * (cai ? ap.pressao.fator : 1);
  const alvos = new Set([proximoDia(hoje, 1), proximoDia(hoje, 2)]);
  return dias.map((d) => {
    if (!alvos.has(d.data) || d.probPct === null || d.probPct === undefined) return d;
    const p = Math.min(0.98, Math.max(0.02, d.probPct / 100));
    const odds = (p / (1 - p)) * fator;
    const novo = Math.round((100 * odds) / (1 + odds));
    const aplicado: SinalAplicado = { oeste, pressaoCai: cai, fator: Math.round(fator * 100) / 100, probModelosPct: d.probPct };
    return { ...d, probPct: novo, sinalEstacao: aplicado };
  });
}

/** Frase curta do sinal de hoje: "vento de oeste (62% do dia) · pressão −3,1 hPa em 24 h". Vazia sem sinal. */
export function textoSinalHoje(s: SinalDia | null, lim: LimiaresSinais = LIMIARES_SINAIS): string {
  if (!s) return "";
  const partes: string[] = [];
  if (temOeste(s, lim)) partes.push(`vento de oeste (${s.oestePct}% do dia)`);
  if (temPressaoCaindo(s, lim)) partes.push(`pressão ${String(s.pressao24hHpa).replace(".", ",")} hPa em 24 h`);
  return partes.join(" · ");
}

/** O que a estação aprendeu, em uma frase. */
export function textoAprendizado(ap: AprendizadoSinais): string {
  if (ap.dias < 3) return "a estação ainda não tem dias suficientes para medir esses sinais";
  const um = (nome: string, a: AprendizadoSinal) =>
    a.chuvaComPct === null ? `${nome}: poucos dias com o sinal` : `${nome}: choveu nos 2 dias seguintes em ${a.chuvaComPct}% dos ${a.com} dias com o sinal` + (a.chuvaSemPct === null ? "" : ` (${a.chuvaSemPct}% sem ele)`);
  return `${ap.dias} dias medidos · ${um("vento de oeste", ap.oeste)} · ${um("pressão caindo", ap.pressao)}`;
}

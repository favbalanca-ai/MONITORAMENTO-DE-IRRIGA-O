import { das, fimDoCicloDas, fracaoCiclo, grausDiaDoDia, kcDoDia } from "./cultura.ts";
import { divergenciaHargreaves, et0Hargreaves, et0PenmanMonteith, LIMITE_DIVERGENCIA_HS } from "./et0.ts";
import { PONTA_PADRAO, recomendar, type Ponta, type Recomendacao } from "./equipamento.ts";
import type { DiaPrevisao } from "./previsao.ts";
import { cad, deficitDaUmidade, fatorDeplecao, profundidadeRaiz } from "./solo.ts";
import type { AjusteUmidade, DataISO, Decisao, DiaClima, Estacao, Irrigacao, Pivo } from "./tipos.ts";

/** Chuva abaixo disso fica na folha e evapora: não entra no balanço (Embrapa). Configurável na estação. */
export const CHUVA_MINIMA_EFETIVA_MM = 2;

/** Abaixo disso a janela não tem dados suficientes para decidir. */
export const MIN_LEITURAS = 100;
/** Radiação diária abaixo disso (MJ/m²) é suspeita de falha do sensor. */
export const RAD_SUSPEITA_MJ = 1;
/** Sem medição de umidade há mais que isso, o balanço começa a derivar. */
export const DIAS_MEDICAO_VELHA = 15;

export interface LinhaBalanco {
  data: DataISO;
  das: number;
  estadio: string;
  kc: number;
  et0: number;
  et0Hargreaves: number;
  etc: number;
  chuva: number;
  irrigacao: number;
  raizCm: number;
  cadMm: number;
  fatorDeplecao: number;
  afdMm: number;
  /** Déficit no fim do dia (mm). */
  deficit: number;
  /** O déficit do dia foi substituído por uma medição de umidade. */
  ajustado: boolean;
  leituras: number;
  decisao: Decisao;
  recomendacao?: Recomendacao;
  alertas: string[];
  /** Olhando pra frente com a ET₀ prevista (só na última linha). */
  projecao?: Projecao;
}

export interface Projecao {
  /** Primeiro dia em que o déficit (sem chuva) passa da lâmina mínima; null = não passa no horizonte. */
  proximaIrrigacao: DataISO | null;
  /** Dias até lá (0 = hoje já pede). */
  emDias: number | null;
  /** Déficit esperado quando a volta terminar, se ligar agora (mm). */
  deficitFimVoltaMm?: number;
  /** Déficit esperado dia a dia, sem contar chuva. */
  dias: { data: DataISO; deficit: number; et0: number; kc: number }[];
  /** Quantos dias do horizonte a previsão cobriu. */
  horizonte: number;
}

export interface EntradaBalanco {
  pivo: Pivo;
  estacao: Estacao;
  /** Dias consecutivos, em ordem. */
  dias: DiaClima[];
  irrigacoes?: Irrigacao[];
  ajustes?: AjusteUmidade[];
  /** Chuva do dia abaixo disso não conta (mm). Padrão 2; a planilha original usava 0. */
  chuvaMinimaMm?: number;
  /** Horário de ponta da energia, para o custo e a hora de ligar. */
  ponta?: Ponta;
  /** Previsão (ET₀ e chuva) para projetar os próximos dias. */
  previsao?: DiaPrevisao[];
}

/** Chuva efetiva: abaixo do mínimo não molha o solo. */
export function chuvaEfetiva(chuvaMm: number, minimoMm: number): number {
  return chuvaMm < minimoMm ? 0 : chuvaMm;
}

const somaPorData = (itens: Irrigacao[]): Map<DataISO, number> => {
  const m = new Map<DataISO, number>();
  for (const i of itens) m.set(i.data, (m.get(i.data) ?? 0) + i.mm);
  return m;
};

/**
 * Balanço hídrico diário de um pivô.
 *
 *   déficit_0 = déficit(umidade inicial)
 *   déficit_d = max(0, déficit_{d−1} + ETc_d − chuva_d − irrigação_d)
 *   se houve medição de umidade no dia d: déficit_d = déficit(θ medida)
 *
 * O balanço continua andando em dias SEM DADOS (com o clima que houver), mas a decisão fica bloqueada.
 */
export function simularBalanco({ pivo, estacao, dias, irrigacoes = [], ajustes = [], chuvaMinimaMm = CHUVA_MINIMA_EFETIVA_MM, ponta = PONTA_PADRAO, previsao = [] }: EntradaBalanco): LinhaBalanco[] {
  const { solo, cultura } = pivo;
  const irrigPorDia = somaPorData(irrigacoes);
  const ajustePorDia = new Map(ajustes.map((a) => [a.data, a]));
  const linhas: LinhaBalanco[] = [];
  let ultimaMedicao: DataISO | null = null;
  let anterior: number | null = null;

  // soma térmica: antes do primeiro dia com clima, assume o ritmo médio da cultivar (GD do ciclo / dias do ciclo)
  const usaGrausDia = !!pivo.grausDiaCiclo && cultura.tBaseC !== undefined && dias.length > 0;
  let gdAcum = usaGrausDia ? (das(dias[0]!.data, pivo.plantio) * pivo.grausDiaCiclo!) / fimDoCicloDas(cultura) : 0;
  const fracaoDoDia = (tmed: number, d: number) => {
    if (!usaGrausDia) return undefined;
    gdAcum += grausDiaDoDia(cultura, tmed);
    return fracaoCiclo(cultura, d, { acumulado: gdAcum, ciclo: pivo.grausDiaCiclo! });
  };

  for (const dia of dias) {
    const d = das(dia.data, pivo.plantio);
    const fracao = fracaoDoDia(dia.tmed, d);
    const { estadio, kc } = kcDoDia(cultura, d, pivo.plantioDiretoPalhada, fracao);
    const raizCm = profundidadeRaiz(solo, d);
    const cadMm = cad(solo, raizCm);
    const semLeituras = dia.n < MIN_LEITURAS;
    const et0Externa = semLeituras && dia.et0Externa !== undefined && Number.isFinite(dia.et0Externa) ? dia.et0Externa : null;
    const et0 = et0Externa ?? et0PenmanMonteith(dia, estacao);
    const hs = et0Hargreaves(dia, estacao);
    const f = fatorDeplecao(solo, et0);
    const afdMm = cadMm * f;
    const etc = et0 * kc;
    const irrigacao = irrigPorDia.get(dia.data) ?? 0;
    const chuva = chuvaEfetiva(dia.chuva, chuvaMinimaMm);

    const inicial = anterior ?? deficitDaUmidade(solo, pivo.umidadeInicialPct, raizCm);
    let deficit = Math.max(0, inicial + etc - chuva - irrigacao);

    const ajuste = ajustePorDia.get(dia.data);
    if (ajuste) {
      deficit = deficitDaUmidade(solo, ajuste.umidadeRaizPct, raizCm);
      ultimaMedicao = dia.data;
    }
    anterior = deficit;

    const decisao: Decisao =
      semLeituras && et0Externa === null ? "SEM DADOS" : deficit >= pivo.laminaMinimaMm ? "IRRIGAR" : "NÃO IRRIGAR";

    const alertas: string[] = [];
    if (et0Externa !== null) alertas.push(`Estação com só ${dia.n} leituras: ET₀ do dia veio do Open-Meteo (${et0Externa.toFixed(2)} mm).`);
    else if (dia.estimados?.length) alertas.push(`Clima estimado pelo dia vizinho (sem leitura de: ${dia.estimados.join(", ")}).`);
    if (semLeituras && et0Externa === null) alertas.push(`Só ${dia.n} leituras na janela (mínimo ${MIN_LEITURAS}).`);
    if (dia.chuva > 0 && chuva === 0) alertas.push(`Chuva de ${dia.chuva.toFixed(1)} mm abaixo de ${chuvaMinimaMm} mm: não conta (fica na folha).`);
    if (et0Externa === null && dia.rad < RAD_SUSPEITA_MJ) alertas.push(`Radiação de ${dia.rad.toFixed(2)} MJ/m² — suspeita de falha do sensor.`);
    if (et0Externa === null && divergenciaHargreaves(et0, hs) > LIMITE_DIVERGENCIA_HS)
      alertas.push(`ET₀ Penman-Monteith (${et0.toFixed(2)}) diverge mais de 35% da Hargreaves (${hs.toFixed(2)}).`);
    if (deficit >= afdMm) alertas.push(`Déficit de ${deficit.toFixed(1)} mm passou da AFD (${afdMm.toFixed(1)} mm): risco de estresse.`);
    if (ajuste?.umidadeProfundaPct !== undefined) {
      const limiteSeco = solo.cc - f * (solo.cc - solo.pmp);
      if (ajuste.umidadeProfundaPct >= solo.cc) alertas.push("Camada profunda na capacidade de campo: risco de percolação.");
      else if (ajuste.umidadeProfundaPct <= limiteSeco) alertas.push("Camada profunda muito seca.");
    }
    if (ajuste?.tensaoKpa !== undefined && ajuste.tensaoKpa <= pivo.tensaoIrrigarKpa)
      alertas.push(`Tensiômetro em ${ajuste.tensaoKpa} kPa (limite ${pivo.tensaoIrrigarKpa} kPa): irrigar.`);
    const diasSemMedicao = das(dia.data, ultimaMedicao ?? dias[0]!.data);
    if (diasSemMedicao > DIAS_MEDICAO_VELHA)
      alertas.push(`Última medição de umidade há ${diasSemMedicao} dias.`);
    const passouCiclo = d - fimDoCicloDas(cultura);
    if (passouCiclo > 0)
      alertas.push(`Ciclo da cultura encerrado há ${passouCiclo} dia(s): confira o plantio ou desative o pivô.`);

    let recomendacao: Recomendacao | undefined;
    if (pivo.equipamento) {
      recomendacao = recomendar(pivo.equipamento, deficit, ponta);
      if (pivo.laminaMinimaMm < recomendacao.lamina100Mm * (pivo.equipamento.eficienciaPct / 100))
        alertas.push(
          `Lâmina mínima (${pivo.laminaMinimaMm} mm) é menor do que o pivô aplica a 100% ` +
            `(${recomendacao.lamina100Mm.toFixed(1)} mm brutos).`,
        );
      if (decisao === "IRRIGAR" && recomendacao.limitadoPelaLaminaMax)
        alertas.push("Déficit maior do que uma volta no percentímetro mínimo repõe.");
    }

    linhas.push({
      data: dia.data,
      das: d,
      estadio: estadio.nome,
      kc,
      et0,
      et0Hargreaves: hs,
      etc,
      chuva,
      irrigacao,
      raizCm,
      cadMm,
      fatorDeplecao: f,
      afdMm,
      deficit,
      ajustado: Boolean(ajuste),
      leituras: dia.n,
      decisao,
      recomendacao: decisao === "IRRIGAR" ? recomendacao : undefined,
      alertas,
    });
  }

  const ultima = linhas[linhas.length - 1];
  if (ultima && previsao.length) {
    ultima.projecao = projetar(pivo, ultima, previsao, usaGrausDia ? { acumulado: gdAcum, ciclo: pivo.grausDiaCiclo! } : null, ultima.decisao === "IRRIGAR" ? recomendarSeHouver(pivo, ultima.deficit, ponta) : undefined);
  }
  return linhas;
}

function recomendarSeHouver(pivo: Pivo, deficit: number, ponta: Ponta): Recomendacao | undefined {
  return pivo.equipamento ? recomendar(pivo.equipamento, deficit, ponta) : undefined;
}

/**
 * Projeta o déficit dia a dia com a ET₀ prevista (Open-Meteo), SEM contar chuva (chuva prevista vira
 * aviso, não desconto). Diz quando o déficit passa da lâmina mínima e quanto estará ao fim da volta.
 */
export function projetar(pivo: Pivo, hoje: LinhaBalanco, previsao: DiaPrevisao[], grausDia: { acumulado: number; ciclo: number } | null, rec?: Recomendacao): Projecao {
  const { cultura } = pivo;
  const prox = previsao.filter((p) => p.data > hoje.data && p.et0Mm !== null && p.et0Mm !== undefined).slice(0, 7);
  let deficit = hoje.deficit;
  let gd = grausDia ? grausDia.acumulado : 0;
  const dias: Projecao["dias"] = [];
  let proxima: DataISO | null = hoje.decisao === "IRRIGAR" ? hoje.data : null;
  for (const p of prox) {
    const d = das(p.data, pivo.plantio);
    let fracao: number | undefined;
    if (grausDia) {
      const tmed = p.tmax !== null && p.tmin !== null ? (p.tmax + p.tmin) / 2 : NaN;
      gd += grausDiaDoDia(cultura, tmed);
      fracao = fracaoCiclo(cultura, d, { acumulado: gd, ciclo: grausDia.ciclo });
    }
    const { kc } = kcDoDia(cultura, d, pivo.plantioDiretoPalhada, fracao);
    const et0 = p.et0Mm as number;
    deficit = Math.max(0, deficit + et0 * kc);
    dias.push({ data: p.data, deficit: Math.round(deficit * 10) / 10, et0, kc });
    if (proxima === null && deficit >= pivo.laminaMinimaMm) proxima = p.data;
  }
  const emDias = proxima === null ? null : das(proxima, hoje.data);
  const primeiro = dias[0];
  const deficitFimVoltaMm = rec && primeiro ? Math.round((hoje.deficit + (primeiro.et0 * primeiro.kc * rec.tempoVoltaH) / 24) * 10) / 10 : undefined;
  return { proximaIrrigacao: proxima, emDias, deficitFimVoltaMm, dias, horizonte: dias.length };
}

import { das, fimDoCicloDas, kcDoDia } from "./cultura.ts";
import { divergenciaHargreaves, et0Hargreaves, et0PenmanMonteith, LIMITE_DIVERGENCIA_HS } from "./et0.ts";
import { recomendar, type Recomendacao } from "./equipamento.ts";
import { cad, deficitDaUmidade, fatorDeplecao, profundidadeRaiz } from "./solo.ts";
import type { AjusteUmidade, DataISO, Decisao, DiaClima, Estacao, Irrigacao, Pivo } from "./tipos.ts";

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
}

export interface EntradaBalanco {
  pivo: Pivo;
  estacao: Estacao;
  /** Dias consecutivos, em ordem. */
  dias: DiaClima[];
  irrigacoes?: Irrigacao[];
  ajustes?: AjusteUmidade[];
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
export function simularBalanco({ pivo, estacao, dias, irrigacoes = [], ajustes = [] }: EntradaBalanco): LinhaBalanco[] {
  const { solo, cultura } = pivo;
  const irrigPorDia = somaPorData(irrigacoes);
  const ajustePorDia = new Map(ajustes.map((a) => [a.data, a]));
  const linhas: LinhaBalanco[] = [];
  let ultimaMedicao: DataISO | null = null;
  let anterior: number | null = null;

  for (const dia of dias) {
    const d = das(dia.data, pivo.plantio);
    const { estadio, kc } = kcDoDia(cultura, d, pivo.plantioDiretoPalhada);
    const raizCm = profundidadeRaiz(solo, d);
    const cadMm = cad(solo, raizCm);
    const et0 = et0PenmanMonteith(dia, estacao);
    const hs = et0Hargreaves(dia, estacao);
    const f = fatorDeplecao(solo, et0);
    const afdMm = cadMm * f;
    const etc = et0 * kc;
    const irrigacao = irrigPorDia.get(dia.data) ?? 0;

    const inicial = anterior ?? deficitDaUmidade(solo, pivo.umidadeInicialPct, raizCm);
    let deficit = Math.max(0, inicial + etc - dia.chuva - irrigacao);

    const ajuste = ajustePorDia.get(dia.data);
    if (ajuste) {
      deficit = deficitDaUmidade(solo, ajuste.umidadeRaizPct, raizCm);
      ultimaMedicao = dia.data;
    }
    anterior = deficit;

    const decisao: Decisao =
      dia.n < MIN_LEITURAS ? "SEM DADOS" : deficit >= pivo.laminaMinimaMm ? "IRRIGAR" : "NÃO IRRIGAR";

    const alertas: string[] = [];
    if (dia.estimados?.length) alertas.push(`Clima estimado pelo dia vizinho (sem leitura de: ${dia.estimados.join(", ")}).`);
    if (dia.n < MIN_LEITURAS) alertas.push(`Só ${dia.n} leituras na janela (mínimo ${MIN_LEITURAS}).`);
    if (dia.rad < RAD_SUSPEITA_MJ) alertas.push(`Radiação de ${dia.rad.toFixed(2)} MJ/m² — suspeita de falha do sensor.`);
    if (divergenciaHargreaves(et0, hs) > LIMITE_DIVERGENCIA_HS)
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
      recomendacao = recomendar(pivo.equipamento, deficit);
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
      chuva: dia.chuva,
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
  return linhas;
}

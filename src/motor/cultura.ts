import type { Cultura, DataISO, Estadio } from "./tipos.ts";

/**
 * Soja, ciclo de 120 dias. Mesmos Kc da aba KC da planilha.
 * Valores de referência — o agrônomo precisa validar.
 */
export const SOJA: Cultura = {
  nome: "Soja",
  cicloDias: 120,
  estadios: [
    { nome: "V1", ateFracao: 0.17, kc: 0.45 },
    { nome: "V3", ateFracao: 0.3, kc: 0.75 },
    { nome: "R1", ateFracao: 0.46, kc: 1.05 },
    { nome: "R3", ateFracao: 0.63, kc: 1.15 },
    { nome: "R5", ateFracao: 0.83, kc: 1.2 },
    { nome: "R7", ateFracao: 1.0, kc: 0.9 },
  ],
  fonte: "Aba KC da planilha original da fazenda.",
  sugestao: { raizMaxCm: 50, diasRaiz: 55, tensaoIrrigarKpa: -70, porque: "Raiz de 50 cm aos 55 dias e tensão de −70 kPa, como no exemplo da fazenda." },
};

/** Monta estádios a partir de "até o dia N" (as tabelas da Embrapa vêm em dias). */
function porDias(ciclo: number, linhas: [string, number, number, number?][]): Estadio[] {
  return linhas.map(([nome, ateDia, kc, kcFim]) => ({ nome, ateFracao: ateDia / ciclo, kc, ...(kcFim === undefined ? {} : { kcFim }) }));
}

/**
 * Milho grão, ciclo de 120 dias. Curva de 4 fases da Embrapa Milho e Sorgo (planilha de manejo e
 * Comunicado Técnico 47): fases de 17%, 28%, 33% e 22% do ciclo; Kc 0,50 na fase inicial, sobe em
 * linha reta até 1,20 no florescimento/enchimento e desce até 0,60 na maturação (FAO-56, adotado pela Embrapa).
 */
export const MILHO: Cultura = {
  nome: "Milho",
  cicloDias: 120,
  estadios: [
    { nome: "Inicial", ateFracao: 0.17, kc: 0.5 },
    { nome: "Vegetativo", ateFracao: 0.45, kc: 0.5, kcFim: 1.2 },
    { nome: "Florescimento/enchimento", ateFracao: 0.78, kc: 1.2 },
    { nome: "Maturação", ateFracao: 1.0, kc: 1.2, kcFim: 0.6 },
  ],
  fonte: "Embrapa Milho e Sorgo — Comunicado Técnico 47 (2002) e Circular Técnica 10 / planilha de manejo de irrigação; Kc final FAO-56.",
  sugestao: { raizMaxCm: 40, diasRaiz: 54, tensaoIrrigarKpa: -60, porque: "Embrapa Milho e Sorgo usa 40 cm de raiz efetiva, atingida no fim da fase vegetativo." },
};

/**
 * Sorgo granífero, ciclo de 120 dias. Fases de 24, 42, 30 e 24 dias (Embrapa, Comunicado Técnico 254,
 * 2021); Kc 0,50 → 1,10 → 0,55 (FAO-56, faixa 1,00–1,15 citada pela Embrapa).
 */
export const SORGO: Cultura = {
  nome: "Sorgo",
  cicloDias: 120,
  estadios: porDias(120, [
    ["Inicial", 24, 0.5],
    ["Vegetativo", 66, 0.5, 1.1],
    ["Florescimento/enchimento", 96, 1.1],
    ["Maturação", 120, 1.1, 0.55],
  ]),
  fonte: "Embrapa Milho e Sorgo — Comunicado Técnico 254 (2021), planilha para obtenção do coeficiente de cultura; Kc FAO-56.",
  sugestao: { raizMaxCm: 40, diasRaiz: 66, tensaoIrrigarKpa: -60, porque: "Mesma raiz efetiva do milho (40 cm), atingida no fim da fase vegetativa." },
};

/**
 * Feijão comum, sistema convencional. Tabela de Kc por dias após a emergência (DAE) da Agência de
 * Informação Embrapa (Embrapa Arroz e Feijão, manejo de irrigação). Ciclo de 94 DAE.
 */
export const FEIJAO: Cultura = {
  nome: "Feijão",
  cicloDias: 94,
  emergenciaDias: 7,
  estadios: porDias(94, [
    ["Emergência (0–14 DAE)", 14, 0.49],
    ["Vegetativo (15–24 DAE)", 24, 0.69],
    ["Vegetativo (25–34 DAE)", 34, 0.77],
    ["Pré-floração (35–44 DAE)", 44, 0.9],
    ["Floração (45–54 DAE)", 54, 1.06],
    ["Vagens (55–64 DAE)", 64, 0.89],
    ["Enchimento (65–74 DAE)", 74, 0.74],
    ["Maturação (75–84 DAE)", 84, 0.48],
    ["Maturação (85–94 DAE)", 94, 0.27],
  ]),
  fonte: "Embrapa Arroz e Feijão — Agência de Informação Embrapa, Feijão: manejo de irrigação (Kc por DAE, sistema convencional).",
  sugestao: { raizMaxCm: 30, diasRaiz: 45, tensaoIrrigarKpa: -35, porque: "Embrapa: tensiômetro a 15 cm, irrigar entre 30 e 40 kPa; raiz efetiva rasa (~30 cm)." },
};

/**
 * Feijão em plantio direto (medido na cv. Aporé): germinação até início da floração 35 dias (Kc 0,69),
 * floração 25 dias (1,28), formação de vagens até maturação 20 dias (1,04). Já medido sobre palhada.
 */
export const FEIJAO_PD: Cultura = {
  nome: "Feijão plantio direto",
  cicloDias: 80,
  emergenciaDias: 7,
  kcJaComPalhada: true,
  estadios: porDias(80, [
    ["Vegetativo", 35, 0.69],
    ["Floração", 60, 1.28],
    ["Vagens/maturação", 80, 1.04],
  ]),
  fonte: "Embrapa Arroz e Feijão — Agência de Informação Embrapa, Feijão: manejo de irrigação (plantio direto, cv. Aporé).",
  sugestao: { raizMaxCm: 30, diasRaiz: 42, tensaoIrrigarKpa: -35, porque: "Embrapa: tensiômetro a 15 cm, irrigar entre 30 e 40 kPa; raiz efetiva rasa (~30 cm)." },
};

/**
 * Trigo irrigado no Cerrado (BRS 394, Embrapa Cerrados): Kc = −0,000268·DAE² + 0,032979·DAE + 0,392945.
 * Médias por fase no trabalho: 0,57 / 0,97 / 1,28 / 1,39 / 1,08. Ciclo de ~115 DAE.
 * Atenção: o Kc foi ajustado com a ET₀ de Hargreaves-Samani.
 */
export const TRIGO: Cultura = {
  nome: "Trigo",
  cicloDias: 115,
  emergenciaDias: 5,
  kcEquacao: [-0.000268, 0.032979, 0.392945],
  estadios: [
    { nome: "Estabelecimento", ateFracao: 0.2, kc: 0.57 },
    { nome: "Perfilhamento", ateFracao: 0.4, kc: 0.97 },
    { nome: "Alongamento/emborrachamento", ateFracao: 0.6, kc: 1.28 },
    { nome: "Espigamento/floração", ateFracao: 0.8, kc: 1.39 },
    { nome: "Enchimento/maturação", ateFracao: 1.0, kc: 1.08 },
  ],
  fonte: "Embrapa Cerrados — Coeficientes de cultura do trigo BRS 394 irrigado no Cerrado (2024).",
  sugestao: { raizMaxCm: 40, diasRaiz: 50, fatorDeplecaoFixo: 0.4, tensaoIrrigarKpa: -50, porque: "Embrapa Cerrados: raiz de 40 cm e irrigar quando 40% da CAD foi consumida (fator fixo 0,4)." },
};

/**
 * Algodão herbáceo: Kc = −0,00006·DAE² + 0,009·DAE + 0,632 (Embrapa Algodão, BRS 200 Marrom).
 * Pico de ~0,97 aos 75 DAE. Ciclo de 150 DAE. Dados do Nordeste: conferir para o Cerrado.
 */
export const ALGODAO: Cultura = {
  nome: "Algodão",
  cicloDias: 150,
  emergenciaDias: 5,
  kcEquacao: [-0.00006, 0.009, 0.632],
  estadios: [
    { nome: "Inicial", ateFracao: 0.2, kc: 0.7 },
    { nome: "Botão floral", ateFracao: 0.4, kc: 0.9 },
    { nome: "Floração", ateFracao: 0.7, kc: 0.97 },
    { nome: "Capulhos", ateFracao: 1.0, kc: 0.8 },
  ],
  fonte: "Embrapa Algodão — Coeficientes de cultivo do algodoeiro herbáceo (2009).",
  sugestao: { raizMaxCm: 60, diasRaiz: 75, tensaoIrrigarKpa: -60, porque: "Raiz profunda (~60 cm) atingida na floração; conferir para o Cerrado." },
};

/** Dias após a semeadura. */
export function das(data: DataISO, plantio: DataISO): number {
  return Math.round((Date.parse(data + "T00:00:00Z") - Date.parse(plantio + "T00:00:00Z")) / 86_400_000);
}

/**
 * Mesma cultura com outro ciclo (a cultivar que a fazenda plantou). As frações dos estádios se mantêm;
 * uma equação por DAE é esticada/encolhida na mesma proporção. Ciclo vazio/igual devolve a própria cultura.
 */
export function comCiclo(cultura: Cultura, cicloDias: number | null | undefined): Cultura {
  const padrao = cultura.cicloPadraoDias ?? cultura.cicloDias;
  if (!cicloDias || cicloDias === cultura.cicloDias) return cultura;
  return { ...cultura, cicloDias, cicloPadraoDias: padrao };
}

/** Último DAS do ciclo (emergência + ciclo). Depois disso o Kc fica parado no final e o balanço avisa. */
export function fimDoCicloDas(cultura: Cultura): number {
  return (cultura.emergenciaDias ?? 0) + cultura.cicloDias;
}

/** Kc de cada dia, do plantio até o fim do ciclo (para desenhar a curva). */
export function curvaKc(cultura: Cultura, palhada: boolean): number[] {
  const fim = fimDoCicloDas(cultura);
  const kcs: number[] = [];
  for (let d = 0; d <= fim; d++) kcs.push(Math.round(kcDoDia(cultura, d, palhada).kc * 1000) / 1000);
  return kcs;
}

/** Dias após a emergência (antes da emergência conta como 0). Sem `emergenciaDias`, é o próprio DAS. */
export function dae(cultura: Cultura, diasAposSemeadura: number): number {
  return Math.max(0, diasAposSemeadura - (cultura.emergenciaDias ?? 0));
}

/** Estádio pela fração do ciclo. Depois do fim do ciclo, fica no último estádio. */
export function estadioPorDas(cultura: Cultura, diasAposSemeadura: number): Estadio {
  const f = dae(cultura, diasAposSemeadura) / cultura.cicloDias;
  const e = cultura.estadios.find((x) => f <= x.ateFracao) ?? cultura.estadios[cultura.estadios.length - 1];
  if (!e) throw new Error(`Cultura ${cultura.nome} sem estádios cadastrados.`);
  return e;
}

/** Kc sem a correção da palhada: equação, reta dentro do estádio ou degrau. */
function kcBase(cultura: Cultura, estadio: Estadio, diasAposSemeadura: number): number {
  const d = dae(cultura, diasAposSemeadura);
  if (cultura.kcEquacao) {
    const [a, b, c] = cultura.kcEquacao;
    const padrao = cultura.cicloPadraoDias ?? cultura.cicloDias;
    const x = Math.min(d, cultura.cicloDias) * (padrao / cultura.cicloDias); // ciclo diferente: estica a equação
    return a * x * x + b * x + c;
  }
  if (estadio.kcFim === undefined) return estadio.kc;
  const i = cultura.estadios.indexOf(estadio);
  const ini = i > 0 ? cultura.estadios[i - 1]!.ateFracao : 0;
  const t = Math.min(1, Math.max(0, (d / cultura.cicloDias - ini) / (estadio.ateFracao - ini)));
  return estadio.kc + (estadio.kcFim - estadio.kc) * t;
}

/**
 * Kc do dia. Em plantio direto sobre palhada, o Kc do primeiro estádio cai pela metade
 * (Embrapa Milho e Sorgo; aplicado à soja por analogia).
 */
export function kcDoDia(cultura: Cultura, diasAposSemeadura: number, palhada: boolean): { estadio: Estadio; kc: number } {
  const estadio = estadioPorDas(cultura, diasAposSemeadura);
  const kc = kcBase(cultura, estadio, diasAposSemeadura);
  const primeiro = estadio === cultura.estadios[0];
  return { estadio, kc: palhada && primeiro && !cultura.kcJaComPalhada ? kc * 0.5 : kc };
}

/**
 * Catálogo de culturas por chave (a escrita na coluna Cultura da aba PIVOS).
 * Valores de boletins da Embrapa — referência; o agrônomo precisa validar para a fazenda.
 */
export const CULTURAS: Record<string, Cultura> = {
  soja: SOJA,
  milho: MILHO,
  sorgo: SORGO,
  feijao: FEIJAO,
  "feijao pd": FEIJAO_PD,
  trigo: TRIGO,
  algodao: ALGODAO,
};

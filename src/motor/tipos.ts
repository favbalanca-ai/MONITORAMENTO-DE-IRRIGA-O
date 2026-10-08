/** Data local no formato "YYYY-MM-DD". */
export type DataISO = string;

/** Data e hora locais da estação no formato "YYYY-MM-DDTHH:MM:SS" (sem fuso). */
export type DataHoraLocal = string;

/** Uma leitura da estação já normalizada para unidades do SI. */
export interface Leitura {
  quando: DataHoraLocal;
  /** Chuva acumulada do dia (mm). Zera à meia-noite. */
  chuvaAcumDia: number | null;
  tempC: number | null;
  urPct: number | null;
  /** Radiação solar instantânea (W/m²). */
  radWm2: number | null;
  ventoMs: number | null;
  /** Intervalo que a leitura representa (min). Ao vivo = 10; histórico pode ser 5 ou 30. */
  intervaloMin?: number;
  /** Origem: "ecowitt", "ecowitt-historico-30min", "planilha"... */
  fonte?: string;
}

/** Clima agregado de um dia (janela 18h de D−1 até 18h de D). */
export interface DiaClima {
  data: DataISO;
  tmax: number;
  tmin: number;
  tmed: number;
  ur: number;
  /** Vento médio medido na altura do anemômetro (m/s). */
  vento: number;
  /** Radiação solar global (MJ/m²/dia). */
  rad: number;
  /** Chuva na janela (mm). */
  chuva: number;
  /** Leituras na janela, em equivalentes de 10 min (144 = dia completo). */
  n: number;
  /** Campos que faltaram na janela e foram preenchidos com o dia válido mais próximo. */
  estimados?: string[];
}

export interface Estacao {
  /** Graus decimais, negativo no hemisfério sul. */
  latitude: number;
  /** Metros. */
  altitude: number;
  /** Altura do anemômetro (m). */
  alturaAnemometro: number;
}

export interface Estadio {
  nome: string;
  /** Fração do ciclo (DAS/ciclo) até a qual vale este estádio. */
  ateFracao: number;
  /** Kc do estádio (ou do começo dele, quando há `kcFim`). */
  kc: number;
  /** Se existir, o Kc anda em linha reta de `kc` até `kcFim` ao longo do estádio (curva FAO/Embrapa). */
  kcFim?: number;
}

export interface Cultura {
  nome: string;
  /** Duração do ciclo (dias). Conta a partir da emergência quando há `emergenciaDias`. */
  cicloDias: number;
  estadios: Estadio[];
  /** Dias da semeadura até a emergência. As tabelas que contam em DAE descontam isso do DAS. */
  emergenciaDias?: number;
  /** Kc = a·DAE² + b·DAE + c (equação ajustada em experimento). Os estádios ficam só como nome. */
  kcEquacao?: [number, number, number];
  /** Os Kc já foram medidos em plantio direto: a palhada não corta o primeiro estádio de novo. */
  kcJaComPalhada?: boolean;
  /** De onde vieram os números (boletim da Embrapa etc.). */
  fonte?: string;
  /** Ciclo original do catálogo, guardado quando o pivô encurta/estica o ciclo (`comCiclo`). */
  cicloPadraoDias?: number;
  /** Valores que a Embrapa sugere para solo/decisão; o app oferece ao escolher a cultura. */
  sugestao?: SugestaoCultura;
}

/** Sugestões por cultura para o cadastro do pivô (o agrônomo confirma). */
export interface SugestaoCultura {
  raizMaxCm: number;
  diasRaiz: number;
  fatorDeplecaoFixo?: number;
  tensaoIrrigarKpa?: number;
  /** Explicação curta mostrada no app. */
  porque: string;
}

export interface Solo {
  /** Capacidade de campo (% em volume). */
  cc: number;
  /** Ponto de murcha permanente (% em volume). */
  pmp: number;
  /** Profundidade da raiz no plantio (cm). */
  raizIniCm: number;
  /** Profundidade máxima da raiz (cm). */
  raizMaxCm: number;
  /** Dias do plantio até a raiz máxima. */
  diasRaiz: number;
  /** Fator de depleção fixo; `null` usa o fator variável pela ET₀ (Embrapa). */
  fatorDeplecaoFixo: number | null;
}

export interface Equipamento {
  raioM: number;
  anguloGraus: number;
  vazaoM3h: number;
  /** Velocidade da última torre com percentímetro em 100% (m/min). */
  velocidadeUltimaTorreMMin: number;
  percentimetroMinPct: number;
  eficienciaPct: number;
  potenciaKw: number;
  tarifaRsKwh: number;
}

export interface Pivo {
  nome: string;
  cultura: Cultura;
  plantio: DataISO;
  plantioDiretoPalhada: boolean;
  /** Umidade na zona radicular no início da simulação (%). */
  umidadeInicialPct: number;
  solo: Solo;
  /** Déficit a partir do qual a decisão é IRRIGAR (mm). */
  laminaMinimaMm: number;
  /** Data em que a umidade inicial vale e o balanço começa (padrão: plantio). */
  inicioBalanco?: DataISO;
  /** Tensão a partir da qual o tensiômetro indica irrigar (kPa, negativo). */
  tensaoIrrigarKpa: number;
  equipamento?: Equipamento;
}

export interface Irrigacao {
  data: DataISO;
  /** Lâmina líquida aplicada (mm). */
  mm: number;
}

export interface AjusteUmidade {
  data: DataISO;
  fonte?: string;
  /** Umidade medida na zona radicular (%). */
  umidadeRaizPct: number;
  /** Umidade medida na camada abaixo da raiz (%). */
  umidadeProfundaPct?: number;
  tensaoKpa?: number;
}

export type Decisao = "IRRIGAR" | "NÃO IRRIGAR" | "SEM DADOS";

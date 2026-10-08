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
  kc: number;
}

export interface Cultura {
  nome: string;
  cicloDias: number;
  estadios: Estadio[];
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

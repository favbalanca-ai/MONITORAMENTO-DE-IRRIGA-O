/**
 * GERADO AUTOMATICAMENTE por scripts/gerar_apps_script.ts — NÃO EDITE AQUI.
 * Para mudar o cálculo, altere o TypeScript em src/, rode os testes e gere de novo.
 */
var Motor = (function () {
  "use strict";
  // ---- src/motor/unidades.ts ----
  /**
   * Normalização das unidades na entrada. Toda leitura da Ecowitt traz `.value` e `.unit`;
   * a conversão olha o `.unit` em vez de supor a unidade (a planilha já recebeu °F e W/m² misturados).
   */
  /** Converte um valor que pode vir como texto ("75.9", "75,9") para número; inválido vira `null`. */
  function numero(v) {
      if (typeof v === "number")
          return Number.isFinite(v) ? v : null;
      if (typeof v === "string" && v.trim() !== "") {
          const n = Number(v.trim().replace(",", "."));
          return Number.isFinite(n) ? n : null;
      }
      return null;
  }
  const unidade = (u) => (u !== null && u !== void 0 ? u : "").trim().toLowerCase().replace(/[º˚]/g, "°");
  class UnidadeDesconhecida extends Error {
      constructor(grandeza, u) {
          super(`Unidade de ${grandeza} desconhecida: "${u}"`);
      }
  }
  function paraCelsius(v, u) {
      const x = unidade(u);
      if (x === "℃" || x === "°c" || x === "c")
          return v;
      if (x === "℉" || x === "°f" || x === "f")
          return ((v - 32) * 5) / 9;
      throw new UnidadeDesconhecida("temperatura", u);
  }
  function paraMm(v, u) {
      const x = unidade(u);
      if (x === "mm")
          return v;
      if (x === "in" || x === "inch" || x === "inches")
          return v * 25.4;
      throw new UnidadeDesconhecida("chuva", u);
  }
  function paraMs(v, u) {
      const x = unidade(u);
      if (x === "m/s")
          return v;
      if (x === "mph")
          return v * 0.44704;
      if (x === "km/h" || x === "kmh")
          return v / 3.6;
      if (x === "knots" || x === "kn" || x === "knot")
          return v * 0.514444;
      if (x === "ft/s")
          return v * 0.3048;
      throw new UnidadeDesconhecida("vento", u);
  }
  function paraWm2(v, u) {
      const x = unidade(u).replace("²", "2");
      if (x === "w/m2")
          return v;
      if (x === "lux")
          return v / 126.7; // aproximação usual para luz solar
      throw new UnidadeDesconhecida("radiação", u);
  }
  /** Leitura média em W/m² → MJ/m²/dia. */
  const wm2ParaMJDia = (wm2) => (wm2 * 86400) / 1e6;
  // ---- src/motor/agregacao.ts ----
  /** Hora local que fecha a janela do dia. */
  const HORA_FECHAMENTO = "18:00:00";
  function diaAnterior(data) {
      const t = Date.parse(data + "T00:00:00Z") - 86400000;
      return new Date(t).toISOString().slice(0, 10);
  }
  const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const valores = (ls, k) => ls.map((l) => l[k]).filter((v) => v !== null && Number.isFinite(v));
  /**
   * Agrega as leituras da janela do dia D: de 18:00 de D−1 até 18:00 de D.
   *
   * Chuva: a Ecowitt manda o acumulado do dia, que zera à meia-noite. Então a chuva da janela é
   * (máx − mín entre 18h e 0h de D−1) + máx entre 0h e 18h de D.
   *
   * Radiação: média das leituras (W/m²) convertida para o dia todo — nunca a soma, porque o
   * número de leituras varia (repetidas ou faltando).
   *
   * `n` conta leituras em equivalentes de 10 min, para que um dia recuperado do histórico de 30 min
   * (48 leituras) valha o mesmo que um dia ao vivo (144).
   *
   * Devolve `null` se não houver nenhuma leitura com temperatura na janela.
   */
  function agregarDia(leituras, data) {
      const ini = `${diaAnterior(data)}T${HORA_FECHAMENTO}`;
      const meiaNoite = `${data}T00:00:00`;
      const fim = `${data}T${HORA_FECHAMENTO}`;
      const janela = leituras.filter((l) => l.quando >= ini && l.quando < fim);
      const temps = valores(janela, "tempC");
      if (temps.length === 0)
          return null;
      const noite = valores(janela.filter((l) => l.quando < meiaNoite), "chuvaAcumDia");
      const dia = valores(janela.filter((l) => l.quando >= meiaNoite), "chuvaAcumDia");
      const chuvaNoite = noite.length ? Math.max(...noite) - Math.min(...noite) : 0;
      const chuvaDia = dia.length ? Math.max(...dia) : 0;
      const urs = valores(janela, "urPct");
      const ventos = valores(janela, "ventoMs");
      const rads = valores(janela, "radWm2");
      return {
          data,
          tmax: Math.max(...temps),
          tmin: Math.min(...temps),
          tmed: media(temps),
          ur: urs.length ? media(urs) : NaN,
          vento: ventos.length ? media(ventos) : NaN,
          rad: rads.length ? wm2ParaMJDia(media(rads)) : NaN,
          chuva: chuvaNoite + chuvaDia,
          n: Math.round(janela.reduce((soma, l) => { var _a; return soma + ((_a = l.intervaloMin) !== null && _a !== void 0 ? _a : 10) / 10; }, 0)),
      };
  }
  // ---- src/motor/completar.ts ----
  const CAMPOS = ["tmax", "tmin", "tmed", "ur", "vento", "rad"];
  function proximoDia(data) {
      return new Date(Date.parse(data + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  }
  function datasEntre(ini, fim) {
      const r = [];
      for (let d = ini; d <= fim; d = proximoDia(d))
          r.push(d);
      return r;
  }
  /**
   * Clima de todos os dias de `ini` a `fim`, sem buracos (o balanço precisa de dias seguidos).
   *
   * Dia sem leitura nenhuma, ou com algum sensor sem dado, recebe o valor do dia válido anterior
   * mais próximo (ou do seguinte, se não houver anterior) e fica marcado em `estimados`.
   * Chuva nunca é estimada: sem leitura, conta 0. A decisão desses dias já sai "SEM DADOS" pelo `n`.
   * Devolve [] se não houver nenhum dia com dado no período.
   */
  function climaCompleto(leituras, ini, fim) {
      const ordenadas = [...leituras].sort((a, b) => (a.quando < b.quando ? -1 : 1));
      const brutos = datasEntre(ini, fim).map((data) => {
          const de = `${diaAnterior(data)}T18:00:00`;
          const ate = `${data}T18:00:00`;
          const janela = ordenadas.filter((l) => l.quando >= de && l.quando < ate);
          return { data, dia: agregarDia(janela, data) };
      });
      const valido = (d, c) => d !== null && Number.isFinite(d[c]);
      if (!brutos.some((b) => CAMPOS.every((c) => valido(b.dia, c))))
          return [];
      return brutos.map(({ data, dia }, i) => {
          var _a;
          const r = dia ? { ...dia } : { data, tmax: NaN, tmin: NaN, tmed: NaN, ur: NaN, vento: NaN, rad: NaN, chuva: 0, n: 0 };
          const estimados = [];
          for (const c of CAMPOS) {
              if (Number.isFinite(r[c]))
                  continue;
              const fonte = (_a = brutos.slice(0, i).reverse().find((b) => valido(b.dia, c))) !== null && _a !== void 0 ? _a : brutos.slice(i + 1).find((b) => valido(b.dia, c));
              if (!(fonte === null || fonte === void 0 ? void 0 : fonte.dia))
                  continue; // impossível: há ao menos um dia completo
              r[c] = fonte.dia[c];
              estimados.push(c);
          }
          if (!Number.isFinite(r.chuva))
              r.chuva = 0;
          if (estimados.length)
              r.estimados = estimados;
          return r;
      });
  }
  // ---- src/motor/et0.ts ----
  /** Pressão de vapor de saturação (kPa) — FAO-56 eq. 11. */
  const eSat = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  /** Dia do ano (1–366) de uma data "YYYY-MM-DD". */
  function diaDoAno(data) {
      const [a, m, d] = data.split("-").map(Number);
      return (Date.UTC(a, m - 1, d) - Date.UTC(a, 0, 0)) / 86400000;
  }
  /** Radiação extraterrestre diária Ra (MJ/m²/dia) — FAO-56 eq. 21. */
  function radiacaoExtraterrestre(latitude, data) {
      const j = diaDoAno(data);
      const phi = (latitude * Math.PI) / 180;
      const dr = 1 + 0.033 * Math.cos((2 * Math.PI * j) / 365);
      const delta = 0.409 * Math.sin((2 * Math.PI * j) / 365 - 1.39);
      const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
      return (((24 * 60) / Math.PI) *
          0.082 *
          dr *
          (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws)));
  }
  /** Converte o vento medido na altura h para 2 m — FAO-56 eq. 47. */
  const ventoA2m = (u, h) => h === 2 ? u : (u * 4.87) / Math.log(67.8 * h - 5.42);
  /** ET₀ Penman-Monteith FAO-56 (mm/dia), com G = 0. */
  function et0PenmanMonteith(dia, est) {
      const z = est.altitude;
      const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
      const gamma = 0.000665 * P;
      const es = (eSat(dia.tmax) + eSat(dia.tmin)) / 2;
      const ea = (dia.ur / 100) * es;
      const delta = (4098 * eSat(dia.tmed)) / Math.pow(dia.tmed + 237.3, 2);
      const u2 = ventoA2m(dia.vento, est.alturaAnemometro);
      const Ra = radiacaoExtraterrestre(est.latitude, dia.data);
      const Rso = (0.75 + 2e-5 * z) * Ra;
      const razao = Math.min(1, Math.max(0.3, dia.rad / Rso));
      const Rns = 0.77 * dia.rad;
      const Rnl = ((4.903e-9 * (Math.pow(dia.tmax + 273.16, 4) + Math.pow(dia.tmin + 273.16, 4))) / 2) *
          (0.34 - 0.14 * Math.sqrt(ea)) *
          (1.35 * razao - 0.35);
      const Rn = Rns - Rnl;
      const et0 = (0.408 * delta * Rn + ((gamma * 900) / (dia.tmed + 273)) * u2 * (es - ea)) /
          (delta + gamma * (1 + 0.34 * u2));
      return Math.max(0, et0);
  }
  /** ET₀ Hargreaves-Samani (mm/dia) — usada só como conferência. */
  function et0Hargreaves(dia, est) {
      const Ra = radiacaoExtraterrestre(est.latitude, dia.data);
      return 0.0023 * 0.408 * Ra * (dia.tmed + 17.8) * Math.sqrt(Math.max(0, dia.tmax - dia.tmin));
  }
  /** Divergência relativa acima da qual a ET₀ PM é sinalizada frente à Hargreaves. */
  const LIMITE_DIVERGENCIA_HS = 0.35;
  function divergenciaHargreaves(pm, hs) {
      return hs > 0 ? Math.abs(pm - hs) / hs : 0;
  }
  // ---- src/motor/cultura.ts ----
  /**
   * Soja, ciclo de 120 dias. Mesmos Kc da aba KC da planilha.
   * Valores de referência — o agrônomo precisa validar.
   */
  const SOJA = {
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
  };
  /** Dias após a semeadura. */
  function das(data, plantio) {
      return Math.round((Date.parse(data + "T00:00:00Z") - Date.parse(plantio + "T00:00:00Z")) / 86400000);
  }
  /** Estádio pela fração do ciclo. Depois do fim do ciclo, fica no último estádio. */
  function estadioPorDas(cultura, diasAposSemeadura) {
      var _a;
      const f = Math.max(0, diasAposSemeadura) / cultura.cicloDias;
      const e = (_a = cultura.estadios.find((x) => f <= x.ateFracao)) !== null && _a !== void 0 ? _a : cultura.estadios[cultura.estadios.length - 1];
      if (!e)
          throw new Error(`Cultura ${cultura.nome} sem estádios cadastrados.`);
      return e;
  }
  /**
   * Kc do dia. Em plantio direto sobre palhada, o Kc do primeiro estádio cai pela metade
   * (Embrapa Milho e Sorgo; aplicado à soja por analogia).
   */
  function kcDoDia(cultura, diasAposSemeadura, palhada) {
      const estadio = estadioPorDas(cultura, diasAposSemeadura);
      const primeiro = estadio === cultura.estadios[0];
      return { estadio, kc: palhada && primeiro ? estadio.kc * 0.5 : estadio.kc };
  }
  /** Catálogo de culturas por chave (a usada no cadastro do pivô). Milho e feijão entram com o protótipo. */
  const CULTURAS = { soja: SOJA };
  // ---- src/motor/solo.ts ----
  /** Profundidade da raiz (cm): cresce em linha reta do plantio até `diasRaiz`. */
  function profundidadeRaiz(solo, diasAposSemeadura) {
      const t = Math.min(1, Math.max(0, diasAposSemeadura / solo.diasRaiz));
      return solo.raizIniCm + (solo.raizMaxCm - solo.raizIniCm) * t;
  }
  /** Capacidade de água disponível (mm) para a raiz com `zCm`. */
  const cad = (solo, zCm) => ((solo.cc - solo.pmp) / 100) * zCm * 10;
  /** Fator de depleção variável pela ET₀ do dia (Embrapa). */
  function fatorDeplecaoPorEt0(et0) {
      if (et0 <= 2.5)
          return 0.75;
      if (et0 <= 5)
          return 0.6;
      if (et0 <= 7.5)
          return 0.5;
      return 0.4;
  }
  const fatorDeplecao = (solo, et0) => { var _a; return (_a = solo.fatorDeplecaoFixo) !== null && _a !== void 0 ? _a : fatorDeplecaoPorEt0(et0); };
  /** Déficit (mm) correspondente a uma umidade medida θ (%). Nunca negativo. */
  const deficitDaUmidade = (solo, thetaPct, zCm) => Math.max(0, ((solo.cc - thetaPct) / 100) * zCm * 10);
  // ---- src/motor/equipamento.ts ----
  function capacidade(eq) {
      const fracao = eq.anguloGraus / 360;
      const areaHa = (Math.PI * eq.raioM ** 2 * fracao) / 10000;
      const t100h = (fracao * 2 * Math.PI * eq.raioM) / (eq.velocidadeUltimaTorreMMin * 60);
      const lamina100Mm = (eq.vazaoM3h * t100h) / (areaHa * 10);
      const laminaMaxMm = lamina100Mm / (eq.percentimetroMinPct / 100);
      return { areaHa, t100h, lamina100Mm, laminaMaxMm };
  }
  /** Ajuste do pivô para repor o déficit líquido (mm) em uma volta. */
  function recomendar(eq, deficitMm) {
      const cap = capacidade(eq);
      const necessaria = deficitMm / (eq.eficienciaPct / 100);
      const laminaBrutaMm = Math.min(cap.laminaMaxMm, Math.max(cap.lamina100Mm, necessaria));
      const percentimetroPct = (cap.lamina100Mm / laminaBrutaMm) * 100;
      const tempoVoltaH = cap.t100h / (percentimetroPct / 100);
      const energiaKwh = eq.potenciaKw * tempoVoltaH;
      return {
          ...cap,
          laminaBrutaMm,
          percentimetroPct,
          tempoVoltaH,
          energiaKwh,
          custoRs: energiaKwh * eq.tarifaRsKwh,
          limitadoPelaLaminaMax: necessaria > cap.laminaMaxMm,
      };
  }
  // ---- src/motor/balanco.ts ----
  /** Abaixo disso a janela não tem dados suficientes para decidir. */
  const MIN_LEITURAS = 100;
  /** Radiação diária abaixo disso (MJ/m²) é suspeita de falha do sensor. */
  const RAD_SUSPEITA_MJ = 1;
  /** Sem medição de umidade há mais que isso, o balanço começa a derivar. */
  const DIAS_MEDICAO_VELHA = 15;
  const somaPorData = (itens) => {
      var _a;
      const m = new Map();
      for (const i of itens)
          m.set(i.data, ((_a = m.get(i.data)) !== null && _a !== void 0 ? _a : 0) + i.mm);
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
  function simularBalanco({ pivo, estacao, dias, irrigacoes = [], ajustes = [] }) {
      var _a, _b;
      const { solo, cultura } = pivo;
      const irrigPorDia = somaPorData(irrigacoes);
      const ajustePorDia = new Map(ajustes.map((a) => [a.data, a]));
      const linhas = [];
      let ultimaMedicao = null;
      let anterior = null;
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
          const irrigacao = (_a = irrigPorDia.get(dia.data)) !== null && _a !== void 0 ? _a : 0;
          const inicial = anterior !== null && anterior !== void 0 ? anterior : deficitDaUmidade(solo, pivo.umidadeInicialPct, raizCm);
          let deficit = Math.max(0, inicial + etc - dia.chuva - irrigacao);
          const ajuste = ajustePorDia.get(dia.data);
          if (ajuste) {
              deficit = deficitDaUmidade(solo, ajuste.umidadeRaizPct, raizCm);
              ultimaMedicao = dia.data;
          }
          anterior = deficit;
          const decisao = dia.n < MIN_LEITURAS ? "SEM DADOS" : deficit >= pivo.laminaMinimaMm ? "IRRIGAR" : "NÃO IRRIGAR";
          const alertas = [];
          if ((_b = dia.estimados) === null || _b === void 0 ? void 0 : _b.length)
              alertas.push(`Clima estimado pelo dia vizinho (sem leitura de: ${dia.estimados.join(", ")}).`);
          if (dia.n < MIN_LEITURAS)
              alertas.push(`Só ${dia.n} leituras na janela (mínimo ${MIN_LEITURAS}).`);
          if (dia.rad < RAD_SUSPEITA_MJ)
              alertas.push(`Radiação de ${dia.rad.toFixed(2)} MJ/m² — suspeita de falha do sensor.`);
          if (divergenciaHargreaves(et0, hs) > LIMITE_DIVERGENCIA_HS)
              alertas.push(`ET₀ Penman-Monteith (${et0.toFixed(2)}) diverge mais de 35% da Hargreaves (${hs.toFixed(2)}).`);
          if (deficit >= afdMm)
              alertas.push(`Déficit de ${deficit.toFixed(1)} mm passou da AFD (${afdMm.toFixed(1)} mm): risco de estresse.`);
          if ((ajuste === null || ajuste === void 0 ? void 0 : ajuste.umidadeProfundaPct) !== undefined) {
              const limiteSeco = solo.cc - f * (solo.cc - solo.pmp);
              if (ajuste.umidadeProfundaPct >= solo.cc)
                  alertas.push("Camada profunda na capacidade de campo: risco de percolação.");
              else if (ajuste.umidadeProfundaPct <= limiteSeco)
                  alertas.push("Camada profunda muito seca.");
          }
          if ((ajuste === null || ajuste === void 0 ? void 0 : ajuste.tensaoKpa) !== undefined && ajuste.tensaoKpa <= pivo.tensaoIrrigarKpa)
              alertas.push(`Tensiômetro em ${ajuste.tensaoKpa} kPa (limite ${pivo.tensaoIrrigarKpa} kPa): irrigar.`);
          const diasSemMedicao = das(dia.data, ultimaMedicao !== null && ultimaMedicao !== void 0 ? ultimaMedicao : dias[0].data);
          if (diasSemMedicao > DIAS_MEDICAO_VELHA)
              alertas.push(`Última medição de umidade há ${diasSemMedicao} dias.`);
          let recomendacao;
          if (pivo.equipamento) {
              recomendacao = recomendar(pivo.equipamento, deficit);
              if (pivo.laminaMinimaMm < recomendacao.lamina100Mm * (pivo.equipamento.eficienciaPct / 100))
                  alertas.push(`Lâmina mínima (${pivo.laminaMinimaMm} mm) é menor do que o pivô aplica a 100% ` +
                      `(${recomendacao.lamina100Mm.toFixed(1)} mm brutos).`);
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
  // ---- src/motor/cadastro.ts ----
  /** Cadastro da fazenda (estação e pivôs) e sua validação — usado pelo banco e pela planilha. */
  
  const DATA = /^\d{4}-\d{2}-\d{2}$/;
  function fusoValidoIntl(fuso) {
      try {
          new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
          return true;
      }
      catch {
          return false;
      }
  }
  /** Confere o cadastro e devolve a lista de problemas (vazia = ok). */
  function validarCadastro(c, fusoValido = fusoValidoIntl) {
      var _a, _b, _c, _d, _e, _f;
      const erros = [];
      const num = (v, onde, min = -Infinity, max = Infinity) => {
          if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
              erros.push(`${onde}: número inválido (${v})`);
      };
      num((_a = c.estacao) === null || _a === void 0 ? void 0 : _a.latitude, "estacao.latitude", -90, 90);
      num((_b = c.estacao) === null || _b === void 0 ? void 0 : _b.altitude, "estacao.altitude", -500, 6000);
      num((_c = c.estacao) === null || _c === void 0 ? void 0 : _c.alturaAnemometro, "estacao.alturaAnemometro", 0.5, 20);
      if (!((_d = c.estacao) === null || _d === void 0 ? void 0 : _d.fuso) || !fusoValido(c.estacao.fuso))
          erros.push(`estacao.fuso: fuso desconhecido (${(_e = c.estacao) === null || _e === void 0 ? void 0 : _e.fuso})`);
      const nomes = new Set();
      ((_f = c.pivos) !== null && _f !== void 0 ? _f : []).forEach((p, i) => {
          var _a, _b, _c, _d, _e, _f, _g;
          const o = `pivos[${i}] (${p.nome})`;
          if (!p.nome)
              erros.push(`pivos[${i}]: falta o nome`);
          if (nomes.has(p.nome))
              erros.push(`${o}: nome repetido`);
          nomes.add(p.nome);
          if (!CULTURAS[p.cultura])
              erros.push(`${o}: cultura "${p.cultura}" não cadastrada (há: ${Object.keys(CULTURAS).join(", ")})`);
          if (!DATA.test((_a = p.plantio) !== null && _a !== void 0 ? _a : ""))
              erros.push(`${o}: plantio deve ser AAAA-MM-DD`);
          if (p.inicioBalanco !== undefined && !DATA.test(p.inicioBalanco))
              erros.push(`${o}: inicioBalanco deve ser AAAA-MM-DD`);
          num(p.umidadeInicialPct, `${o}.umidadeInicialPct`, 0, 100);
          num((_b = p.solo) === null || _b === void 0 ? void 0 : _b.cc, `${o}.solo.cc`, 0, 100);
          num((_c = p.solo) === null || _c === void 0 ? void 0 : _c.pmp, `${o}.solo.pmp`, 0, 100);
          if (p.solo && p.solo.pmp >= p.solo.cc)
              erros.push(`${o}: PMP precisa ser menor que a CC`);
          num((_d = p.solo) === null || _d === void 0 ? void 0 : _d.raizIniCm, `${o}.solo.raizIniCm`, 0, 300);
          num((_e = p.solo) === null || _e === void 0 ? void 0 : _e.raizMaxCm, `${o}.solo.raizMaxCm`, 0, 300);
          num((_f = p.solo) === null || _f === void 0 ? void 0 : _f.diasRaiz, `${o}.solo.diasRaiz`, 1, 400);
          if (((_g = p.solo) === null || _g === void 0 ? void 0 : _g.fatorDeplecaoFixo) != null)
              num(p.solo.fatorDeplecaoFixo, `${o}.solo.fatorDeplecaoFixo`, 0.05, 1);
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
  // ---- src/coletor/tempo.ts ----
  const formatadores = new Map();
  function formatador(fuso) {
      let f = formatadores.get(fuso);
      if (!f) {
          f = new Intl.DateTimeFormat("en-CA", {
              timeZone: fuso,
              year: "numeric", month: "2-digit", day: "2-digit",
              hour: "2-digit", minute: "2-digit", second: "2-digit",
              hourCycle: "h23",
          });
          formatadores.set(fuso, f);
      }
      return f;
  }
  /** Instante (ms desde 1970) → data e hora locais "YYYY-MM-DDTHH:MM:SS" no fuso da estação. */
  function paraLocal(ms, fuso) {
      const p = Object.fromEntries(formatador(fuso).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  }
  /** Data e hora locais → instante (ms). */
  function deLocal(local, fuso) {
      const comoUtc = Date.parse(local + "Z");
      const desvio = Date.parse(paraLocal(comoUtc, fuso) + "Z") - comoUtc;
      return comoUtc - desvio;
  }
  /** Minutos entre duas datas-hora locais (b − a). */
  const minutosEntre = (a, b) => (Date.parse(b + "Z") - Date.parse(a + "Z")) / 60000;
  /** Soma minutos a uma data-hora local. */
  const somarMinutos = (a, min) => new Date(Date.parse(a + "Z") + min * 60000).toISOString().slice(0, 19);
  // ---- src/coletor/ecowitt.ts ----
  /**
   * Cliente da API v3 da Ecowitt (ecowitt.net).
   *
   * Tempo real: GET /device/real_time → cada grandeza vem como { time, unit, value }.
   * Histórico:  GET /device/history   → cada grandeza vem como { unit, list: { "<unix>": "<valor>" } }.
   *
   * As unidades são pedidas em SI na URL, mas a conversão sempre olha o `.unit` da resposta.
   */
  
  
  const URL_BASE = "https://api.ecowitt.net/api/v3";
  /** ℃, km/h, mm, W/m² — mesmos ids usados por clientes da API v3. */
  const UNIDADES = { temp_unitid: "1", wind_speed_unitid: "7", rainfall_unitid: "12", solar_irradiance_unitid: "16" };
  class ErroEcowitt extends Error {
      constructor(msg, codigo) {
          super(msg);
          this.codigo = codigo;
      }
  }
  const MINUTOS_DO_CICLO = { "5min": 5, "30min": 30, "4hour": 240, "1day": 1440 };
  /** Retenção do ecowitt.net: 5 min por ~90 dias, 30 min por ~1 ano, 4 h por ~2 anos. */
  function cicloParaIdade(dias) {
      if (dias <= 89)
          return "5min";
      if (dias <= 364)
          return "30min";
      return "4hour";
  }
  function credenciais(cfg) {
      return new URLSearchParams({ application_key: cfg.applicationKey, api_key: cfg.apiKey, mac: cfg.mac, ...UNIDADES });
  }
  async function chamar(fetchFn, url) {
      var _a;
      const resp = await fetchFn(url);
      if (!resp.ok)
          throw new ErroEcowitt(`HTTP ${resp.status} da Ecowitt`);
      const corpo = (await resp.json());
      if (corpo.code !== 0)
          throw new ErroEcowitt(`Ecowitt recusou: ${(_a = corpo.msg) !== null && _a !== void 0 ? _a : "sem mensagem"} (code ${corpo.code})`, corpo.code);
      return corpo.data;
  }
  const grupoChuva = (d, cfg) => { var _a, _b, _c; return (_c = (_b = d[(_a = cfg.grupoChuva) !== null && _a !== void 0 ? _a : "rainfall"]) !== null && _b !== void 0 ? _b : d.rainfall) !== null && _c !== void 0 ? _c : d.rainfall_piezo; };
  function converter(v, conv) {
      const x = numero(v === null || v === void 0 ? void 0 : v.value);
      return x === null ? null : conv(x, v === null || v === void 0 ? void 0 : v.unit);
  }
  /** Resposta do tempo real → uma leitura. O horário é o da medição na estação, não o da consulta. */
  function leituraDoTempoReal(data, cfg) {
      var _a, _b, _c, _d, _e, _f;
      if (!data || typeof data !== "object" || Array.isArray(data))
          throw new ErroEcowitt("Ecowitt retornou dados vazios.");
      const d = data;
      const campos = {
          temp: (_a = d.outdoor) === null || _a === void 0 ? void 0 : _a.temperature,
          ur: (_b = d.outdoor) === null || _b === void 0 ? void 0 : _b.humidity,
          rad: (_c = d.solar_and_uvi) === null || _c === void 0 ? void 0 : _c.solar,
          chuva: (_d = grupoChuva(d, cfg)) === null || _d === void 0 ? void 0 : _d.daily,
          vento: (_e = d.wind) === null || _e === void 0 ? void 0 : _e.wind_speed,
      };
      const tempos = Object.values(campos).map((c) => Number(c === null || c === void 0 ? void 0 : c.time)).filter((t) => Number.isFinite(t) && t > 0);
      if (tempos.length === 0)
          throw new ErroEcowitt("Resposta da Ecowitt sem horário de medição.");
      return {
          quando: paraLocal(Math.max(...tempos) * 1000, cfg.fuso),
          chuvaAcumDia: converter(campos.chuva, paraMm),
          tempC: converter(campos.temp, paraCelsius),
          urPct: numero((_f = campos.ur) === null || _f === void 0 ? void 0 : _f.value),
          radWm2: converter(campos.rad, paraWm2),
          ventoMs: converter(campos.vento, paraMs),
          intervaloMin: 10,
          fonte: "ecowitt",
      };
  }
  /** Resposta do histórico → leituras, uma por instante, juntando as séries pelo timestamp. */
  function leiturasDoHistorico(data, cfg, ciclo) {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      if (!data || typeof data !== "object" || Array.isArray(data))
          return []; // período sem dados vem como []
      const d = data;
      const porInstante = new Map();
      const leitura = (ts) => {
          let l = porInstante.get(ts);
          if (!l) {
              l = {
                  quando: paraLocal(Number(ts) * 1000, cfg.fuso),
                  chuvaAcumDia: null, tempC: null, urPct: null, radWm2: null, ventoMs: null,
                  intervaloMin: MINUTOS_DO_CICLO[ciclo],
                  fonte: `ecowitt-historico-${ciclo}`,
              };
              porInstante.set(ts, l);
          }
          return l;
      };
      const serie = (s, campo, conv) => {
          var _a;
          for (const [ts, bruto] of Object.entries((_a = s === null || s === void 0 ? void 0 : s.list) !== null && _a !== void 0 ? _a : {})) {
              const x = numero(bruto);
              if (x !== null && Number.isFinite(Number(ts)))
                  leitura(ts)[campo] = conv(x, s === null || s === void 0 ? void 0 : s.unit);
          }
      };
      serie((_a = d.outdoor) === null || _a === void 0 ? void 0 : _a.temperature, "tempC", paraCelsius);
      serie((_b = d.outdoor) === null || _b === void 0 ? void 0 : _b.humidity, "urPct", (x) => x);
      serie((_c = d.solar_and_uvi) === null || _c === void 0 ? void 0 : _c.solar, "radWm2", paraWm2);
      serie((_g = ((_f = (_e = d[(_d = cfg.grupoChuva) !== null && _d !== void 0 ? _d : "rainfall"]) !== null && _e !== void 0 ? _e : d.rainfall) !== null && _f !== void 0 ? _f : d.rainfall_piezo)) === null || _g === void 0 ? void 0 : _g.daily, "chuvaAcumDia", paraMm);
      serie((_h = d.wind) === null || _h === void 0 ? void 0 : _h.wind_speed, "ventoMs", paraMs);
      return [...porInstante.values()].sort((a, b) => (a.quando < b.quando ? -1 : 1));
  }
  class ClienteEcowitt {
      constructor(cfg, fetchFn = fetch) {
          this.cfg = cfg;
          this.fetchFn = fetchFn;
      }
      async tempoReal() {
          const p = credenciais(this.cfg);
          p.set("call_back", "all");
          return leituraDoTempoReal(await chamar(this.fetchFn, `${URL_BASE}/device/real_time?${p}`), this.cfg);
      }
      /** Datas no formato que a API espera ("YYYY-MM-DD HH:MM:SS"). */
      async historico(ini, fim, ciclo) {
          var _a;
          const p = credenciais(this.cfg);
          p.set("start_date", ini.replace("T", " "));
          p.set("end_date", fim.replace("T", " "));
          p.set("cycle_type", ciclo);
          p.set("call_back", ["outdoor", "solar_and_uvi", (_a = this.cfg.grupoChuva) !== null && _a !== void 0 ? _a : "rainfall", "wind"].join(","));
          return leiturasDoHistorico(await chamar(this.fetchFn, `${URL_BASE}/device/history?${p}`), this.cfg, ciclo);
      }
  }
  // ---- src/coletor/lacunas.ts ----
  /** Folga além do intervalo esperado antes de considerar que faltou leitura. */
  const TOLERANCIA = 1.5;
  const INTERVALO_PADRAO = 10;
  const limite = (a, b) => { var _a, _b; return TOLERANCIA * Math.max((_a = a === null || a === void 0 ? void 0 : a.intervaloMin) !== null && _a !== void 0 ? _a : INTERVALO_PADRAO, (_b = b === null || b === void 0 ? void 0 : b.intervaloMin) !== null && _b !== void 0 ? _b : INTERVALO_PADRAO); };
  /**
   * Buracos na série entre `ini` e `fim`. Um buraco é um espaço entre leituras maior que 1,5× o
   * intervalo delas (15 min para leituras ao vivo, 45 min para histórico de 30 min).
   */
  function encontrarLacunas(leituras, ini, fim) {
      const ls = leituras.filter((l) => l.quando >= ini && l.quando <= fim).sort((a, b) => (a.quando < b.quando ? -1 : 1));
      const lacunas = [];
      let anterior;
      let marco = ini;
      for (const l of ls) {
          if (minutosEntre(marco, l.quando) > limite(anterior, l))
              lacunas.push({ de: marco, ate: l.quando });
          anterior = l;
          marco = l.quando;
      }
      if (minutosEntre(marco, fim) > limite(anterior))
          lacunas.push({ de: marco, ate: fim });
      return lacunas;
  }
  // ---- src/job/mensagem.ts ----
  /** Número no formato brasileiro (1.234,5) sem depender do Intl — o Apps Script nem sempre tem pt-BR. */
  function br_(x, casas) {
      const [int, dec] = Math.abs(x).toFixed(casas).split(".");
      const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return `${x < 0 && Number(x.toFixed(casas)) !== 0 ? "-" : ""}${milhar}${dec ? "," + dec : ""}`;
  }
  const n1 = (x) => br_(x, 1);
  const n2 = (x) => br_(x, 2);
  const n0 = (x) => br_(x, 0);
  const br = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  function horas(h) {
      const total = Math.round(h * 60);
      return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
  }
  /** Texto do relatório do dia — curto para caber no WhatsApp, com *negrito* no estilo do WhatsApp. */
  function montarMensagem(data, clima, itens) {
      var _a, _b;
      const irrigar = itens.filter((i) => { var _a; return ((_a = i.linha) === null || _a === void 0 ? void 0 : _a.decisao) === "IRRIGAR"; }).length;
      const assunto = `Manejo ${br(data)}: ${irrigar ? `irrigar ${irrigar} pivô(s)` : "nenhum pivô para irrigar"}`;
      const l = [
          `💧 *Manejo de irrigação — ${br(data)}*`,
          `Janela ${br(diaAnterior(data))} 18h → ${br(data)} 18h`,
          `ET₀ ${n1(clima.et0)} mm · chuva ${n1(clima.chuva)} mm · ${clima.n} de 144 leituras`,
      ];
      if ((_a = clima.estimados) === null || _a === void 0 ? void 0 : _a.length)
          l.push(`⚠️ Estação sem dado de ${clima.estimados.join(", ")}: valores do dia vizinho.`);
      for (const it of itens) {
          l.push("");
          const x = it.linha;
          if (!x) {
              l.push(`*${it.pivo.nome}* — ${(_b = it.aviso) !== null && _b !== void 0 ? _b : "sem cálculo"}`);
              continue;
          }
          l.push(`*${it.pivo.nome}* — ${it.pivo.cultura.nome} ${x.estadio}, ${x.das} DAS`);
          if (x.decisao === "IRRIGAR") {
              l.push(`🚿 *IRRIGAR* — repor ${n1(x.deficit)} mm`);
              const r = x.recomendacao;
              if (r) {
                  l.push(`   Percentímetro *${n0(r.percentimetroPct)}%* · volta ${horas(r.tempoVoltaH)} · ${n1(r.laminaBrutaMm)} mm brutos`);
                  l.push(`   Energia ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
              }
              else {
                  l.push("   (cadastre o equipamento para ter percentímetro, tempo e custo)");
              }
          }
          else if (x.decisao === "SEM DADOS") {
              l.push(`⛔ *SEM DADOS* — estação com poucas leituras; déficit estimado ${n1(x.deficit)} mm`);
          }
          else {
              l.push(`✅ NÃO IRRIGAR — déficit ${n1(x.deficit)} mm`);
          }
          l.push(`   ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · AFD ${n1(x.afdMm)} mm${x.irrigacao ? ` · irrigado hoje ${n1(x.irrigacao)} mm` : ""}`);
          for (const a of x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado")))
              l.push(`   ⚠️ ${a}`);
          if (it.diasIncertos)
              l.push(`   ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.`);
      }
      return { assunto, texto: l.join("\n") };
  }

  // No Apps Script, a hora local vem do Utilities (independe do suporte a Intl).
  if (typeof Utilities !== "undefined") {
    paraLocal = function (ms, fuso) {
      return Utilities.formatDate(new Date(ms), fuso, "yyyy-MM-dd'T'HH:mm:ss");
    };
  }

  return { numero, UnidadeDesconhecida, paraCelsius, paraMm, paraMs, paraWm2, wm2ParaMJDia, HORA_FECHAMENTO, diaAnterior, agregarDia, proximoDia, datasEntre, climaCompleto, eSat, diaDoAno, radiacaoExtraterrestre, ventoA2m, et0PenmanMonteith, et0Hargreaves, LIMITE_DIVERGENCIA_HS, divergenciaHargreaves, SOJA, das, estadioPorDas, kcDoDia, CULTURAS, profundidadeRaiz, cad, fatorDeplecaoPorEt0, fatorDeplecao, deficitDaUmidade, capacidade, recomendar, MIN_LEITURAS, RAD_SUSPEITA_MJ, DIAS_MEDICAO_VELHA, simularBalanco, DATA, validarCadastro, paraLocal, deLocal, minutosEntre, somarMinutos, URL_BASE, ErroEcowitt, MINUTOS_DO_CICLO, cicloParaIdade, leituraDoTempoReal, leiturasDoHistorico, ClienteEcowitt, encontrarLacunas, montarMensagem };
})();

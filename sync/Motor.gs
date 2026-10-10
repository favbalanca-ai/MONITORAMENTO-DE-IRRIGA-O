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
  /**
   * Converte para SI pelo texto da unidade, sem saber a grandeza (para os extras da estação).
   * Unidade desconhecida ou vazia: devolve o valor como veio.
   */
  function paraSI(v, u) {
      const x = unidade(u);
      if (x === "℉" || x === "°f" || x === "f")
          return { valor: ((v - 32) * 5) / 9, unidade: "°C" };
      if (x === "℃" || x === "°c" || x === "c")
          return { valor: v, unidade: "°C" };
      if (x === "in/hr" || x === "in/h")
          return { valor: v * 25.4, unidade: "mm/h" };
      if (x === "in" || x === "inch" || x === "inches")
          return { valor: v * 25.4, unidade: "mm" };
      if (x === "mph")
          return { valor: v * 0.44704, unidade: "m/s" };
      if (x === "km/h" || x === "kmh")
          return { valor: v / 3.6, unidade: "m/s" };
      if (x === "knots" || x === "kn" || x === "knot")
          return { valor: v * 0.514444, unidade: "m/s" };
      if (x === "ft/s")
          return { valor: v * 0.3048, unidade: "m/s" };
      if (x === "inhg")
          return { valor: v * 33.8639, unidade: "hPa" };
      if (x === "mmhg")
          return { valor: v * 1.33322, unidade: "hPa" };
      if (x === "lux")
          return { valor: v / 126.7, unidade: "W/m²" };
      if (x === "mi" || x === "mile" || x === "miles")
          return { valor: v * 1.609344, unidade: "km" };
      if (x === "ft" || x === "feet")
          return { valor: v * 0.3048, unidade: "m" };
      return { valor: v, unidade: u !== null && u !== void 0 ? u : "" };
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
          n: fatiasCobertas(janela, ini, fim),
          horasSol: horasDeSol(janela),
      };
  }
  /** Radiação a partir da qual a leitura conta como "sol" (W/m²) — o limiar clássico de insolação do heliógrafo. */
  const RAD_SOL_WM2 = 120;
  /** Horas de sol efetivo: leituras com radiação acima do limiar, cada uma valendo o seu intervalo. */
  function horasDeSol(janela) {
      var _a;
      let min = 0;
      for (const l of janela)
          if (l.radWm2 !== null && l.radWm2 > RAD_SOL_WM2)
              min += (_a = l.intervaloMin) !== null && _a !== void 0 ? _a : 10;
      return Math.round((min / 60) * 10) / 10;
  }
  /**
   * Quanto da janela tem leitura, em equivalentes de 10 min (máximo 144). Cada leitura "vale" o tempo do seu
   * intervalo a partir dela (10 min ao vivo, 30 min no histórico), cortado no fim da janela; o que se sobrepõe
   * conta uma vez só. Assim a coleta ao vivo às 08:32 e a recuperação do histórico às 08:30, ou duas leituras
   * segundos uma da outra, não somam — antes `n` passava de 144. As médias continuam usando todas as leituras
   * (repetidas têm o mesmo valor; é o que a planilha original fazia).
   */
  function fatiasCobertas(janela, ini, fim) {
      const tFim = Date.parse(fim + "Z");
      const tramos = janela
          .map((l) => { var _a; const a = Date.parse(l.quando + "Z"); return [a, Math.min(tFim, a + ((_a = l.intervaloMin) !== null && _a !== void 0 ? _a : 10) * 60000)]; })
          .sort((a, b) => a[0] - b[0]);
      let coberto = 0, ate = Date.parse(ini + "Z");
      for (const [a, b] of tramos) {
          if (b <= ate)
              continue;
          coberto += b - Math.max(a, ate);
          ate = b;
      }
      return Math.min(144, Math.ceil(coberto / 600000 - 1e-9));
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
  /** Fotoperíodo: horas entre o nascer e o pôr do sol pela latitude e data — FAO-56 eq. 34 (N = 24/π · ωs). */
  function fotoperiodoH(latitude, data) {
      const j = diaDoAno(data);
      const phi = (latitude * Math.PI) / 180;
      const delta = 0.409 * Math.sin((2 * Math.PI * j) / 365 - 1.39);
      const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
      return (24 / Math.PI) * ws;
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
      fonte: "Aba KC da planilha original da fazenda.",
      sugestao: { raizMaxCm: 50, diasRaiz: 55, tensaoIrrigarKpa: -70, porque: "Raiz de 50 cm aos 55 dias e tensão de −70 kPa, como no exemplo da fazenda." },
      tBaseC: 10,
  };
  /**
   * Soja precoce (cultivares de grupo de maturação 5.x–6.x, ~100 dias no Cerrado). Mesmos degraus de Kc da
   * soja, nas mesmas frações do ciclo: V1 até ~17 d, V3 ~30 d, R1 ~46 d, R3 ~63 d, R5 ~83 d, R7 100 d.
   * Raiz máxima mais cedo (45 cm aos 45 dias). Valores de referência — o agrônomo precisa validar.
   */
  const SOJA_PRECOCE = {
      ...SOJA,
      nome: "Soja precoce",
      cicloDias: 100,
      fonte: "Kc da aba KC da planilha original; ciclo de 100 dias das cultivares precoces (Embrapa Soja, Tecnologias de Produção de Soja).",
      sugestao: { raizMaxCm: 45, diasRaiz: 45, tensaoIrrigarKpa: -70, porque: "Ciclo curto: a raiz chega a 45 cm por volta dos 45 dias; tensão de −70 kPa como na soja." },
  };
  /** Monta estádios a partir de "até o dia N" (as tabelas da Embrapa vêm em dias). */
  function porDias(ciclo, linhas) {
      return linhas.map(([nome, ateDia, kc, kcFim]) => ({ nome, ateFracao: ateDia / ciclo, kc, ...(kcFim === undefined ? {} : { kcFim }) }));
  }
  /**
   * Milho grão, ciclo de 120 dias. Curva de 4 fases da Embrapa Milho e Sorgo (planilha de manejo e
   * Comunicado Técnico 47): fases de 17%, 28%, 33% e 22% do ciclo; Kc 0,50 na fase inicial, sobe em
   * linha reta até 1,20 no florescimento/enchimento e desce até 0,60 na maturação (FAO-56, adotado pela Embrapa).
   */
  const MILHO = {
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
      tBaseC: 10,
  };
  /**
   * Sorgo granífero, ciclo de 120 dias. Fases de 24, 42, 30 e 24 dias (Embrapa, Comunicado Técnico 254,
   * 2021); Kc 0,50 → 1,10 → 0,55 (FAO-56, faixa 1,00–1,15 citada pela Embrapa).
   */
  const SORGO = {
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
      tBaseC: 10,
  };
  /**
   * Feijão comum, sistema convencional. Tabela de Kc por dias após a emergência (DAE) da Agência de
   * Informação Embrapa (Embrapa Arroz e Feijão, manejo de irrigação). Ciclo de 94 DAE.
   */
  const FEIJAO = {
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
      tBaseC: 3,
  };
  /**
   * Feijão em plantio direto (medido na cv. Aporé): germinação até início da floração 35 dias (Kc 0,69),
   * floração 25 dias (1,28), formação de vagens até maturação 20 dias (1,04). Já medido sobre palhada.
   */
  const FEIJAO_PD = {
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
      tBaseC: 3,
  };
  /**
   * Trigo irrigado no Cerrado (BRS 394, Embrapa Cerrados): Kc = −0,000268·DAE² + 0,032979·DAE + 0,392945.
   * Médias por fase no trabalho: 0,57 / 0,97 / 1,28 / 1,39 / 1,08. Ciclo de ~115 DAE.
   * Atenção: o Kc foi ajustado com a ET₀ de Hargreaves-Samani.
   */
  const TRIGO = {
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
      tBaseC: 0,
  };
  /**
   * Algodão herbáceo: Kc = −0,00006·DAE² + 0,009·DAE + 0,632 (Embrapa Algodão, BRS 200 Marrom).
   * Pico de ~0,97 aos 75 DAE. Ciclo de 150 DAE. Dados do Nordeste: conferir para o Cerrado.
   */
  const ALGODAO = {
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
      tBaseC: 15,
  };
  /** Dias após a semeadura. */
  function das(data, plantio) {
      return Math.round((Date.parse(data + "T00:00:00Z") - Date.parse(plantio + "T00:00:00Z")) / 86400000);
  }
  /**
   * Mesma cultura com outro ciclo (a cultivar que a fazenda plantou). As frações dos estádios se mantêm;
   * uma equação por DAE é esticada/encolhida na mesma proporção. Ciclo vazio/igual devolve a própria cultura.
   */
  function comCiclo(cultura, cicloDias) {
      var _a;
      const padrao = (_a = cultura.cicloPadraoDias) !== null && _a !== void 0 ? _a : cultura.cicloDias;
      if (!cicloDias || cicloDias === cultura.cicloDias)
          return cultura;
      return { ...cultura, cicloDias, cicloPadraoDias: padrao };
  }
  /** Último DAS do ciclo (emergência + ciclo). Depois disso o Kc fica parado no final e o balanço avisa. */
  function fimDoCicloDas(cultura) {
      var _a;
      return ((_a = cultura.emergenciaDias) !== null && _a !== void 0 ? _a : 0) + cultura.cicloDias;
  }
  /** Kc de cada dia, do plantio até o fim do ciclo (para desenhar a curva). */
  function curvaKc(cultura, palhada) {
      const fim = fimDoCicloDas(cultura);
      const kcs = [];
      for (let d = 0; d <= fim; d++)
          kcs.push(Math.round(kcDoDia(cultura, d, palhada).kc * 1000) / 1000);
      return kcs;
  }
  /** Dias após a emergência (antes da emergência conta como 0). Sem `emergenciaDias`, é o próprio DAS. */
  function dae(cultura, diasAposSemeadura) {
      var _a;
      return Math.max(0, diasAposSemeadura - ((_a = cultura.emergenciaDias) !== null && _a !== void 0 ? _a : 0));
  }
  /**
   * Fração do ciclo já percorrida. Por dias corridos (DAE/ciclo) ou, quando o pivô tem os graus-dia da
   * cultivar e a cultura tem temperatura-base, pela soma térmica acumulada (GD/GD do ciclo).
   */
  function fracaoCiclo(cultura, diasAposSemeadura, grausDia) {
      if (grausDia && grausDia.ciclo > 0)
          return Math.max(0, grausDia.acumulado) / grausDia.ciclo;
      return dae(cultura, diasAposSemeadura) / cultura.cicloDias;
  }
  /** Graus-dia de um dia: temperatura média acima da base (nunca negativo). */
  function grausDiaDoDia(cultura, tmed) {
      return cultura.tBaseC === undefined || !Number.isFinite(tmed) ? 0 : Math.max(0, tmed - cultura.tBaseC);
  }
  /** Estádio pela fração do ciclo. Depois do fim do ciclo, fica no último estádio. */
  function estadioPorDas(cultura, diasAposSemeadura, fracao) {
      var _a;
      const f = fracao !== null && fracao !== void 0 ? fracao : dae(cultura, diasAposSemeadura) / cultura.cicloDias;
      const e = (_a = cultura.estadios.find((x) => f <= x.ateFracao)) !== null && _a !== void 0 ? _a : cultura.estadios[cultura.estadios.length - 1];
      if (!e)
          throw new Error(`Cultura ${cultura.nome} sem estádios cadastrados.`);
      return e;
  }
  /** Kc sem a correção da palhada: equação, reta dentro do estádio ou degrau. */
  function kcBase(cultura, estadio, diasAposSemeadura, fracao) {
      var _a;
      const f = fracao !== null && fracao !== void 0 ? fracao : dae(cultura, diasAposSemeadura) / cultura.cicloDias;
      if (cultura.kcEquacao) {
          const [a, b, c] = cultura.kcEquacao;
          const padrao = (_a = cultura.cicloPadraoDias) !== null && _a !== void 0 ? _a : cultura.cicloDias;
          const x = Math.min(1, f) * padrao; // "dia equivalente" no ciclo padrão da equação
          return a * x * x + b * x + c;
      }
      if (estadio.kcFim === undefined)
          return estadio.kc;
      const i = cultura.estadios.indexOf(estadio);
      const ini = i > 0 ? cultura.estadios[i - 1].ateFracao : 0;
      const t = Math.min(1, Math.max(0, (f - ini) / (estadio.ateFracao - ini)));
      return estadio.kc + (estadio.kcFim - estadio.kc) * t;
  }
  /**
   * Kc do dia. Em plantio direto sobre palhada, o Kc do primeiro estádio cai pela metade
   * (Embrapa Milho e Sorgo; aplicado à soja por analogia).
   */
  function kcDoDia(cultura, diasAposSemeadura, palhada, fracao) {
      const estadio = estadioPorDas(cultura, diasAposSemeadura, fracao);
      const kc = kcBase(cultura, estadio, diasAposSemeadura, fracao);
      const primeiro = estadio === cultura.estadios[0];
      return { estadio, kc: palhada && primeiro && !cultura.kcJaComPalhada ? kc * 0.5 : kc };
  }
  /**
   * Catálogo de culturas por chave (a escrita na coluna Cultura da aba PIVOS).
   * Valores de boletins da Embrapa — referência; o agrônomo precisa validar para a fazenda.
   */
  const CULTURAS = {
      soja: SOJA,
      "soja precoce": SOJA_PRECOCE,
      milho: MILHO,
      sorgo: SORGO,
      feijao: FEIJAO,
      "feijao pd": FEIJAO_PD,
      trigo: TRIGO,
      algodao: ALGODAO,
  };
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
  const PONTA_PADRAO = { inicioH: 18, fimH: 21 };
  /** Horas dentro da ponta numa volta que começa em `inicioH` (hora decimal do dia) e dura `duracaoH`. */
  function horasNaPonta(inicioH, duracaoH, ponta = PONTA_PADRAO) {
      let total = 0;
      for (let dia = 0; dia * 24 < inicioH + duracaoH + 24; dia++) {
          const a = Math.max(inicioH, dia * 24 + ponta.inicioH);
          const b = Math.min(inicioH + duracaoH, dia * 24 + ponta.fimH);
          if (b > a)
              total += b - a;
      }
      return total;
  }
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  /** Lâmina líquida (mm) aplicada numa volta com o percentímetro em `pct` %. */
  function laminaDoPercentimetro(eq, pct) {
      const cap = capacidade(eq);
      const brutaMm = cap.lamina100Mm / (pct / 100);
      return { brutaMm, liquidaMm: brutaMm * (eq.eficienciaPct / 100) };
  }
  /** Ajuste do pivô para repor o déficit líquido (mm) em uma volta. */
  function recomendar(eq, deficitMm, ponta = PONTA_PADRAO) {
      const cap = capacidade(eq);
      const necessaria = deficitMm / (eq.eficienciaPct / 100);
      const laminaBrutaMm = Math.min(cap.laminaMaxMm, Math.max(cap.lamina100Mm, necessaria));
      const percentimetroPct = (cap.lamina100Mm / laminaBrutaMm) * 100;
      const tempoVoltaH = cap.t100h / (percentimetroPct / 100);
      const energiaKwh = eq.potenciaKw * tempoVoltaH;
      const r = {
          ...cap,
          laminaBrutaMm,
          percentimetroPct,
          tempoVoltaH,
          energiaKwh,
          custoRs: energiaKwh * eq.tarifaRsKwh,
          limitadoPelaLaminaMax: necessaria > cap.laminaMaxMm,
      };
      const tarifaPonta = eq.tarifaPontaRsKwh;
      if (tarifaPonta != null && tarifaPonta > 0) {
          const custo = (inicioH) => {
              const hp = horasNaPonta(inicioH, tempoVoltaH, ponta);
              return eq.potenciaKw * ((tempoVoltaH - hp) * eq.tarifaRsKwh + hp * tarifaPonta);
          };
          r.custoRs = custo(ponta.fimH);
          r.ponta = { inicioSugerido: hhmm(ponta.fimH), horasNaPonta: horasNaPonta(ponta.fimH, tempoVoltaH, ponta), custoPiorRs: custo(ponta.inicioH) };
      }
      return r;
  }
  // ---- src/motor/balanco.ts ----
  /** Chuva abaixo disso fica na folha e evapora: não entra no balanço (Embrapa). Configurável na estação. */
  const CHUVA_MINIMA_EFETIVA_MM = 2;
  /** Abaixo disso a janela não tem dados suficientes para decidir. */
  const MIN_LEITURAS = 100;
  /** Radiação diária abaixo disso (MJ/m²) é suspeita de falha do sensor. */
  const RAD_SUSPEITA_MJ = 1;
  /** Sem medição de umidade há mais que isso, o balanço começa a derivar. */
  const DIAS_MEDICAO_VELHA = 15;
  /** Chuva efetiva: abaixo do mínimo não molha o solo. */
  function chuvaEfetiva(chuvaMm, minimoMm) {
      return chuvaMm < minimoMm ? 0 : chuvaMm;
  }
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
  function simularBalanco({ pivo, estacao, dias, irrigacoes = [], ajustes = [], chuvaMinimaMm = CHUVA_MINIMA_EFETIVA_MM, ponta = PONTA_PADRAO, previsao = [] }) {
      var _a, _b;
      const { solo, cultura } = pivo;
      const irrigPorDia = somaPorData(irrigacoes);
      const ajustePorDia = new Map(ajustes.map((a) => [a.data, a]));
      const linhas = [];
      let ultimaMedicao = null;
      let anterior = null;
      // soma térmica: antes do primeiro dia com clima, assume o ritmo médio da cultivar (GD do ciclo / dias do ciclo)
      const usaGrausDia = !!pivo.grausDiaCiclo && cultura.tBaseC !== undefined && dias.length > 0;
      let gdAcum = usaGrausDia ? (das(dias[0].data, pivo.plantio) * pivo.grausDiaCiclo) / fimDoCicloDas(cultura) : 0;
      const fracaoDoDia = (tmed, d) => {
          if (!usaGrausDia)
              return undefined;
          gdAcum += grausDiaDoDia(cultura, tmed);
          return fracaoCiclo(cultura, d, { acumulado: gdAcum, ciclo: pivo.grausDiaCiclo });
      };
      for (const dia of dias) {
          const d = das(dia.data, pivo.plantio);
          const fracao = fracaoDoDia(dia.tmed, d);
          const { estadio, kc } = kcDoDia(cultura, d, pivo.plantioDiretoPalhada, fracao);
          const raizCm = profundidadeRaiz(solo, d);
          const cadMm = cad(solo, raizCm);
          const semLeituras = dia.n < MIN_LEITURAS;
          const et0Externa = semLeituras && dia.et0Externa !== undefined && Number.isFinite(dia.et0Externa) ? dia.et0Externa : null;
          const et0 = et0Externa !== null && et0Externa !== void 0 ? et0Externa : et0PenmanMonteith(dia, estacao);
          const hs = et0Hargreaves(dia, estacao);
          const f = fatorDeplecao(solo, et0);
          const afdMm = cadMm * f;
          const etc = et0 * kc;
          const irrigacao = (_a = irrigPorDia.get(dia.data)) !== null && _a !== void 0 ? _a : 0;
          const chuva = chuvaEfetiva(dia.chuva, chuvaMinimaMm);
          const inicial = anterior !== null && anterior !== void 0 ? anterior : deficitDaUmidade(solo, pivo.umidadeInicialPct, raizCm);
          let deficit = Math.max(0, inicial + etc - chuva - irrigacao);
          const ajuste = ajustePorDia.get(dia.data);
          if (ajuste) {
              deficit = deficitDaUmidade(solo, ajuste.umidadeRaizPct, raizCm);
              ultimaMedicao = dia.data;
          }
          anterior = deficit;
          const decisao = semLeituras && et0Externa === null ? "SEM DADOS" : deficit >= pivo.laminaMinimaMm ? "IRRIGAR" : "NÃO IRRIGAR";
          const alertas = [];
          if (et0Externa !== null)
              alertas.push(`Estação com só ${dia.n} leituras: ET₀ do dia veio do Open-Meteo (${et0Externa.toFixed(2)} mm).`);
          else if ((_b = dia.estimados) === null || _b === void 0 ? void 0 : _b.length)
              alertas.push(`Clima estimado pelo dia vizinho (sem leitura de: ${dia.estimados.join(", ")}).`);
          if (semLeituras && et0Externa === null)
              alertas.push(`Só ${dia.n} leituras na janela (mínimo ${MIN_LEITURAS}).`);
          if (dia.chuva > 0 && chuva === 0)
              alertas.push(`Chuva de ${dia.chuva.toFixed(1)} mm abaixo de ${chuvaMinimaMm} mm: não conta (fica na folha).`);
          if (et0Externa === null && dia.rad < RAD_SUSPEITA_MJ)
              alertas.push(`Radiação de ${dia.rad.toFixed(2)} MJ/m² — suspeita de falha do sensor.`);
          if (et0Externa === null && divergenciaHargreaves(et0, hs) > LIMITE_DIVERGENCIA_HS)
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
          const passouCiclo = d - fimDoCicloDas(cultura);
          if (passouCiclo > 0)
              alertas.push(`Ciclo da cultura encerrado há ${passouCiclo} dia(s): confira o plantio ou desative o pivô.`);
          let recomendacao;
          if (pivo.equipamento) {
              recomendacao = recomendar(pivo.equipamento, deficit, ponta);
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
          ultima.projecao = projetar(pivo, ultima, previsao, usaGrausDia ? { acumulado: gdAcum, ciclo: pivo.grausDiaCiclo } : null, ultima.decisao === "IRRIGAR" ? recomendarSeHouver(pivo, ultima.deficit, ponta) : undefined);
      }
      return linhas;
  }
  function recomendarSeHouver(pivo, deficit, ponta) {
      return pivo.equipamento ? recomendar(pivo.equipamento, deficit, ponta) : undefined;
  }
  /**
   * Projeta o déficit dia a dia com a ET₀ prevista (Open-Meteo), SEM contar chuva (chuva prevista vira
   * aviso, não desconto). Diz quando o déficit passa da lâmina mínima e quanto estará ao fim da volta.
   */
  function projetar(pivo, hoje, previsao, grausDia, rec) {
      const { cultura } = pivo;
      const prox = previsao.filter((p) => p.data > hoje.data && p.et0Mm !== null && p.et0Mm !== undefined).slice(0, 7);
      let deficit = hoje.deficit;
      let gd = grausDia ? grausDia.acumulado : 0;
      const dias = [];
      let proxima = hoje.decisao === "IRRIGAR" ? hoje.data : null;
      for (const p of prox) {
          const d = das(p.data, pivo.plantio);
          let fracao;
          if (grausDia) {
              const tmed = p.tmax !== null && p.tmin !== null ? (p.tmax + p.tmin) / 2 : NaN;
              gd += grausDiaDoDia(cultura, tmed);
              fracao = fracaoCiclo(cultura, d, { acumulado: gd, ciclo: grausDia.ciclo });
          }
          const { kc } = kcDoDia(cultura, d, pivo.plantioDiretoPalhada, fracao);
          const et0 = p.et0Mm;
          deficit = Math.max(0, deficit + et0 * kc);
          dias.push({ data: p.data, deficit: Math.round(deficit * 10) / 10, et0, kc });
          if (proxima === null && deficit >= pivo.laminaMinimaMm)
              proxima = p.data;
      }
      const emDias = proxima === null ? null : das(proxima, hoje.data);
      const primeiro = dias[0];
      const deficitFimVoltaMm = rec && primeiro ? Math.round((hoje.deficit + (primeiro.et0 * primeiro.kc * rec.tempoVoltaH) / 24) * 10) / 10 : undefined;
      return { proximaIrrigacao: proxima, emDias, deficitFimVoltaMm, dias, horizonte: dias.length };
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
          if (p.cicloDias != null)
              num(p.cicloDias, `${o}.cicloDias`, 30, 400);
          if (p.grausDiaCiclo != null)
              num(p.grausDiaCiclo, `${o}.grausDiaCiclo`, 200, 6000);
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
          if (p.latitude != null)
              num(p.latitude, `${o}.latitude`, -90, 90);
          if (p.longitude != null)
              num(p.longitude, `${o}.longitude`, -180, 180);
          if ((p.latitude == null) !== (p.longitude == null))
              erros.push(`${o}: latitude e longitude precisam vir juntas`);
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
              if (e.tarifaPontaRsKwh != null)
                  num(e.tarifaPontaRsKwh, `${o}.equipamento.tarifaPontaRsKwh`, 0);
          }
      });
      return erros;
  }
  // ---- src/motor/previsao.ts ----
  const INMET_URL = "https://apiprevmet3.inmet.gov.br/previsao/";
  /** Pede também os 7 dias passados: a ET₀ deles tapa dias em que a estação ficou sem leituras. */
  function urlOpenMeteo(latitude, longitude, fuso, dias = 7, passados = 7) {
      return ("https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
          "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration" +
          "&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias + "&past_days=" + passados);
  }
  const num = (v) => {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
      return Number.isFinite(n) ? n : null;
  };
  /** Resposta do Open-Meteo (`daily.time[]` + séries) → um item por dia. */
  function lerOpenMeteo(json) {
      const d = json === null || json === void 0 ? void 0 : json.daily;
      if (!d || !Array.isArray(d["time"]))
          throw new Error("Open-Meteo: resposta sem a série diária.");
      return d["time"].map((t, i) => {
          var _a, _b, _c, _d, _e;
          return ({
              data: String(t).slice(0, 10),
              chuvaMm: num((_a = d["precipitation_sum"]) === null || _a === void 0 ? void 0 : _a[i]),
              probPct: num((_b = d["precipitation_probability_max"]) === null || _b === void 0 ? void 0 : _b[i]),
              tmax: num((_c = d["temperature_2m_max"]) === null || _c === void 0 ? void 0 : _c[i]),
              tmin: num((_d = d["temperature_2m_min"]) === null || _d === void 0 ? void 0 : _d[i]),
              et0Mm: num((_e = d["et0_fao_evapotranspiration"]) === null || _e === void 0 ? void 0 : _e[i]),
          });
      });
  }
  /**
   * Resposta do INMET (`{ "<ibge>": { "dd/mm/aaaa": { manha, tarde, noite } | {...} } }`) → um item por dia,
   * com o resumo por turno. Os dois primeiros dias vêm por turno; os demais, inteiros.
   */
  function lerInmet(json) {
      var _a;
      const raiz = json;
      const porCidade = raiz && Object.values(raiz)[0];
      if (!porCidade || typeof porCidade !== "object")
          throw new Error("INMET: resposta sem previsão para o município.");
      const dias = [];
      for (const [dataBr, v] of Object.entries(porCidade)) {
          const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr);
          if (!m || !v || typeof v !== "object")
              continue;
          const data = `${m[3]}-${m[2]}-${m[1]}`;
          const turnos = ["manha", "tarde", "noite"].filter((t) => v[t] && typeof v[t] === "object");
          const partes = turnos.length ? turnos.map((t) => v[t]) : [v];
          const rotulo = { manha: "manhã", tarde: "tarde", noite: "noite" };
          const resumo = turnos.length
              ? turnos.map((t, i) => { var _a; return `${rotulo[t]}: ${String((_a = partes[i]["resumo"]) !== null && _a !== void 0 ? _a : "").toLowerCase()}`; }).join("; ")
              : String((_a = v["resumo"]) !== null && _a !== void 0 ? _a : "").toLowerCase();
          const tmaxs = partes.map((p) => num(p["temp_max"])).filter((x) => x !== null);
          const tmins = partes.map((p) => num(p["temp_min"])).filter((x) => x !== null);
          dias.push({
              data,
              chuvaMm: null,
              probPct: null,
              tmax: tmaxs.length ? Math.max(...tmaxs) : null,
              tmin: tmins.length ? Math.min(...tmins) : null,
              resumo: resumo.replace(/\s+/g, " ").trim(),
          });
      }
      return dias.sort((a, b) => (a.data < b.data ? -1 : 1));
  }
  /** Junta números do Open-Meteo com o texto do INMET pela data. Qualquer uma das listas pode faltar. */
  function juntarPrevisao(openMeteo, inmet) {
      const porData = new Map();
      for (const d of openMeteo)
          porData.set(d.data, { ...d });
      for (const d of inmet) {
          const x = porData.get(d.data);
          if (x) {
              if (d.resumo)
                  x.resumo = d.resumo;
              if (x.tmax === null)
                  x.tmax = d.tmax;
              if (x.tmin === null)
                  x.tmin = d.tmin;
          }
          else
              porData.set(d.data, { ...d });
      }
      return [...porData.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
  }
  /** Chuva prevista (mm) e probabilidade máxima nos próximos `dias` depois de `hoje`. */
  function chuvaPrevista(previsao, hoje, dias = 2) {
      var _a;
      const prox = previsao.filter((d) => d.data > hoje).slice(0, dias);
      let mm = 0, prob = null;
      for (const d of prox) {
          mm += (_a = d.chuvaMm) !== null && _a !== void 0 ? _a : 0;
          if (d.probPct !== null)
              prob = Math.max(prob !== null && prob !== void 0 ? prob : 0, d.probPct);
      }
      return { mm: Math.round(mm * 10) / 10, probPct: prob, ate: prox.length ? prox[prox.length - 1].data : null };
  }
  const dBr = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  /**
   * Aviso para um pivô com decisão IRRIGAR: se a chuva prevista nos próximos 2 dias cobre ≥ 80% do déficit
   * com probabilidade ≥ 50%, vale pensar em adiar. Sem previsão numérica, não avisa.
   */
  function avisoChuva(deficitMm, previsao, hoje) {
      const p = chuvaPrevista(previsao, hoje, 2);
      if (!p.ate || p.mm <= 0 || deficitMm <= 0)
          return null;
      if (p.mm < 0.8 * deficitMm || (p.probPct !== null && p.probPct < 50))
          return null;
      const prob = p.probPct !== null ? ` (${Math.round(p.probPct)}% de chance)` : "";
      return `Previsão de ${p.mm.toFixed(1).replace(".", ",")} mm de chuva até ${dBr(p.ate)}${prob} cobre o déficit: avalie adiar a irrigação.`;
  }
  function urlOpenMeteoHoras(latitude, longitude, fuso, dias = 3) {
      return ("https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
          "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability" +
          "&wind_speed_unit=ms&timezone=" + encodeURIComponent(fuso) + "&forecast_days=" + dias);
  }
  function lerOpenMeteoHoras(json) {
      const h = json === null || json === void 0 ? void 0 : json.hourly;
      if (!h || !Array.isArray(h["time"]))
          throw new Error("Open-Meteo: resposta sem a série horária.");
      return h["time"].map((t, i) => {
          var _a, _b, _c, _d, _e, _f;
          return ({
              quando: String(t).slice(0, 13) + ":00",
              tempC: num((_a = h["temperature_2m"]) === null || _a === void 0 ? void 0 : _a[i]),
              urPct: num((_b = h["relative_humidity_2m"]) === null || _b === void 0 ? void 0 : _b[i]),
              ventoMs: num((_c = h["wind_speed_10m"]) === null || _c === void 0 ? void 0 : _c[i]),
              rajadaMs: num((_d = h["wind_gusts_10m"]) === null || _d === void 0 ? void 0 : _d[i]),
              chuvaMm: num((_e = h["precipitation"]) === null || _e === void 0 ? void 0 : _e[i]),
              probPct: num((_f = h["precipitation_probability"]) === null || _f === void 0 ? void 0 : _f[i]),
          });
      });
  }
  /** Temperatura de bulbo úmido (°C) por T e UR — Stull (2011). */
  function bulboUmido(tempC, urPct) {
      return tempC * Math.atan(0.151977 * Math.sqrt(urPct + 8.313659)) + Math.atan(tempC + urPct) - Math.atan(urPct - 1.676331) +
          0.00391838 * Math.pow(urPct, 1.5) * Math.atan(0.023101 * urPct) - 4.686035;
  }
  const deltaT = (tempC, urPct) => tempC - bulboUmido(tempC, urPct);
  /** Faixas usuais (Embrapa/ANDEF), uma só para qualquer pulverização. Vento em km/h: [bom até, atenção até]. */
  const FAIXAS_APLICACAO = {
      deltaT: { minimo: 2, idealAte: 8, atencaoAte: 10 },
      ventoKmh: { minimo: 3, bomAte: 10, atencaoAte: 15 },
      ur: { atencaoAbaixo: 55, ruimAbaixo: 50 },
      temp: { atencaoAcima: 30, ruimAcima: 35 },
  };
  const dec1 = (x) => x.toFixed(1).replace(".", ",");
  const int0 = (x) => String(Math.round(x));
  /**
   * Condições de pulverização para um instante (leitura da estação ou hora prevista).
   * O nível é o pior item; os motivos explicam.
   */
  function condicoesAplicacao(x) {
      const F = FAIXAS_APLICACAO;
      const dt = deltaT(x.tempC, x.urPct);
      const ventoKmh = x.ventoMs == null ? null : x.ventoMs * 3.6;
      const rajadaKmh = x.rajadaMs == null ? null : x.rajadaMs * 3.6;
      const ORDEM = { bom: 0, atencao: 1, ruim: 2 };
      const motivos = [];
      let pior = "bom";
      const marca = (nivel, texto) => { motivos.push([nivel, texto]); if (ORDEM[nivel] > ORDEM[pior])
          pior = nivel; };
      if (dt < F.deltaT.minimo)
          marca("ruim", `Delta T ${dec1(dt)} °C: abaixo de ${F.deltaT.minimo} — gota não seca, risco de inversão térmica`);
      else if (dt <= F.deltaT.idealAte)
          marca("bom", `Delta T ${dec1(dt)} °C: ideal (${F.deltaT.minimo} a ${F.deltaT.idealAte})`);
      else if (dt <= F.deltaT.atencaoAte)
          marca("atencao", `Delta T ${dec1(dt)} °C: alto — só com gota grossa`);
      else
          marca("ruim", `Delta T ${dec1(dt)} °C: acima de ${F.deltaT.atencaoAte} — a gota evapora antes de chegar`);
      if (ventoKmh !== null) {
          if (ventoKmh < F.ventoKmh.minimo)
              marca("atencao", `Vento ${int0(ventoKmh)} km/h: calmaria — deriva imprevisível, inversão`);
          else if (ventoKmh <= F.ventoKmh.bomAte)
              marca("bom", `Vento ${int0(ventoKmh)} km/h: ideal (${F.ventoKmh.minimo} a ${F.ventoKmh.bomAte})`);
          else if (ventoKmh <= F.ventoKmh.atencaoAte)
              marca("atencao", `Vento ${int0(ventoKmh)} km/h: no limite (${F.ventoKmh.bomAte} a ${F.ventoKmh.atencaoAte})`);
          else
              marca("ruim", `Vento ${int0(ventoKmh)} km/h: acima de ${F.ventoKmh.atencaoAte} — deriva`);
          if (rajadaKmh !== null && rajadaKmh > F.ventoKmh.atencaoAte && ventoKmh <= F.ventoKmh.atencaoAte)
              marca("atencao", `Rajadas de ${int0(rajadaKmh)} km/h`);
      }
      if (x.urPct < F.ur.ruimAbaixo)
          marca("ruim", `UR ${int0(x.urPct)}%: abaixo de ${F.ur.ruimAbaixo}`);
      else if (x.urPct < F.ur.atencaoAbaixo)
          marca("atencao", `UR ${int0(x.urPct)}%: entre ${F.ur.ruimAbaixo} e ${F.ur.atencaoAbaixo}`);
      if (x.tempC > F.temp.ruimAcima)
          marca("ruim", `Temperatura ${int0(x.tempC)} °C: acima de ${F.temp.ruimAcima}`);
      else if (x.tempC > F.temp.atencaoAcima)
          marca("atencao", `Temperatura ${int0(x.tempC)} °C: acima de ${F.temp.atencaoAcima}`);
      if (x.chovendo)
          marca("ruim", "Chovendo — lava o produto");
      return { deltaT: dt, nivel: pior, motivos };
  }
  /** Nível de aplicação hora a hora (chuva prevista ≥ 0,2 mm ou chance ≥ 60 % conta como "chovendo"). */
  function aplicacaoPorHora(horas) {
      var _a, _b;
      const out = [];
      for (const h of horas) {
          if (h.tempC === null || h.urPct === null)
              continue;
          const c = condicoesAplicacao({ tempC: h.tempC, urPct: h.urPct, ventoMs: h.ventoMs, rajadaMs: h.rajadaMs, chovendo: ((_a = h.chuvaMm) !== null && _a !== void 0 ? _a : 0) >= 0.2 || ((_b = h.probPct) !== null && _b !== void 0 ? _b : 0) >= 60 });
          out.push({ quando: h.quando, deltaT: Math.round(c.deltaT * 10) / 10, nivel: c.nivel, ventoKmh: h.ventoMs === null ? null : Math.round(h.ventoMs * 3.6), chuvaMm: h.chuvaMm, tempC: h.tempC, urPct: h.urPct });
      }
      return out;
  }
  /** Janelas de horas seguidas no nível pedido ou melhor (mínimo `minHoras`), depois de `apartirDe`. */
  function janelasBoas(horas, apartirDe, minHoras = 2, max = 4, ateNivel = "bom") {
      const ORDEM = { bom: 0, atencao: 1, ruim: 2 };
      const janelas = [];
      let ini = null, n = 0, ultima = "";
      const fecha = () => { if (ini && n >= minHoras)
          janelas.push({ inicio: ini, fim: ultima, horas: n }); ini = null; n = 0; };
      for (const h of horas) {
          if (h.quando < apartirDe)
              continue;
          if (ORDEM[h.nivel] <= ORDEM[ateNivel]) {
              if (!ini)
                  ini = h.quando;
              n++;
              ultima = h.quando;
          }
          else
              fecha();
      }
      fecha();
      return janelas.slice(0, max);
  }
  /**
   * Quando não há janela boa nem de atenção: a hora "menos ruim" — sem chuva, com o menor Delta T
   * (desempate pela maior UR). Devolve null se todas as horas têm chuva.
   */
  function horaMenosRuim(horas, apartirDe) {
      var _a;
      let melhor = null;
      for (const h of horas) {
          if (h.quando < apartirDe || ((_a = h.chuvaMm) !== null && _a !== void 0 ? _a : 0) >= 0.2)
              continue;
          if (!melhor || h.deltaT < melhor.deltaT || (h.deltaT === melhor.deltaT && h.urPct > melhor.urPct))
              melhor = h;
      }
      return melhor;
  }
  // ---- src/motor/ciclo.ts ----
  /**
   * Resumo meteorológico do ciclo de uma área (pivô ou talhão): graus-dia, horas de luz, chuva, ET₀ e extremos
   * do plantio até o dia do cálculo. É o "relatório do ciclo" — serve também para talhão sem pivô.
   */
  
  
  const TEMP_DIA_QUENTE = 32;
  const TEMP_DIA_FRIO = 10;
  function resumoCiclo(cultura, plantio, ate, latitude, clima, et0PorDia, grausDiaCiclo) {
      var _a, _b, _c;
      const porData = new Map(clima.map((d) => [d.data, d]));
      const serie = [];
      let gdAcum = 0, foto = 0, sol = 0, temSol = false, chuva = 0, diasChuva = 0, et0 = 0, tmaxAbs = -Infinity, tminAbs = Infinity, somaT = 0, nT = 0, quentes = 0, frios = 0, comClima = 0;
      let fotoHoje = 0, solHoje = null;
      for (let t = Date.parse(plantio + "T00:00:00Z"); t <= Date.parse(ate + "T00:00:00Z"); t += 86400000) {
          const data = new Date(t).toISOString().slice(0, 10);
          const fp = fotoperiodoH(latitude, data);
          foto += fp;
          fotoHoje = fp;
          const d = porData.get(data);
          if (!d || !Number.isFinite(d.tmed))
              continue;
          comClima++;
          const gd = grausDiaDoDia(cultura, d.tmed);
          gdAcum += gd;
          if (d.horasSol !== undefined) {
              sol += d.horasSol;
              temSol = true;
              solHoje = d.horasSol;
          }
          chuva += d.chuva;
          if (d.chuva >= 1)
              diasChuva++;
          const e = (_a = et0PorDia.get(data)) !== null && _a !== void 0 ? _a : 0;
          et0 += e;
          if (d.tmax > tmaxAbs)
              tmaxAbs = d.tmax;
          if (d.tmin < tminAbs)
              tminAbs = d.tmin;
          somaT += d.tmed;
          nT++;
          if (d.tmax >= TEMP_DIA_QUENTE)
              quentes++;
          if (d.tmin <= TEMP_DIA_FRIO)
              frios++;
          serie.push({ data, gd: Math.round(gd * 10) / 10, gdAcum: Math.round(gdAcum), fotoperiodo: Math.round(fp * 100) / 100, horasSol: (_b = d.horasSol) !== null && _b !== void 0 ? _b : null, chuva: d.chuva, et0: Math.round(e * 100) / 100, tmax: d.tmax, tmin: d.tmin });
      }
      const fim = fimDoCicloDas(cultura);
      const dias = das(ate, plantio) + 1;
      return {
          plantio, ate, dias, diasComClima: comClima,
          grausDia: Math.round(gdAcum),
          grausDiaCiclo: grausDiaCiclo !== null && grausDiaCiclo !== void 0 ? grausDiaCiclo : null,
          fracaoGrausDia: grausDiaCiclo ? Math.round((gdAcum / grausDiaCiclo) * 1000) / 1000 : null,
          tBaseC: (_c = cultura.tBaseC) !== null && _c !== void 0 ? _c : null,
          fotoperiodoHojeH: Math.round(fotoHoje * 100) / 100,
          fotoperiodoAcumH: Math.round(foto),
          horasSolAcumH: temSol ? Math.round(sol) : null,
          horasSolHojeH: solHoje,
          chuvaMm: Math.round(chuva * 10) / 10,
          diasComChuva: diasChuva,
          et0Mm: Math.round(et0 * 10) / 10,
          tmaxAbs: nT ? tmaxAbs : NaN,
          tminAbs: nT ? tminAbs : NaN,
          tmedia: nT ? Math.round((somaT / nT) * 10) / 10 : NaN,
          diasQuentes: quentes,
          diasFrios: frios,
          fimCicloDas: fim,
          faltamDias: fim - das(ate, plantio),
          serie,
      };
  }
  // ---- src/motor/reservatorio.ts ----
  const DIAS_NIVEL_VELHO = 7;
  const DIAS_AUTONOMIA_ATENCAO = 3;
  const r0 = (x) => Math.round(x);
  const r1 = (x) => Math.round(x * 10) / 10;
  /** m³ brutos de uma lâmina líquida num pivô. */
  function retiradaM3(p, liquidaMm) {
      const ef = p.eficienciaPct > 0 ? p.eficienciaPct / 100 : 1;
      return (liquidaMm / ef) * p.areaHa * 10;
  }
  function balancoReservatorio(r, niveis, retiradas, pivos, dia) {
      var _a;
      const reposicaoDiaM3 = Math.max(0, r.bombaM3h) * Math.max(0, r.horasBombaDia);
      const ultimo = (_a = niveis.filter((n) => n.data <= dia).sort((a, b) => (a.data < b.data ? -1 : 1)).pop()) !== null && _a !== void 0 ? _a : null;
      let volumeM3 = null, reposicao = 0, retirado = 0, diasDesde = null;
      if (ultimo) {
          diasDesde = das(dia, ultimo.data);
          reposicao = reposicaoDiaM3 * diasDesde;
          retirado = retiradas.filter((x) => x.data > ultimo.data && x.data <= dia).reduce((t, x) => t + x.m3, 0);
          volumeM3 = Math.min(r.volumeUtilM3, Math.max(0, (ultimo.pct / 100) * r.volumeUtilM3 + reposicao - retirado));
      }
      const demandaDiaM3 = pivos.reduce((t, p) => { var _a; return t + retiradaM3(p, (_a = p.etcMm) !== null && _a !== void 0 ? _a : 0); }, 0);
      const pedidoHojeM3 = pivos.reduce((t, p) => t + (p.pedidoBrutoMm ? p.pedidoBrutoMm * p.areaHa * 10 : 0), 0);
      const areaHa = pivos.reduce((t, p) => t + p.areaHa, 0);
      const disponivel = volumeM3 === null ? null : Math.max(0, volumeM3 - r.reservaMinM3);
      const faltaHoje = disponivel === null ? 0 : Math.max(0, pedidoHojeM3 - disponivel);
      const cobreHoje = disponivel === null ? null : faltaHoje <= 0;
      const saldoDia = reposicaoDiaM3 - demandaDiaM3;
      let diasAutonomia = null, diasAteEncher = null;
      if (disponivel !== null && saldoDia < 0)
          diasAutonomia = r1(disponivel / -saldoDia);
      if (volumeM3 !== null && saldoDia > 0 && volumeM3 < r.volumeUtilM3)
          diasAteEncher = r1((r.volumeUtilM3 - volumeM3) / saldoDia);
      const alertas = [];
      let semaforo = "bom";
      if (!ultimo) {
          alertas.push("Sem nível lançado: lance o nível do reservatório (%) para o cálculo valer.");
          semaforo = "sem";
      }
      else {
          if (diasDesde > DIAS_NIVEL_VELHO)
              alertas.push(`Nível lançado há ${diasDesde} dias: confira e lance de novo.`);
          if (volumeM3 <= r.reservaMinM3) {
              alertas.push("No volume de reserva: não dá pra puxar mais água.");
              semaforo = "ruim";
          }
          else if (cobreHoje === false) {
              alertas.push(`Falta água pra irrigação de hoje: ${r0(faltaHoje)} m³ a mais do que tem.`);
              semaforo = "ruim";
          }
          else if (diasAutonomia !== null && diasAutonomia < DIAS_AUTONOMIA_ATENCAO) {
              alertas.push(`Água pra ${diasAutonomia} dia(s) de irrigação: ligue a bomba mais tempo ou escalone os pivôs.`);
              semaforo = "atencao";
          }
          else if (diasDesde > DIAS_NIVEL_VELHO)
              semaforo = "atencao";
      }
      return {
          nome: r.nome, volumeUtilM3: r.volumeUtilM3, reservaMinM3: r.reservaMinM3,
          volumeM3: volumeM3 === null ? null : r0(volumeM3),
          pct: volumeM3 === null || r.volumeUtilM3 <= 0 ? null : r0((volumeM3 / r.volumeUtilM3) * 100),
          nivel: ultimo, diasDesdeNivel: diasDesde,
          reposicaoDesdeNivelM3: r0(reposicao), retiradoDesdeNivelM3: r0(retirado),
          reposicaoDiaM3: r0(reposicaoDiaM3), demandaDiaM3: r0(demandaDiaM3), areaHa: r1(areaHa),
          pivos: pivos.map((p) => p.nome),
          pedidoHojeM3: r0(pedidoHojeM3), cobreHoje, faltaHojeM3: r0(faltaHoje),
          horasParaCobrir: faltaHoje > 0 && r.bombaM3h > 0 ? r1(faltaHoje / r.bombaM3h) : null,
          diasAutonomia, diasAteEncher, semaforo, alertas,
      };
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
          extras: extrasDoTempoReal(d),
      };
  }
  /** Todas as grandezas da resposta, "grupo.campo" → número em SI (°C, mm, m/s, hPa…). Texto é ignorado. */
  function extrasDoTempoReal(d) {
      const out = {};
      for (const [grupo, campos] of Object.entries(d)) {
          if (!campos || typeof campos !== "object")
              continue;
          for (const [campo, v] of Object.entries(campos)) {
              const x = numero(v === null || v === void 0 ? void 0 : v.value);
              if (x === null)
                  continue;
              out[`${grupo}.${campo}`] = Math.round(paraSI(x, v === null || v === void 0 ? void 0 : v.unit).valor * 100) / 100;
          }
      }
      return out;
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
  /** Mesmo semáforo do app: vermelho irrigar, amarelo déficit ≥ 70 % da lâmina mínima, verde ok, cinza sem dados. */
  function semaforoDoItem(it) {
      var _a;
      const x = it.linha;
      if (!x || x.decisao === "SEM DADOS")
          return "sem";
      if (x.decisao === "IRRIGAR")
          return "ruim";
      const lm = (_a = it.pivo.laminaMinimaMm) !== null && _a !== void 0 ? _a : 0;
      return lm > 0 && x.deficit / lm >= 0.7 ? "atencao" : "bom";
  }
  const SEM_EMOJI = { ruim: "🔴", atencao: "🟡", bom: "🟢", sem: "⚫" };
  const SEM_COR = { ruim: "#c62828", atencao: "#f0b429", bom: "#2e7d32", sem: "#9e9e9e" };
  const areaHa = (eq) => (eq ? (Math.PI * eq.raioM ** 2 * (eq.anguloGraus / 360)) / 10000 : 0);
  /** Totais do dia: pivôs em cada estado, água e energia das irrigações recomendadas. */
  function resumoDoDia(itens) {
      var _a, _b;
      const cont = { ruim: 0, atencao: 0, bom: 0, sem: 0 };
      let aguaM3 = 0, kwh = 0, custo = 0, ha = 0;
      for (const it of itens) {
          cont[semaforoDoItem(it)]++;
          const r = (_a = it.linha) === null || _a === void 0 ? void 0 : _a.recomendacao;
          if (((_b = it.linha) === null || _b === void 0 ? void 0 : _b.decisao) === "IRRIGAR" && r) {
              const a = areaHa(it.pivo.equipamento);
              aguaM3 += r.laminaBrutaMm * a * 10; // mm × ha × 10 = m³
              ha += a;
              kwh += r.energiaKwh;
              custo += r.custoRs;
          }
      }
      return { cont, aguaM3, kwh, custo, ha };
  }
  /** Texto do relatório do dia — cabe no WhatsApp, com *negrito* no estilo do WhatsApp. */
  /** Linha do ciclo para o relatório: graus-dia, luz, chuva e ET₀ acumulados desde o plantio. */
  function linhaCiclo(c) {
      var _a;
      const gd = `${n0(c.grausDia)} GD` + (c.grausDiaCiclo ? ` de ${n0(c.grausDiaCiclo)} (${n0(((_a = c.fracaoGrausDia) !== null && _a !== void 0 ? _a : 0) * 100)}%)` : c.tBaseC !== null ? ` (base ${c.tBaseC} °C)` : "");
      const luz = `luz ${n1(c.fotoperiodoHojeH)} h/dia (${n0(c.fotoperiodoAcumH)} h acum.)` + (c.horasSolAcumH !== null ? ` · sol ${n0(c.horasSolAcumH)} h` : "");
      return `Ciclo ${c.dias} d: ${gd} · ${luz} · chuva ${n1(c.chuvaMm)} mm em ${c.diasComChuva} d · ET₀ ${n0(c.et0Mm)} mm · ${n0(c.tminAbs)}–${n0(c.tmaxAbs)} °C` +
          (c.diasQuentes ? ` · ${c.diasQuentes} d > 32 °C` : "") + (c.diasFrios ? ` · ${c.diasFrios} d < 10 °C` : "") + (c.faltamDias >= 0 ? ` · faltam ${c.faltamDias} d` : ` · ciclo encerrado há ${-c.faltamDias} d`);
  }
  const SEM_RES = { ruim: "🔴", atencao: "🟡", bom: "🟢", sem: "⚫" };
  /** Frases do reservatório para o relatório: volume, reposição, consumo e dias de irrigação. */
  function linhasReservatorio(b) {
      var _a;
      const l = [];
      const vol = b.volumeM3 === null ? "nível não lançado" : `${n0(b.volumeM3)} m³ (${n0((_a = b.pct) !== null && _a !== void 0 ? _a : 0)}% de ${n0(b.volumeUtilM3)} m³)`;
      l.push(`${SEM_RES[b.semaforo]} *${b.nome}* — ${vol}${b.nivel ? ` · nível ${n0(b.nivel.pct)}% lançado ${br(b.nivel.data)}` : ""}`);
      l.push(`   Entra ${n0(b.reposicaoDiaM3)} m³/dia na bomba · ${b.pivos.length ? `${b.pivos.join(", ")} ${b.pivos.length === 1 ? "consome" : "consomem"} ${n0(b.demandaDiaM3)} m³/dia` : "nenhum pivô ligado"}` +
          (b.pedidoHojeM3 > 0 ? ` · hoje pedem ${n0(b.pedidoHojeM3)} m³` : ""));
      if (b.volumeM3 !== null) {
          if (b.cobreHoje === false)
              l.push(`   ⚠️ Falta ${n0(b.faltaHojeM3)} m³ pra irrigação de hoje${b.horasParaCobrir !== null ? ` (${n1(b.horasParaCobrir)} h de bomba)` : ""}`);
          if (b.diasAutonomia !== null)
              l.push(`   💧 Água pra *${n1(b.diasAutonomia)} dias* de irrigação com a reposição (reserva de ${n0(b.reservaMinM3)} m³ fora)`);
          else
              l.push(`   💧 A reposição cobre o consumo${b.diasAteEncher !== null ? ` · enche em ${n1(b.diasAteEncher)} dias` : " · cheio"}`);
      }
      for (const a of b.alertas.filter((a) => !/^Falta água|^Água pra/.test(a)))
          l.push(`   ⚠️ ${a}`);
      return l;
  }
  function montarMensagem(data, clima, itens, previsao = [], nomeFazenda = "", reservatorios = []) {
      var _a, _b, _c, _d, _e;
      const irrigar = itens.filter((i) => { var _a; return ((_a = i.linha) === null || _a === void 0 ? void 0 : _a.decisao) === "IRRIGAR"; }).length;
      const assunto = `Manejo ${br(data)}${nomeFazenda ? ` · ${nomeFazenda}` : ""}: ${irrigar ? `irrigar ${irrigar} pivô(s)` : "nenhum pivô para irrigar"}`;
      const rs = resumoDoDia(itens);
      const l = [
          `💧 *Manejo de irrigação — ${br(data)}${nomeFazenda ? ` · ${nomeFazenda}` : ""}*`,
          `Janela ${br(diaAnterior(data))} 18h → ${br(data)} 18h`,
          `🔴 ${rs.cont.ruim} irrigar · 🟡 ${rs.cont.atencao} atenção · 🟢 ${rs.cont.bom} ok${rs.cont.sem ? ` · ⚫ ${rs.cont.sem} sem dados` : ""}`,
      ];
      if (rs.ha > 0)
          l.push(`Hoje: ${n0(rs.aguaM3)} m³ de água em ${n1(rs.ha)} ha · ${n0(rs.kwh)} kWh · R$ ${n2(rs.custo)}`);
      l.push(`ET₀ ${n1(clima.et0)} mm · chuva ${n1(clima.chuva)} mm · ${n0(clima.tmin)}–${n0(clima.tmax)} °C · UR ${n0(clima.ur)}% · vento ${n1(clima.vento)} m/s` +
          (clima.horasSol !== undefined ? ` · sol ${n1(clima.horasSol)} h` : "") + ` · ${clima.n} de 144 leituras`);
      if ((_a = clima.estimados) === null || _a === void 0 ? void 0 : _a.length)
          l.push(`⚠️ Estação sem dado de ${clima.estimados.join(", ")}: valores do dia vizinho.`);
      const prox = previsao.filter((d) => d.data > data).slice(0, 3);
      if (prox.length) {
          const p = chuvaPrevista(previsao, data, 2);
          l.push(`🌧 Previsão: ${prox.map((d) => `${br(d.data)} ${d.chuvaMm === null ? "?" : n1(d.chuvaMm)} mm${d.probPct === null ? "" : ` (${n0(d.probPct)}%)`}`).join(" · ")}` +
              ` — ${n1(p.mm)} mm em 2 dias`);
          const r = (_b = prox[0]) === null || _b === void 0 ? void 0 : _b.resumo;
          if (r)
              l.push(`   INMET amanhã: ${r}`);
      }
      for (const b of reservatorios) {
          l.push("");
          l.push(...linhasReservatorio(b));
      }
      for (const it of itens) {
          l.push("");
          const x = it.linha;
          if (!x) {
              l.push(`${it.pivo.semBalanco ? "🌱" : "⚫"} *${it.pivo.nome}* — ${it.pivo.cultura.nome}${it.pivo.semBalanco ? " (talhão)" : ""} — ${(_c = it.aviso) !== null && _c !== void 0 ? _c : "sem cálculo"}`);
              if (it.ciclo)
                  l.push(`   ${linhaCiclo(it.ciclo)}`);
              continue;
          }
          const sem = semaforoDoItem(it);
          const fim = it.fimCicloDas !== undefined ? it.fimCicloDas - x.das : null;
          l.push(`${SEM_EMOJI[sem]} *${it.pivo.nome}* — ${it.pivo.cultura.nome} ${x.estadio}, ${x.das} DAS${fim !== null ? (fim >= 0 ? ` (faltam ${fim} d do ciclo)` : ` (ciclo encerrado há ${-fim} d)`) : ""}`);
          const pctAfd = x.afdMm > 0 ? Math.round((x.deficit / x.afdMm) * 100) : 0;
          if (x.decisao === "IRRIGAR") {
              l.push(`🚿 *IRRIGAR* — repor ${n1(x.deficit)} mm (${pctAfd}% da AFD de ${n1(x.afdMm)} mm)`);
              const chuva = avisoChuva(x.deficit, previsao, data);
              if (chuva)
                  l.push(`   🌧 ${chuva}`);
              const r = x.recomendacao;
              if (r) {
                  l.push(`   Percentímetro *${n0(r.percentimetroPct)}%* · volta ${horas(r.tempoVoltaH)} · ${n1(r.laminaBrutaMm)} mm brutos (${n0(r.laminaBrutaMm * areaHa(it.pivo.equipamento) * 10)} m³)`);
                  if (r.ponta)
                      l.push(`   Ligar às *${r.ponta.inicioSugerido}* (fora da ponta): ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)} — no começo da ponta sairia R$ ${n2(r.ponta.custoPiorRs)}`);
                  else
                      l.push(`   Energia ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
                  if (((_d = x.projecao) === null || _d === void 0 ? void 0 : _d.deficitFimVoltaMm) !== undefined)
                      l.push(`   Déficit ao fim da volta ≈ ${n1(x.projecao.deficitFimVoltaMm)} mm`);
                  if (r.limitadoPelaLaminaMax)
                      l.push("   ⚠️ Uma volta no percentímetro mínimo não repõe tudo: vai precisar de outra.");
              }
              else {
                  l.push("   (cadastre o equipamento para ter percentímetro, tempo e custo)");
              }
          }
          else if (x.decisao === "SEM DADOS") {
              l.push(`⛔ *SEM DADOS* — estação com poucas leituras; déficit estimado ${n1(x.deficit)} mm`);
          }
          else {
              l.push(`✅ NÃO IRRIGAR — déficit ${n1(x.deficit)} mm (${pctAfd}% da AFD; lâmina mínima ${n1((_e = it.pivo.laminaMinimaMm) !== null && _e !== void 0 ? _e : 0)} mm)`);
              const pj = x.projecao;
              if (pj && pj.horizonte > 0) {
                  l.push(pj.proximaIrrigacao
                      ? `   Próxima irrigação prevista: ${br(pj.proximaIrrigacao)} (em ${pj.emDias} dia${pj.emDias === 1 ? "" : "s"}, sem chuva)`
                      : `   Sem irrigação prevista nos próximos ${pj.horizonte} dias (sem chuva)`);
              }
          }
          l.push(`   ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · raiz ${n0(x.raizCm)} cm · CAD ${n1(x.cadMm)} mm${x.irrigacao ? ` · irrigado hoje ${n1(x.irrigacao)} mm` : ""}${x.chuva ? ` · chuva ${n1(x.chuva)} mm` : ""}${it.pivo.fonte ? ` · água do ${it.pivo.fonte}` : ""}`);
          const ui = it.ultimaIrrigacao, um = it.ultimaMedicao;
          if (ui || um)
              l.push(`   ${ui ? `Última irrigação ${br(ui.data)} (${n1(ui.mm)} mm)` : "Sem irrigação lançada"}${um ? ` · última medição ${br(um.data)} (${n0(um.umidadeRaizPct)}%)` : ""}`);
          if (it.historico && it.historico.length > 1) {
              l.push(`   Déficit (mm) nos últimos dias: ${it.historico.map((h) => `${br(h.data)} ${n0(h.deficit)}`).join(" · ")}`);
          }
          if (it.ciclo)
              l.push(`   ${linhaCiclo(it.ciclo)}`);
          for (const a of x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado")))
              l.push(`   ⚠️ ${a}`);
          if (it.diasIncertos)
              l.push(`   ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.`);
      }
      l.push("", "Legenda: 🔴 irrigar · 🟡 déficit chegando na lâmina mínima · 🟢 ok · ⚫ sem dados. Chuva prevista não entra no balanço: só avisa.");
      return { assunto, texto: l.join("\n") };
  }
  const h = (t) => String(t !== null && t !== void 0 ? t : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /** Versão em HTML do mesmo relatório, para o e-mail (cores do semáforo e tabelinha por pivô). */
  function montarMensagemHtml(data, clima, itens, previsao = [], linkApp = "", nomeFazenda = "", reservatorios = []) {
      var _a, _b, _c, _d, _e;
      const rs = resumoDoDia(itens);
      const prox = previsao.filter((d) => d.data > data).slice(0, 3);
      const p2 = chuvaPrevista(previsao, data, 2);
      const chip = (txt, cor) => `<span style="display:inline-block;background:${cor};color:#fff;border-radius:999px;padding:3px 10px;font-weight:700;font-size:12px;margin-right:4px">${txt}</span>`;
      const linha = (rot, val) => `<tr><td style="padding:3px 8px 3px 0;color:#64757d;white-space:nowrap">${rot}</td><td style="padding:3px 0">${val}</td></tr>`;
      let html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#33474f;max-width:640px;font-size:14px;line-height:1.45">`;
      html += `<h2 style="color:#16404d;margin:0 0 4px">💧 Manejo de irrigação — ${h(br(data))}${nomeFazenda ? ` · ${h(nomeFazenda)}` : ""}</h2>`;
      html += `<div style="color:#64757d;font-size:13px;margin-bottom:10px">Janela ${h(br(diaAnterior(data)))} 18h → ${h(br(data))} 18h</div>`;
      html += `<div style="margin-bottom:10px">${chip(`${rs.cont.ruim} irrigar`, SEM_COR.ruim)}${chip(`${rs.cont.atencao} atenção`, SEM_COR.atencao)}${chip(`${rs.cont.bom} ok`, SEM_COR.bom)}${rs.cont.sem ? chip(`${rs.cont.sem} sem dados`, SEM_COR.sem) : ""}</div>`;
      if (rs.ha > 0)
          html += `<div style="margin-bottom:6px"><b>Hoje:</b> ${n0(rs.aguaM3)} m³ de água em ${n1(rs.ha)} ha · ${n0(rs.kwh)} kWh · R$ ${n2(rs.custo)}</div>`;
      html += `<div style="background:#f4f6f8;border-radius:10px;padding:8px 12px;margin-bottom:10px">ET₀ <b>${n1(clima.et0)}</b> mm · chuva <b>${n1(clima.chuva)}</b> mm · ${n0(clima.tmin)}–${n0(clima.tmax)} °C · UR ${n0(clima.ur)}% · vento ${n1(clima.vento)} m/s · ${clima.n}/144 leituras`;
      if ((_a = clima.estimados) === null || _a === void 0 ? void 0 : _a.length)
          html += `<br><span style="color:#b7791f">⚠️ Estação sem dado de ${h(clima.estimados.join(", "))}: valores do dia vizinho.</span>`;
      if (prox.length)
          html += `<br>🌧 Previsão: ${prox.map((d) => `${h(br(d.data))} <b>${d.chuvaMm === null ? "?" : n1(d.chuvaMm)}</b> mm${d.probPct === null ? "" : ` (${n0(d.probPct)}%)`}`).join(" · ")} — ${n1(p2.mm)} mm em 2 dias${((_b = prox[0]) === null || _b === void 0 ? void 0 : _b.resumo) ? `<br><span style="color:#64757d">INMET amanhã: ${h(prox[0].resumo)}</span>` : ""}`;
      html += `</div>`;
      for (const b of reservatorios) {
          const cor = SEM_COR[b.semaforo];
          const [titulo, ...resto] = linhasReservatorio(b).map((t) => t.replace(/^\s+/, "").replace(/^(🔴|🟡|🟢|⚫) /u, "").replace(/\*/g, ""));
          html += `<div style="border:1px solid #e2e8ec;border-left:5px solid ${cor};border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#f7fbfc">`;
          html += `<div style="display:flex;justify-content:space-between"><b style="font-size:15px;color:#16404d">🏞 ${h(titulo)}</b>${b.pct !== null ? chip(`${n0(b.pct)}%`, cor) : ""}</div>`;
          if (b.pct !== null)
              html += `<div style="height:10px;background:#eef2f4;border-radius:6px;overflow:hidden;margin:6px 0"><div style="width:${Math.min(100, b.pct).toFixed(0)}%;height:10px;background:#2e7d8c"></div></div>`;
          for (const t of resto)
              html += `<div style="font-size:13px;margin-top:3px">${h(t)}</div>`;
          html += `</div>`;
      }
      for (const it of itens) {
          const x = it.linha, sem = semaforoDoItem(it);
          html += `<div style="border:1px solid #e2e8ec;border-left:5px solid ${SEM_COR[sem]};border-radius:10px;padding:10px 12px;margin-bottom:10px">`;
          const fim = it.fimCicloDas !== undefined && x ? it.fimCicloDas - x.das : null;
          html += `<div style="display:flex;justify-content:space-between"><b style="font-size:15px;color:#16404d">${h(it.pivo.nome)}</b>${x ? chip(x.decisao, SEM_COR[sem]) : ""}</div>`;
          if (!x) {
              html += `<div style="color:#64757d">${h(it.pivo.cultura.nome)}${it.pivo.semBalanco ? " · talhão" : ""} — ${h((_c = it.aviso) !== null && _c !== void 0 ? _c : "sem cálculo")}</div>`;
              if (it.ciclo)
                  html += `<div style="font-size:13px;margin-top:6px">${h(linhaCiclo(it.ciclo))}</div>`;
              html += `</div>`;
              continue;
          }
          html += `<div style="color:#64757d;font-size:13px;margin-bottom:6px">${h(it.pivo.cultura.nome)} · ${h(x.estadio)} · ${x.das} DAS${fim !== null ? (fim >= 0 ? ` · faltam ${fim} d do ciclo` : ` · <span style="color:#c62828">ciclo encerrado há ${-fim} d</span>`) : ""}</div>`;
          const pct = x.afdMm > 0 ? Math.min(100, (x.deficit / x.afdMm) * 100) : 0;
          html += `<div style="height:10px;background:#eef2f4;border-radius:6px;overflow:hidden;margin:4px 0"><div style="width:${pct.toFixed(0)}%;height:10px;background:#e65100"></div></div>`;
          html += `<table style="border-collapse:collapse;font-size:13px">`;
          html += linha("Déficit", `<b>${n1(x.deficit)} mm</b> (${Math.round(pct)}% da AFD de ${n1(x.afdMm)} mm; lâmina mínima ${n1((_d = it.pivo.laminaMinimaMm) !== null && _d !== void 0 ? _d : 0)} mm)`);
          const r = x.recomendacao;
          if (x.decisao === "IRRIGAR" && r) {
              html += linha("Ajuste", `Percentímetro <b>${n0(r.percentimetroPct)}%</b> · volta ${h(horas(r.tempoVoltaH))} · ${n1(r.laminaBrutaMm)} mm brutos (${n0(r.laminaBrutaMm * areaHa(it.pivo.equipamento) * 10)} m³)`);
              html += linha("Energia", r.ponta ? `Ligar às <b>${h(r.ponta.inicioSugerido)}</b>: ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)} (na ponta: R$ ${n2(r.ponta.custoPiorRs)})` : `${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
              if (((_e = x.projecao) === null || _e === void 0 ? void 0 : _e.deficitFimVoltaMm) !== undefined)
                  html += linha("Fim da volta", `déficit ≈ ${n1(x.projecao.deficitFimVoltaMm)} mm`);
              const chuva = avisoChuva(x.deficit, previsao, data);
              if (chuva)
                  html += linha("Chuva", `🌧 ${h(chuva)}`);
          }
          else if (x.decisao === "IRRIGAR")
              html += linha("Ajuste", "cadastre o equipamento para ter percentímetro, tempo e custo");
          else if (x.projecao && x.projecao.horizonte > 0)
              html += linha("Próxima", x.projecao.proximaIrrigacao ? `${h(br(x.projecao.proximaIrrigacao))} (em ${x.projecao.emDias} dia${x.projecao.emDias === 1 ? "" : "s"}, sem chuva)` : `sem irrigação prevista em ${x.projecao.horizonte} dias (sem chuva)`);
          html += linha("Hoje", `ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · raiz ${n0(x.raizCm)} cm · CAD ${n1(x.cadMm)} mm${x.irrigacao ? ` · irrigado ${n1(x.irrigacao)} mm` : ""}${x.chuva ? ` · chuva ${n1(x.chuva)} mm` : ""}${it.pivo.fonte ? ` · água do ${h(it.pivo.fonte)}` : ""}`);
          if (it.ultimaIrrigacao || it.ultimaMedicao)
              html += linha("Lançamentos", `${it.ultimaIrrigacao ? `última irrigação ${h(br(it.ultimaIrrigacao.data))} (${n1(it.ultimaIrrigacao.mm)} mm)` : "sem irrigação lançada"}${it.ultimaMedicao ? ` · última medição ${h(br(it.ultimaMedicao.data))} (${n0(it.ultimaMedicao.umidadeRaizPct)}%)` : ""}`);
          if (it.historico && it.historico.length > 1)
              html += linha("Déficit (mm)", it.historico.map((d) => `${h(br(d.data))} <b>${n0(d.deficit)}</b>`).join(" · "));
          if (it.ciclo)
              html += linha("Ciclo", h(linhaCiclo(it.ciclo)).replace(/^Ciclo \d+ d: /, ""));
          html += `</table>`;
          const alertas = x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado"));
          if (alertas.length)
              html += `<div style="margin-top:6px">${alertas.map((a) => `<div style="background:#fff2cc;color:#7a5200;border-radius:8px;padding:5px 9px;font-size:13px;margin-top:4px">⚠️ ${h(a)}</div>`).join("")}</div>`;
          if (it.diasIncertos)
              html += `<div style="color:#64757d;font-size:12px;margin-top:4px">ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.</div>`;
          html += `</div>`;
      }
      html += `<div style="color:#64757d;font-size:12px">Legenda: vermelho irrigar · amarelo déficit chegando na lâmina mínima · verde ok · cinza sem dados. Chuva prevista não entra no balanço: só avisa.${linkApp ? ` <a href="${h(linkApp)}" style="color:#2e7d8c">Abrir o app</a>` : ""}</div></div>`;
      return html;
  }

  // No Apps Script, a hora local vem do Utilities (independe do suporte a Intl).
  if (typeof Utilities !== "undefined") {
    paraLocal = function (ms, fuso) {
      return Utilities.formatDate(new Date(ms), fuso, "yyyy-MM-dd'T'HH:mm:ss");
    };
  }

  return { numero, UnidadeDesconhecida, paraCelsius, paraMm, paraMs, paraWm2, paraSI, wm2ParaMJDia, HORA_FECHAMENTO, diaAnterior, agregarDia, RAD_SOL_WM2, horasDeSol, fatiasCobertas, proximoDia, datasEntre, climaCompleto, eSat, diaDoAno, radiacaoExtraterrestre, fotoperiodoH, ventoA2m, et0PenmanMonteith, et0Hargreaves, LIMITE_DIVERGENCIA_HS, divergenciaHargreaves, SOJA, SOJA_PRECOCE, MILHO, SORGO, FEIJAO, FEIJAO_PD, TRIGO, ALGODAO, das, comCiclo, fimDoCicloDas, curvaKc, dae, fracaoCiclo, grausDiaDoDia, estadioPorDas, kcDoDia, CULTURAS, profundidadeRaiz, cad, fatorDeplecaoPorEt0, fatorDeplecao, deficitDaUmidade, capacidade, PONTA_PADRAO, horasNaPonta, laminaDoPercentimetro, recomendar, CHUVA_MINIMA_EFETIVA_MM, MIN_LEITURAS, RAD_SUSPEITA_MJ, DIAS_MEDICAO_VELHA, chuvaEfetiva, simularBalanco, projetar, DATA, validarCadastro, INMET_URL, urlOpenMeteo, lerOpenMeteo, lerInmet, juntarPrevisao, chuvaPrevista, avisoChuva, urlOpenMeteoHoras, lerOpenMeteoHoras, bulboUmido, deltaT, FAIXAS_APLICACAO, condicoesAplicacao, aplicacaoPorHora, janelasBoas, horaMenosRuim, TEMP_DIA_QUENTE, TEMP_DIA_FRIO, resumoCiclo, DIAS_NIVEL_VELHO, DIAS_AUTONOMIA_ATENCAO, retiradaM3, balancoReservatorio, paraLocal, deLocal, minutosEntre, somarMinutos, URL_BASE, ErroEcowitt, MINUTOS_DO_CICLO, cicloParaIdade, leituraDoTempoReal, extrasDoTempoReal, leiturasDoHistorico, ClienteEcowitt, encontrarLacunas, semaforoDoItem, resumoDoDia, linhaCiclo, linhasReservatorio, montarMensagem, montarMensagemHtml };
})();

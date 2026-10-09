/************************************************************************
 * MANEJO DE IRRIGAÇÃO — FAZENDA ÁGUA VIVA
 *
 * Planilha + Apps Script. O cálculo está em Motor.gs (gerado a partir do
 * código testado — não edite lá). Este arquivo liga o motor à planilha:
 * abas, coleta da Ecowitt, relatório das 18h, e-mail e backup no Drive.
 *
 * Primeira vez: menu 💧 Manejo → "1. Instalar / atualizar" e depois
 * "2. Configurar chaves Ecowitt".
 ************************************************************************/

var ABA = {
  PAINEL: "PAINEL",
  PIVOS: "PIVOS",
  ESTACAO: "ESTACAO",
  IRRIGACOES: "IRRIGACOES",
  UMIDADE: "UMIDADE",
  BALANCO: "BALANCO",
  CLIMA: "CLIMA",
  LEITURAS: "LEITURAS",
  LOG: "LOG",
  PREVISAO: "PREVISAO",
  CACHE: "CACHE",
  USUARIOS: "USUÁRIOS APP",
  CONFIG_APP: "CONFIG APP",
};

var PASTA_BACKUP = "BACKUP";
var PASTA_RELATORIOS = "RELATORIOS";
var BACKUPS_MANTIDOS = 30;
var LIMITE_EXECUCAO_MS = 4.5 * 60 * 1000; // o Apps Script corta em 6 min

/** Campos da aba ESTACAO, na ordem das linhas. */
var CAMPOS_ESTACAO = [
  ["latitude", "Latitude (graus, negativo no sul)", -14.74, "Confirmar a posição real da estação."],
  ["longitude", "Longitude (graus, negativo no oeste)", -46.24, "Confirmar. Usada na previsão de chuva (Open-Meteo)."],
  ["altitude", "Altitude (m)", 900, "Confirmar."],
  ["alturaAnemometro", "Altura do anemômetro (m)", 2, "Confirmar. Se não for 2 m, o vento é corrigido."],
  ["fuso", "Fuso horário", "America/Sao_Paulo", "Mato Grosso: America/Cuiaba."],
  ["grupoChuva", "Pluviômetro", "rainfall", "rainfall (báscula) ou rainfall_piezo (WS90)."],
  ["emails", "E-mails do relatório (separe por vírgula)", "", "Quem recebe o relatório das 18h."],
  ["ibge", "Município (código IBGE) p/ previsão do INMET", 3126208, "Formoso-MG = 3126208. Vazio = sem a previsão do INMET."],
  ["chuvaMinima", "Chuva mínima que conta no balanço (mm)", 2, "Chuva menor que isso fica na folha e evapora (Embrapa). 0 = conta tudo."],
  ["pontaInicio", "Horário de ponta — início (hora)", 18, "Da sua distribuidora. Usado no custo e na hora sugerida de ligar."],
  ["pontaFim", "Horário de ponta — fim (hora)", 21, ""],
];

var COLUNAS_PIVOS = [
  ["nome", "Pivô"],
  ["ativo", "Ativo (SIM/NÃO)"],
  ["cultura", "Cultura"],
  ["cicloDias", "Ciclo (dias, vazio = padrão)", true],
  ["plantio", "Plantio"],
  ["inicioBalanco", "Início do balanço"],
  ["palhada", "Plantio direto na palha (SIM/NÃO)"],
  ["umidadeInicialPct", "Umidade no início (%)"],
  ["cc", "Capacidade de campo (%)"],
  ["pmp", "Ponto de murcha (%)"],
  ["raizIniCm", "Raiz no plantio (cm)"],
  ["raizMaxCm", "Raiz máxima (cm)"],
  ["diasRaiz", "Dias até raiz máxima"],
  ["fatorFixo", "Fator de depleção fixo (vazio = variável)"],
  ["laminaMinimaMm", "Lâmina mínima p/ irrigar (mm)"],
  ["tensaoIrrigarKpa", "Tensão p/ irrigar (kPa)"],
  ["raioM", "Raio (m)"],
  ["anguloGraus", "Ângulo (°)"],
  ["vazaoM3h", "Vazão (m³/h)"],
  ["velocidadeUltimaTorreMMin", "Velocidade última torre a 100% (m/min)"],
  ["percentimetroMinPct", "Percentímetro mínimo (%)"],
  ["eficienciaPct", "Eficiência (%)"],
  ["potenciaKw", "Potência (kW)"],
  ["tarifaRsKwh", "Tarifa (R$/kWh)"],
  // opcionais (3º item = true): criadas no fim da aba quando faltam
  ["latitude", "Latitude (centro)", true],
  ["longitude", "Longitude (centro)", true],
  ["contorno", "Contorno (do KMZ)", true],
  ["tarifaPontaRsKwh", "Tarifa na ponta (R$/kWh, vazio = única)", true],
  ["grausDiaCiclo", "Graus-dia do ciclo (vazio = dias corridos)", true],
  ["sensorSolo", "Sensor de solo da estação (canal 1-8)", true],
];

/** Valores de EXEMPLO (CONTEXT.md seção 6) — não são medições da fazenda. */
var PIVO_EXEMPLO = ["Pivô 2", "SIM", "soja", "", "2025-11-25", "2026-01-20", "SIM", 30, 32, 18, 10, 50, 55, "", 5, -70,
  400, 360, 200, 3, 10, 85, 55, 0.5];

var CABECALHOS = {
  IRRIGACOES: ["Data", "Pivô", "Lâmina líquida aplicada (mm)", "Obs.", "Por", "ID"],
  UMIDADE: ["Data", "Pivô", "Umidade na raiz (%)", "Umidade camada profunda (%)", "Tensão (kPa)", "Fonte", "Por", "ID"],
  LEITURAS: ["Quando (hora local)", "Chuva acum. dia (mm)", "Temp (°C)", "UR (%)", "Radiação (W/m²)", "Vento (m/s)", "Intervalo (min)", "Fonte", "Extras (JSON)"],
  CLIMA: ["Data", "Tmax", "Tmin", "Tmed", "UR", "Vento", "Radiação (MJ/m²)", "Chuva (mm)", "Leituras (eq. 10 min)", "Estimado", "ET0 PM (mm)", "ET0 Hargreaves (mm)"],
  BALANCO: ["Pivô", "Data", "DAS", "Estádio", "Kc", "ET0", "ETc", "Chuva", "Irrigação", "Raiz (cm)", "CAD (mm)", "f", "AFD (mm)", "Déficit (mm)", "Medição", "Decisão", "Alertas"],
  LOG: ["Quando", "Ação", "Status", "Detalhe", "Dia do relatório"],
  PREVISAO: ["Data", "Chuva prevista (mm)", "Probabilidade (%)", "Tmin", "Tmax", "INMET", "Atualizado em", "Fontes"],
};

/* =========================== MENU E INSTALAÇÃO =========================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("💧 Manejo")
    .addItem("1. Instalar / atualizar", "instalar")
    .addItem("2. Configurar chaves Ecowitt", "configurarChaves")
    .addSeparator()
    .addItem("Calcular agora (sem enviar)", "menuCalcular")
    .addItem("Enviar relatório agora", "menuEnviar")
    .addSeparator()
    .addItem("Coletar leitura agora", "menuColetar")
    .addItem("Testar conexão Ecowitt", "testarEcowitt")
    .addItem("Recuperar buracos (período)", "menuRecuperarPeriodo")
    .addItem("Importar METEO de outra planilha", "menuImportarMeteo")
    .addItem("🌧 Atualizar previsão do tempo", "menuPrevisao")
    .addSeparator()
    .addItem("📱 Endereço para o app", "menuLinkApp")
    .addItem("👤 Criar administrador do app", "menuCriarAdmin")
    .addToUi();
}

/** Cria as abas que faltam, as pastas no Drive e os gatilhos. Pode rodar de novo sem perder dados. */
function instalar() {
  var ss = SpreadsheetApp.getActive();
  criarAbaSeFaltar_(ss, ABA.PAINEL, null);

  var est = criarAbaSeFaltar_(ss, ABA.ESTACAO, ["Campo", "Valor", "Observação"]);
  if (est.getLastRow() < 2) {
    est.getRange(2, 1, CAMPOS_ESTACAO.length, 3).setValues(CAMPOS_ESTACAO.map(function (c) { return [c[1], c[2], c[3]]; }));
  } else {
    // planilha de versão anterior: acrescenta os campos novos no fim
    var atuais = est.getRange(2, 1, est.getLastRow() - 1, 1).getValues().map(function (l) { return String(l[0]).trim(); });
    CAMPOS_ESTACAO.forEach(function (c) {
      if (atuais.indexOf(c[1]) < 0) est.appendRow([c[1], c[2], c[3]]);
    });
  }

  var piv = criarAbaSeFaltar_(ss, ABA.PIVOS, COLUNAS_PIVOS.map(function (c) { return c[1]; }));
  if (piv.getLastRow() < 2) {
    piv.getRange(2, 1, 1, PIVO_EXEMPLO.length).setValues([PIVO_EXEMPLO]);
    piv.getRange(2, 5, 1, 2).setNumberFormat("@");
  }
  garantirColunasPivos_();

  criarAbaSeFaltar_(ss, ABA.IRRIGACOES, CABECALHOS.IRRIGACOES);
  criarAbaSeFaltar_(ss, ABA.UMIDADE, CABECALHOS.UMIDADE);
  criarAbaSeFaltar_(ss, ABA.BALANCO, CABECALHOS.BALANCO);
  criarAbaSeFaltar_(ss, ABA.CLIMA, CABECALHOS.CLIMA);
  var lei = criarAbaSeFaltar_(ss, ABA.LEITURAS, CABECALHOS.LEITURAS);
  lei.getRange("A:A").setNumberFormat("@"); // texto: não deixa o Sheets converter a hora
  criarAbaSeFaltar_(ss, ABA.LOG, CABECALHOS.LOG);
  criarAbaSeFaltar_(ss, ABA.PREVISAO, CABECALHOS.PREVISAO);
  var cache = criarAbaSeFaltar_(ss, ABA.CACHE, null);
  cache.hideSheet();
  abaUsuarios_();
  abaConfigApp_();
  garantirColunaId_(ABA.IRRIGACOES);
  garantirColunaId_(ABA.UMIDADE);

  var cfg = lerEstacao_();
  ss.setSpreadsheetTimeZone(cfg.fuso);
  pastaDoApp_(PASTA_BACKUP);
  pastaDoApp_(PASTA_RELATORIOS);
  recriarGatilhos_(cfg.fuso);
  log_("instalar", "ok", "Abas, pastas e gatilhos prontos.");
  aviso_("Instalado. Agora: menu 💧 Manejo → 2. Configurar chaves Ecowitt. Depois revise as abas ESTACAO e PIVOS.");
}

function criarAbaSeFaltar_(ss, nome, cabecalho) {
  var aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);
  if (cabecalho && aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight("bold");
    aba.setFrozenRows(1);
  }
  return aba;
}

function recriarGatilhos_(fuso) {
  var nossos = ["coletar", "recuperarRecentes", "relatorioDiario", "backupDiario", "continuarRecuperacao", "atualizarPrevisao"];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (nossos.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("coletar").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("recuperarRecentes").timeBased().everyHours(1).create();
  // nearMinute(20): roda entre 18:05 e 18:35, depois que a janela do dia fecha às 18h.
  ScriptApp.newTrigger("relatorioDiario").timeBased().atHour(18).nearMinute(20).everyDays(1).inTimezone(fuso).create();
  ScriptApp.newTrigger("backupDiario").timeBased().atHour(4).everyDays(1).inTimezone(fuso).create();
  ScriptApp.newTrigger("atualizarPrevisao").timeBased().everyHours(3).create();
}

/** Tira espaços, quebras de linha e caracteres invisíveis que vêm junto ao copiar. */
function limparChave_(v) {
  return String(v || "").replace(/[^A-Za-z0-9:\-]/g, "");
}

/** Formatos usuais: Application Key = 32 letras/números; API Key = com hífens (UUID). */
function tipoChave_(v) {
  if (/^[0-9A-Fa-f]{32}$/.test(v)) return "application";
  if (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(v)) return "api";
  return "desconhecido";
}

/** Grava as chaves limpas; se estiverem trocadas (formato de uma no lugar da outra), desfaz a troca. */
function guardarChaves_(app, api, mac) {
  var props = PropertiesService.getScriptProperties();
  var atual = function (k) { return props.getProperty(k) || ""; };
  app = limparChave_(app) || atual("ECOWITT_APPLICATION_KEY");
  api = limparChave_(api) || atual("ECOWITT_API_KEY");
  mac = limparChave_(mac).toUpperCase() || atual("ECOWITT_MAC");
  var trocadas = tipoChave_(app) === "api" && tipoChave_(api) === "application";
  if (trocadas) {
    var t = app;
    app = api;
    api = t;
  }
  props.setProperty("ECOWITT_APPLICATION_KEY", app);
  props.setProperty("ECOWITT_API_KEY", api);
  props.setProperty("ECOWITT_MAC", mac);
  return { trocadas: trocadas, app: tipoChave_(app), api: tipoChave_(api) };
}

/** As chaves ficam nas propriedades do script — não aparecem na planilha nem nos backups. */
function configurarChaves() {
  var ui = SpreadsheetApp.getUi();
  var perguntas = [
    "Application Key (32 letras e números, sem hífen)",
    "API Key (formato com hífens, ex.: 0000aaaa-1111-...)",
    "MAC da estação (ex.: AA:BB:CC:DD:EE:FF)",
  ];
  var respostas = [];
  for (var i = 0; i < perguntas.length; i++) {
    var r = ui.prompt("Chaves Ecowitt", perguntas[i] + "\n(deixe em branco para manter a atual)", ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    respostas.push(r.getResponseText());
  }
  var g = guardarChaves_(respostas[0], respostas[1], respostas[2]);
  var msg = "Chaves guardadas.";
  if (g.trocadas) msg += "\n\n⚠️ As duas chaves estavam trocadas — já acertei.";
  if (g.app !== "application") msg += "\n\n⚠️ A Application Key não tem o formato esperado (32 letras/números). Confira.";
  if (g.api !== "api") msg += "\n\n⚠️ A API Key não tem o formato esperado (com hífens). Confira.";
  aviso_(msg + "\n\nTeste com 💧 Manejo → Testar conexão Ecowitt.");
}

/* =============================== CONFIGURAÇÃO =============================== */

function lerEstacao_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.ESTACAO);
  var cfg = {};
  CAMPOS_ESTACAO.forEach(function (c) { cfg[c[0]] = c[2]; });
  if (aba && aba.getLastRow() >= 2) {
    var vals = aba.getRange(2, 1, aba.getLastRow() - 1, 2).getValues();
    CAMPOS_ESTACAO.forEach(function (c) {
      for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === c[1] && vals[i][1] !== "") cfg[c[0]] = vals[i][1];
    });
  }
  ["latitude", "longitude", "altitude", "alturaAnemometro", "ibge", "chuvaMinima", "pontaInicio", "pontaFim"].forEach(function (k) { cfg[k] = Motor.numero(cfg[k]); });
  if (cfg.chuvaMinima === null) cfg.chuvaMinima = Motor.CHUVA_MINIMA_EFETIVA_MM;
  cfg.ponta = { inicioH: cfg.pontaInicio === null ? 18 : cfg.pontaInicio, fimH: cfg.pontaFim === null ? 21 : cfg.pontaFim };
  cfg.fuso = String(cfg.fuso).trim();
  cfg.grupoChuva = String(cfg.grupoChuva).trim() || "rainfall";
  cfg.emails = String(cfg.emails || "").split(/[,;\s]+/).filter(function (e) { return e.indexOf("@") > 0; });
  return cfg;
}

function configEcowitt_(cfg) {
  var p = PropertiesService.getScriptProperties();
  var app = limparChave_(p.getProperty("ECOWITT_APPLICATION_KEY"));
  var api = limparChave_(p.getProperty("ECOWITT_API_KEY"));
  var mac = limparChave_(p.getProperty("ECOWITT_MAC"));
  if (!app || !api || !mac) throw new Error("Chaves da Ecowitt não configuradas (menu 💧 Manejo → 2. Configurar chaves Ecowitt).");
  return { applicationKey: app, apiKey: api, mac: mac, fuso: cfg.fuso, grupoChuva: cfg.grupoChuva };
}

function simNao_(v) {
  if (v === true || v === false) return v;
  var s = String(v).trim().toUpperCase();
  return s === "SIM" || s === "S" || s === "TRUE" || s === "1" || s === "X";
}

/** Data de célula (Date, "AAAA-MM-DD" ou "DD/MM/AAAA") → "AAAA-MM-DD". */
function dataIso_(v, fuso) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso, "yyyy-MM-dd");
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return s;
}

/** "Feijão PD" → "feijao pd": sem acento, minúsculo, espaços simples (chave do Motor.CULTURAS). */
function chaveCultura_(v) {
  return String(v == null ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Acrescenta no fim da aba PIVOS as colunas opcionais (3º item = true) que ainda não existem. */
function garantirColunasPivos_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
  if (!aba) return;
  var cab = aba.getLastColumn() ? aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0] : [];
  COLUNAS_PIVOS.forEach(function (c) {
    if (c[2] && cab.indexOf(c[1]) < 0) {
      aba.getRange(1, cab.length + 1).setValue(c[1]).setFontWeight("bold");
      cab.push(c[1]);
    }
  });
}

function lerPivos_(cfg) {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
  if (!aba || aba.getLastRow() < 2) return [];
  var vals = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
  var col = {};
  COLUNAS_PIVOS.forEach(function (c) { col[c[0]] = vals[0].indexOf(c[1]); });
  var faltando = COLUNAS_PIVOS.filter(function (c) { return col[c[0]] < 0 && !c[2]; }).map(function (c) { return c[1]; });
  if (faltando.length) throw new Error("Aba PIVOS sem as colunas: " + faltando.join(", "));
  var n = function (linha, k) { return col[k] < 0 ? null : Motor.numero(linha[col[k]]); };
  return vals.slice(1).filter(function (l) { return String(l[col.nome]).trim() !== ""; }).map(function (l) {
    var temEquip = n(l, "raioM") !== null && n(l, "vazaoM3h") !== null;
    return {
      nome: String(l[col.nome]).trim(),
      ativo: simNao_(l[col.ativo]),
      cultura: chaveCultura_(l[col.cultura]),
      cicloDias: n(l, "cicloDias"),
      plantio: dataIso_(l[col.plantio], cfg.fuso),
      inicioBalanco: l[col.inicioBalanco] === "" ? undefined : dataIso_(l[col.inicioBalanco], cfg.fuso),
      plantioDiretoPalhada: simNao_(l[col.palhada]),
      umidadeInicialPct: n(l, "umidadeInicialPct"),
      solo: {
        cc: n(l, "cc"), pmp: n(l, "pmp"), raizIniCm: n(l, "raizIniCm"), raizMaxCm: n(l, "raizMaxCm"),
        diasRaiz: n(l, "diasRaiz"), fatorDeplecaoFixo: n(l, "fatorFixo"),
      },
      laminaMinimaMm: n(l, "laminaMinimaMm"),
      tensaoIrrigarKpa: n(l, "tensaoIrrigarKpa"),
      latitude: n(l, "latitude"),
      longitude: n(l, "longitude"),
      contorno: contornoLido_(col.contorno < 0 ? "" : l[col.contorno]),
      equipamento: temEquip ? {
        raioM: n(l, "raioM"), anguloGraus: n(l, "anguloGraus"), vazaoM3h: n(l, "vazaoM3h"),
        velocidadeUltimaTorreMMin: n(l, "velocidadeUltimaTorreMMin"), percentimetroMinPct: n(l, "percentimetroMinPct"),
        eficienciaPct: n(l, "eficienciaPct"), potenciaKw: n(l, "potenciaKw"), tarifaRsKwh: n(l, "tarifaRsKwh"),
        tarifaPontaRsKwh: n(l, "tarifaPontaRsKwh"),
      } : undefined,
      grausDiaCiclo: n(l, "grausDiaCiclo"),
      sensorSolo: n(l, "sensorSolo"),
    };
  });
}

/** Contorno do pivô gravado como JSON [[lat,lon],…]; qualquer coisa estranha vira "sem contorno". */
function contornoLido_(v) {
  try {
    var c = JSON.parse(String(v || ""));
    return Array.isArray(c) && c.length >= 3 ? c : undefined;
  } catch (e) {
    return undefined;
  }
}

function fusoValido_(fuso) {
  try {
    Utilities.formatDate(new Date(), fuso, "yyyy");
    return true;
  } catch (e) {
    return false;
  }
}

/** Cadastro validado pelo motor; erros viram exceção com a lista em português. */
function cadastroValidado_() {
  var cfg = lerEstacao_();
  var pivos = lerPivos_(cfg);
  var cad = {
    estacao: { latitude: cfg.latitude, altitude: cfg.altitude, alturaAnemometro: cfg.alturaAnemometro, fuso: cfg.fuso },
    pivos: pivos,
  };
  var erros = Motor.validarCadastro(cad, fusoValido_);
  if (erros.length) throw new Error("Cadastro com problemas:\n- " + erros.join("\n- "));
  return { cfg: cfg, pivos: pivos };
}

/* ================================ LEITURAS ================================ */

function abaLeituras_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.LEITURAS);
  // planilha de versão anterior: a 9ª coluna (extras da estação) entra pelo cabeçalho
  if (aba && aba.getLastColumn() < 9 && aba.getLastRow() >= 1) aba.getRange(1, 9).setValue(CABECALHOS.LEITURAS[8]).setFontWeight("bold");
  return aba;
}

function linhaParaLeitura_(l) {
  var extras;
  try { extras = l[8] ? JSON.parse(String(l[8])) : undefined; } catch (e) { extras = undefined; }
  return {
    quando: String(l[0]),
    chuvaAcumDia: Motor.numero(l[1]),
    tempC: Motor.numero(l[2]),
    urPct: Motor.numero(l[3]),
    radWm2: Motor.numero(l[4]),
    ventoMs: Motor.numero(l[5]),
    intervaloMin: Motor.numero(l[6]) === null ? undefined : Motor.numero(l[6]),
    fonte: l[7] === "" ? undefined : String(l[7]),
    extras: extras,
  };
}

function leituraParaLinha_(x) {
  var v = function (n) { return n === null || n === undefined ? "" : n; };
  return [x.quando, v(x.chuvaAcumDia), v(x.tempC), v(x.urPct), v(x.radWm2), v(x.ventoMs), v(x.intervaloMin), v(x.fonte),
    x.extras && Object.keys(x.extras).length ? JSON.stringify(x.extras) : ""];
}

/** Leituras com ini <= quando <= fim. */
function lerLeituras_(ini, fim) {
  var aba = abaLeituras_();
  if (aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 9).getValues()
    .filter(function (l) { var q = String(l[0]); return q >= ini && q <= fim; })
    .map(linhaParaLeitura_);
}

/** Grava sem duplicar (mesmo horário de medição) e mantém a aba em ordem. Devolve quantas entraram. */
function gravarLeituras_(leituras) {
  if (!leituras.length) return 0;
  var aba = abaLeituras_();
  var ultima = aba.getLastRow();
  var existentes = {};
  var maiorExistente = "";
  if (ultima >= 2) {
    aba.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (l) {
      var q = String(l[0]);
      existentes[q] = true;
      if (q > maiorExistente) maiorExistente = q;
    });
  }
  var novas = leituras.filter(function (l) {
    if (existentes[l.quando]) return false;
    existentes[l.quando] = true;
    return true;
  });
  if (!novas.length) return 0;
  novas.sort(function (a, b) { return a.quando < b.quando ? -1 : 1; });
  aba.getRange(ultima + 1, 1, novas.length, 9).setValues(novas.map(leituraParaLinha_));
  if (novas[0].quando < maiorExistente) aba.getRange(2, 1, ultima - 1 + novas.length, 9).sort({ column: 1, ascending: true });
  return novas.length;
}

/* ================================= ECOWITT ================================= */

function chamarEcowitt_(caminho, params) {
  var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  var resp = UrlFetchApp.fetch(Motor.URL_BASE + caminho + "?" + qs, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error("HTTP " + resp.getResponseCode() + " da Ecowitt");
  var corpo = JSON.parse(resp.getContentText());
  if (corpo.code !== 0) throw new Error("Ecowitt recusou: " + corpo.msg + " (code " + corpo.code + ")");
  return corpo.data;
}

function paramsEcowitt_(eco) {
  return {
    application_key: eco.applicationKey, api_key: eco.apiKey, mac: eco.mac,
    temp_unitid: "1", wind_speed_unitid: "7", rainfall_unitid: "12", solar_irradiance_unitid: "16",
  };
}

/** Lê a estação agora e grava. Devolve a leitura e se ela era nova. */
function coletarAgora_() {
  var cfg = lerEstacao_();
  var eco = configEcowitt_(cfg);
  var p = paramsEcowitt_(eco);
  p.call_back = "all";
  var leitura = Motor.leituraDoTempoReal(chamarEcowitt_("/device/real_time", p), eco);
  return { leitura: leitura, gravada: gravarLeituras_([leitura]) > 0 };
}

/** Gatilho a cada 10 min: uma leitura ao vivo. */
function coletar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var r = coletarAgora_();
    if (!r.gravada) log_("coletar", "repetida", "Estação sem dado novo desde " + r.leitura.quando);
  } catch (e) {
    log_("coletar", "erro", e.message);
  } finally {
    lock.releaseLock();
  }
}

/** Menu: coleta e mostra o resultado (ou o erro) na tela. */
function menuColetar() {
  try {
    var r = coletarAgora_();
    var l = r.leitura;
    var f = function (x, u) { return x === null || x === undefined ? "sem dado" : (Math.round(x * 10) / 10) + " " + u; };
    log_("coletar", r.gravada ? "ok" : "repetida", l.quando);
    aviso_((r.gravada ? "✅ Leitura gravada na aba LEITURAS" : "ℹ️ A estação ainda não mandou leitura nova (a última já estava gravada)") +
      "\n\nMedida em: " + l.quando.replace("T", " ") +
      "\nTemperatura: " + f(l.tempC, "°C") + "\nUmidade: " + f(l.urPct, "%") +
      "\nRadiação: " + f(l.radWm2, "W/m²") + "\nVento: " + f(l.ventoMs, "m/s") + "\nChuva do dia: " + f(l.chuvaAcumDia, "mm"));
  } catch (e) {
    log_("coletar", "erro", e.message);
    aviso_("❌ Não coletou:\n\n" + e.message + "\n\nSe não entender o erro, use 💧 Manejo → Testar conexão Ecowitt e me mande o que aparecer.");
  }
}

/** Menu: mostra o que a Ecowitt responde, sem revelar as chaves. Serve para diagnosticar. */
function testarEcowitt() {
  var linhas = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var mascara = function (k) {
      var bruto = props.getProperty(k);
      var v = limparChave_(bruto);
      if (!v) return "NÃO CONFIGURADA";
      var tipo = tipoChave_(v);
      var esperado = k === "ECOWITT_APPLICATION_KEY" ? "application" : "api";
      return v.slice(0, 4) + "…" + v.slice(-2) + " (" + v.length + " caracteres" +
        (bruto.length !== v.length ? ", tinha " + (bruto.length - v.length) + " caractere(s) invisível(is)" : "") + ") — " +
        (tipo === esperado ? "formato OK" : tipo === "desconhecido" ? "FORMATO ESTRANHO" : "PARECE A OUTRA CHAVE (trocadas?)");
    };
    linhas.push("Application Key: " + mascara("ECOWITT_APPLICATION_KEY"));
    linhas.push("API Key: " + mascara("ECOWITT_API_KEY"));
    linhas.push("MAC: " + (props.getProperty("ECOWITT_MAC") || "NÃO CONFIGURADO"));
    var cfg = lerEstacao_();
    linhas.push("Fuso: " + cfg.fuso + " · Pluviômetro: " + cfg.grupoChuva);
    var eco = configEcowitt_(cfg);
    var p = paramsEcowitt_(eco);
    p.call_back = "all";
    var qs = Object.keys(p).map(function (k) { return k + "=" + encodeURIComponent(p[k]); }).join("&");
    var resp = UrlFetchApp.fetch(Motor.URL_BASE + "/device/real_time?" + qs, { muteHttpExceptions: true });
    linhas.push("HTTP: " + resp.getResponseCode());
    var corpo = JSON.parse(resp.getContentText());
    linhas.push("Resposta: code " + corpo.code + " — " + corpo.msg);
    var d = corpo.data;
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      linhas.push("Dados: vazios" + (Array.isArray(d) ? " (lista vazia — estação offline ou MAC errado?)" : ""));
    } else {
      linhas.push("Grupos recebidos: " + Object.keys(d).join(", "));
      [["outdoor", "temperature"], ["outdoor", "humidity"], ["solar_and_uvi", "solar"], [cfg.grupoChuva, "daily"], ["wind", "wind_speed"]]
        .forEach(function (c) {
          var v = d[c[0]] && d[c[0]][c[1]];
          linhas.push("• " + c.join(".") + ": " + (v ? v.value + " " + v.unit + " (medido " +
            (v.time ? Motor.paraLocal(Number(v.time) * 1000, cfg.fuso).replace("T", " ") : "sem hora") + ")" : "NÃO VEIO"));
        });
    }
  } catch (e) {
    linhas.push("ERRO: " + e.message);
  }
  log_("testar Ecowitt", "diagnóstico", linhas.join(" | "));
  aviso_(linhas.join("\n"));
  return linhas;
}

function historicoEcowitt_(eco, a, b, ciclo) {
  var p = paramsEcowitt_(eco);
  p.start_date = a.replace("T", " ");
  p.end_date = b.replace("T", " ");
  p.cycle_type = ciclo;
  p.call_back = ["outdoor", "solar_and_uvi", eco.grupoChuva || "rainfall", "wind"].join(",");
  return Motor.leiturasDoHistorico(chamarEcowitt_("/device/history", p), eco, ciclo);
}

/**
 * Preenche buracos entre `ini` e `fim` pelo histórico do ecowitt.net, em blocos de 1 dia com 12 h de folga.
 * Para antes do limite de tempo do Apps Script e devolve até onde chegou (ou null se terminou).
 */
function recuperar_(ini, fim, inicioMs) {
  var cfg = lerEstacao_();
  var eco = configEcowitt_(cfg);
  var agora = Motor.paraLocal(Date.now(), cfg.fuso);
  var fimUtil = [fim, Motor.somarMinutos(agora, -15)].sort()[0];
  var lacunas = Motor.encontrarLacunas(lerLeituras_(ini, fimUtil), ini, fimUtil);
  var res = { lacunas: lacunas.length, gravadas: 0, erros: [], parouEm: null };
  for (var i = 0; i < lacunas.length; i++) {
    var lac = lacunas[i];
    var ciclo = Motor.cicloParaIdade(Motor.minutosEntre(lac.de, agora) / 1440);
    var a = Motor.somarMinutos(lac.de, -720);
    var z = Motor.somarMinutos(lac.ate, 720);
    while (a < z) {
      if (Date.now() - inicioMs > LIMITE_EXECUCAO_MS) {
        res.parouEm = [lac.de, a].sort()[1];
        return res;
      }
      var b = [Motor.somarMinutos(a, 1440), z].sort()[0];
      try {
        var dentro = historicoEcowitt_(eco, a, b, ciclo).filter(function (l) { return l.quando > lac.de && l.quando < lac.ate; });
        res.gravadas += gravarLeituras_(dentro);
      } catch (e) {
        res.erros.push(a + " → " + b + ": " + e.message);
      }
      Utilities.sleep(1100);
      a = b;
    }
  }
  return res;
}

/** Gatilho de hora em hora: tapa buracos dos últimos 2 dias. */
function recuperarRecentes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var cfg = lerEstacao_();
    var agora = Motor.paraLocal(Date.now(), cfg.fuso);
    var r = recuperar_(Motor.somarMinutos(agora, -2880), agora, Date.now());
    if (r.lacunas) log_("recuperar", r.erros.length ? "erro" : "ok", r.lacunas + " lacuna(s), " + r.gravadas + " leitura(s). " + r.erros.join(" | "));
  } catch (e) {
    log_("recuperar", "erro", e.message);
  } finally {
    lock.releaseLock();
  }
}

/** Recuperação longa (ex.: meses parados): continua sozinha em novas execuções até terminar. */
function recuperarPeriodo(deData, ateData) {
  PropertiesService.getScriptProperties().setProperty("RECUPERACAO", JSON.stringify({ de: deData + "T00:00:00", ate: ateData + "T23:59:59" }));
  continuarRecuperacao();
}

function continuarRecuperacao() {
  var props = PropertiesService.getScriptProperties();
  var estado = JSON.parse(props.getProperty("RECUPERACAO") || "null");
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "continuarRecuperacao") ScriptApp.deleteTrigger(t);
  });
  if (!estado) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ScriptApp.newTrigger("continuarRecuperacao").timeBased().after(60 * 1000).create();
    return;
  }
  try {
    var r = recuperar_(estado.de, estado.ate, Date.now());
    log_("recuperar período", r.erros.length ? "erro" : "ok",
      "Desde " + estado.de + ": " + r.lacunas + " lacuna(s), " + r.gravadas + " leitura(s)" +
      (r.parouEm ? ", continua em " + r.parouEm : ", terminado") + ". " + r.erros.slice(0, 5).join(" | "));
    if (r.parouEm) {
      props.setProperty("RECUPERACAO", JSON.stringify({ de: r.parouEm, ate: estado.ate }));
      ScriptApp.newTrigger("continuarRecuperacao").timeBased().after(60 * 1000).create();
    } else {
      props.deleteProperty("RECUPERACAO");
    }
  } catch (e) {
    log_("recuperar período", "erro", e.message);
  } finally {
    lock.releaseLock();
  }
}

/* =========================== CÁLCULO E RELATÓRIO =========================== */

function ultimoDiaFechado_(fuso) {
  var agora = Motor.paraLocal(Date.now(), fuso);
  return agora.slice(11) >= Motor.HORA_FECHAMENTO ? agora.slice(0, 10) : Motor.diaAnterior(agora.slice(0, 10));
}

function lancamentos_(aba, fuso) {
  var a = SpreadsheetApp.getActive().getSheetByName(aba);
  if (!a || a.getLastRow() < 2) return [];
  return a.getRange(2, 1, a.getLastRow() - 1, a.getLastColumn()).getValues()
    .filter(function (l) { return l[0] !== "" && String(l[1]).trim() !== ""; })
    .map(function (l) { return { data: dataIso_(l[0], fuso), pivo: String(l[1]).trim().toLowerCase(), l: l }; });
}

/** Recalcula clima e balanço de todos os pivôs ativos até `dia` e escreve nas abas. */
function calcular_(dia) {
  var c = cadastroValidado_();
  var cfg = c.cfg;
  var estacao = { latitude: cfg.latitude, altitude: cfg.altitude, alturaAnemometro: cfg.alturaAnemometro };
  dia = dia || ultimoDiaFechado_(cfg.fuso);
  var pivos = c.pivos.filter(function (p) { return p.ativo; });
  if (!pivos.length) throw new Error("Nenhum pivô ativo na aba PIVOS.");
  pivos.forEach(function (p) { p.cultura = Motor.comCiclo(Motor.CULTURAS[p.cultura], p.cicloDias); });

  var inicio = function (p) { return p.inicioBalanco || p.plantio; };
  var iniGeral = pivos.map(inicio).filter(function (d) { return d <= dia; }).sort()[0] || dia;
  var leituras = lerLeituras_(Motor.diaAnterior(iniGeral) + "T" + Motor.HORA_FECHAMENTO, dia + "T" + Motor.HORA_FECHAMENTO);
  var clima = Motor.climaCompleto(leituras, iniGeral, dia);
  if (!clima.length) throw new Error("Nenhuma leitura da estação entre " + iniGeral + " e " + dia + ".");
  var previsao = lerPrevisao_();
  var diasPrev = previsao ? previsao.dias : [];
  // dia em que a estação ficou sem leituras: a ET₀ do Open-Meteo (dias passados) segura a decisão
  clima.forEach(function (d) {
    if (d.n >= Motor.MIN_LEITURAS) return;
    var p = diasPrev.filter(function (x) { return x.data === d.data && x.et0Mm !== null && x.et0Mm !== undefined; })[0];
    if (p) d.et0Externa = p.et0Mm;
  });

  escreverTabela_(ABA.CLIMA, CABECALHOS.CLIMA, clima.map(function (d) {
    return [d.data, d.tmax, d.tmin, d.tmed, d.ur, d.vento, d.rad, d.chuva, d.n, (d.estimados || []).join(", "),
      Motor.et0PenmanMonteith(d, estacao), Motor.et0Hargreaves(d, estacao)];
  }));

  var irrig = lancamentos_(ABA.IRRIGACOES, cfg.fuso);
  var umid = lancamentos_(ABA.UMIDADE, cfg.fuso);
  var linhasBalanco = [];
  var itens = pivos.map(function (pivo) {
    var ini = inicio(pivo);
    if (ini > dia) return { pivo: pivo, aviso: "balanço começa em " + ini };
    var chave = pivo.nome.toLowerCase();
    var dias = clima.filter(function (d) { return d.data >= ini; });
    var linhas = Motor.simularBalanco({
      pivo: pivo,
      estacao: estacao,
      dias: dias,
      irrigacoes: irrig.filter(function (x) { return x.pivo === chave; }).map(function (x) { return { data: x.data, mm: Motor.numero(x.l[2]) || 0 }; }),
      ajustes: umid.filter(function (x) { return x.pivo === chave && Motor.numero(x.l[2]) !== null; }).map(function (x) {
        return {
          data: x.data, umidadeRaizPct: Motor.numero(x.l[2]),
          umidadeProfundaPct: Motor.numero(x.l[3]) === null ? undefined : Motor.numero(x.l[3]),
          tensaoKpa: Motor.numero(x.l[4]) === null ? undefined : Motor.numero(x.l[4]),
          fonte: x.l[5] ? String(x.l[5]) : undefined,
        };
      }),
      chuvaMinimaMm: cfg.chuvaMinima,
      ponta: cfg.ponta,
      previsao: diasPrev,
    });
    linhas.forEach(function (l) {
      linhasBalanco.push([pivo.nome, l.data, l.das, l.estadio, l.kc, l.et0, l.etc, l.chuva, l.irrigacao, l.raizCm, l.cadMm,
        l.fatorDeplecao, l.afdMm, l.deficit, l.ajustado ? "SIM" : "", l.decisao, l.alertas.join(" | ")]);
    });
    var incertos = dias.filter(function (d) { return (d.estimados && d.estimados.length) || d.n < Motor.MIN_LEITURAS; }).length;
    return { pivo: pivo, linha: linhas[linhas.length - 1], diasIncertos: incertos };
  });
  escreverTabela_(ABA.BALANCO, CABECALHOS.BALANCO, linhasBalanco);

  var climaDia = clima[clima.length - 1];
  var et0Dia = climaDia.et0Externa !== undefined ? climaDia.et0Externa : Motor.et0PenmanMonteith(climaDia, estacao);
  var msg = Motor.montarMensagem(dia, Object.assign({}, climaDia, { et0: et0Dia }), itens, diasPrev);
  escreverPainel_(dia, climaDia, et0Dia, itens, msg);
  salvarResumo_(dia, cfg, climaDia, et0Dia, itens, previsao);
  return { dia: dia, cfg: cfg, assunto: msg.assunto, texto: msg.texto, itens: itens };
}

/** Resumo do último cálculo para o app abrir rápido (aba oculta CACHE, célula A1). */
function salvarResumo_(dia, cfg, clima, et0, itens, previsao) {
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var ult = ultimaLeitura_();
  var resumo = {
    dia: dia,
    calculadoEm: Motor.paraLocal(Date.now(), cfg.fuso),
    clima: { et0: r2(et0), chuva: r2(clima.chuva), n: clima.n, tmax: r2(clima.tmax), tmin: r2(clima.tmin), ur: r2(clima.ur), estimados: clima.estimados || [] },
    pivos: itens.map(function (it) {
      var l = it.linha;
      var cult = it.pivo.cultura;
      var eq = it.pivo.equipamento;
      var p = {
        nome: it.pivo.nome, cultura: cult.nome, laminaMinimaMm: it.pivo.laminaMinimaMm, aviso: it.aviso || "",
        latitude: it.pivo.latitude, longitude: it.pivo.longitude, contorno: it.pivo.contorno || null,
        raioM: eq ? eq.raioM : null, anguloGraus: eq ? eq.anguloGraus : null,
      };
      if (!l) return p;
      p.sensorSolo = sensorSolo_(ult, it.pivo.sensorSolo);
      if (l.decisao === "IRRIGAR" && previsao) p.avisoChuva = Motor.avisoChuva(l.deficit, previsao.dias, dia);
      p.estadio = l.estadio;
      p.das = l.das;
      p.dae = Motor.dae(cult, l.das);
      p.emergenciaDias = cult.emergenciaDias || 0;
      p.fimCicloDas = Motor.fimDoCicloDas(cult);
      p.curvaKc = Motor.curvaKc(cult, it.pivo.plantioDiretoPalhada);
      p.decisao = l.decisao;
      p.deficit = r2(l.deficit);
      p.afd = r2(l.afdMm);
      p.cad = r2(l.cadMm);
      p.etc = r2(l.etc);
      p.kc = l.kc;
      p.irrigacao = r2(l.irrigacao);
      p.alertas = l.alertas;
      p.diasIncertos = it.diasIncertos || 0;
      var r = l.recomendacao;
      if (r) p.rec = {
        laminaBrutaMm: r2(r.laminaBrutaMm), percentimetroPct: Math.round(r.percentimetroPct), tempoVoltaH: r2(r.tempoVoltaH),
        energiaKwh: Math.round(r.energiaKwh), custoRs: r2(r.custoRs), limitado: r.limitadoPelaLaminaMax,
        ponta: r.ponta ? { inicioSugerido: r.ponta.inicioSugerido, horasNaPonta: r2(r.ponta.horasNaPonta), custoPiorRs: r2(r.ponta.custoPiorRs) } : null,
      };
      if (l.projecao) p.projecao = {
        proximaIrrigacao: l.projecao.proximaIrrigacao, emDias: l.projecao.emDias,
        deficitFimVoltaMm: l.projecao.deficitFimVoltaMm === undefined ? null : r2(l.projecao.deficitFimVoltaMm),
        dias: l.projecao.dias.map(function (x) { return { data: x.data, deficit: r2(x.deficit) }; }),
      };
      return p;
    }),
  };
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CACHE) || SpreadsheetApp.getActive().insertSheet(ABA.CACHE);
  aba.getRange(1, 1).setValue(JSON.stringify(resumo));
  return resumo;
}

/* ------------------------------ previsão do tempo ------------------------------ */

/** Gatilho (a cada 3 h) e menu: busca Open-Meteo (mm, %) e INMET (texto) e grava na aba PREVISAO + CACHE. */
function atualizarPrevisao() {
  var cfg = lerEstacao_();
  var fontes = [], erros = [], om = [], inmet = [];
  if (cfg.latitude !== null && cfg.longitude !== null) {
    try {
      om = Motor.lerOpenMeteo(buscarJson_(Motor.urlOpenMeteo(cfg.latitude, cfg.longitude, cfg.fuso)));
      fontes.push("Open-Meteo");
    } catch (e) { erros.push("Open-Meteo: " + e.message); }
  } else erros.push("Open-Meteo: preencha latitude e longitude na aba ESTACAO.");
  if (cfg.ibge) {
    try {
      inmet = Motor.lerInmet(buscarJson_(Motor.INMET_URL + Math.round(cfg.ibge)));
      fontes.push("INMET");
    } catch (e) { erros.push("INMET: " + e.message); }
  }
  var dias = Motor.juntarPrevisao(om, inmet);
  if (!dias.length) {
    log_("previsão", "erro", erros.join(" | "));
    return null;
  }
  // hora a hora (48 h) para as janelas de pulverização
  var horas = [];
  if (cfg.latitude !== null && cfg.longitude !== null) {
    try {
      horas = Motor.aplicacaoPorHora(Motor.lerOpenMeteoHoras(buscarJson_(Motor.urlOpenMeteoHoras(cfg.latitude, cfg.longitude, cfg.fuso))));
    } catch (e) { erros.push("Open-Meteo horas: " + e.message); }
  }
  var previsao = { atualizadoEm: Motor.paraLocal(Date.now(), cfg.fuso), dias: dias, fontes: fontes, horas: horas };
  criarAbaSeFaltar_(SpreadsheetApp.getActive(), ABA.PREVISAO, CABECALHOS.PREVISAO);
  escreverTabela_(ABA.PREVISAO, CABECALHOS.PREVISAO, dias.map(function (d) {
    return [d.data, d.chuvaMm === null ? "" : d.chuvaMm, d.probPct === null ? "" : d.probPct, d.tmin === null ? "" : d.tmin,
      d.tmax === null ? "" : d.tmax, d.resumo || "", previsao.atualizadoEm, fontes.join(", ")];
  }));
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CACHE) || SpreadsheetApp.getActive().insertSheet(ABA.CACHE);
  aba.getRange(2, 1).setValue(JSON.stringify(previsao));
  log_("previsão", erros.length ? "parcial" : "ok", fontes.join(", ") + (erros.length ? " | " + erros.join(" | ") : ""));
  return previsao;
}

function buscarJson_(url) {
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("HTTP " + code);
  return JSON.parse(resp.getContentText());
}

function lerPrevisao_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CACHE);
  if (!aba || aba.getLastRow() < 2) return null;
  var t = aba.getRange(2, 1).getValue();
  try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

function menuPrevisao() {
  var p = atualizarPrevisao();
  if (!p) { aviso_("Não consegui buscar a previsão. Veja a aba LOG."); return; }
  var prox = p.dias.slice(0, 4).map(function (d) {
    return d.data.split("-").reverse().slice(0, 2).join("/") + ": " + (d.chuvaMm === null ? "?" : d.chuvaMm) + " mm" + (d.probPct === null ? "" : " (" + d.probPct + "%)") + (d.resumo ? " — " + d.resumo : "");
  });
  aviso_("Previsão atualizada (" + p.fontes.join(", ") + "):\n" + prox.join("\n"));
}

function lerResumo_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CACHE);
  if (!aba || aba.getLastRow() < 1) return null;
  var t = aba.getRange(1, 1).getValue();
  return t ? JSON.parse(t) : null;
}

var APP_URL = "https://favbalanca-ai.github.io/MONITORAMENTO-DE-IRRIGA-O/";

/**
 * Mostra o endereço /exec para o app: campo com botão Copiar, link que já abre o app ligado a esta
 * planilha (?exec=…) e QR Code para abrir no celular apontando a câmera.
 */
function menuLinkApp() {
  var url = "";
  try {
    url = ScriptApp.getService().getUrl();
  } catch (e) {
    url = "";
  }
  if (!url) {
    aviso_("A ponte com o app ainda não foi publicada. No editor do Apps Script: Implantar → Nova implantação → App da Web → Executar como: Eu → Quem pode acessar: Qualquer pessoa → Implantar.");
    return;
  }
  var link = APP_URL + "?exec=" + encodeURIComponent(url);
  var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };
  var html =
    '<div style="font:14px Arial,sans-serif;color:#16404d">' +
    '<p style="margin:0 0 6px"><b>1. No celular:</b> aponte a câmera para o QR Code. O app abre já ligado a esta planilha.</p>' +
    '<div id="qr" style="text-align:center;margin:8px 0"></div>' +
    '<p style="margin:10px 0 6px"><b>2. Ou</b> abra o app por este link:</p>' +
    '<p style="margin:0 0 10px"><a href="' + esc(link) + '" target="_blank" style="color:#2e7d8c;font-weight:bold">Abrir o app ligado a esta planilha ↗</a></p>' +
    '<p style="margin:10px 0 6px"><b>3. Ou</b> copie o endereço e cole em ⚙️ Ajustes no app:</p>' +
    '<input id="u" readonly value="' + esc(url) + '" style="width:100%;padding:8px;font-size:12px;box-sizing:border-box" onclick="this.select()">' +
    '<button id="c" style="margin-top:8px;padding:8px 14px;background:#2e7d8c;color:#fff;border:0;border-radius:6px;font-weight:bold;cursor:pointer">Copiar endereço</button>' +
    '<span id="ok" style="margin-left:8px;color:#2e7d32"></span>' +
    '</div>' +
    '<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>' +
    '<script>' +
    'try{var q=qrcode(0,"M");q.addData(' + JSON.stringify(link) + ');q.make();document.getElementById("qr").innerHTML=q.createImgTag(4,8);}catch(e){document.getElementById("qr").textContent="(QR Code indisponível — use o link)";}' +
    'document.getElementById("c").onclick=function(){var i=document.getElementById("u");i.select();' +
    'var feito=function(){document.getElementById("ok").textContent="Copiado ✓";};' +
    'try{navigator.clipboard.writeText(i.value).then(feito,function(){document.execCommand("copy");feito();});}catch(e){document.execCommand("copy");feito();}};' +
    '</script>';
  try {
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(560), "📱 Ligar o app a esta planilha");
  } catch (e) {
    aviso_("Endereço da planilha para o app:\n\n" + url + "\n\nOu abra: " + link);
  }
}

function escreverTabela_(nome, cabecalho, linhas) {
  var aba = SpreadsheetApp.getActive().getSheetByName(nome);
  aba.clearContents();
  aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight("bold");
  if (linhas.length) aba.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
}

function escreverPainel_(dia, clima, et0, itens, msg) {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PAINEL);
  aba.clearContents();
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var linhas = [
    ["MANEJO DE IRRIGAÇÃO — " + dia.split("-").reverse().join("/"), "", "", "", "", "", "", "", "", "", "", ""],
    ["ET0 (mm)", r1(et0), "Chuva (mm)", r1(clima.chuva), "Leituras", clima.n + " de 144", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["Pivô", "Cultura / estádio", "DAS", "Decisão", "Déficit (mm)", "AFD (mm)", "Lâmina bruta (mm)", "Percentímetro (%)",
      "Volta (h)", "Energia (kWh)", "Custo (R$)", "Alertas"],
  ];
  itens.forEach(function (it) {
    var l = it.linha;
    if (!l) {
      linhas.push([it.pivo.nome, it.aviso || "", "", "", "", "", "", "", "", "", "", ""]);
      return;
    }
    var r = l.recomendacao;
    linhas.push([it.pivo.nome, it.pivo.cultura.nome + " " + l.estadio, l.das, l.decisao, r1(l.deficit), r1(l.afdMm),
      r ? r1(r.laminaBrutaMm) : "", r ? Math.round(r.percentimetroPct) : "", r ? r1(r.tempoVoltaH) : "",
      r ? Math.round(r.energiaKwh) : "", r ? Math.round(r.custoRs * 100) / 100 : "", l.alertas.join(" | ")]);
  });
  linhas.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
  linhas.push(["Mensagem enviada:", msg.texto.replace(/\*/g, ""), "", "", "", "", "", "", "", "", "", ""]);
  aba.getRange(1, 1, linhas.length, 12).setValues(linhas);
  aba.getRange(1, 1).setFontWeight("bold");
  aba.getRange(4, 1, 1, 12).setFontWeight("bold");
}

function jaEnviado_(dia, canal) {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.LOG);
  if (aba.getLastRow() < 2) return false;
  return aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues().some(function (l) {
    return l[1] === canal && l[2] === "enviado" && String(l[4]) === dia;
  });
}

/** Calcula e envia. Cada canal recebe uma vez por dia; `forcar` reenvia. */
function calcularEEnviar_(dia, forcar) {
  var r = calcular_(dia);
  var nomeArquivo = r.dia + ".txt";
  var pasta = pastaDoApp_(PASTA_RELATORIOS);
  var antigos = pasta.getFilesByName(nomeArquivo);
  while (antigos.hasNext()) antigos.next().setTrashed(true);
  pasta.createFile(nomeArquivo, r.assunto + "\n\n" + r.texto.replace(/\*/g, ""));

  if (!r.cfg.emails.length) {
    log_("e-mail", "sem destinatário", "Preencha os e-mails na aba ESTACAO.", r.dia);
  } else if (!forcar && jaEnviado_(r.dia, "e-mail")) {
    log_("e-mail", "já enviado", "", r.dia);
  } else {
    try {
      MailApp.sendEmail({ to: r.cfg.emails.join(","), subject: r.assunto, body: r.texto.replace(/\*/g, "") });
      log_("e-mail", "enviado", r.cfg.emails.join(", "), r.dia);
    } catch (e) {
      log_("e-mail", "erro", e.message, r.dia);
    }
  }
  return r;
}

/** Gatilho das 18h. */
function relatorioDiario() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 60 * 1000)) {
    log_("relatório", "erro", "Outra execução não liberou a planilha a tempo.");
    return;
  }
  try {
    var cfg = lerEstacao_();
    var agora = Motor.paraLocal(Date.now(), cfg.fuso);
    try {
      // Antes de decidir, tenta tapar buracos do dia (no máximo ~2 min, para sobrar tempo ao cálculo).
      recuperar_(Motor.somarMinutos(agora, -1440), agora, Date.now() - LIMITE_EXECUCAO_MS + 2 * 60 * 1000);
    } catch (e) {
      log_("recuperar", "erro", e.message);
    }
    calcularEEnviar_(null, false);
  } catch (e) {
    log_("relatório", "erro", e.message);
    avisarErroPorEmail_(e);
  } finally {
    lock.releaseLock();
  }
}

function avisarErroPorEmail_(e) {
  try {
    var emails = lerEstacao_().emails;
    if (emails.length) MailApp.sendEmail({ to: emails.join(","), subject: "⚠️ Manejo: relatório não saiu", body: e.message });
  } catch (ignorado) {
    // sem como avisar; fica no LOG
  }
}

/* ================================ MENU ================================ */

function menuCalcular() {
  var r = calcular_(perguntarData_());
  if (r) aviso_("Calculado para " + r.dia + ". Veja a aba PAINEL.");
}

function menuEnviar() {
  var dia = perguntarData_();
  var r = calcularEEnviar_(dia, true);
  aviso_("Relatório de " + r.dia + " processado. Veja a aba LOG.");
}

function perguntarData_() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Dia do relatório", "AAAA-MM-DD ou DD/MM/AAAA (em branco = último dia fechado às 18h)", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) throw new Error("Cancelado.");
  var t = r.getResponseText().trim();
  return t ? dataIso_(t, lerEstacao_().fuso) : null;
}

function menuRecuperarPeriodo() {
  var ui = SpreadsheetApp.getUi();
  var de = ui.prompt("Recuperar do histórico da Ecowitt", "Data inicial (AAAA-MM-DD ou DD/MM/AAAA)", ui.ButtonSet.OK_CANCEL);
  if (de.getSelectedButton() !== ui.Button.OK) return;
  var ate = ui.prompt("Recuperar do histórico da Ecowitt", "Data final (em branco = hoje)", ui.ButtonSet.OK_CANCEL);
  if (ate.getSelectedButton() !== ui.Button.OK) return;
  var fuso = lerEstacao_().fuso;
  var fim = ate.getResponseText().trim() ? dataIso_(ate.getResponseText(), fuso) : Motor.paraLocal(Date.now(), fuso).slice(0, 10);
  recuperarPeriodo(dataIso_(de.getResponseText(), fuso), fim);
  aviso_("Recuperação iniciada. Se for um período longo, ela continua sozinha a cada minuto — acompanhe na aba LOG.");
}

/**
 * Importa a aba METEO de uma planilha antiga (ex.: MANEJO_IRRIGACAO_MASTER).
 * Colunas: Data/hora, Chuva (mm), Temp, UR, Radiação, Vento (m/s).
 * Temperatura acima de 45 é tratada como °F; radiação até 5 como MJ/m² por leitura de 10 min, acima disso como W/m².
 */
function importarMeteo(urlOuId) {
  var cfg = lerEstacao_();
  var origem = /^https?:/.test(urlOuId) ? SpreadsheetApp.openByUrl(urlOuId) : SpreadsheetApp.openById(urlOuId);
  var aba = origem.getSheetByName("METEO");
  if (!aba) throw new Error("A planilha não tem aba METEO.");
  if (aba.getLastRow() < 2) return 0;
  var leituras = aba.getRange(2, 1, aba.getLastRow() - 1, 6).getValues()
    .filter(function (l) { return l[0] instanceof Date; })
    .map(function (l) {
      var temp = Motor.numero(l[2]);
      var rad = Motor.numero(l[4]);
      return {
        quando: Utilities.formatDate(l[0], cfg.fuso, "yyyy-MM-dd'T'HH:mm:ss"),
        chuvaAcumDia: Motor.numero(l[1]),
        tempC: temp !== null && temp > 45 ? Motor.paraCelsius(temp, "°F") : temp,
        urPct: Motor.numero(l[3]),
        radWm2: rad === null ? null : rad <= 5 ? (rad * 1e6) / 600 : rad,
        ventoMs: Motor.numero(l[5]),
        intervaloMin: 10,
        fonte: "planilha",
      };
    });
  var n = gravarLeituras_(leituras);
  log_("importar METEO", "ok", n + " de " + leituras.length + " leitura(s) de " + origem.getName());
  return n;
}

function menuImportarMeteo() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Importar METEO", "Link da planilha antiga (precisa ter a aba METEO)", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var n = importarMeteo(r.getResponseText().trim());
  aviso_(n + " leitura(s) importada(s).");
}

/* ============================ DRIVE E UTILIDADES ============================ */

/** Subpasta dentro da pasta onde está esta planilha (cria se não existir). */
function pastaDoApp_(nome) {
  var arquivo = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  var pais = arquivo.getParents();
  var pai = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  var it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

/** Gatilho das 4h: cópia da planilha na pasta BACKUP, mantendo as últimas 30. */
function backupDiario() {
  try {
    var ss = SpreadsheetApp.getActive();
    var fuso = lerEstacao_().fuso;
    var pasta = pastaDoApp_(PASTA_BACKUP);
    DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + "_BACKUP_" + Utilities.formatDate(new Date(), fuso, "yyyy-MM-dd"), pasta);
    var copias = [];
    var it = pasta.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf(ss.getName() + "_BACKUP_") === 0) copias.push(f);
    }
    copias.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    copias.slice(BACKUPS_MANTIDOS).forEach(function (f) { f.setTrashed(true); });
  } catch (e) {
    log_("backup", "erro", e.message);
  }
}

function log_(acao, status, detalhe, dia) {
  try {
    var aba = SpreadsheetApp.getActive().getSheetByName(ABA.LOG);
    if (!aba) return;
    var fuso = lerEstacao_().fuso;
    aba.appendRow([Motor.paraLocal(Date.now(), fuso).replace("T", " "), acao, status, String(detalhe || "").slice(0, 2000), dia || ""]);
    if (aba.getLastRow() > 5000) aba.deleteRows(2, 1000);
  } catch (e) {
    console.log(acao + " " + status + " " + detalhe);
  }
}

function aviso_(texto) {
  try {
    SpreadsheetApp.getUi().alert(texto);
  } catch (e) {
    console.log(texto); // rodando por gatilho, sem tela
  }
}

/* ===================================================================================
 * APP NO CELULAR (GitHub Pages) ↔ PLANILHA
 *
 * Mesmo modelo do Planejamento: a planilha é a fonte da verdade, o app puxa (doGet) e
 * envia (doPost). Publicar: Implantar → Nova implantação → App da Web →
 *   Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 * O endereço /exec vai na tela ⚙️ Sincronizar do app (nunca no GitHub).
 *
 * doGet  ?acao=dados | hash | historico&pivo=&dias= | usuarios     (&s=<sessão>)
 * doPost {__login} {__lancamento} {__apagar} {__recalcular} {__pivo} {__usuario} {__trocarPin}
 *        — um tipo por pedido, com a sessão em "s". Content-Type text/plain (sem preflight).
 * =================================================================================== */

var VERSAO_SERVIDOR = "2026.10.09-5";
var LOGIN_TENTATIVAS = 5;
var LOGIN_BLOQUEIO_MIN = 10;
var SESSAO_DIAS = 30;
var COLS_USUARIOS = ["NOME", "LOGIN", "PERFIL", "PIN NOVO", "PIN", "ATIVO", "VERSÃO", "ÚLTIMO ACESSO"];

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    return json_(doGet_((e && e.parameter) || {}));
  } catch (err) {
    return json_({ ok: false, erro: err.message });
  }
}

function doGet_(p) {
  var acao = p.acao || "dados";
  var u = usuarioDaSessao_(p.s);
  if (u && u.erro) return { login: true, erro: u.erro };
  if (!u && loginExigido_()) return { login: true, erro: "Entre com seu login e PIN." };
  if (acao === "dados") return dadosApp_(u);
  if (acao === "hash") return { ok: true, hash: hashDados_() };
  if (acao === "historico") return { ok: true, historico: historico_(p.pivo, Number(p.dias) || 30) };
  if (acao === "usuarios") {
    exigirAdmin_(u);
    return { ok: true, usuarios: listarUsuarios_() };
  }
  throw new Error("Ação desconhecida: " + acao);
}

function doPost(e) {
  var corpo;
  try {
    corpo = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, erro: "Pedido inválido (JSON)." });
  }
  var tipos = Object.keys(corpo).filter(function (k) { return k.indexOf("__") === 0; });
  if (tipos.length !== 1) return json_({ ok: false, erro: "Mande um tipo de gravação por pedido." });
  var tipo = tipos[0];
  if (tipo === "__login") {
    try {
      return json_(loginFaz_(corpo.__login || {}));
    } catch (err) {
      return json_({ ok: false, erro: err.message });
    }
  }
  var u = usuarioDaSessao_(corpo.s);
  if (u && u.erro) return json_({ ok: false, login: true, erro: u.erro });
  if (!u && loginExigido_()) return json_({ ok: false, login: true, erro: "Entre com seu login e PIN." });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) return json_({ ok: false, ocupado: true, erro: "Planilha ocupada. Tente de novo em instantes." });
  try {
    var d = corpo[tipo] || {};
    if (tipo === "__lancamento") return json_(gravarLancamento_(d, u));
    if (tipo === "__apagar") return json_(apagarLancamento_(d.id, u));
    if (tipo === "__recalcular") return json_(recalcularApp_());
    if (tipo === "__pivo") {
      exigirAdmin_(u);
      return json_({ ok: true, cadastro: salvarPivo_(d.dados || {}, d.original || null), recalculo: recalcularApp_() });
    }
    if (tipo === "__usuario") {
      exigirAdmin_(u);
      return json_(gravarUsuario_(d));
    }
    if (tipo === "__trocarPin") return json_(trocarPin_(u, d.atual, d.novo));
    return json_({ ok: false, erro: "Tipo de gravação desconhecido: " + tipo });
  } catch (err) {
    return json_({ ok: false, erro: err.message });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------- dados para o app ------------------------------- */

function hojeLocal_() {
  return Motor.paraLocal(Date.now(), lerEstacao_().fuso).slice(0, 10);
}

/** Última leitura ao vivo com tudo que a estação mandou + tendência da pressão (3 h). */
function ultimaLeitura_() {
  var aba = abaLeituras_();
  if (!aba || aba.getLastRow() < 2) return null;
  var n = Math.min(40, aba.getLastRow() - 1);
  var ls = aba.getRange(aba.getLastRow() - n + 1, 1, n, 9).getValues().map(linhaParaLeitura_);
  var l = ls[ls.length - 1];
  // extras só existem na coleta ao vivo; se a última linha veio do histórico, usa os extras mais recentes
  var comExtras = ls.filter(function (x) { return x.extras && Object.keys(x.extras).length; }).pop();
  var r = { quando: l.quando, tempC: l.tempC, urPct: l.urPct, radWm2: l.radWm2, ventoMs: l.ventoMs, chuvaAcumDia: l.chuvaAcumDia,
    extras: comExtras ? comExtras.extras : {}, extrasQuando: comExtras ? comExtras.quando : null };
  var pAgora = r.extras["pressure.relative"];
  if (pAgora !== undefined) {
    var limite = Motor.somarMinutos(l.quando, -180);
    var antiga = ls.filter(function (x) { return x.extras && x.extras["pressure.relative"] !== undefined && x.quando <= limite; }).pop();
    if (antiga) r.pressaoTendencia3h = Math.round((pAgora - antiga.extras["pressure.relative"]) * 10) / 10;
  }
  return r;
}

/**
 * Rosa dos ventos das últimas 24 h: 16 setores de 22,5°, cada um com quantas leituras vieram daquela
 * direção, separadas por faixa de velocidade (km/h: < 3 calmaria, 3–10, 10–20, > 20), e a média.
 * Usa a direção gravada nos extras (coleta ao vivo); leituras sem direção não entram.
 */
function rosaVentos24h_() {
  var aba = abaLeituras_();
  if (!aba || aba.getLastRow() < 2) return null;
  var n = Math.min(200, aba.getLastRow() - 1);
  var ls = aba.getRange(aba.getLastRow() - n + 1, 1, n, 9).getValues().map(linhaParaLeitura_);
  var fim = ls[ls.length - 1].quando, ini = Motor.somarMinutos(fim, -1440);
  var setores = [];
  for (var i = 0; i < 16; i++) setores.push({ n: 0, faixas: [0, 0, 0, 0], soma: 0 });
  var total = 0, calmaria = 0;
  ls.forEach(function (l) {
    if (l.quando < ini || !l.extras || l.extras["wind.wind_direction"] === undefined) return;
    var kmh = (l.ventoMs || 0) * 3.6;
    total++;
    if (kmh < 3) { calmaria++; return; } // sem vento a direção não significa nada
    var s = Math.round((((l.extras["wind.wind_direction"] % 360) + 360) % 360) / 22.5) % 16;
    var f = kmh < 10 ? 1 : kmh < 20 ? 2 : 3;
    setores[s].n++; setores[s].faixas[f]++; setores[s].soma += kmh;
  });
  if (!total) return null;
  var maior = 0, idx = -1;
  setores.forEach(function (s, i) { s.mediaKmh = s.n ? Math.round(s.soma / s.n) : 0; delete s.soma; if (s.n > maior) { maior = s.n; idx = i; } });
  return { de: ini, ate: fim, total: total, calmaria: calmaria, setores: setores, predominante: idx };
}

/** Umidade/temperatura do sensor de solo de um canal, da última leitura. */
function sensorSolo_(ult, canal) {
  if (!ult || !canal || !ult.extras) return null;
  var c = Math.round(canal);
  var um = ult.extras["soil_ch" + c + ".soilmoisture"];
  if (um === undefined) return null;
  var t = ult.extras["temp_ch" + c + ".temperature"];
  return { canal: c, umidadePct: um, tempC: t === undefined ? null : t, quando: ult.extrasQuando || ult.quando };
}

function dadosApp_(u) {
  var resumo = lerResumo_();
  var erroCalculo = "";
  if (!resumo) {
    try {
      calcular_(null);
      resumo = lerResumo_();
    } catch (e) {
      erroCalculo = e.message;
    }
  }
  return {
    ok: true,
    versao: VERSAO_SERVIDOR,
    hoje: hojeLocal_(),
    usuario: u ? usuarioPublico_(u) : null,
    exigido: loginExigido_(),
    resumo: resumo,
    previsao: lerPrevisao_(),
    vento24h: rosaVentos24h_(),
    erroCalculo: erroCalculo,
    ultimaLeitura: ultimaLeitura_(),
    cadastro: cadastroPivos_(),
    lancamentos: lancamentosApp_(30),
    hash: hashDados_(),
  };
}

/** Muda quando há cálculo novo, leitura nova ou lançamento novo: o app só baixa tudo se mudou. */
function hashDados_() {
  var r = lerResumo_();
  var ss = SpreadsheetApp.getActive();
  var n = function (nome) { var a = ss.getSheetByName(nome); return a ? a.getLastRow() : 0; };
  var ult = ultimaLeitura_();
  var prev = lerPrevisao_();
  return [r ? r.calculadoEm : "", n(ABA.IRRIGACOES), n(ABA.UMIDADE), n(ABA.PIVOS), ult ? ult.quando : "", prev ? prev.atualizadoEm : ""].join("|");
}

function recalcularApp_() {
  try {
    calcular_(null);
    return { ok: true, resumo: lerResumo_(), hash: hashDados_() };
  } catch (e) {
    return { ok: true, resumo: lerResumo_(), aviso: "Gravado, mas o recálculo falhou: " + e.message, hash: hashDados_() };
  }
}

function historico_(nome, dias) {
  var alvo = String(nome || "").toLowerCase();
  var bal = SpreadsheetApp.getActive().getSheetByName(ABA.BALANCO);
  if (!bal || bal.getLastRow() < 2) return { pivo: nome, linhas: [] };
  var cab = bal.getRange(1, 1, 1, bal.getLastColumn()).getValues()[0];
  var col = function (h) { return cab.indexOf(h); };
  var fuso = lerEstacao_().fuso;
  var linhas = bal.getRange(2, 1, bal.getLastRow() - 1, cab.length).getValues()
    .filter(function (l) { return String(l[col("Pivô")]).toLowerCase() === alvo; })
    .map(function (l) {
      var n = function (h) { var x = Motor.numero(l[col(h)]); return x === null ? null : Math.round(x * 100) / 100; };
      return {
        data: dataIso_(l[col("Data")], fuso), deficit: n("Déficit (mm)"), afd: n("AFD (mm)"), chuva: n("Chuva"),
        irrigacao: n("Irrigação"), et0: n("ET0"), etc: n("ETc"), estadio: String(l[col("Estádio")]),
        decisao: String(l[col("Decisão")]), medicao: l[col("Medição")] === "SIM",
      };
    });
  var p = lerPivos_(lerEstacao_()).filter(function (x) { return x.nome.toLowerCase() === alvo; })[0];
  return { pivo: nome, laminaMinimaMm: p ? p.laminaMinimaMm : null, linhas: linhas.slice(-dias), clima: climaHistorico_(dias, fuso) };
}

/** Série diária da estação (aba CLIMA) para o gráfico do Histórico. */
function climaHistorico_(dias, fuso) {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CLIMA);
  if (!aba || aba.getLastRow() < 2) return [];
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var col = function (h) { return cab.indexOf(h); };
  return aba.getRange(2, 1, aba.getLastRow() - 1, cab.length).getValues().slice(-dias).map(function (l) {
    var n = function (h) { var x = Motor.numero(l[col(h)]); return x === null ? null : Math.round(x * 10) / 10; };
    return { data: dataIso_(l[col("Data")], fuso), tmax: n("Tmax"), tmin: n("Tmin"), ur: n("UR"), chuva: n("Chuva (mm)"), et0: n("ET0 PM (mm)"), vento: n("Vento"), rad: n("Radiação (MJ/m²)") };
  });
}

function cadastroPivos_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
  var fuso = lerEstacao_().fuso;
  var pivos = [];
  if (aba && aba.getLastRow() >= 2) {
    var vals = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
    pivos = vals.slice(1).filter(function (l) { return String(l[0]).trim() !== ""; }).map(function (l) {
      var o = {};
      COLUNAS_PIVOS.forEach(function (c) {
        var i = vals[0].indexOf(c[1]);
        var x = i < 0 ? "" : l[i];
        o[c[0]] = x instanceof Date ? dataIso_(x, fuso) : x === undefined ? "" : x;
      });
      return o;
    });
  }
  return { colunas: COLUNAS_PIVOS, pivos: pivos, culturas: catalogoCulturas_() };
}

/** Catálogo de culturas para o app: nome, ciclo, curva de Kc (sem palhada), sugestões e fonte. */
function catalogoCulturas_() {
  return Object.keys(Motor.CULTURAS).map(function (k) {
    var c = Motor.CULTURAS[k];
    return {
      chave: k, nome: c.nome, cicloDias: c.cicloDias, emergenciaDias: c.emergenciaDias || 0,
      estadios: c.estadios.map(function (e) { return { nome: e.nome, ateFracao: e.ateFracao }; }),
      curvaKc: Motor.curvaKc(c, false), sugestao: c.sugestao || null, fonte: c.fonte || "",
    };
  });
}

/* --------------------------------- lançamentos --------------------------------- */

/** Garante as colunas "Por" e "ID" (achadas pelo cabeçalho) e devolve os índices (1-based). */
function garantirColunaId_(nome) {
  var aba = SpreadsheetApp.getActive().getSheetByName(nome);
  var ultCol = Math.max(1, aba.getLastColumn());
  var cab = aba.getRange(1, 1, 1, ultCol).getValues()[0].map(String);
  ["Por", "ID"].forEach(function (h) {
    if (cab.indexOf(h) < 0) {
      cab.push(h);
      aba.getRange(1, cab.length).setValue(h);
    }
  });
  return { aba: aba, cab: cab, por: cab.indexOf("Por") + 1, id: cab.indexOf("ID") + 1 };
}

function novoId_() {
  return "P" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);
}

/** Linhas de um tipo com id; linhas lançadas à mão na planilha ganham id aqui. */
function linhasLancamento_(nome) {
  var g = garantirColunaId_(nome);
  var n = g.aba.getLastRow();
  if (n < 2) return { g: g, linhas: [] };
  var vals = g.aba.getRange(2, 1, n - 1, g.cab.length).getValues();
  var semId = false;
  vals.forEach(function (l) {
    if (String(l[0]) !== "" && String(l[1]).trim() !== "" && !String(l[g.id - 1]).trim()) {
      l[g.id - 1] = novoId_();
      semId = true;
    }
  });
  if (semId) g.aba.getRange(2, g.id, vals.length, 1).setValues(vals.map(function (l) { return [l[g.id - 1]]; }));
  return { g: g, linhas: vals };
}

function lancamentosApp_(limite) {
  var fuso = lerEstacao_().fuso;
  var ler = function (nome, tipo, nValores) {
    var r = linhasLancamento_(nome);
    return r.linhas.filter(function (l) { return String(l[0]) !== "" && String(l[1]).trim() !== ""; }).map(function (l) {
      var v = function (x) { return x === "" || x === null ? "" : x instanceof Date ? dataIso_(x, fuso) : x; };
      return {
        id: String(l[r.g.id - 1]), tipo: tipo, data: dataIso_(l[0], fuso), pivo: String(l[1]),
        valores: l.slice(2, 2 + nValores).map(v), por: String(l[r.g.por - 1] || ""),
      };
    });
  };
  var todos = ler(ABA.IRRIGACOES, "irrigacao", 2).concat(ler(ABA.UMIDADE, "umidade", 4));
  todos.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : a.id < b.id ? 1 : -1; });
  return todos.slice(0, limite || 30);
}

function numeroEntre_(v, nome, min, max) {
  var n = Motor.numero(v);
  if (n === null || n < min || n > max) throw new Error(nome + " deve ser um número entre " + min + " e " + max + ".");
  return n;
}

/**
 * Grava (ou regrava, pelo id) uma irrigação ou medição de umidade e recalcula.
 * Reenviar o mesmo id não duplica — é o que permite a fila sem internet no celular.
 */
function gravarLancamento_(d, u) {
  var id = String(d.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (!id) throw new Error("Lançamento sem id.");
  var tipo = d.tipo === "umidade" ? "umidade" : d.tipo === "irrigacao" ? "irrigacao" : null;
  if (!tipo) throw new Error("Tipo de lançamento desconhecido.");
  var alvo = String(d.pivo || "").trim().toLowerCase();
  var p = lerPivos_(lerEstacao_()).filter(function (x) { return x.nome.toLowerCase() === alvo; })[0];
  if (!p) throw new Error("Pivô \"" + d.pivo + "\" não está na aba PIVOS.");
  var data = dataIso_(d.data, lerEstacao_().fuso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Data inválida: " + d.data);
  if (data > hojeLocal_()) throw new Error("A data não pode ser no futuro.");
  var por = u ? u.nome : String(d.por || "");

  var valores;
  if (tipo === "irrigacao") {
    var mm = d.mm, obs = String(d.obs || "");
    if ((mm === "" || mm == null) && d.percentimetro !== "" && d.percentimetro != null) {
      // lançado pelo percentímetro: a lâmina líquida sai do equipamento cadastrado
      if (!p.equipamento) throw new Error("Para lançar pelo percentímetro, cadastre o equipamento do " + p.nome + ".");
      var pct = numeroEntre_(d.percentimetro, "O percentímetro", p.equipamento.percentimetroMinPct, 100);
      var lam = Motor.laminaDoPercentimetro(p.equipamento, pct);
      mm = Math.round(lam.liquidaMm * 10) / 10;
      obs = ("percentímetro " + Math.round(pct) + "% (" + (Math.round(lam.brutaMm * 10) / 10) + " mm brutos)" + (obs ? " · " + obs : "")).slice(0, 200);
    }
    valores = [numeroEntre_(mm, "A lâmina", 0.1, 100), T_(obs)];
  } else {
    var opc = function (v, nome, min, max) { return v === "" || v == null ? "" : numeroEntre_(v, nome, min, max); };
    valores = [numeroEntre_(d.umidadeRaiz, "A umidade na raiz", 0, 100), opc(d.umidadeProfunda, "A umidade profunda", 0, 100),
      opc(d.tensao, "A tensão", -1500, 0), T_(d.fonte)];
  }

  // um id só pode existir em um dos dois tipos: se mudou de tipo, sai do outro
  apagarPorId_(tipo === "irrigacao" ? ABA.UMIDADE : ABA.IRRIGACOES, id);
  var r = linhasLancamento_(tipo === "irrigacao" ? ABA.IRRIGACOES : ABA.UMIDADE);
  var linha = [data, p.nome].concat(valores);
  while (linha.length < r.g.cab.length) linha.push("");
  linha[r.g.por - 1] = T_(por);
  linha[r.g.id - 1] = id;
  var idx = -1;
  r.linhas.forEach(function (l, i) { if (String(l[r.g.id - 1]) === id) idx = i; });
  var nLinha = idx >= 0 ? idx + 2 : r.g.aba.getLastRow() + 1;
  r.g.aba.getRange(nLinha, 1, 1, linha.length).setValues([linha]);
  log_("app", idx >= 0 ? "regravado" : "lançado", tipo + " " + p.nome + " " + data + " por " + (por || "?"));
  var res = recalcularApp_();
  res.id = id;
  return res;
}

function apagarPorId_(nome, id) {
  var r = linhasLancamento_(nome);
  for (var i = r.linhas.length - 1; i >= 0; i--) {
    if (String(r.linhas[i][r.g.id - 1]) === id) {
      r.g.aba.deleteRows(i + 2, 1);
      return true;
    }
  }
  return false;
}

function apagarLancamento_(id, u) {
  id = String(id || "");
  var achou = apagarPorId_(ABA.IRRIGACOES, id) || apagarPorId_(ABA.UMIDADE, id);
  if (!achou) return { ok: true, jaApagado: true, hash: hashDados_() };   // apagar de novo não é erro
  log_("app", "apagado", id + " por " + (u ? u.nome : "?"));
  return recalcularApp_();
}

/** Texto do usuário nunca vira fórmula na planilha. */
function T_(v) {
  var s = String(v == null ? "" : v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ------------------------------------ pivôs ------------------------------------ */

/** Cria ou atualiza um pivô (pelo nome original). Valida o cadastro inteiro antes de gravar. */
function salvarPivo_(dados, nomeOriginal) {
  garantirColunasPivos_();
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var nome = String(dados.nome || "").trim();
  if (!nome) throw new Error("Dê um nome ao pivô.");
  var nomes = aba.getLastRow() >= 2 ? aba.getRange(2, 1, aba.getLastRow() - 1, 1).getValues().map(function (l) { return String(l[0]).trim().toLowerCase(); }) : [];
  var idxOriginal = nomeOriginal ? nomes.indexOf(String(nomeOriginal).trim().toLowerCase()) : -1;
  var idxNome = nomes.indexOf(nome.toLowerCase());
  if (idxNome >= 0 && idxNome !== idxOriginal) throw new Error("Já existe um pivô chamado " + nome + ".");
  var linha = idxOriginal >= 0 ? idxOriginal + 2 : aba.getLastRow() + 1;
  var antiga = linha <= aba.getLastRow() ? aba.getRange(linha, 1, 1, cab.length).getValues()[0] : cab.map(function () { return ""; });
  var nova = cab.map(function (h, i) {
    var c = COLUNAS_PIVOS.filter(function (x) { return x[1] === h; })[0];
    if (!c || !(c[0] in dados)) return antiga[i];
    var v = dados[c[0]];
    if (c[0] === "ativo" || c[0] === "palhada") return v === true || String(v).toUpperCase() === "SIM" ? "SIM" : "NÃO";
    if (c[0] === "nome" || c[0] === "cultura" || c[0] === "plantio" || c[0] === "inicioBalanco") return T_(String(v == null ? "" : v).trim());
    if (c[0] === "contorno") return T_(contornoLido_(typeof v === "string" ? v : JSON.stringify(v)) ? (typeof v === "string" ? v : JSON.stringify(v)) : "");
    var n = Motor.numero(v);
    return n === null ? "" : n;
  });
  // datas como texto AAAA-MM-DD (formatar antes de escrever, senão o Sheets converte)
  [cab.indexOf("Plantio") + 1, cab.indexOf("Início do balanço") + 1].forEach(function (c) {
    if (c > 0) aba.getRange(linha, c).setNumberFormat("@");
  });
  aba.getRange(linha, 1, 1, cab.length).setValues([nova]);
  try {
    cadastroValidado_();
  } catch (e) {
    aba.getRange(linha, 1, 1, cab.length).setValues([antiga]);
    if (idxOriginal < 0) aba.deleteRows(linha, 1);
    throw e;
  }
  log_("app", "pivô salvo", nome);
  return cadastroPivos_();
}

/* ------------------------------ login (PIN) e usuários ------------------------------ */

function abaUsuarios_() {
  var ss = SpreadsheetApp.getActive();
  var aba = ss.getSheetByName(ABA.USUARIOS) || ss.insertSheet(ABA.USUARIOS);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, COLS_USUARIOS.length).setValues([COLS_USUARIOS]).setFontWeight("bold");
    aba.setFrozenRows(1);
  }
  return aba;
}

function abaConfigApp_() {
  var ss = SpreadsheetApp.getActive();
  var aba = ss.getSheetByName(ABA.CONFIG_APP) || ss.insertSheet(ABA.CONFIG_APP);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 2, 3).setValues([
      ["CONFIG", "VALOR", "OBSERVAÇÃO"],
      ["EXIGIR LOGIN", "SIM", "SIM = o app só mostra e grava com login e PIN (aba USUÁRIOS APP)."],
    ]);
    aba.getRange(1, 1, 1, 3).setFontWeight("bold");
  }
  return aba;
}

function loginExigido_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.CONFIG_APP);
  if (!aba || aba.getLastRow() < 2) return true;
  var vals = aba.getRange(2, 1, aba.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim().toUpperCase() === "EXIGIR LOGIN") return String(vals[i][1]).trim().toUpperCase() !== "NÃO";
  return true;
}

function segredo_(nome) {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty(nome);
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty(nome, s);
  }
  return s;
}

function hashPin_(login, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, segredo_("SAL_PIN") + ":" + login + ":" + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function assinar_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, segredo_("SEGREDO_SESSAO")));
}

function cab_(aba) {
  return aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toUpperCase(); });
}

/** Usuários como objetos, com a linha (para regravar). */
function usuarios_() {
  var aba = abaUsuarios_();
  var cab = cab_(aba);
  var c = function (h) { return cab.indexOf(h); };
  if (aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, cab.length).getValues().map(function (l, i) {
    return {
      linha: i + 2, nome: String(l[c("NOME")]).trim(), login: String(l[c("LOGIN")]).trim().toLowerCase(),
      perfil: String(l[c("PERFIL")]).trim().toUpperCase() === "ADMIN" ? "ADMIN" : "OPERADOR",
      pinNovo: String(l[c("PIN NOVO")]).trim(), pin: String(l[c("PIN")]).trim(),
      ativo: String(l[c("ATIVO")]).trim().toUpperCase() !== "NÃO", versao: Number(l[c("VERSÃO")]) || 1,
    };
  }).filter(function (x) { return x.login; });
}

function gravarCampoUsuario_(linha, campos) {
  var aba = abaUsuarios_();
  var cab = cab_(aba);
  Object.keys(campos).forEach(function (h) {
    var col = cab.indexOf(h);
    if (col >= 0) aba.getRange(linha, col + 1).setValue(campos[h]);
  });
}

function usuarioPublico_(u) {
  return { nome: u.nome, login: u.login, perfil: u.perfil };
}

function pinValido_(pin) {
  return /^\d{4,6}$/.test(String(pin || ""));
}

function loginFaz_(d) {
  var login = String(d.login || "").trim().toLowerCase();
  var pin = String(d.pin || "").trim();
  var props = PropertiesService.getScriptProperties();
  var chave = "TENTATIVAS_" + login;
  var t = JSON.parse(props.getProperty(chave) || '{"n":0,"ate":0}');
  if (t.ate > Date.now()) return { ok: false, erro: "Muitas tentativas. Espere " + Math.ceil((t.ate - Date.now()) / 60000) + " min." };
  var u = usuarios_().filter(function (x) { return x.login === login; })[0];
  var certo = false;
  if (u && u.ativo) {
    if (u.pinNovo && pin === u.pinNovo && pinValido_(pin)) {
      gravarCampoUsuario_(u.linha, { "PIN": hashPin_(login, pin), "PIN NOVO": "" });   // o PIN some da planilha
      certo = true;
    } else if (u.pin && hashPin_(login, pin) === u.pin) {
      certo = true;
    }
  }
  if (!certo) {
    t.n += 1;
    if (t.n >= LOGIN_TENTATIVAS) t = { n: 0, ate: Date.now() + LOGIN_BLOQUEIO_MIN * 60000 };
    props.setProperty(chave, JSON.stringify(t));
    return { ok: false, erro: "Login ou PIN errado." };
  }
  props.deleteProperty(chave);
  gravarCampoUsuario_(u.linha, { "ÚLTIMO ACESSO": Motor.paraLocal(Date.now(), lerEstacao_().fuso).replace("T", " ") });
  return { ok: true, token: criarSessao_(u), usuario: usuarioPublico_(u), exigido: loginExigido_() };
}

function criarSessao_(u) {
  var corpo = [u.login, u.versao, Date.now() + SESSAO_DIAS * 86400000].join("|");
  return Utilities.base64EncodeWebSafe(corpo) + "." + assinar_(corpo);
}

/** null = sem sessão; {erro} = sessão inválida/vencida; senão o usuário. */
function usuarioDaSessao_(token) {
  if (!token) return null;
  var partes = String(token).split(".");
  if (partes.length !== 2) return { erro: "Sessão inválida. Entre de novo." };
  var corpo;
  try {
    corpo = Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString();
  } catch (e) {
    return { erro: "Sessão inválida. Entre de novo." };
  }
  if (assinar_(corpo) !== partes[1]) return { erro: "Sessão inválida. Entre de novo." };
  var c = corpo.split("|");
  if (Number(c[2]) < Date.now()) return { erro: "Sessão vencida. Entre de novo." };
  var u = usuarios_().filter(function (x) { return x.login === c[0]; })[0];
  if (!u || !u.ativo || String(u.versao) !== c[1]) return { erro: "Seu acesso mudou. Entre de novo." };
  return u;
}

function exigirAdmin_(u) {
  if (!u || u.perfil !== "ADMIN") {
    if (!u && !loginExigido_()) return;   // sem login exigido, quem não entrou age como antes
    throw new Error("Só o administrador pode fazer isso.");
  }
}

function listarUsuarios_() {
  return usuarios_().map(function (x) {
    return { nome: x.nome, login: x.login, perfil: x.perfil, ativo: x.ativo, temPin: !!(x.pin || x.pinNovo) };
  });
}

/** {salvar:{nome, login, perfil, ativo, pin?}} ou {excluir: login}. Sempre sobra 1 admin ativo. */
function gravarUsuario_(d) {
  var lista = usuarios_();
  if (d.excluir) {
    var alvo = String(d.excluir).toLowerCase();
    var x = lista.filter(function (y) { return y.login === alvo; })[0];
    if (!x) return { ok: true, usuarios: listarUsuarios_() };
    var admins = lista.filter(function (y) { return y.perfil === "ADMIN" && y.ativo && y.login !== alvo; });
    if (x.perfil === "ADMIN" && !admins.length) throw new Error("Precisa sobrar pelo menos um administrador ativo.");
    abaUsuarios_().deleteRows(x.linha, 1);
    return { ok: true, usuarios: listarUsuarios_() };
  }
  var s = d.salvar || {};
  var login = String(s.login || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!/^[a-z0-9._-]{2,30}$/.test(login)) throw new Error("Login: de 2 a 30 letras, números, ponto ou traço.");
  if (!String(s.nome || "").trim()) throw new Error("Informe o nome.");
  if (s.pin && !pinValido_(s.pin)) throw new Error("O PIN tem de ter de 4 a 6 números.");
  var perfil = String(s.perfil).toUpperCase() === "ADMIN" ? "ADMIN" : "OPERADOR";
  var ativo = s.ativo === false || String(s.ativo).toUpperCase() === "NÃO" ? "NÃO" : "SIM";
  var atual = lista.filter(function (y) { return y.login === login; })[0];
  if (atual && (perfil !== "ADMIN" || ativo === "NÃO") && atual.perfil === "ADMIN") {
    var outros = lista.filter(function (y) { return y.perfil === "ADMIN" && y.ativo && y.login !== login; });
    if (!outros.length) throw new Error("Precisa sobrar pelo menos um administrador ativo.");
  }
  var aba = abaUsuarios_();
  var linha = atual ? atual.linha : aba.getLastRow() + 1;
  var versao = atual ? atual.versao + (s.pin || ativo === "NÃO" || perfil !== atual.perfil ? 1 : 0) : 1;
  var campos = { "NOME": T_(String(s.nome).trim()), "LOGIN": login, "PERFIL": perfil, "ATIVO": ativo, "VERSÃO": versao };
  if (s.pin) {
    campos["PIN"] = hashPin_(login, String(s.pin));
    campos["PIN NOVO"] = "";
  }
  if (!atual) aba.getRange(linha, 1).setValue(login);   // reserva a linha
  gravarCampoUsuario_(linha, campos);
  return { ok: true, usuarios: listarUsuarios_() };
}

function trocarPin_(u, atual, novo) {
  if (!u) throw new Error("Entre primeiro.");
  if (hashPin_(u.login, String(atual || "")) !== u.pin) throw new Error("PIN atual errado.");
  if (!pinValido_(novo)) throw new Error("O PIN novo tem de ter de 4 a 6 números.");
  var versao = u.versao + 1;
  gravarCampoUsuario_(u.linha, { "PIN": hashPin_(u.login, String(novo)), "VERSÃO": versao });
  u.versao = versao;
  return { ok: true, token: criarSessao_(u) };
}

/** Menu: cria (ou redefine) o administrador sem precisar mexer na aba USUÁRIOS APP. */
function menuCriarAdmin() {
  var ui = SpreadsheetApp.getUi();
  var pergunta = function (t) {
    var r = ui.prompt("Administrador do app", t, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error("Cancelado.");
    return r.getResponseText().trim();
  };
  var nome = pergunta("Nome (ex.: Fabiana)");
  var login = pergunta("Login (sem espaços, ex.: fabiana)");
  var pin = pergunta("PIN de 4 a 6 números");
  gravarUsuario_({ salvar: { nome: nome, login: login, perfil: "ADMIN", ativo: "SIM", pin: pin } });
  aviso_("Administrador " + login + " criado. Entre no app com esse login e PIN.");
}

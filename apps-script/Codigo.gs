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
};

var PASTA_BACKUP = "BACKUP";
var PASTA_RELATORIOS = "RELATORIOS";
var BACKUPS_MANTIDOS = 30;
var LIMITE_EXECUCAO_MS = 4.5 * 60 * 1000; // o Apps Script corta em 6 min

/** Campos da aba ESTACAO, na ordem das linhas. */
var CAMPOS_ESTACAO = [
  ["latitude", "Latitude (graus, negativo no sul)", -14.74, "Confirmar a posição real da estação."],
  ["altitude", "Altitude (m)", 900, "Confirmar."],
  ["alturaAnemometro", "Altura do anemômetro (m)", 2, "Confirmar. Se não for 2 m, o vento é corrigido."],
  ["fuso", "Fuso horário", "America/Sao_Paulo", "Mato Grosso: America/Cuiaba."],
  ["grupoChuva", "Pluviômetro", "rainfall", "rainfall (báscula) ou rainfall_piezo (WS90)."],
  ["emails", "E-mails do relatório (separe por vírgula)", "", "Quem recebe o relatório das 18h."],
];

var COLUNAS_PIVOS = [
  ["nome", "Pivô"],
  ["ativo", "Ativo (SIM/NÃO)"],
  ["cultura", "Cultura"],
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
];

/** Valores de EXEMPLO (CONTEXT.md seção 6) — não são medições da fazenda. */
var PIVO_EXEMPLO = ["Pivô 2", "SIM", "soja", "2025-11-25", "2026-01-20", "SIM", 30, 32, 18, 10, 50, 55, "", 5, -70,
  400, 360, 200, 3, 10, 85, 55, 0.5];

var CABECALHOS = {
  IRRIGACOES: ["Data", "Pivô", "Lâmina líquida aplicada (mm)", "Obs."],
  UMIDADE: ["Data", "Pivô", "Umidade na raiz (%)", "Umidade camada profunda (%)", "Tensão (kPa)", "Fonte"],
  LEITURAS: ["Quando (hora local)", "Chuva acum. dia (mm)", "Temp (°C)", "UR (%)", "Radiação (W/m²)", "Vento (m/s)", "Intervalo (min)", "Fonte"],
  CLIMA: ["Data", "Tmax", "Tmin", "Tmed", "UR", "Vento", "Radiação (MJ/m²)", "Chuva (mm)", "Leituras (eq. 10 min)", "Estimado", "ET0 PM (mm)", "ET0 Hargreaves (mm)"],
  BALANCO: ["Pivô", "Data", "DAS", "Estádio", "Kc", "ET0", "ETc", "Chuva", "Irrigação", "Raiz (cm)", "CAD (mm)", "f", "AFD (mm)", "Déficit (mm)", "Medição", "Decisão", "Alertas"],
  LOG: ["Quando", "Ação", "Status", "Detalhe", "Dia do relatório"],
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
    .addToUi();
}

/** Cria as abas que faltam, as pastas no Drive e os gatilhos. Pode rodar de novo sem perder dados. */
function instalar() {
  var ss = SpreadsheetApp.getActive();
  criarAbaSeFaltar_(ss, ABA.PAINEL, null);

  var est = criarAbaSeFaltar_(ss, ABA.ESTACAO, ["Campo", "Valor", "Observação"]);
  if (est.getLastRow() < 2) {
    est.getRange(2, 1, CAMPOS_ESTACAO.length, 3).setValues(CAMPOS_ESTACAO.map(function (c) { return [c[1], c[2], c[3]]; }));
  }

  var piv = criarAbaSeFaltar_(ss, ABA.PIVOS, COLUNAS_PIVOS.map(function (c) { return c[1]; }));
  if (piv.getLastRow() < 2) {
    piv.getRange(2, 1, 1, PIVO_EXEMPLO.length).setValues([PIVO_EXEMPLO]);
    piv.getRange(2, 4, 1, 2).setNumberFormat("@");
  }

  criarAbaSeFaltar_(ss, ABA.IRRIGACOES, CABECALHOS.IRRIGACOES);
  criarAbaSeFaltar_(ss, ABA.UMIDADE, CABECALHOS.UMIDADE);
  criarAbaSeFaltar_(ss, ABA.BALANCO, CABECALHOS.BALANCO);
  criarAbaSeFaltar_(ss, ABA.CLIMA, CABECALHOS.CLIMA);
  var lei = criarAbaSeFaltar_(ss, ABA.LEITURAS, CABECALHOS.LEITURAS);
  lei.getRange("A:A").setNumberFormat("@"); // texto: não deixa o Sheets converter a hora
  criarAbaSeFaltar_(ss, ABA.LOG, CABECALHOS.LOG);

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
  var nossos = ["coletar", "recuperarRecentes", "relatorioDiario", "backupDiario", "continuarRecuperacao"];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (nossos.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("coletar").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("recuperarRecentes").timeBased().everyHours(1).create();
  // nearMinute(20): roda entre 18:05 e 18:35, depois que a janela do dia fecha às 18h.
  ScriptApp.newTrigger("relatorioDiario").timeBased().atHour(18).nearMinute(20).everyDays(1).inTimezone(fuso).create();
  ScriptApp.newTrigger("backupDiario").timeBased().atHour(4).everyDays(1).inTimezone(fuso).create();
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
  ["latitude", "altitude", "alturaAnemometro"].forEach(function (k) { cfg[k] = Motor.numero(cfg[k]); });
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

function lerPivos_(cfg) {
  var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
  if (!aba || aba.getLastRow() < 2) return [];
  var vals = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
  var col = {};
  COLUNAS_PIVOS.forEach(function (c) { col[c[0]] = vals[0].indexOf(c[1]); });
  var faltando = COLUNAS_PIVOS.filter(function (c) { return col[c[0]] < 0; }).map(function (c) { return c[1]; });
  if (faltando.length) throw new Error("Aba PIVOS sem as colunas: " + faltando.join(", "));
  var n = function (linha, k) { return Motor.numero(linha[col[k]]); };
  return vals.slice(1).filter(function (l) { return String(l[col.nome]).trim() !== ""; }).map(function (l) {
    var temEquip = n(l, "raioM") !== null && n(l, "vazaoM3h") !== null;
    return {
      nome: String(l[col.nome]).trim(),
      ativo: simNao_(l[col.ativo]),
      cultura: String(l[col.cultura]).trim().toLowerCase(),
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
      equipamento: temEquip ? {
        raioM: n(l, "raioM"), anguloGraus: n(l, "anguloGraus"), vazaoM3h: n(l, "vazaoM3h"),
        velocidadeUltimaTorreMMin: n(l, "velocidadeUltimaTorreMMin"), percentimetroMinPct: n(l, "percentimetroMinPct"),
        eficienciaPct: n(l, "eficienciaPct"), potenciaKw: n(l, "potenciaKw"), tarifaRsKwh: n(l, "tarifaRsKwh"),
      } : undefined,
    };
  });
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
  return SpreadsheetApp.getActive().getSheetByName(ABA.LEITURAS);
}

function linhaParaLeitura_(l) {
  return {
    quando: String(l[0]),
    chuvaAcumDia: Motor.numero(l[1]),
    tempC: Motor.numero(l[2]),
    urPct: Motor.numero(l[3]),
    radWm2: Motor.numero(l[4]),
    ventoMs: Motor.numero(l[5]),
    intervaloMin: Motor.numero(l[6]) === null ? undefined : Motor.numero(l[6]),
    fonte: l[7] === "" ? undefined : String(l[7]),
  };
}

function leituraParaLinha_(x) {
  var v = function (n) { return n === null || n === undefined ? "" : n; };
  return [x.quando, v(x.chuvaAcumDia), v(x.tempC), v(x.urPct), v(x.radWm2), v(x.ventoMs), v(x.intervaloMin), v(x.fonte)];
}

/** Leituras com ini <= quando <= fim. */
function lerLeituras_(ini, fim) {
  var aba = abaLeituras_();
  if (aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 8).getValues()
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
  aba.getRange(ultima + 1, 1, novas.length, 8).setValues(novas.map(leituraParaLinha_));
  if (novas[0].quando < maiorExistente) aba.getRange(2, 1, ultima - 1 + novas.length, 8).sort({ column: 1, ascending: true });
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
  pivos.forEach(function (p) { p.cultura = Motor.CULTURAS[p.cultura]; });

  var inicio = function (p) { return p.inicioBalanco || p.plantio; };
  var iniGeral = pivos.map(inicio).filter(function (d) { return d <= dia; }).sort()[0] || dia;
  var leituras = lerLeituras_(Motor.diaAnterior(iniGeral) + "T" + Motor.HORA_FECHAMENTO, dia + "T" + Motor.HORA_FECHAMENTO);
  var clima = Motor.climaCompleto(leituras, iniGeral, dia);
  if (!clima.length) throw new Error("Nenhuma leitura da estação entre " + iniGeral + " e " + dia + ".");

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
  var et0Dia = Motor.et0PenmanMonteith(climaDia, estacao);
  var msg = Motor.montarMensagem(dia, Object.assign({}, climaDia, { et0: et0Dia }), itens);
  escreverPainel_(dia, climaDia, et0Dia, itens, msg);
  return { dia: dia, cfg: cfg, assunto: msg.assunto, texto: msg.texto, itens: itens };
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

/************************************************************************
 * APP NO CELULAR — servidor das telas (App.html).
 *
 * Publicar: Implantar → Nova implantação → App da Web →
 *   Executar como: Eu · Quem pode acessar: Somente eu.
 * O link aparece em 💧 Manejo → 📱 Link do app.
 *
 * As funções api* são chamadas pela tela (google.script.run). Elas usam as
 * mesmas abas e o mesmo cálculo da planilha.
 ************************************************************************/

function doGet() {
  return HtmlService.createHtmlOutputFromFile("App")
    .setTitle("Manejo de Irrigação")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .addMetaTag("mobile-web-app-capable", "yes")
    .addMetaTag("apple-mobile-web-app-capable", "yes");
}

/** Erro amigável para a tela, sem pilha técnica. */
function erroApp_(e) {
  throw new Error(e && e.message ? e.message : String(e));
}

function hojeLocal_() {
  return Motor.paraLocal(Date.now(), lerEstacao_().fuso).slice(0, 10);
}

/* ================================ HOJE ================================ */

/** Resumo do último cálculo. Com `recalcular`, refaz o cálculo antes (leva alguns segundos). */
function apiHoje(recalcular) {
  try {
    var resumo = recalcular ? null : lerResumo_();
    if (!resumo) {
      calcular_(null);
      resumo = lerResumo_();
    }
    resumo.hoje = hojeLocal_();
    var ult = ultimaLeitura_();
    resumo.ultimaLeitura = ult;
    return resumo;
  } catch (e) {
    erroApp_(e);
  }
}

function ultimaLeitura_() {
  var aba = abaLeituras_();
  if (!aba || aba.getLastRow() < 2) return null;
  var l = linhaParaLeitura_(aba.getRange(aba.getLastRow(), 1, 1, 8).getValues()[0]);
  return { quando: l.quando, tempC: l.tempC, urPct: l.urPct };
}

/* ============================== LANÇAMENTOS ============================== */

function pivoExiste_(nome) {
  var alvo = String(nome || "").trim().toLowerCase();
  var p = lerPivos_(lerEstacao_()).filter(function (x) { return x.nome.toLowerCase() === alvo; })[0];
  if (!p) throw new Error("Pivô \"" + nome + "\" não está na aba PIVOS.");
  return p;
}

function dataValida_(d) {
  var iso = dataIso_(d, lerEstacao_().fuso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Data inválida: " + d);
  if (iso > hojeLocal_()) throw new Error("A data não pode ser no futuro.");
  return iso;
}

function numeroEntre_(v, nome, min, max) {
  var n = Motor.numero(v);
  if (n === null || n < min || n > max) throw new Error(nome + " deve ser um número entre " + min + " e " + max + ".");
  return n;
}

/**
 * Lança uma irrigação ({pivo, data, mm, obs}) ou uma medição de umidade
 * ({pivo, data, umidadeRaiz, umidadeProfunda, tensao, fonte}) e recalcula.
 */
function apiLancar(tipo, d) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) erroApp_(new Error("A planilha está ocupada. Tente de novo em um minuto."));
  try {
    var p = pivoExiste_(d.pivo);
    var data = dataValida_(d.data);
    if (tipo === "irrigacao") {
      var mm = numeroEntre_(d.mm, "A lâmina", 0.1, 100);
      SpreadsheetApp.getActive().getSheetByName(ABA.IRRIGACOES).appendRow([data, p.nome, mm, String(d.obs || "")]);
    } else if (tipo === "umidade") {
      var raiz = numeroEntre_(d.umidadeRaiz, "A umidade na raiz", 0, 100);
      var prof = d.umidadeProfunda === "" || d.umidadeProfunda == null ? "" : numeroEntre_(d.umidadeProfunda, "A umidade profunda", 0, 100);
      var tensao = d.tensao === "" || d.tensao == null ? "" : numeroEntre_(d.tensao, "A tensão", -1500, 0);
      SpreadsheetApp.getActive().getSheetByName(ABA.UMIDADE).appendRow([data, p.nome, raiz, prof, tensao, String(d.fonte || "")]);
    } else {
      throw new Error("Tipo de lançamento desconhecido: " + tipo);
    }
    log_("app", "lançado", tipo + " " + p.nome + " " + data);
    var resumo = null;
    var aviso = "";
    try {
      calcular_(null);
      resumo = lerResumo_();
    } catch (e) {
      aviso = "Lançado, mas o recálculo falhou: " + e.message;
    }
    return { ok: true, resumo: resumo, aviso: aviso };
  } catch (e) {
    erroApp_(e);
  } finally {
    lock.releaseLock();
  }
}

/** Últimos lançamentos (mais novos primeiro), com o número da linha para poder apagar. */
function apiLancamentos(limite) {
  try {
    var fuso = lerEstacao_().fuso;
    var ler = function (nome, tipo) {
      var aba = SpreadsheetApp.getActive().getSheetByName(nome);
      if (!aba || aba.getLastRow() < 2) return [];
      return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues().map(function (l, i) {
        var v = function (x) { return x === "" || x === null ? "" : x instanceof Date ? dataIso_(x, fuso) : x; };
        return { tipo: tipo, linha: i + 2, data: dataIso_(l[0], fuso), pivo: String(l[1]), valores: l.slice(2).map(v) };
      }).filter(function (x) { return x.pivo !== ""; });
    };
    var todos = ler(ABA.IRRIGACOES, "irrigacao").concat(ler(ABA.UMIDADE, "umidade"));
    todos.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : b.linha - a.linha; });
    return todos.slice(0, limite || 20);
  } catch (e) {
    erroApp_(e);
  }
}

/** Apaga um lançamento, conferindo que a linha ainda é a mesma (data e pivô) para não apagar outra. */
function apiApagarLancamento(tipo, linha, data, pivo) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) erroApp_(new Error("A planilha está ocupada. Tente de novo em um minuto."));
  try {
    var aba = SpreadsheetApp.getActive().getSheetByName(tipo === "irrigacao" ? ABA.IRRIGACOES : ABA.UMIDADE);
    if (linha < 2 || linha > aba.getLastRow()) throw new Error("Lançamento não encontrado. Atualize a tela.");
    var l = aba.getRange(linha, 1, 1, 2).getValues()[0];
    if (dataIso_(l[0], lerEstacao_().fuso) !== data || String(l[1]) !== pivo) throw new Error("A planilha mudou. Atualize a tela e tente de novo.");
    aba.deleteRows(linha, 1);
    log_("app", "apagado", tipo + " " + pivo + " " + data);
    try {
      calcular_(null);
    } catch (e) {
      // sem leituras ainda: o lançamento foi apagado mesmo assim
    }
    return { ok: true };
  } catch (e) {
    erroApp_(e);
  } finally {
    lock.releaseLock();
  }
}

/* =============================== HISTÓRICO =============================== */

/** Série diária de um pivô nos últimos `dias` do balanço. */
function apiHistorico(nome, dias) {
  try {
    var alvo = String(nome).toLowerCase();
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
    return { pivo: nome, laminaMinimaMm: p ? p.laminaMinimaMm : null, linhas: linhas.slice(-(dias || 30)) };
  } catch (e) {
    erroApp_(e);
  }
}

/* ================================ PIVÔS ================================ */

/** Cadastro na forma de formulário: colunas (chave, rótulo) e uma linha por pivô. */
function apiPivos() {
  try {
    var aba = SpreadsheetApp.getActive().getSheetByName(ABA.PIVOS);
    var fuso = lerEstacao_().fuso;
    var pivos = [];
    if (aba && aba.getLastRow() >= 2) {
      var vals = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
      pivos = vals.slice(1).filter(function (l) { return String(l[0]).trim() !== ""; }).map(function (l) {
        var o = {};
        COLUNAS_PIVOS.forEach(function (c) {
          var x = l[vals[0].indexOf(c[1])];
          o[c[0]] = x instanceof Date ? dataIso_(x, fuso) : x === undefined ? "" : x;
        });
        return o;
      });
    }
    return { colunas: COLUNAS_PIVOS, pivos: pivos, culturas: Object.keys(Motor.CULTURAS) };
  } catch (e) {
    erroApp_(e);
  }
}

/** Cria ou atualiza um pivô (pelo nome original). Valida com o motor antes de gravar. */
function apiSalvarPivo(dados, nomeOriginal) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) erroApp_(new Error("A planilha está ocupada. Tente de novo em um minuto."));
  try {
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
      if (c[0] === "nome" || c[0] === "cultura" || c[0] === "plantio" || c[0] === "inicioBalanco") return String(v == null ? "" : v).trim();
      var n = Motor.numero(v);
      return n === null ? "" : n;
    });

    // Datas como texto AAAA-MM-DD (formatar antes de escrever, senão o Sheets converte).
    [cab.indexOf("Plantio") + 1, cab.indexOf("Início do balanço") + 1].forEach(function (c) {
      if (c > 0) aba.getRange(linha, c).setNumberFormat("@");
    });
    // Valida o cadastro inteiro com a linha nova antes de gravar.
    aba.getRange(linha, 1, 1, cab.length).setValues([nova]);
    try {
      cadastroValidado_();
    } catch (e) {
      aba.getRange(linha, 1, 1, cab.length).setValues([antiga]);
      if (idxOriginal < 0) aba.deleteRows(linha, 1);
      throw e;
    }
    log_("app", "pivô salvo", nome);
    return apiPivos();
  } catch (e) {
    erroApp_(e);
  } finally {
    lock.releaseLock();
  }
}

/* Manejo de Irrigação — app estático (sem backend), mesmo modelo do Planejamento.
   A planilha é a fonte da verdade: o app puxa dela (doGet) e envia lançamentos (doPost).
   O que precisa aparecer em outros aparelhos sobe para a planilha; aqui fica só cache e fila. */
'use strict';

const APP_VERSION = '2026.10.08-6';   // mostrado no rodapé; ajuda a confirmar se a atualização chegou
const SYNC_KEY = 'irrigacao_sync_url';     // endereço /exec do Apps Script (nunca no GitHub)
const SESS_KEY = 'irrigacao_sessao';       // {token, usuario}
const DADOS_KEY = 'irrigacao_dados';       // última leitura da planilha (abre rápido e sem internet)
const FILA_KEY = 'irrigacao_fila';         // lançamentos/exclusões esperando internet
const LOG_KEY = 'irrigacao_log';           // últimas conversas com a planilha
const HIST_KEY = 'irrigacao_hist_pref';    // pivô e período escolhidos no Histórico

/* ================= utilidades ================= */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ler(k, padrao) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? padrao : v; } catch (e) { return padrao; } }
function grava(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
/** Número brasileiro (1.234,5) sem depender do Intl. */
function br(x, casas) {
  if (x === null || x === undefined || x === '' || isNaN(x)) return '–';
  const p = Math.abs(Number(x)).toFixed(casas).split('.');
  const s = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (p[1] ? ',' + p[1] : '');
  return (Number(x) < 0 && Number(Number(x).toFixed(casas)) !== 0 ? '-' : '') + s;
}
/** "2,5" e "2.5" = 2,5; vazio = null. */
function numBR(v) { const t = String(v == null ? '' : v).trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return isFinite(n) ? n : NaN; }
const dataBr = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
const dataBrAno = (iso) => (iso ? dataBr(iso) + '/' + iso.slice(0, 4) : '');
function horas(h) { const t = Math.round(h * 60); return Math.floor(t / 60) + 'h' + String(t % 60).padStart(2, '0'); }
function hojeIso() {
  if (DADOS && DADOS.hoje) return DADOS.hoje;
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function novoId() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
let toastTimer;
function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, erro ? 6000 : 3000);
}

/* ================= sessão (login com PIN) ================= */
function sessao() { return ler(SESS_KEY, null); }
function sessToken() { const s = sessao(); return (s && s.token) || ''; }
function sessUsuario() { const s = sessao(); return (s && s.usuario) || null; }
function ehAdmin() { const u = sessUsuario(); return !!(u && u.perfil === 'ADMIN') || (!!DADOS && DADOS.exigido === false && !u); }

/* ================= conversa com a planilha ================= */
let DADOS = ler(DADOS_KEY, null);
let ocupado = false;
let estado = { st: '', msg: '' };
function syncUrl() { return ler(SYNC_KEY, '') || ''; }

function logAdd(ok, oque, det) {
  const l = ler(LOG_KEY, []);
  l.unshift({ t: new Date().toLocaleString('pt-BR'), ok, oque, det: String(det || '').slice(0, 300) });
  grava(LOG_KEY, l.slice(0, 80));
}

function setStatus(st, msg) {
  estado = { st, msg: msg || '' };
  const el = $('#sync-status'); if (!el) return;
  el.className = 'sync-status ' + st;
  const n = fila().length;
  el.querySelector('.sync-status-txt').textContent =
    st === 'busy' ? 'Sincronizando…' : st === 'err' ? (msg || 'Erro') : st === 'ok' ? (n ? n + ' na fila' : 'Sincronizado') : (syncUrl() ? 'Sem conexão' : 'Configurar');
  barraFila();
}

async function chamar(metodo, params, corpo) {
  const url = syncUrl();
  if (!url) throw new Error('Configure o endereço da planilha em ⚙️ Ajustes.');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    let r;
    if (metodo === 'GET') {
      const qs = new URLSearchParams(Object.assign({}, params, { s: sessToken(), t: Date.now() })).toString();
      r = await fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + qs, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
    } else {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ s: sessToken() }, corpo)), redirect: 'follow', signal: ctrl.signal });
    }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('A planilha respondeu algo inesperado. Confira o endereço em Ajustes.'); }
    if (j && j.login) { precisaEntrar(j.erro); }
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('A planilha demorou demais para responder.');
    if (navigator.onLine === false) throw new Error('Sem internet.');
    if (e instanceof TypeError) throw new Error('Não consegui falar com a planilha. No Apps Script, confira em Implantar → Gerenciar implantações: "Quem pode acessar" = Qualquer pessoa e Versão = Nova versão. Teste abrindo o endereço /exec?acao=hash no navegador.');
    throw e;
  } finally { clearTimeout(timer); }
}

function precisaEntrar(msg) {
  const atual = (location.hash || '').replace('#/', '');
  if (atual !== 'login') { grava(SESS_KEY, null); toast(msg || 'Entre com seu login e PIN.'); location.hash = '#/login'; }
}

/** Puxa tudo da planilha. Sem `forcar`, primeiro pergunta só o "hash" e só baixa se mudou. */
async function puxar(forcar) {
  if (!syncUrl() || ocupado) return false;
  ocupado = true; setStatus('busy');
  try {
    if (!forcar && DADOS && DADOS.hash) {
      const h = await chamar('GET', { acao: 'hash' });
      if (h && h.ok && h.hash === DADOS.hash) { ocupado = false; setStatus('ok'); return true; }
    }
    const d = await chamar('GET', { acao: 'dados' });
    if (!d || d.login) { ocupado = false; setStatus('err', 'Entrar'); return false; }
    if (!d.ok) throw new Error(d.erro || 'erro da planilha');
    DADOS = d; grava(DADOS_KEY, d);
    if (d.usuario) { const s = sessao(); if (s) { s.usuario = d.usuario; grava(SESS_KEY, s); } }
    logAdd(true, 'Puxar planilha', d.resumo ? 'dia ' + d.resumo.dia : (d.erroCalculo || 'sem cálculo'));
    ocupado = false; setStatus('ok');
    if (!editando()) route({ manterRolagem: true });
    return true;
  } catch (e) {
    ocupado = false; setStatus('err', navigator.onLine === false ? 'Sem internet' : 'Erro');
    logAdd(false, 'Puxar planilha', e.message);
    if (forcar) toast(e.message, true);
    return false;
  }
}

/* ================= fila (lançamentos feitos sem internet) ================= */
function fila() { return ler(FILA_KEY, []); }
function salvaFila(f) { grava(FILA_KEY, f); barraFila(); }
function barraFila() {
  const f = fila(), b = $('#fila-bar'); if (!b) return;
  const comErro = f.filter((x) => x.erro).length;
  b.hidden = !f.length;
  b.textContent = f.length ? (comErro ? `⚠️ ${comErro} lançamento(s) recusado(s) pela planilha — veja em Lançar.` : `⏳ ${f.length} lançamento(s) esperando internet para subir para a planilha.`) : '';
}

let enviando = false;
async function enviarFila() {
  if (enviando || !syncUrl() || !fila().some((x) => !x.erro)) return;
  enviando = true; let enviou = false, falhou = false;
  try {
    for (const item of fila()) {
      if (item.erro) continue;
      let r;
      try {
        r = await chamar('POST', null, item.op === 'apagar' ? { __apagar: { id: item.id } } : { __lancamento: item.d });
      } catch (e) { logAdd(false, 'Enviar ' + item.op, e.message); falhou = true; break; }   // sem internet: tenta depois
      if (r && r.ok) {
        salvaFila(fila().filter((x) => x.id !== item.id || x.op !== item.op)); enviou = true;
        logAdd(true, item.op === 'apagar' ? 'Apagar lançamento' : 'Lançar ' + item.d.tipo, item.op === 'apagar' ? item.id : item.d.pivo + ' ' + item.d.data);
        if (r.resumo && DADOS) { DADOS.resumo = r.resumo; DADOS.hash = ''; grava(DADOS_KEY, DADOS); }
        if (r.aviso) toast(r.aviso, true);
      } else if (r && (r.ocupado || r.login)) { break; }                      // ocupada ou sem login: tenta depois
      else {
        const f = fila(); const i = f.findIndex((x) => x.id === item.id && x.op === item.op);
        if (i >= 0) { f[i].erro = (r && r.erro) || 'recusado'; salvaFila(f); }
        logAdd(false, 'Lançar', (r && r.erro) || 'recusado');
        toast('A planilha recusou: ' + ((r && r.erro) || ''), true);
      }
    }
  } finally { enviando = false; }
  if (enviou) await puxar(true);
  else setStatus(falhou ? 'err' : estado.st, falhou ? (navigator.onLine === false ? 'Sem internet' : 'Sem conexão') : estado.msg);
}

/* ================= navegação ================= */
const V = {};
const TITULOS = { hoje: 'Hoje', lancar: 'Lançar', historico: 'Histórico', mapa: 'Mapa', pivos: 'Pivôs', sync: 'Ajustes', login: 'Entrar', conta: 'Minha conta', usuarios: 'Usuários' };
function editando() { const a = document.activeElement; return !!a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && !!a.value; }

function route(opts) {
  opts = opts || {};
  const [view, arg] = (location.hash || '#/hoje').replace('#/', '').split('/');
  let v = V[view] ? view : 'hoje';
  if (v !== 'login' && v !== 'sync' && syncUrl() && DADOS && DADOS.exigido !== false && !sessToken()) v = 'login';
  document.body.dataset.view = v;
  $('#page-title').textContent = TITULOS[v] || '';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === v || (v === 'usuarios' || v === 'conta') && a.dataset.view === 'sync'));
  const u = sessUsuario(); const chip = $('#user-chip');
  chip.hidden = !u; if (u) chip.textContent = '👤 ' + u.nome;
  const y = window.scrollY;
  $('#content').innerHTML = V[v](arg);
  if (V[v + '_depois']) V[v + '_depois'](arg);
  window.scrollTo(0, opts.manterRolagem ? y : 0);
  setStatus(estado.st || (syncUrl() ? '' : ''), estado.msg);
}
window.addEventListener('hashchange', () => route());

function semDados() {
  if (!syncUrl()) return '<div class="card vazio"><p>Para começar, cole o endereço da planilha em <b>⚙️ Ajustes</b>.</p><p class="muted">Na planilha: menu 💧 Manejo → 📱 Endereço para o app.</p><a class="btn btn-primary" style="margin-top:12px" href="#/sync">Abrir Ajustes</a></div>';
  return '<div class="card vazio">Carregando os dados da planilha…</div>';
}

/* ================= HOJE ================= */
const classeDec = (d) => (d === 'IRRIGAR' ? 'irrigar' : d === 'SEM DADOS' ? 'sem' : 'nao');

V.hoje = function () {
  if (!DADOS) return semDados();
  const r = DADOS.resumo;
  if (!r) return '<div class="card vazio">' + esc(DADOS.erroCalculo || 'A planilha ainda não calculou nenhum dia.') + '</div>';
  const c = r.clima, ult = DADOS.ultimaLeitura;
  let h = '<div class="card"><div class="row"><h2>Estação · janela até ' + esc(dataBr(r.dia)) + ' 18h</h2>' +
    '<button class="btn btn-outline btn-sm" data-act="recalcular">↻ Recalcular</button></div>' +
    '<div class="chips"><span class="chip">ET₀ <b>' + br(c.et0, 1) + '</b> mm</span><span class="chip">Chuva <b>' + br(c.chuva, 1) + '</b> mm</span>' +
    '<span class="chip">🌡 <b>' + br(c.tmin, 0) + '–' + br(c.tmax, 0) + '</b> °C</span><span class="chip">UR <b>' + br(c.ur, 0) + '</b>%</span>' +
    '<span class="chip">Leituras <b>' + esc(c.n) + '</b>/144</span></div>' +
    '<p class="muted" style="margin-top:8px">Calculado em ' + esc(dataBr(r.calculadoEm)) + ' às ' + esc((r.calculadoEm || '').slice(11, 16)) +
    (ult ? ' · última leitura ' + esc(dataBr(ult.quando)) + ' ' + esc(ult.quando.slice(11, 16)) + (ult.tempC != null ? ' (' + br(ult.tempC, 1) + ' °C)' : '') : '') + '</p>' +
    (c.estimados && c.estimados.length ? '<ul class="alertas"><li>Estação sem dado de ' + esc(c.estimados.join(', ')) + ' — usado o dia vizinho.</li></ul>' : '') + '</div>';
  h += cardPrevisao(r.dia);
  h += r.pivos.map((p) => {
    if (!p.decisao) return '<div class="card"><h2>' + esc(p.nome) + '</h2><p class="muted">' + esc(p.aviso || 'sem cálculo') + '</p></div>';
    const pct = p.afd > 0 ? Math.min(100, (p.deficit / p.afd) * 100) : 0;
    const marca = p.afd > 0 && p.laminaMinimaMm != null ? Math.min(100, (p.laminaMinimaMm / p.afd) * 100) : null;
    const rec = p.rec && p.decisao === 'IRRIGAR'
      ? '<div class="kpis"><div><small>Percentímetro</small><b>' + br(p.rec.percentimetroPct, 0) + '%</b></div><div><small>Volta</small><b>' + horas(p.rec.tempoVoltaH) +
        '</b></div><div><small>Lâmina bruta</small><b>' + br(p.rec.laminaBrutaMm, 1) + '</b><em>mm</em></div><div><small>Energia</small><b>R$ ' + br(p.rec.custoRs, 0) + '</b><em>' + br(p.rec.energiaKwh, 0) + ' kWh</em></div></div>'
      : (p.decisao === 'IRRIGAR' ? '<p class="muted" style="margin-top:8px">Cadastre o equipamento do pivô para ver percentímetro, tempo e custo.</p>' : '');
    const alertas = (p.alertas || []).filter((a) => a.indexOf('Só ') !== 0 && a.indexOf('Clima estimado') !== 0);
    const fim = p.fimCicloDas != null && p.das > p.fimCicloDas;
    return '<div class="card sem-' + semaforo(p) + '"><div class="row"><div><h2>' + esc(p.nome) + '</h2><div class="muted">' + esc(p.cultura) + ' · ' + esc(p.estadio) + ' · ' + esc(p.das) + ' DAS' +
      (p.emergenciaDias ? ' (' + esc(p.dae) + ' DAE)' : '') + ' · Kc ' + br(p.kc, 2) + (fim ? ' · <b style="color:var(--red)">ciclo encerrado</b>' : '') + '</div></div>' +
      '<span class="badge ' + classeDec(p.decisao) + '">' + (p.decisao === 'IRRIGAR' ? '🚿 ' : '') + esc(p.decisao) + '</span></div>' +
      '<div class="bar" title="Déficit em relação à AFD"><span style="width:' + pct.toFixed(1) + '%"></span>' + (marca != null ? '<i style="left:' + marca.toFixed(1) + '%"></i>' : '') + '</div>' +
      '<div class="row muted"><span>Déficit <b style="color:var(--ink)">' + br(p.deficit, 1) + ' mm</b></span><span>AFD ' + br(p.afd, 1) + ' mm · ETc ' + br(p.etc, 1) + ' mm</span></div>' +
      rec + (p.avisoChuva ? '<ul class="alertas"><li>🌧 ' + esc(p.avisoChuva) + '</li></ul>' : '') +
      (alertas.length ? '<ul class="alertas">' + alertas.map((a) => '<li>⚠️ ' + esc(a) + '</li>').join('') + '</ul>' : '') +
      (p.curvaKc ? '<details class="kc-det"><summary class="muted">Curva de Kc do ciclo</summary>' + graficoKc(p.curvaKc, p.das, p.emergenciaDias) + '</details>' : '') +
      (p.diasIncertos ? '<p class="muted" style="margin-top:8px">ℹ️ ' + esc(p.diasIncertos) + ' dia(s) do balanço com clima estimado ou incompleto.</p>' : '') + '</div>';
  }).join('');
  return h || '<div class="card vazio">Nenhum pivô ativo.</div>';
};

/** Semáforo do pivô: bom (verde), atencao (amarelo, déficit ≥ 70% da lâmina mínima), ruim (vermelho = IRRIGAR), sem (cinza). */
function semaforo(p) {
  if (!p || !p.decisao || p.decisao === 'SEM DADOS') return 'sem';
  if (p.decisao === 'IRRIGAR') return 'ruim';
  return p.laminaMinimaMm > 0 && p.deficit / p.laminaMinimaMm >= 0.7 ? 'atencao' : 'bom';
}
const SEM_COR = { bom: '#2e7d32', atencao: '#f0b429', ruim: '#c62828', sem: '#9e9e9e' };
const SEM_ROTULO = { bom: 'Bom', atencao: 'Atenção', ruim: 'Irrigar', sem: 'Sem dados' };

/** Cartão "Próximos dias" com a previsão (Open-Meteo = mm e %, INMET = texto). */
function cardPrevisao(dia) {
  const pv = DADOS.previsao; if (!pv || !pv.dias || !pv.dias.length) return '';
  const prox = pv.dias.filter((d) => d.data > (dia || '')).slice(0, 5);
  if (!prox.length) return '';
  const soma = prox.slice(0, 2).reduce((t, d) => t + (d.chuvaMm || 0), 0);
  return '<div class="card"><div class="row"><h2>🌧 Próximos dias</h2><span class="muted">' + br(soma, 1) + ' mm em 2 dias</span></div>' +
    '<div class="prev">' + prox.map((d) => '<div class="prev-dia' + ((d.chuvaMm || 0) >= 5 ? ' chuva' : '') + '"><small>' + esc(dataBr(d.data)) + '</small><b>' + (d.chuvaMm == null ? '?' : br(d.chuvaMm, 1)) + '<em> mm</em></b>' +
      '<span>' + (d.probPct == null ? '' : br(d.probPct, 0) + '%') + '</span>' + (d.tmin != null && d.tmax != null ? '<span>' + br(d.tmin, 0) + '–' + br(d.tmax, 0) + '°</span>' : '') + '</div>').join('') + '</div>' +
    (prox[0].resumo ? '<p class="muted" style="margin-top:8px">INMET amanhã — ' + esc(prox[0].resumo) + '</p>' : '') +
    '<p class="muted">Fonte: ' + esc((pv.fontes || []).join(' + ')) + ' · atualizado ' + esc(dataBr(pv.atualizadoEm)) + ' ' + esc((pv.atualizadoEm || '').slice(11, 16)) + '. A previsão não entra no balanço; só avisa.</p></div>';
}

/* ================= LANÇAR ================= */
let tipoLanc = 'irrigacao';
function nomesPivos() {
  const c = DADOS && DADOS.cadastro;
  return c ? c.pivos.filter((p) => /^(SIM|S|TRUE|1)$/i.test(String(p.ativo).trim()) || p.ativo === true).map((p) => p.nome) : [];
}
V.lancar = function () {
  if (!DADOS) return semDados();
  const ps = nomesPivos();
  const f = fila();
  const pend = f.filter((x) => x.op === 'lancar');
  const apagando = f.filter((x) => x.op === 'apagar').map((x) => x.id);
  const lista = pend.map((x) => Object.assign({ pend: true, erro: x.erro }, itemDeFila(x)))
    .concat((DADOS.lancamentos || []).filter((l) => !pend.some((p) => p.id === l.id) && apagando.indexOf(l.id) < 0));
  return '<div class="seg" role="tablist"><button type="button" data-act="tipo" data-tipo="irrigacao" class="' + (tipoLanc === 'irrigacao' ? 'on' : '') + '">🚿 Irrigação</button>' +
    '<button type="button" data-act="tipo" data-tipo="umidade" class="' + (tipoLanc === 'umidade' ? 'on' : '') + '">🌱 Umidade do solo</button></div>' +
    '<form class="card" id="f-lanc" autocomplete="off"><div class="grid2"><div><label for="l-pivo">Pivô</label><select id="l-pivo" required>' +
    ps.map((n) => '<option>' + esc(n) + '</option>').join('') + '</select></div><div><label for="l-data">Data</label><input id="l-data" type="date" required value="' + hojeIso() + '" max="' + hojeIso() + '"></div></div>' +
    (tipoLanc === 'irrigacao'
      ? '<div class="grid2"><div><label for="l-mm">Lâmina líquida aplicada (mm)</label><input id="l-mm" inputmode="decimal" placeholder="ex.: 12"></div><div><label for="l-obs">Observação</label><input id="l-obs" placeholder="ex.: percentímetro 40%"></div></div>'
      : '<div class="grid2"><div><label for="l-raiz">Umidade na raiz (%)</label><input id="l-raiz" inputmode="decimal" placeholder="ex.: 27"></div><div><label for="l-prof">Camada profunda (%)</label><input id="l-prof" inputmode="decimal" placeholder="opcional"></div>' +
        '<div><label for="l-tensao">Tensão (kPa)</label><input id="l-tensao" inputmode="decimal" placeholder="ex.: -45"></div><div><label for="l-fonte">Fonte</label><input id="l-fonte" placeholder="TDR, tensiômetro…"></div></div>') +
    '<button class="btn btn-primary btn-block" type="submit">Lançar</button>' +
    '<p class="muted" style="margin-top:8px">Sem internet? O lançamento fica guardado no celular e sobe sozinho quando o sinal voltar.</p></form>' +
    '<div class="card"><h2>Últimos lançamentos</h2><ul class="lista" style="margin-top:6px">' +
    (lista.length ? lista.map((l) => '<li><div class="t"><b>' + esc(dataBr(l.data)) + '</b> · ' + esc(l.pivo) +
      (l.pend ? ' <span class="badge ' + (l.erro ? 'erro' : 'pend') + '">' + (l.erro ? 'recusado' : 'na fila') + '</span>' : '') +
      '<div class="muted">' + textoLanc(l) + (l.por ? ' · ' + esc(l.por) : '') + (l.erro ? '<br><span style="color:var(--red)">' + esc(l.erro) + '</span>' : '') + '</div></div>' +
      '<button class="btn btn-danger btn-sm" type="button" data-act="apagar" data-id="' + esc(l.id) + '" data-pend="' + (l.pend ? 1 : 0) + '">Apagar</button></li>').join('')
      : '<li class="vazio">Nada lançado ainda.</li>') + '</ul></div>';
};
function itemDeFila(x) {
  const d = x.d;
  return { id: x.id, tipo: d.tipo, data: d.data, pivo: d.pivo, por: (sessUsuario() || {}).nome || '',
    valores: d.tipo === 'irrigacao' ? [numBR(d.mm), d.obs || ''] : [numBR(d.umidadeRaiz), numBR(d.umidadeProfunda) == null ? '' : numBR(d.umidadeProfunda), numBR(d.tensao) == null ? '' : numBR(d.tensao), d.fonte || ''] };
}
function textoLanc(l) {
  const v = l.valores || [];
  return l.tipo === 'irrigacao'
    ? '🚿 ' + br(v[0], 1) + ' mm' + (v[1] ? ' · ' + esc(v[1]) : '')
    : '🌱 ' + br(v[0], 1) + '%' + (v[1] !== '' && v[1] != null ? ' · prof. ' + br(v[1], 1) + '%' : '') + (v[2] !== '' && v[2] != null ? ' · ' + br(v[2], 0) + ' kPa' : '') + (v[3] ? ' · ' + esc(v[3]) : '');
}
V.lancar_depois = function () {
  const f = $('#f-lanc'); if (!f) return;
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = { id: novoId(), tipo: tipoLanc, pivo: $('#l-pivo').value, data: $('#l-data').value };
    if (!d.pivo) return toast('Cadastre um pivô ativo primeiro.', true);
    if (d.data > hojeIso()) return toast('A data não pode ser no futuro.', true);
    if (tipoLanc === 'irrigacao') {
      d.mm = $('#l-mm').value; d.obs = $('#l-obs').value;
      const n = numBR(d.mm); if (n == null || isNaN(n) || n <= 0 || n > 100) return toast('Informe a lâmina em mm (de 0,1 a 100).', true);
    } else {
      d.umidadeRaiz = $('#l-raiz').value; d.umidadeProfunda = $('#l-prof').value; d.tensao = $('#l-tensao').value; d.fonte = $('#l-fonte').value;
      const n = numBR(d.umidadeRaiz); if (n == null || isNaN(n) || n < 0 || n > 100) return toast('Informe a umidade na raiz em % (0 a 100).', true);
    }
    const fi = fila(); fi.push({ op: 'lancar', id: d.id, d }); salvaFila(fi);
    toast(navigator.onLine === false ? '📴 Guardado no celular. Sobe quando a internet voltar.' : '✅ Lançado. Enviando para a planilha…');
    route(); enviarFila();
  });
};

/* ================= HISTÓRICO ================= */
let HIST = null;
V.historico = function () {
  if (!DADOS) return semDados();
  const pref = ler(HIST_KEY, {}); const ps = (DADOS.cadastro ? DADOS.cadastro.pivos.map((p) => p.nome) : []);
  const piv = ps.indexOf(pref.pivo) >= 0 ? pref.pivo : ps[0];
  const dias = pref.dias || 30;
  return '<div class="card"><div class="grid2"><div><label for="h-pivo">Pivô</label><select id="h-pivo" data-act="hist">' + ps.map((n) => '<option' + (n === piv ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
    '<div><label for="h-dias">Período</label><select id="h-dias" data-act="hist">' + [15, 30, 60, 120].map((d) => '<option value="' + d + '"' + (d === dias ? ' selected' : '') + '>' + d + ' dias</option>').join('') + '</select></div></div></div>' +
    '<div class="card"><div id="grafico">' + (HIST && HIST.pivo === piv ? grafico(HIST) : '<div class="vazio">Carregando…</div>') + '</div>' +
    '<div class="legenda"><span class="l" style="--c:var(--deficit)">Déficit</span><span class="l" style="--c:var(--afd)">AFD (limite de estresse)</span><span class="l" style="--c:var(--muted)">Lâmina mínima</span><span style="--c:var(--chuva)">Chuva</span><span style="--c:var(--irrig)">Irrigação</span></div></div>' +
    '<div class="card" id="tab-hist">' + (HIST && HIST.pivo === piv ? tabelaHist(HIST) : '') + '</div>';
};
V.historico_depois = function () { carregarHist(); };
async function carregarHist() {
  const sel = $('#h-pivo'); if (!sel || !sel.value) return;
  const pref = { pivo: sel.value, dias: Number($('#h-dias').value) }; grava(HIST_KEY, pref);
  try {
    const r = await chamar('GET', { acao: 'historico', pivo: pref.pivo, dias: pref.dias });
    if (!r || !r.ok) throw new Error((r && r.erro) || 'sem resposta');
    HIST = r.historico;
    if ($('#grafico')) { $('#grafico').innerHTML = grafico(HIST); $('#tab-hist').innerHTML = tabelaHist(HIST); }
  } catch (e) { if ($('#grafico')) $('#grafico').innerHTML = '<div class="vazio">' + esc(e.message) + '</div>'; }
}
function grafico(h) {
  const ls = h.linhas; if (!ls.length) return '<div class="vazio">Sem dados para este pivô.</div>';
  const W = 640, H = 280, mE = 38, mD = 10, mT = 10, mB = 28, w = W - mE - mD, alt = H - mT - mB;
  let maxV = 5; ls.forEach((l) => { maxV = Math.max(maxV, l.deficit || 0, l.afd || 0, l.chuva || 0, l.irrigacao || 0); }); maxV = Math.ceil(maxV / 10) * 10;
  const x = (i) => mE + (ls.length === 1 ? w / 2 : (i * w) / (ls.length - 1));
  const y = (v) => mT + alt - (Math.min(v, maxV) / maxV) * alt;
  const bw = Math.max(2, Math.min(14, (w / ls.length) * 0.35));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Gráfico do balanço hídrico">';
  for (let g = 0; g <= 4; g++) { const v = (maxV * g) / 4, yy = y(v); s += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--line)"/><text x="' + (mE - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + br(v, 0) + '</text>'; }
  ls.forEach((l, i) => {
    if (l.chuva > 0) s += '<rect x="' + (x(i) - bw) + '" y="' + y(l.chuva) + '" width="' + bw + '" height="' + (mT + alt - y(l.chuva)) + '" fill="var(--chuva)" rx="1"><title>' + dataBr(l.data) + ': chuva ' + br(l.chuva, 1) + ' mm</title></rect>';
    if (l.irrigacao > 0) s += '<rect x="' + x(i) + '" y="' + y(l.irrigacao) + '" width="' + bw + '" height="' + (mT + alt - y(l.irrigacao)) + '" fill="var(--irrig)" rx="1"><title>' + dataBr(l.data) + ': irrigação ' + br(l.irrigacao, 1) + ' mm</title></rect>';
  });
  const linha = (campo) => ls.map((l, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(l[campo] || 0).toFixed(1)).join(' ');
  s += '<path d="' + linha('afd') + '" fill="none" stroke="var(--afd)" stroke-width="2" stroke-dasharray="6 4"/>';
  if (h.laminaMinimaMm != null) s += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + y(h.laminaMinimaMm) + '" y2="' + y(h.laminaMinimaMm) + '" stroke="var(--muted)" stroke-dasharray="2 4"/>';
  s += '<path d="' + linha('deficit') + '" fill="none" stroke="var(--deficit)" stroke-width="2.5" stroke-linejoin="round"/>';
  ls.forEach((l, i) => { s += '<circle cx="' + x(i) + '" cy="' + y(l.deficit || 0) + '" r="' + (l.medicao ? 4.5 : 2.5) + '" fill="' + (l.medicao ? '#fff' : 'var(--deficit)') + '" stroke="var(--deficit)" stroke-width="2"><title>' + dataBr(l.data) + ': déficit ' + br(l.deficit, 1) + ' mm · ' + esc(l.decisao) + '</title></circle>'; });
  const passo = Math.max(1, Math.ceil(ls.length / 7));
  ls.forEach((l, i) => {
    const ult = i === ls.length - 1;
    if ((i % passo === 0 && ls.length - 1 - i >= passo / 2) || ult) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : ult ? 'end' : 'middle') + '">' + dataBr(l.data) + '</text>';
  });
  return s + '</svg>';
}
function tabelaHist(h) {
  const ls = h.linhas.slice().reverse(); if (!ls.length) return '';
  return '<div class="tbl-wrap"><table><thead><tr><th>Dia</th><th>Déficit</th><th>ETc</th><th>Chuva</th><th>Irrig.</th><th>Decisão</th></tr></thead><tbody>' +
    ls.map((l) => '<tr><td>' + dataBr(l.data) + (l.medicao ? ' 🌱' : '') + '</td><td>' + br(l.deficit, 1) + '</td><td>' + br(l.etc, 1) + '</td><td>' + br(l.chuva, 1) + '</td><td>' + br(l.irrigacao, 1) +
      '</td><td><span class="badge ' + classeDec(l.decisao) + '">' + esc(l.decisao === 'NÃO IRRIGAR' ? 'NÃO' : l.decisao === 'SEM DADOS' ? 'S/ DADOS' : l.decisao) + '</span></td></tr>').join('') + '</tbody></table></div>';
}

/** Curva de Kc do plantio ao fim do ciclo, com marcador no dia de hoje (DAS). */
function graficoKc(curva, hojeDas, emergencia) {
  if (!curva || curva.length < 2) return '';
  const W = 640, H = 150, mE = 34, mD = 12, mT = 12, mB = 24, w = W - mE - mD, alt = H - mT - mB;
  const n = curva.length - 1, maxK = 1.5;
  const x = (d) => mE + (Math.min(d, n) / n) * w, y = (k) => mT + alt - (Math.min(k, maxK) / maxK) * alt;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Curva de Kc">';
  [0, 0.5, 1, 1.5].forEach((k) => { s += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + y(k) + '" y2="' + y(k) + '" stroke="var(--line)"/><text x="' + (mE - 6) + '" y="' + (y(k) + 4) + '" text-anchor="end">' + br(k, 1) + '</text>'; });
  s += '<path d="' + curva.map((k, d) => (d ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(k).toFixed(1)).join(' ') + '" fill="none" stroke="var(--irrig)" stroke-width="2.5" stroke-linejoin="round"/>';
  if (emergencia) s += '<line x1="' + x(emergencia) + '" x2="' + x(emergencia) + '" y1="' + mT + '" y2="' + (mT + alt) + '" stroke="var(--muted)" stroke-dasharray="2 4"><title>Emergência (' + emergencia + ' DAS)</title></line>';
  if (hojeDas != null && hojeDas >= 0) {
    const d = Math.min(hojeDas, n), k = curva[d];
    s += '<line x1="' + x(d) + '" x2="' + x(d) + '" y1="' + mT + '" y2="' + (mT + alt) + '" stroke="var(--deficit)" stroke-dasharray="4 3"/>' +
      '<circle cx="' + x(d) + '" cy="' + y(k) + '" r="5" fill="#fff" stroke="var(--deficit)" stroke-width="2.5"><title>Hoje: ' + hojeDas + ' DAS · Kc ' + br(k, 2) + '</title></circle>' +
      (hojeDas > n ? '<text x="' + (W - mD) + '" y="' + (mT + 12) + '" text-anchor="end" fill="var(--red)">ciclo encerrado há ' + (hojeDas - n) + ' d</text>' : '');
  }
  [0, Math.round(n / 2), n].forEach((d, i) => { s += '<text x="' + x(d) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + d + ' DAS</text>'; });
  return s + '</svg>';
}
/** Culturas do catálogo (a planilha manda objetos; versão antiga mandava só as chaves). */
function culturas() { return (DADOS && DADOS.cadastro && DADOS.cadastro.culturas || []).map((c) => (typeof c === 'string' ? { chave: c, nome: c } : c)); }
function cultura(chave) { const k = String(chave || '').toLowerCase().trim(); return culturas().find((c) => c.chave === k) || null; }
function nomeCultura(chave) { const c = cultura(chave); return c ? c.nome : String(chave || ''); }

/* ================= MAPA ================= */
let leafletP = null, mapaAtual = null;
function carregarLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    sc.onload = res; sc.onerror = () => { leafletP = null; rej(new Error('Não consegui baixar o mapa (sem internet?).')); };
    document.head.appendChild(sc);
  });
  return leafletP;
}
/** Pivôs com posição: junta o cadastro (lat/lon/contorno/raio) com o resumo do dia (decisão, déficit). */
function pivosNoMapa() {
  const cad = DADOS && DADOS.cadastro ? DADOS.cadastro.pivos : [];
  const res = DADOS && DADOS.resumo ? DADOS.resumo.pivos : [];
  return cad.map((c) => {
    const r = res.find((x) => x.nome === c.nome) || {};
    let contorno = null; try { contorno = typeof c.contorno === 'string' && c.contorno ? JSON.parse(c.contorno) : c.contorno; } catch (e) { contorno = null; }
    const lat = Number(String(c.latitude).replace(',', '.')), lon = Number(String(c.longitude).replace(',', '.'));
    return Object.assign({}, r, { nome: c.nome, ativo: simNao(c.ativo), cultura: nomeCultura(c.cultura), lat: isFinite(lat) && c.latitude !== '' ? lat : null, lon: isFinite(lon) && c.longitude !== '' ? lon : null,
      contorno: Array.isArray(contorno) && contorno.length >= 3 ? contorno : null, raioM: Number(c.raioM) || null, anguloGraus: Number(c.anguloGraus) || 360 });
  });
}
V.mapa = function () {
  if (mapaAtual) { try { mapaAtual.remove(); } catch (e) { /* já foi */ } mapaAtual = null; }
  if (!DADOS || !DADOS.cadastro) return semDados();
  const ps = pivosNoMapa(), com = ps.filter((p) => p.lat != null && p.lon != null), sem = ps.filter((p) => p.lat == null || p.lon == null);
  return '<div class="card" style="padding:0;overflow:hidden"><div id="mapa" class="mapa"><div class="loading" style="padding:30px;text-align:center">' + (com.length ? 'Carregando o mapa…' : 'Nenhum pivô com posição ainda.') + '</div></div></div>' +
    '<div class="card"><div class="legenda">' + Object.keys(SEM_COR).map((k) => '<span style="--c:' + SEM_COR[k] + '">' + SEM_ROTULO[k] + '</span>').join('') + '</div>' +
    '<ul class="lista" style="margin-top:8px">' + com.map((p) => '<li><div class="t"><b style="color:' + SEM_COR[semaforo(p)] + '">●</b> ' + esc(p.nome) + ' <span class="muted">' + esc(p.cultura) + (p.decisao ? ' · déficit ' + br(p.deficit, 1) + ' mm' : '') + '</span></div>' +
      (p.decisao ? '<span class="badge ' + classeDec(p.decisao) + '">' + esc(p.decisao) + '</span>' : '') + '</li>').join('') + '</ul>' +
    (sem.length ? '<p class="muted" style="margin-top:10px">Sem posição: ' + esc(sem.map((p) => p.nome).join(', ')) + '. ' + (ehAdmin() ? 'Em <a href="#/pivos">Pivôs</a>, importe o KMZ ou use "📍 Usar minha posição".' : 'O administrador cadastra pelo KMZ.') + '</p>' : '') + '</div>';
};
V.mapa_depois = function () {
  const com = pivosNoMapa().filter((p) => p.lat != null && p.lon != null); if (!com.length) return;
  carregarLeaflet().then(() => {
    const el = $('#mapa'); if (!el || el._leaflet_id) return; el.innerHTML = '';
    const mapa = L.map(el, { zoomControl: true, attributionControl: true }); mapaAtual = mapa;
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagens: Esri' }).addTo(mapa);
    const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    L.control.layers({ 'Satélite': sat, 'Mapa': ruas }, null, { position: 'topright' }).addTo(mapa);
    // o Leaflet só desenha depois de ter uma vista: calcula o enquadramento à mão e aplica antes das formas
    const pontos = [];
    com.forEach((p) => {
      if (p.contorno) p.contorno.forEach((q) => pontos.push(q));
      else { const d = (p.raioM || 300) / 111320; pontos.push([p.lat - d, p.lon - d], [p.lat + d, p.lon + d]); }
    });
    mapa.fitBounds(L.latLngBounds(pontos).pad(0.2));
    const grupo = L.featureGroup().addTo(mapa);
    com.forEach((p) => {
      const cor = SEM_COR[semaforo(p)], estilo = { color: cor, weight: 2, fillColor: cor, fillOpacity: 0.35 };
      const forma = p.contorno ? L.polygon(p.contorno, estilo) : L.circle([p.lat, p.lon], Object.assign({ radius: p.raioM || 300 }, estilo));
      forma.bindPopup('<b>' + esc(p.nome) + '</b><br>' + esc(p.cultura) + (p.decisao ? '<br><b>' + esc(p.decisao) + '</b> · déficit ' + br(p.deficit, 1) + ' mm · AFD ' + br(p.afd, 1) + ' mm' +
        (p.rec && p.decisao === 'IRRIGAR' ? '<br>Percentímetro ' + br(p.rec.percentimetroPct, 0) + '% · volta ' + horas(p.rec.tempoVoltaH) : '') : '<br>' + esc(p.aviso || 'sem cálculo')));
      forma.addTo(grupo);
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'rotulo-pivo', html: esc(p.nome), iconSize: null }), interactive: false }).addTo(grupo);
    });
  }).catch((e) => { const el = $('#mapa'); if (el) el.innerHTML = '<div class="vazio">' + esc(e.message) + '</div>'; });
};

/* ================= KMZ / KML ================= */
/** Lê um .kmz (zip) ou .kml e devolve os desenhos: [{nome, pontos:[[lat,lon]…], centro:[lat,lon], raioM}]. */
async function lerKml(arquivo) {
  const buf = new Uint8Array(await arquivo.arrayBuffer());
  const xml = buf[0] === 0x50 && buf[1] === 0x4b ? await kmlDoKmz(buf) : new TextDecoder().decode(buf);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo KML inválido.');
  const marcas = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
  const saida = [];
  marcas.forEach((pm, i) => {
    const nomeEl = pm.getElementsByTagNameNS('*', 'name')[0];
    const coords = Array.from(pm.getElementsByTagNameNS('*', 'coordinates')).map((c) => c.textContent).filter(Boolean);
    if (!coords.length) return;
    const pontos = coords[0].trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((v) => v.length >= 2 && isFinite(v[0]) && isFinite(v[1])).map((v) => [v[1], v[0]]);
    if (!pontos.length) return;
    saida.push(Object.assign({ nome: (nomeEl ? nomeEl.textContent : '').trim() || 'Desenho ' + (i + 1), pontos: simplificar(pontos, 72) }, geometria(pontos)));
  });
  if (!saida.length) throw new Error('Não achei nenhum desenho (Placemark) no arquivo.');
  return saida;
}
/** Só o arquivo .kml dentro do .kmz (zip): lê o diretório central e descompacta com a API nativa do navegador. */
async function kmlDoKmz(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), dec = new TextDecoder();
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('KMZ inválido.');
  const n = dv.getUint16(fim + 10, true); let off = dv.getUint32(fim + 16, true);
  for (let k = 0; k < n && dv.getUint32(off, true) === 0x02014b50; k++) {
    const metodo = dv.getUint16(off + 10, true), tam = dv.getUint32(off + 20, true), nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true);
    const nome = dec.decode(buf.subarray(off + 46, off + 46 + nl)); off += 46 + nl + el + cl;
    if (!/\.kml$/i.test(nome)) continue;
    const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), dados = buf.subarray(ini, ini + tam);
    if (metodo === 0) return dec.decode(dados);
    if (metodo !== 8) throw new Error('KMZ com compressão desconhecida.');
    if (!window.DecompressionStream) throw new Error('Este navegador não abre KMZ: exporte como KML.');
    return await new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  throw new Error('KMZ sem arquivo .kml dentro.');
}
function distM(a, b) { const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function geometria(pontos) {
  const centro = [pontos.reduce((t, p) => t + p[0], 0) / pontos.length, pontos.reduce((t, p) => t + p[1], 0) / pontos.length];
  const raioM = pontos.length >= 3 ? Math.round(pontos.reduce((t, p) => t + distM(centro, p), 0) / pontos.length) : null;
  return { centro: [Math.round(centro[0] * 1e6) / 1e6, Math.round(centro[1] * 1e6) / 1e6], raioM };
}
function simplificar(pontos, max) {
  if (pontos.length <= 3) return null;
  const passo = Math.max(1, Math.ceil(pontos.length / max));
  return pontos.filter((_, i) => i % passo === 0).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}
const chaveNome = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Casa o nome do desenho com um pivô: nome igual (sem acento/espaço) ou mesmo número ("Pivô 2" ↔ "P2" ↔ "pivo_02"). */
function pivoDoDesenho(nome, pivos) {
  const k = chaveNome(nome), num = (k.match(/\d+/) || [''])[0].replace(/^0+/, '');
  return pivos.find((p) => chaveNome(p.nome) === k) || (num ? pivos.find((p) => ((chaveNome(p.nome).match(/\d+/) || [''])[0].replace(/^0+/, '')) === num) : null) || null;
}

/* ================= PIVÔS ================= */
const GRUPOS = [
  ['Identificação', ['nome', 'ativo', 'cultura', 'cicloDias', 'plantio', 'inicioBalanco', 'palhada']],
  ['Solo e raiz', ['umidadeInicialPct', 'cc', 'pmp', 'raizIniCm', 'raizMaxCm', 'diasRaiz', 'fatorFixo']],
  ['Decisão', ['laminaMinimaMm', 'tensaoIrrigarKpa']],
  ['Localização (mapa)', ['latitude', 'longitude', 'contorno']],
  ['Equipamento', ['raioM', 'anguloGraus', 'vazaoM3h', 'velocidadeUltimaTorreMMin', 'percentimetroMinPct', 'eficienciaPct', 'potenciaKw', 'tarifaRsKwh']],
];
const simNao = (v) => v === true || /^(SIM|S|TRUE|1|X)$/i.test(String(v).trim());
V.pivos = function (arg) {
  if (!DADOS || !DADOS.cadastro) return semDados();
  const c = DADOS.cadastro;
  if (arg !== undefined) return formPivo(arg === 'novo' ? null : c.pivos[Number(arg)]);
  return c.pivos.map((p, i) => '<div class="card"><div class="row"><div><h2>' + esc(p.nome) + (simNao(p.ativo) ? '' : ' <span class="muted">(inativo)</span>') + '</h2>' +
    '<div class="muted">' + esc(nomeCultura(p.cultura)) + (p.cicloDias ? ' (' + esc(p.cicloDias) + ' dias)' : '') + ' · plantio ' + esc(dataBrAno(String(p.plantio))) + (p.raioM ? ' · raio ' + br(p.raioM, 0) + ' m' : ' · sem equipamento') + '</div></div>' +
    '<a class="btn btn-outline btn-sm" href="#/pivos/' + i + '">' + (ehAdmin() ? 'Editar' : 'Ver') + '</a></div></div>').join('') +
    (ehAdmin() ? '<a class="btn btn-outline btn-block" href="#/pivos/novo">+ Novo pivô</a>' +
      '<div class="card" style="margin-top:14px"><h2>📂 Importar KMZ com os pivôs</h2><p class="muted" style="margin:4px 0 10px">Arquivo do Google Earth com um desenho por pivô. Eu caso o nome do desenho com o pivô e guardo o centro, o contorno e o raio.</p>' +
      '<label class="btn btn-outline">Escolher arquivo .kmz / .kml<input type="file" id="kmz-todos" accept=".kmz,.kml" hidden></label><div id="kmz-lista"></div></div>' : '<p class="muted">Só o administrador edita os pivôs.</p>');
};
V.pivos_depois_lista = function () {
  const inp = $('#kmz-todos'); if (!inp) return;
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const box = $('#kmz-lista'); box.innerHTML = '<p class="muted">Lendo…</p>';
    try {
      const des = await lerKml(f), pivos = DADOS.cadastro.pivos;
      box.innerHTML = '<ul class="lista">' + des.map((d, i) => { const p = pivoDoDesenho(d.nome, pivos);
        return '<li><div class="t">' + esc(d.nome) + '<div class="muted">' + (d.raioM ? 'raio ≈ ' + d.raioM + ' m · ' : '') + d.centro[0] + ', ' + d.centro[1] + '</div></div>' +
          '<select data-desenho="' + i + '"><option value="">— não importar —</option>' + pivos.map((x) => '<option' + (p && p.nome === x.nome ? ' selected' : '') + '>' + esc(x.nome) + '</option>').join('') + '</select></li>'; }).join('') + '</ul>' +
        '<button class="btn btn-primary btn-block" id="kmz-salvar" type="button">Salvar posições na planilha</button>';
      $('#kmz-salvar').addEventListener('click', async () => {
        const btn = $('#kmz-salvar'); btn.disabled = true;
        let n = 0;
        try {
          for (const sel of $$('select[data-desenho]', box)) {
            if (!sel.value) continue;
            const d = des[Number(sel.dataset.desenho)], p = pivos.find((x) => x.nome === sel.value);
            btn.textContent = 'Salvando ' + p.nome + '…';
            const dados = { nome: p.nome, latitude: d.centro[0], longitude: d.centro[1], contorno: d.pontos ? JSON.stringify(d.pontos) : '' };
            if (d.raioM && !Number(p.raioM)) dados.raioM = d.raioM;
            const r = await chamar('POST', null, { __pivo: { dados, original: p.nome } });
            if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
            DADOS.cadastro = r.cadastro; if (r.recalculo && r.recalculo.resumo) DADOS.resumo = r.recalculo.resumo; n++;
          }
          DADOS.hash = ''; grava(DADOS_KEY, DADOS);
          toast('✅ ' + n + ' pivô(s) com posição salva.'); location.hash = '#/mapa'; puxar(true);
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Salvar posições na planilha'; }
      });
    } catch (e) { box.innerHTML = '<p class="muted" style="color:var(--red)">' + esc(e.message) + '</p>'; }
  });
};
function campoPivo(k, rot, v, so) {
  const id = 'p_' + k, dis = so ? ' disabled' : '';
  if (k === 'ativo' || k === 'palhada') return '<div><label for="' + id + '">' + esc(rot.replace(' (SIM/NÃO)', '')) + '</label><select id="' + id + '" name="' + k + '"' + dis + '><option value="SIM"' + (simNao(v) ? ' selected' : '') + '>Sim</option><option value="NÃO"' + (simNao(v) ? '' : ' selected') + '>Não</option></select></div>';
  if (k === 'cultura') return '<div><label for="' + id + '">' + esc(rot) + '</label><select id="' + id + '" name="' + k + '"' + dis + '>' + culturas().map((c) => '<option value="' + esc(c.chave) + '"' + (String(v).toLowerCase().trim() === c.chave ? ' selected' : '') + '>' + esc(c.nome) + (c.cicloDias ? ' (' + c.cicloDias + ' dias)' : '') + '</option>').join('') + '</select></div>';
  if (k === 'cicloDias') { const c = cultura($('#p_cultura') ? $('#p_cultura').value : ''); return '<div><label for="' + id + '">' + esc(rot) + '</label><input inputmode="numeric" id="' + id + '" name="' + k + '" value="' + esc(v === '' || v == null ? '' : v) + '" placeholder="padrão' + (c && c.cicloDias ? ' ' + c.cicloDias : '') + '"' + dis + '></div>'; }
  if (k === 'plantio' || k === 'inicioBalanco') return '<div><label for="' + id + '">' + esc(rot) + '</label><input type="date" id="' + id + '" name="' + k + '" value="' + esc(v) + '"' + dis + '></div>';
  if (k === 'nome') return '<div><label for="' + id + '">' + esc(rot) + '</label><input id="' + id + '" name="' + k + '" value="' + esc(v) + '" required' + dis + '></div>';
  if (k === 'contorno') return '<input type="hidden" id="' + id + '" name="' + k + '" value="' + esc(typeof v === 'string' ? v : v ? JSON.stringify(v) : '') + '">';
  return '<div><label for="' + id + '">' + esc(rot) + '</label><input inputmode="decimal" id="' + id + '" name="' + k + '" value="' + esc(v === '' || v == null ? '' : String(v).replace('.', ',')) + '"' + dis + '></div>';
}
function formPivo(p) {
  const so = !ehAdmin(); const rot = {}; DADOS.cadastro.colunas.forEach((c) => { rot[c[0]] = c[1]; });
  const cs = culturas();
  const base = p || { ativo: 'SIM', cultura: cs.length ? cs[0].chave : '', palhada: 'SIM', tensaoIrrigarKpa: -70, laminaMinimaMm: 5, anguloGraus: 360, eficienciaPct: 85, percentimetroMinPct: 10 };
  return '<form class="card" id="f-pivo" data-original="' + esc(p ? p.nome : '') + '" autocomplete="off"><div class="row"><h2>' + (p ? esc(p.nome) : 'Novo pivô') + '</h2><a class="btn btn-outline btn-sm" href="#/pivos">Voltar</a></div>' +
    GRUPOS.map((g) => '<fieldset><legend>' + esc(g[0]) + '</legend><div class="grid2">' + g[1].map((k) => campoPivo(k, rot[k] || k, base[k] == null ? '' : base[k], so)).join('') + '</div>' +
      (g[0] === 'Identificação' ? '<div id="cult-info"></div>' : '') +
      (g[0] === 'Localização (mapa)' ? (so ? '' : '<div class="toolbar" style="margin-top:10px"><button type="button" class="btn btn-outline btn-sm" data-act="gps">📍 Usar minha posição</button>' +
        '<label class="btn btn-outline btn-sm">📂 KMZ / KML do pivô<input type="file" id="p_arquivo" accept=".kmz,.kml" hidden></label></div>') + '<div id="loc-info" class="muted"></div>' : '') + '</fieldset>').join('') +
    '<p class="muted" style="margin-top:10px">Solo, Kc e equipamento precisam ser confirmados com o agrônomo e a placa do pivô.</p>' +
    (so ? '' : '<button class="btn btn-primary btn-block" type="submit">Salvar na planilha</button>') + '</form>';
}
/** Bloco abaixo da cultura: curva de Kc da cultura escolhida, sugestão da Embrapa e fonte. */
function infoCultura(f) {
  const box = $('#cult-info', f); if (!box) return;
  const c = cultura($('#p_cultura', f).value); if (!c) { box.innerHTML = ''; return; }
  const ciclo = Number(String($('#p_cicloDias', f).value || '').replace(',', '.')) || c.cicloDias;
  $('#p_cicloDias', f).placeholder = 'padrão ' + c.cicloDias;
  // ciclo diferente do padrão: estica a curva do catálogo na mesma proporção (igual ao Motor)
  let curva = c.curvaKc || [];
  if (curva.length && ciclo !== c.cicloDias) {
    const em = c.emergenciaDias || 0, n = em + ciclo, orig = curva.length - 1;
    curva = Array.from({ length: n + 1 }, (_, d) => curva[d <= em ? d : Math.min(orig, Math.round(em + (d - em) * (orig - em) / (n - em)))]);
  }
  const plantio = $('#p_plantio', f).value;
  const hoje = plantio ? Math.round((Date.parse(hojeIso() + 'T00:00:00Z') - Date.parse(plantio + 'T00:00:00Z')) / 86400000) : null;
  const sg = c.sugestao, dis = !ehAdmin();
  box.innerHTML = graficoKc(curva, hoje, c.emergenciaDias) +
    (sg ? '<div class="sugestao"><div><b>Sugestão da Embrapa:</b> raiz máxima ' + sg.raizMaxCm + ' cm em ' + sg.diasRaiz + ' dias' +
      (sg.fatorDeplecaoFixo ? ', fator fixo ' + br(sg.fatorDeplecaoFixo, 2) : '') + (sg.tensaoIrrigarKpa ? ', tensão ' + sg.tensaoIrrigarKpa + ' kPa' : '') + '.<div class="muted">' + esc(sg.porque) + '</div></div>' +
      (dis ? '' : '<button type="button" class="btn btn-outline btn-sm" data-act="sugestao">Usar</button>') + '</div>' : '') +
    (c.fonte ? '<p class="muted" style="margin-top:6px">Fonte: ' + esc(c.fonte) + '</p>' : '');
}
function infoLocal(f, texto) {
  const box = $('#loc-info', f); if (!box) return;
  let c = null; try { c = JSON.parse($('#p_contorno', f).value || 'null'); } catch (e) { c = null; }
  box.textContent = texto || (Array.isArray(c) && c.length ? 'Contorno do KMZ com ' + c.length + ' pontos.' : 'Sem contorno: o mapa desenha um círculo com o raio do equipamento.');
}
V.pivos_depois = function () {
  if (V.pivos_depois_lista) V.pivos_depois_lista();
  const f = $('#f-pivo'); if (!f) return;
  infoCultura(f); infoLocal(f);
  f.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-act="gps"]')) return;
    if (!navigator.geolocation) { toast('Este aparelho não informa a posição.', true); return; }
    infoLocal(f, 'Pegando a posição do aparelho…');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('#p_latitude', f).value = String(Math.round(pos.coords.latitude * 1e6) / 1e6).replace('.', ',');
      $('#p_longitude', f).value = String(Math.round(pos.coords.longitude * 1e6) / 1e6).replace('.', ',');
      infoLocal(f, 'Posição do aparelho (precisão ' + Math.round(pos.coords.accuracy) + ' m). Fique no centro do pivô ao usar.');
    }, (e) => infoLocal(f, 'Não consegui a posição: ' + e.message), { enableHighAccuracy: true, timeout: 15000 });
  });
  const arq = $('#p_arquivo', f);
  if (arq) arq.addEventListener('change', async () => {
    const file = arq.files[0]; if (!file) return;
    try {
      const des = await lerKml(file);
      const d = (des.length > 1 && pivoDoDesenho($('#p_nome', f).value, des.map((x) => ({ nome: x.nome })))) ? des.find((x) => x.nome === pivoDoDesenho($('#p_nome', f).value, des.map((y) => ({ nome: y.nome }))).nome) : des[0];
      $('#p_latitude', f).value = String(d.centro[0]).replace('.', ','); $('#p_longitude', f).value = String(d.centro[1]).replace('.', ',');
      $('#p_contorno', f).value = d.pontos ? JSON.stringify(d.pontos) : '';
      const raio = $('#p_raioM', f); if (d.raioM && raio && !raio.value) raio.value = String(d.raioM);
      infoLocal(f, 'Desenho "' + d.nome + '"' + (des.length > 1 ? ' (de ' + des.length + ' no arquivo)' : '') + (d.raioM ? ' · raio ≈ ' + d.raioM + ' m' : '') + (d.pontos ? ' · ' + d.pontos.length + ' pontos' : '') + '. Salve para gravar.');
    } catch (e) { toast(e.message, true); }
  });
  ['#p_cultura', '#p_cicloDias', '#p_plantio'].forEach((q) => { const el = $(q, f); if (el) el.addEventListener('change', () => infoCultura(f)); });
  f.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-act="sugestao"]')) return;
    const c = cultura($('#p_cultura', f).value); if (!c || !c.sugestao) return;
    const sg = c.sugestao, por = (k, v) => { const el = $('#p_' + k, f); if (el) el.value = v == null ? '' : String(v).replace('.', ','); };
    por('raizMaxCm', sg.raizMaxCm); por('diasRaiz', sg.diasRaiz); por('fatorFixo', sg.fatorDeplecaoFixo == null ? '' : sg.fatorDeplecaoFixo);
    if (sg.tensaoIrrigarKpa != null) por('tensaoIrrigarKpa', sg.tensaoIrrigarKpa);
    toast('Preenchido com a sugestão da Embrapa — confira com o agrônomo e salve.');
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {}; $$('[name]', f).forEach((el) => { dados[el.name] = el.value; });
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const r = await chamar('POST', null, { __pivo: { dados, original: f.dataset.original || null } });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
      DADOS.cadastro = r.cadastro; if (r.recalculo && r.recalculo.resumo) DADOS.resumo = r.recalculo.resumo; DADOS.hash = ''; grava(DADOS_KEY, DADOS);
      toast('✅ Pivô salvo e decisão recalculada.'); location.hash = '#/pivos'; puxar(true);
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Salvar na planilha'; }
  });
};

/* ================= AJUSTES (sincronizar) ================= */
V.sync = function () {
  const u = sessUsuario(), f = fila(), log = ler(LOG_KEY, []);
  return '<div class="card"><h2>Endereço da planilha</h2><p class="muted" style="margin-top:4px">Na planilha: menu 💧 Manejo → 📱 Endereço para o app. Termina em <b>/exec</b>.</p>' +
    '<label for="s-url">Endereço (/exec)</label><input id="s-url" value="' + esc(syncUrl()) + '" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false">' +
    '<div class="toolbar" style="margin-top:12px"><button class="btn btn-primary" data-act="salvar-url">Salvar</button><button class="btn btn-outline" data-act="puxar">↓ Puxar agora</button>' +
    (f.length ? '<button class="btn btn-outline" data-act="enviar">↑ Enviar fila (' + f.length + ')</button>' : '') +
    (syncUrl() ? '<a class="btn btn-outline" target="_blank" rel="noopener" href="' + esc(syncUrl() + '?acao=hash') + '">🔎 Testar endereço</a>' : '') + '</div>' +
    (syncUrl() ? '<p class="muted">🔎 Testar endereço abre a planilha numa aba nova. Certo = aparece um texto com <b>"login":true</b> ou <b>"ok":true</b>. Tela de login do Google = falta "Qualquer pessoa" na implantação. "Arquivo não existe" = endereço errado.</p>' : '') +
    '<p class="muted">Estado: ' + esc(estado.st === 'ok' ? 'sincronizado' : estado.st === 'err' ? 'erro — ' + (estado.msg || '') : estado.st === 'busy' ? 'sincronizando…' : 'parado') +
    (DADOS && DADOS.versao ? ' · planilha v' + esc(DADOS.versao) : '') + ' · app v' + APP_VERSION + '</p></div>' +
    (f.some((x) => x.erro) ? '<div class="card"><h2>Recusados pela planilha</h2><ul class="lista">' + f.filter((x) => x.erro).map((x) => '<li><div class="t">' + esc(x.op === 'apagar' ? 'Apagar ' + x.id : x.d.pivo + ' ' + dataBr(x.d.data)) + '<div class="muted" style="color:var(--red)">' + esc(x.erro) + '</div></div><button class="btn btn-danger btn-sm" data-act="descartar" data-id="' + esc(x.id) + '" data-op="' + esc(x.op) + '">Descartar</button></li>').join('') + '</ul></div>' : '') +
    '<div class="card"><h2>Conta</h2><div class="toolbar" style="margin-top:10px">' +
    (u ? '<a class="btn btn-outline" href="#/conta">👤 ' + esc(u.nome) + ' (' + (u.perfil === 'ADMIN' ? 'administrador' : 'operador') + ')</a>' + (u.perfil === 'ADMIN' ? '<a class="btn btn-outline" href="#/usuarios">👥 Usuários</a>' : '')
      : '<a class="btn btn-primary" href="#/login">Entrar</a>') + '</div></div>' +
    '<div class="card"><h2>Conversas com a planilha</h2><div class="log" style="margin-top:8px">' + (log.length ? log.slice(0, 40).map((l) => '<div class="' + (l.ok ? '' : 'e') + '">' + esc(l.t) + ' · ' + (l.ok ? '✔' : '✖') + ' ' + esc(l.oque) + (l.det ? ' — ' + esc(l.det) : '') + '</div>').join('') : '<div>Nada ainda.</div>') + '</div></div>';
};

/* ================= ENTRAR / CONTA / USUÁRIOS ================= */
V.login = function () {
  return '<div class="entrar card"><div class="logo">💧</div><h2>Manejo de Irrigação</h2><p class="muted" style="text-align:center">Fazenda Água Viva</p>' +
    '<form id="f-login" autocomplete="on"><label for="lg-login">Login</label><input id="lg-login" autocomplete="username" autocapitalize="none" required>' +
    '<label for="lg-pin">PIN</label><input id="lg-pin" type="password" inputmode="numeric" autocomplete="current-password" required>' +
    '<button class="btn btn-primary btn-block" type="submit">Entrar</button></form>' +
    '<p class="muted" style="margin-top:12px;text-align:center"><a href="#/sync">⚙️ Endereço da planilha</a></p></div>';
};
V.login_depois = function () {
  $('#f-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!syncUrl()) { toast('Primeiro cole o endereço da planilha em Ajustes.', true); location.hash = '#/sync'; return; }
    const btn = $('#f-login button'); btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const r = await chamar('POST', null, { __login: { login: $('#lg-login').value, pin: $('#lg-pin').value } });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'Não foi possível entrar.');
      grava(SESS_KEY, { token: r.token, usuario: r.usuario });
      logAdd(true, 'Entrar', r.usuario.nome);
      toast('Olá, ' + r.usuario.nome + '!'); location.hash = '#/hoje'; await puxar(true); enviarFila();
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Entrar'; }
  });
};
V.conta = function () {
  const u = sessUsuario(); if (!u) return '<div class="card vazio"><a class="btn btn-primary" href="#/login">Entrar</a></div>';
  return '<div class="card"><h2>' + esc(u.nome) + '</h2><p class="muted">Login ' + esc(u.login) + ' · ' + (u.perfil === 'ADMIN' ? 'administrador' : 'operador') + '</p>' +
    '<form id="f-pin" autocomplete="off"><div class="grid2"><div><label for="pin-atual">PIN atual</label><input id="pin-atual" type="password" inputmode="numeric"></div><div><label for="pin-novo">PIN novo (4 a 6 números)</label><input id="pin-novo" type="password" inputmode="numeric"></div></div>' +
    '<button class="btn btn-primary btn-block" type="submit">Trocar PIN</button></form><button class="btn btn-danger btn-block" data-act="sair">Sair deste aparelho</button></div>';
};
V.conta_depois = function () {
  const f = $('#f-pin'); if (!f) return;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await chamar('POST', null, { __trocarPin: { atual: $('#pin-atual').value, novo: $('#pin-novo').value } });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'Não foi possível trocar.');
      const s = sessao(); s.token = r.token; grava(SESS_KEY, s); toast('PIN trocado.'); route();
    } catch (e) { toast(e.message, true); }
  });
};
let USUARIOS = null;
V.usuarios = function () {
  if (!ehAdmin()) return '<div class="card vazio">Só o administrador gerencia usuários.</div>';
  return '<div class="card"><h2>Novo ou editar</h2><p class="muted">Para editar, use o mesmo login. PIN em branco mantém o atual.</p><form id="f-user" autocomplete="off"><div class="grid2">' +
    '<div><label for="u-nome">Nome</label><input id="u-nome" required></div><div><label for="u-login">Login</label><input id="u-login" autocapitalize="none" required></div>' +
    '<div><label for="u-perfil">Perfil</label><select id="u-perfil"><option value="OPERADOR">Operador (vê e lança)</option><option value="ADMIN">Administrador (tudo)</option></select></div>' +
    '<div><label for="u-ativo">Ativo</label><select id="u-ativo"><option value="SIM">Sim</option><option value="NÃO">Não</option></select></div>' +
    '<div><label for="u-pin">PIN (4 a 6 números)</label><input id="u-pin" type="password" inputmode="numeric"></div></div>' +
    '<button class="btn btn-primary btn-block" type="submit">Salvar usuário</button></form></div>' +
    '<div class="card"><h2>Usuários</h2><ul class="lista" id="l-users" style="margin-top:6px"><li class="vazio">Carregando…</li></ul></div>';
};
V.usuarios_depois = async function () {
  if (!ehAdmin()) return;
  const desenhar = () => {
    $('#l-users').innerHTML = (USUARIOS || []).map((u) => '<li><div class="t"><b>' + esc(u.nome) + '</b> · ' + esc(u.login) + '<div class="muted">' + (u.perfil === 'ADMIN' ? 'Administrador' : 'Operador') + (u.ativo ? '' : ' · inativo') + (u.temPin ? '' : ' · sem PIN') + '</div></div>' +
      '<span class="toolbar" style="margin:0"><button class="btn btn-outline btn-sm" data-act="user-editar" data-login="' + esc(u.login) + '">Editar</button><button class="btn btn-danger btn-sm" data-act="user-excluir" data-login="' + esc(u.login) + '">Excluir</button></span></li>').join('') || '<li class="vazio">Nenhum.</li>';
  };
  $('#f-user').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const salvar = { nome: $('#u-nome').value, login: $('#u-login').value, perfil: $('#u-perfil').value, ativo: $('#u-ativo').value };
    if ($('#u-pin').value) salvar.pin = $('#u-pin').value;
    try { const r = await chamar('POST', null, { __usuario: { salvar } }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); USUARIOS = r.usuarios; desenhar(); ev.target.reset(); toast('Usuário salvo.'); }
    catch (e) { toast(e.message, true); }
  });
  try { const r = await chamar('GET', { acao: 'usuarios' }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); USUARIOS = r.usuarios; desenhar(); }
  catch (e) { $('#l-users').innerHTML = '<li class="vazio">' + esc(e.message) + '</li>'; }
};

/* ================= ações (data-act) ================= */
document.addEventListener('click', async (ev) => {
  const go = ev.target.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
  const a = ev.target.closest('[data-act]'); if (!a || a.tagName === 'SELECT') return;
  const act = a.dataset.act;
  if (act === 'tipo') { tipoLanc = a.dataset.tipo; route({ manterRolagem: true }); }
  else if (act === 'recalcular') {
    a.disabled = true; a.textContent = 'Recalculando…';
    try { const r = await chamar('POST', null, { __recalcular: {} }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); if (r.aviso) toast(r.aviso, true); else toast('Recalculado.'); await puxar(true); }
    catch (e) { toast(e.message, true); a.disabled = false; a.textContent = '↻ Recalcular'; }
  }
  else if (act === 'apagar') {
    const id = a.dataset.id;
    if (!confirm('Apagar este lançamento?')) return;
    if (a.dataset.pend === '1') { salvaFila(fila().filter((x) => x.id !== id)); route({ manterRolagem: true }); return; }
    const fi = fila(); fi.push({ op: 'apagar', id }); salvaFila(fi); route({ manterRolagem: true }); enviarFila();
  }
  else if (act === 'salvar-url') {
    const u = $('#s-url').value.trim();
    if (u && !/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(u)) { toast('O endereço deve começar com https://script.google.com/ e terminar em /exec.', true); return; }
    grava(SYNC_KEY, u || null); DADOS = null; grava(DADOS_KEY, null); toast(u ? 'Endereço salvo.' : 'Endereço apagado.');
    if (u) { await puxar(true); location.hash = sessToken() || (DADOS && DADOS.exigido === false) ? '#/hoje' : '#/login'; } else route();
  }
  else if (act === 'puxar') { await puxar(true); route(); }
  else if (act === 'enviar') { await enviarFila(); route(); }
  else if (act === 'descartar') { salvaFila(fila().filter((x) => !(x.id === a.dataset.id && x.op === a.dataset.op))); route(); }
  else if (act === 'sair') { grava(SESS_KEY, null); toast('Você saiu.'); location.hash = '#/login'; }
  else if (act === 'user-editar') {
    const u = (USUARIOS || []).find((x) => x.login === a.dataset.login); if (!u) return;
    $('#u-nome').value = u.nome; $('#u-login').value = u.login; $('#u-perfil').value = u.perfil; $('#u-ativo').value = u.ativo ? 'SIM' : 'NÃO'; $('#u-pin').value = ''; window.scrollTo(0, 0);
  }
  else if (act === 'user-excluir') {
    if (!confirm('Excluir o usuário ' + a.dataset.login + '?')) return;
    try { const r = await chamar('POST', null, { __usuario: { excluir: a.dataset.login } }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); USUARIOS = r.usuarios; route(); }
    catch (e) { toast(e.message, true); }
  }
});
document.addEventListener('change', (ev) => { if (ev.target.dataset.act === 'hist') carregarHist(); });

/* ================= início ================= */
// Link do menu da planilha (📱 Endereço para o app / QR Code): ?exec=<endereço /exec> já configura o app.
(function () {
  try {
    const p = new URLSearchParams(location.search), u = (p.get('exec') || '').trim();
    if (!u) return;
    history.replaceState(null, '', location.pathname + (location.hash || '#/login'));
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(u)) { setTimeout(() => toast('O link não tem um endereço de planilha válido.', true), 300); return; }
    if (u !== syncUrl()) { grava(SYNC_KEY, u); DADOS = null; grava(DADOS_KEY, null); }
    setTimeout(() => toast('✅ App ligado à planilha. Entre com seu login e PIN.'), 300);
  } catch (e) {}
})();
$('#app-ver').textContent = 'v' + APP_VERSION;
$('#btn-update').addEventListener('click', async () => {
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (e) {}
  location.reload();
});
window.addEventListener('online', () => { enviarFila(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { enviarFila(); puxar(false); } });
setInterval(() => { if (document.visibilityState === 'visible') { if (fila().length) enviarFila(); else puxar(false); } }, 60000);
route();
if (syncUrl()) { enviarFila(); puxar(!DADOS); }
setStatus(syncUrl() ? '' : '');

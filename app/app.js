/* Manejo de Irrigação — app estático (sem backend), mesmo modelo do Planejamento.
   A planilha é a fonte da verdade: o app puxa dela (doGet) e envia lançamentos (doPost).
   O que precisa aparecer em outros aparelhos sobe para a planilha; aqui fica só cache e fila. */
'use strict';

const APP_VERSION = '2026.10.11-3';   // mostrado no rodapé; ajuda a confirmar se a atualização chegou
const SYNC_KEY = 'irrigacao_sync_url';     // endereço /exec do Apps Script (nunca no GitHub)
const SESS_KEY = 'irrigacao_sessao';       // {token, usuario}
const DADOS_KEY = 'irrigacao_dados';       // última leitura da planilha (abre rápido e sem internet)
const FILA_KEY = 'irrigacao_fila';         // lançamentos/exclusões esperando internet
const LOG_KEY = 'irrigacao_log';           // últimas conversas com a planilha
const HIST_KEY = 'irrigacao_hist_pref';    // pivô e período escolhidos no Histórico
const FAZ_KEY = 'irrigacao_fazenda';       // fazenda escolhida no app (quando o usuário vê mais de uma)

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
const TITULOS = { hoje: 'Hoje', lancar: 'Lançar', clima: 'Clima', historico: 'Histórico', mapa: 'Mapa', pivos: 'Pivôs', piscinao: 'Piscinão', sync: 'Ajustes', login: 'Entrar', conta: 'Minha conta', usuarios: 'Usuários' };
function editando() { const a = document.activeElement; return !!a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && !!a.value; }

function route(opts) {
  opts = opts || {};
  const [view, arg] = (location.hash || '#/hoje').replace('#/', '').split('/');
  let v = V[view] ? view : 'hoje';
  if (v !== 'login' && v !== 'sync' && syncUrl() && DADOS && DADOS.exigido !== false && !sessToken()) v = 'login';
  document.body.dataset.view = v;
  $('#page-title').textContent = TITULOS[v] || '';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === v || (v === 'usuarios' || v === 'conta') && a.dataset.view === 'sync' || v === 'piscinao' && a.dataset.view === 'pivos'));
  const u = sessUsuario(); const chip = $('#user-chip');
  chip.hidden = !u; if (u) chip.textContent = '👤 ' + u.nome;
  const y = window.scrollY;
  barraFazendas();
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


/* ================= fazendas (o app mostra uma por vez) ================= */
function fazendas() { return (DADOS && DADOS.fazendas) || []; }
function fazendaAtual() {
  const fs = fazendas(); if (!fs.length) return null;
  const pref = ler(FAZ_KEY, '');
  return fs.find((f) => f.chave === pref) || fs[0];
}
const chaveAtual = () => { const f = fazendaAtual(); return f ? f.chave : ''; };
const daFazenda = (p) => !fazendas().length || !p.chaveFazenda || p.chaveFazenda === chaveAtual();
/** Áreas do resumo (decisão do dia) da fazenda escolhida. */
function pivosResumo() { const r = DADOS && DADOS.resumo; return r && r.pivos ? r.pivos.filter(daFazenda) : []; }
/** Áreas do cadastro da fazenda escolhida (com a chave da fazenda resolvida). */
function pivosCadastro() {
  const c = DADOS && DADOS.cadastro; if (!c) return [];
  const fs = fazendas();
  return c.pivos.map((p, i) => Object.assign({ __i: i, chaveFazenda: (fs.find((f) => f.nome === p.fazenda) || fs[0] || {}).chave }, p)).filter(daFazenda);
}
/** Reservatórios (piscinões) da fazenda escolhida: do cadastro (nomes) e do último cálculo (balanço). */
function reservatoriosCadastro() { return ((DADOS && DADOS.cadastro && DADOS.cadastro.reservatorios) || []).map((r, i) => Object.assign({ __i: i }, r)).filter((r) => !fazendas().length || !r.chaveFazenda || r.chaveFazenda === chaveAtual()); }
function reservatoriosResumo() { const r = DADOS && DADOS.resumo; return r && r.reservatorios ? r.reservatorios.filter((b) => !fazendas().length || !b.chaveFazenda || b.chaveFazenda === chaveAtual()) : []; }
function lancs() { return ((DADOS && DADOS.lancamentos) || []).filter((l) => !fazendas().length || !l.chaveFazenda || l.chaveFazenda === chaveAtual()); }
/** Estação, previsão e rosa da fazenda escolhida (planilha nova) — ou os campos antigos (planilha anterior). */
function estacao() {
  const e = DADOS && DADOS.estacoes && DADOS.estacoes[chaveAtual()];
  return e || { ultimaLeitura: DADOS && DADOS.ultimaLeitura, previsao: DADOS && DADOS.previsao, vento24h: DADOS && DADOS.vento24h, temEstacao: true };
}
const climaResumo = () => { const r = DADOS && DADOS.resumo; if (!r) return null; const f = (r.fazendas || []).find((x) => x.chave === chaveAtual()); return f ? f.clima : r.clima; };
function barraFazendas() {
  const fs = fazendas(); const el = $('#faz-bar'); if (!el) return;
  if (fs.length < 2) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<label for="faz-sel" class="faz-rot">' + ico('mapa2') + ' Fazenda</label><select id="faz-sel">' + fs.map((f) => '<option value="' + esc(f.chave) + '"' + (f.chave === chaveAtual() ? ' selected' : '') + '>' + esc(f.nome) + (f.temEstacao ? '' : ' (sem estação)') + '</option>').join('') + '</select>';
}
document.addEventListener('change', (ev) => { if (ev.target.id === 'faz-sel') { grava(FAZ_KEY, ev.target.value); HIST = null; CLIMA = null; ROSA = null; route(); } });

/* ================= ícones (SVG inline, traço 2px) ================= */
const ICO = {
  agua: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9 14a3 3 0 0 0 3 3"/>',
  hoje: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13h6M9 17h4"/>',
  lancar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  historico: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  mapa: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  pivos: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  sync: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  gota: '<path d="M12 2.7 6.3 9.6a7 7 0 1 0 11.4 0Z"/>',
  chuveiro: '<path d="M4 4 2 6l5 5"/><path d="M8 8c3-3 7-3 10 0l1 1-7 7-1-1c-3-3-3-7 0-10Z"/><path d="M9 16v3M12 18v3M15 16v3M6 18v3"/>',
  alerta: '<path d="m10.3 3.9-8.5 14.6A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
  bloq: '<circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/>',
  vento: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  chuva: '<path d="M17 17a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1A3.5 3.5 0 0 0 6 17h11Z"/><path d="M8 19v2M12 19v3M16 19v2"/>',
  termo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/>',
  gauge: '<path d="M12 15a2 2 0 1 0 0 .1Z"/><path d="m14 13 3-5"/><path d="M4 18a9 9 0 1 1 16 0"/>',
  raio: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  solo: '<path d="M12 3c-3 4-6 7-6 10.5a6 6 0 0 0 12 0C18 10 15 7 12 3Z"/><path d="M4 21h16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  seta: '<path d="M12 3v18M6 9l6-6 6 6"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mapa2: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
};
function ico(nome, cls) { return '<svg class="svg' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[nome] || '') + '</svg>'; }
$$('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });

/* ================= estação agora (última leitura + extras) ================= */
const DIRECOES = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const pontoCardeal = (g) => DIRECOES[Math.round(((g % 360) + 360) % 360 / 45) % 8];
function faixaUv(u) { return u < 3 ? ['Baixo', '#2e7d32'] : u < 6 ? ['Moderado', '#f0b429'] : u < 8 ? ['Alto', '#ef6c00'] : u < 11 ? ['Muito alto', '#c62828'] : ['Extremo', '#6a1b9a']; }
/** Temperatura de bulbo úmido (°C) a partir de T e UR — fórmula de Stull (2011), boa de 5 a 99 % de UR. */
function bulboUmido(t, ur) {
  return t * Math.atan(0.151977 * Math.sqrt(ur + 8.313659)) + Math.atan(t + ur) - Math.atan(ur - 1.676331) +
    0.00391838 * Math.pow(ur, 1.5) * Math.atan(0.023101 * ur) - 4.686035;
}
/**
 * Condições para pulverização com a última leitura — critérios usuais (Embrapa/ANDEF): Delta T 2–8 °C ideal
 * (até 10 com gota grossa), vento 3–10 km/h, UR > 55 %, temperatura < 30 °C, sem chuva. Pior item manda.
 */
function condicoesAplicacao(u, x) {
  if (u.tempC == null || u.urPct == null) return null;
  const deltaT = u.tempC - bulboUmido(u.tempC, u.urPct);
  const ventoKmh = u.ventoMs != null ? u.ventoMs * 3.6 : null;
  const rajadaKmh = x['wind.wind_gust'] != null ? x['wind.wind_gust'] * 3.6 : null;
  const chovendo = (x['rainfall.rain_rate'] || x['rainfall_piezo.rain_rate'] || 0) > 0;
  const NIVEL = { bom: 0, atencao: 1, ruim: 2 };
  const motivos = []; let pior = 'bom';
  const marca = (nivel, texto) => { motivos.push([nivel, texto]); if (NIVEL[nivel] > NIVEL[pior]) pior = nivel; };
  if (deltaT < 2) marca('ruim', 'Delta T ' + br(deltaT, 1) + ' °C: abaixo de 2 — gota não seca, risco de inversão térmica');
  else if (deltaT <= 8) marca('bom', 'Delta T ' + br(deltaT, 1) + ' °C: ideal (2 a 8)');
  else if (deltaT <= 10) marca('atencao', 'Delta T ' + br(deltaT, 1) + ' °C: alto — só com gota grossa');
  else marca('ruim', 'Delta T ' + br(deltaT, 1) + ' °C: acima de 10 — a gota evapora antes de chegar');
  if (ventoKmh != null) {
    if (ventoKmh < 3) marca('atencao', 'Vento ' + br(ventoKmh, 0) + ' km/h: calmaria — deriva imprevisível, inversão');
    else if (ventoKmh <= 10) marca('bom', 'Vento ' + br(ventoKmh, 0) + ' km/h: ideal (3 a 10)');
    else if (ventoKmh <= 15) marca('atencao', 'Vento ' + br(ventoKmh, 0) + ' km/h: no limite (10 a 15)');
    else marca('ruim', 'Vento ' + br(ventoKmh, 0) + ' km/h: acima de 15 — deriva');
    if (rajadaKmh != null && rajadaKmh > 15 && ventoKmh <= 15) marca('atencao', 'Rajadas de ' + br(rajadaKmh, 0) + ' km/h');
  }
  if (u.urPct < 50) marca('ruim', 'UR ' + br(u.urPct, 0) + '%: abaixo de 50');
  else if (u.urPct < 55) marca('atencao', 'UR ' + br(u.urPct, 0) + '%: entre 50 e 55');
  if (u.tempC > 35) marca('ruim', 'Temperatura ' + br(u.tempC, 0) + ' °C: acima de 35');
  else if (u.tempC > 30) marca('atencao', 'Temperatura ' + br(u.tempC, 0) + ' °C: acima de 30');
  if (chovendo) marca('ruim', 'Chovendo agora — lava o produto');
  return { deltaT, nivel: pior, motivos };
}
const APLIC_ROTULO = { bom: 'Boa', atencao: 'Atenção', ruim: 'Ruim' };
function blocoAplicacao(u, x) {
  const c = condicoesAplicacao(u, x); if (!c) return '';
  const nivelDT = c.deltaT < 2 || c.deltaT > 10 ? 'ruim' : c.deltaT > 8 ? 'atencao' : 'bom';
  const pv = estacao().previsao, horas = pv && pv.horas ? pv.horas : [];
  const ruins = c.motivos.filter((m) => m[0] !== 'bom');
  return '<div class="aplic"><div class="aplic-top"><div class="est-rotulo">' + ico('gota') + ' Pulverização agora</div><div class="deltat sem-' + nivelDT + '"><small>Delta T</small><b>' + br(c.deltaT, 1) + '<span> °C</span></b><em>' + (nivelDT === 'bom' ? 'ideal 2–8' : nivelDT === 'atencao' ? 'alto (8–10)' : c.deltaT < 2 ? 'abaixo de 2' : 'acima de 10') + '</em></div></div>' +
    '<div class="aplic-modal sem-' + c.nivel + '"><div class="aplic-cab"><b>Condição pra aplicar</b><span class="badge aplic-' + c.nivel + '">' + SEM_ICONE[c.nivel] + ' ' + APLIC_ROTULO[c.nivel] + '</span></div>' +
    '<ul>' + (ruins.length ? ruins.map((m) => '<li class="m-' + m[0] + '">' + esc(m[1]) + '</li>').join('') : '<li class="m-bom">Delta T, vento, UR e temperatura dentro da faixa.</li>') + '</ul></div>' +
    janelas48h(horas) +
    '<p class="muted">Faixas usuais (Embrapa/ANDEF): Delta T 2–8 °C, vento 3–10 km/h, UR &gt; 55 %, temperatura &lt; 30 °C, sem chuva. Confirme com o agrônomo e a bula.</p></div>';
}
/** Próximas 48 h hora a hora (previsão Open-Meteo) e as melhores janelas de cada modalidade. */
function janelasBoas(horas, apartirDe, minHoras, max, ateNivel) {
  const ORDEM = { bom: 0, atencao: 1, ruim: 2 }, lim = ORDEM[ateNivel || 'bom'];
  const out = []; let ini = null, n = 0, ult = '';
  const fecha = () => { if (ini && n >= minHoras) out.push({ inicio: ini, fim: ult, horas: n }); ini = null; n = 0; };
  for (const h of horas) { if (h.quando < apartirDe) continue; if (ORDEM[h.nivel] <= lim) { if (!ini) ini = h.quando; n++; ult = h.quando; } else fecha(); }
  fecha(); return out.slice(0, max);
}
function horaMenosRuim(horas, apartirDe) {
  let m = null;
  for (const h of horas) { if (h.quando < apartirDe || (h.chuvaMm || 0) >= 0.2) continue; if (!m || h.deltaT < m.deltaT || (h.deltaT === m.deltaT && (h.urPct || 0) > (m.urPct || 0))) m = h; }
  return m;
}
function janelas48h(horas) {
  if (!horas || !horas.length) return '';
  const agora = new Date(); agora.setMinutes(0, 0, 0);
  const ini = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0') + 'T' + String(agora.getHours()).padStart(2, '0') + ':00';
  const prox = horas.filter((h) => h.quando >= ini).slice(0, 48);
  if (!prox.length) return '';
  const hh = (q) => q.slice(11, 13) + 'h', dd = (q) => q.slice(8, 10) + '/' + q.slice(5, 7);
  const quando = (q) => (q.slice(0, 10) === ini.slice(0, 10) ? 'hoje' : q.slice(0, 10) === prox[prox.length - 1].quando.slice(0, 10) && prox[prox.length - 1].quando.slice(0, 10) !== ini.slice(0, 10) ? dd(q) : 'amanhã');
  const lista = (js) => js.map((j) => quando(j.inicio) + ' ' + hh(j.inicio) + '–' + String(Number(j.fim.slice(11, 13)) + 1).padStart(2, '0') + 'h (' + j.horas + ' h)').join(' · ');
  const texto = () => {
    const boas = janelasBoas(prox, ini, 2, 3);
    if (boas.length) return lista(boas);
    const atencao = janelasBoas(prox, ini, 2, 3, 'atencao');
    if (atencao.length) return 'nenhuma janela boa; com atenção (gota grossa, adjuvante): ' + lista(atencao);
    const m = horaMenosRuim(prox, ini);
    return m ? 'nenhuma janela boa nas 48 h. Menos ruim: ' + quando(m.quando) + ' ' + hh(m.quando) + ' (Delta T ' + br(m.deltaT, 1) + ', UR ' + br(m.urPct, 0) + '%' + (m.ventoKmh != null ? ', vento ' + m.ventoKmh + ' km/h' : '') + ') — converse com o agrônomo' : 'nenhuma janela: chuva o tempo todo';
  };
  const faixa = () => '<div class="faixa48"><div class="horas48">' + prox.map((h) => '<i class="h-' + h.nivel + '" title="' + esc(dd(h.quando) + ' ' + hh(h.quando) + ' · Delta T ' + br(h.deltaT, 1) + (h.ventoKmh != null ? ' · vento ' + h.ventoKmh + ' km/h' : '') + (h.chuvaMm ? ' · chuva ' + br(h.chuvaMm, 1) + ' mm' : '')) + '"></i>').join('') + '</div></div>';
  return '<div class="j48"><div class="est-rotulo" style="margin-top:12px">' + ico('calendario') + ' Próximas 48 h (previsão)</div>' + faixa() +
    '<div class="horas48-rotulos">' + prox.filter((h, i) => i % 6 === 0).map((h) => '<span>' + hh(h.quando) + '</span>').join('') + '</div>' +
    '<p class="j48-txt"><b>Melhor hora pra aplicar:</b> ' + esc(texto()) + '</p></div>';
}

/**
 * Rosa dos ventos: 8 pontos, marcas a cada 10°, seta no sentido em que o vento SOPRA (sai da direção de
 * origem e atravessa o centro — convenção dos mapas de vento) e, no centro, a velocidade e de onde vem.
 */
function rosaDosVentos(dirGraus, ventoMs, rajadaMs) {
  const d = ((dirGraus % 360) + 360) % 360, R = 60, c = 70;
  const pt = (ang, r) => [c + r * Math.sin((ang * Math.PI) / 180), c - r * Math.cos((ang * Math.PI) / 180)];
  let s = '<svg viewBox="0 0 140 140" role="img" aria-label="Vento de ' + esc(pontoCardeal(d)) + ', ' + d + ' graus">';
  s += '<circle cx="' + c + '" cy="' + c + '" r="' + R + '" fill="rgba(255,255,255,.12)" stroke="currentColor" stroke-opacity=".5"/>';
  for (let a = 0; a < 360; a += 10) { const g = a % 90 === 0 ? 9 : a % 45 === 0 ? 7 : 4; const [x1, y1] = pt(a, R), [x2, y2] = pt(a, R - g); s += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="currentColor" stroke-opacity="' + (a % 45 === 0 ? '.9' : '.4') + '" stroke-width="' + (a % 90 === 0 ? 2 : 1) + '"/>'; }
  DIRECOES.forEach((n, i) => { const [x, y] = pt(i * 45, R - 17); s += '<text x="' + x.toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="middle" class="' + (i % 2 ? 'sec' : 'pri') + '">' + n + '</text>'; });
  // seta: nasce na borda, na direção de ORIGEM, e aponta para onde o vento vai
  const [ox, oy] = pt(d, R - 2), [fx, fy] = pt(d + 180, R - 22), [hx, hy] = pt(d + 180, R - 12);
  const [l1x, l1y] = pt(d + 180 - 14, R - 30), [l2x, l2y] = pt(d + 180 + 14, R - 30);
  s += '<line x1="' + ox.toFixed(1) + '" y1="' + oy.toFixed(1) + '" x2="' + fx.toFixed(1) + '" y2="' + fy.toFixed(1) + '" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/>';
  s += '<path d="M' + hx.toFixed(1) + ' ' + hy.toFixed(1) + ' L' + l1x.toFixed(1) + ' ' + l1y.toFixed(1) + ' L' + l2x.toFixed(1) + ' ' + l2y.toFixed(1) + ' Z" fill="#ffd166"/>';
  s += '<circle cx="' + ox.toFixed(1) + '" cy="' + oy.toFixed(1) + '" r="4" fill="#ffd166"/>';
  s += '<circle cx="' + c + '" cy="' + c + '" r="22" fill="rgba(0,0,0,.28)"/>';
  s += '<text x="' + c + '" y="' + (c - 1) + '" text-anchor="middle" class="vel">' + (ventoMs != null ? br(ventoMs * 3.6, 0) : '—') + '</text>';
  s += '<text x="' + c + '" y="' + (c + 10) + '" text-anchor="middle" class="uni">km/h</text></svg>';
  return '<div class="rosa">' + s + '<small>de <b>' + esc(pontoCardeal(d)) + '</b> (' + Math.round(d) + '°)' + (rajadaMs != null ? ' · rajada ' + br(rajadaMs * 3.6, 0) : '') + '</small></div>';
}

const DIR16 = ['N', 'NNE', 'NE', 'LNE', 'L', 'LSE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const FAIXAS_VENTO = [['3–10 km/h', '#9ad6e0'], ['10–20 km/h', '#3e9aaa'], ['> 20 km/h', '#16404d']];
/** Cartão "Vento nas últimas 24 h": rosa dos ventos com 16 setores empilhados por faixa de velocidade. */
let ROSA = null; // período escolhido pelo usuário: { de, ate, dados } (null = últimas 24 h da planilha)
function cardRosa24h() {
  const r = ROSA ? ROSA.dados : estacao().vento24h; if (!r) return '';
  const filtro = '<div class="rosa-filtro"><div class="grid2"><div><label for="r-de">De</label><input type="date" id="r-de" value="' + esc(ROSA ? ROSA.de : '') + '" max="' + hojeIso() + '"></div><div><label for="r-ate">Até</label><input type="date" id="r-ate" value="' + esc(ROSA ? ROSA.ate : '') + '" max="' + hojeIso() + '"></div></div>' +
    '<div class="toolbar" style="margin:8px 0 0"><button type="button" class="btn btn-outline btn-sm" data-act="rosa-periodo">Ver período</button>' + (ROSA ? '<button type="button" class="btn btn-outline btn-sm" data-act="rosa-24h">Últimas 24 h</button>' : '') + '</div></div>';
  const titulo = ROSA ? 'Vento de ' + dataBr(ROSA.de) + ' a ' + dataBr(ROSA.ate) : 'Vento nas últimas 24 h';
  if (!r.total) return '<div class="card rosa24"><div class="row"><h2>' + ico('vento') + ' ' + esc(titulo) + '</h2></div><p class="muted">Nenhuma leitura com direção do vento nesse período.</p>' + filtro + '</div>';
  const c = 110, R = 92, maxN = Math.max(1, ...r.setores.map((s) => s.n));
  const pt = (ang, rad) => [c + rad * Math.sin((ang * Math.PI) / 180), c - rad * Math.cos((ang * Math.PI) / 180)];
  const fatia = (i, r0, r1) => { const a0 = i * 22.5 - 10.5, a1 = i * 22.5 + 10.5; const [x0, y0] = pt(a0, r1), [x1, y1] = pt(a1, r1), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a0, r0);
    return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + x3.toFixed(1) + ' ' + y3.toFixed(1) + ' Z'; };
  let s = '<svg class="rosa24-svg" viewBox="0 0 220 220" role="img" aria-label="Rosa dos ventos das últimas 24 horas">';
  [0.25, 0.5, 0.75, 1].forEach((f) => { s += '<circle cx="' + c + '" cy="' + c + '" r="' + (R * f).toFixed(1) + '" fill="none" stroke="var(--line)"/>'; });
  for (let a = 0; a < 360; a += 45) { const [x, y] = pt(a, R); s += '<line x1="' + c + '" y1="' + c + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--line)"/>'; }
  r.setores.forEach((st, i) => {
    if (!st.n) return;
    let r0 = 0;
    [1, 2, 3].forEach((f) => { const n = st.faixas[f] || 0; if (!n) return; const r1 = r0 + (n / maxN) * R;
      s += '<path d="' + fatia(i, Math.max(r0, 0.01), r1) + '" fill="' + FAIXAS_VENTO[f - 1][1] + '" stroke="var(--card)" stroke-width="1"><title>' + DIR16[i] + ': ' + st.n + ' leitura(s) · média ' + st.mediaKmh + ' km/h</title></path>'; r0 = r1; });
  });
  DIR16.forEach((n, i) => { if (i % 2) return; const [x, y] = pt(i * 22.5, R + 11); s += '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="middle" class="' + (i % 4 ? 'sec' : 'pri') + '">' + n + '</text>'; });
  s += '</svg>';
  const pct = (n) => Math.round((n / r.total) * 100);
  const pred = r.predominante >= 0 ? DIR16[r.predominante] : null;
  return '<div class="card rosa24"><div class="row"><h2>' + ico('vento') + ' ' + esc(titulo) + '</h2><span class="muted">' + r.total + ' leituras</span></div>' +
    '<div class="rosa24-corpo">' + s + '<div class="rosa24-info">' +
    (pred ? '<p>Predominante: <b>' + esc(pred) + '</b> (' + pct(r.setores[r.predominante].n) + '% do tempo, média ' + r.setores[r.predominante].mediaKmh + ' km/h)</p>' : '') +
    '<p>Calmaria (&lt; 3 km/h): <b>' + pct(r.calmaria) + '%</b> do tempo</p>' +
    '<div class="legenda" style="margin-top:6px">' + FAIXAS_VENTO.map((f) => '<span style="--c:' + f[1] + '">' + f[0] + '</span>').join('') + '</div>' +
    '<p class="muted">Cada fatia aponta de onde o vento veio; quanto mais comprida, mais vezes veio dali. Serve pra saber pra que lado a deriva vai e de onde a chuva costuma chegar.</p></div></div>' + filtro + '</div>';
}
async function rosaPeriodo(de, ate) {
  if (!de || !ate) return toast('Escolha as duas datas.', true);
  if (ate < de) return toast('A data final vem antes da inicial.', true);
  const btn = $('[data-act="rosa-periodo"]'); if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
  try {
    const r = await chamar('GET', { acao: 'rosa', de, ate, fazenda: chaveAtual() });
    if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
    ROSA = { de, ate, dados: r.rosa }; route({ manterRolagem: true });
  } catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = 'Ver período'; } }
}

/** Cartão "Estação agora": o que a estação mediu por último, com avisos pra quem vai ligar o pivô. */
function cardEstacao() {
  const u = estacao().ultimaLeitura; if (!u || !u.quando) return '';
  const x = u.extras || {}, g = (k) => (x[k] === undefined ? null : x[k]);
  const idadeMin = Math.round((Date.now() - Date.parse(u.quando)) / 60000);
  const velha = idadeMin > 45;
  const rajada = g('wind.wind_gust'), dir = g('wind.wind_direction'), taxa = g((DADOS.grupoChuva || 'rainfall') + '.rain_rate') ?? g('rainfall.rain_rate') ?? g('rainfall_piezo.rain_rate');
  const uv = g('solar_and_uvi.uvi'), pres = g('pressure.relative'), orv = g('outdoor.dew_point'), sens = g('outdoor.feels_like');
  const raios = g('lightning.count'), raioKm = g('lightning.distance');
  const avisos = [];
  if (velha) avisos.push(['alerta', 'Sem leitura nova há ' + (idadeMin >= 120 ? Math.round(idadeMin / 60) + ' h' : idadeMin + ' min') + ' — estação ou internet fora?']);
  if (taxa > 0) avisos.push(['chuva', 'Chovendo agora (' + br(taxa, 1) + ' mm/h): não ligue o pivô.']);
  if ((rajada != null ? rajada : u.ventoMs) >= 4) avisos.push(['vento', 'Vento forte (' + br(rajada != null ? rajada : u.ventoMs, 1) + ' m/s): a água do pivô deriva — se puder, espere acalmar.']);
  if (raios > 0) avisos.push(['raio', 'Raios detectados' + (raioKm != null ? ' a ' + br(raioKm, 0) + ' km' : '') + ' — cuidado com o pivô (estrutura metálica).']);
  const stat = (nome, rot, val, sub) => '<div class="est-stat">' + ico(nome) + '<div><small>' + rot + '</small><b>' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div></div>';
  return '<div class="card estacao' + (velha ? ' velha' : '') + '"><div class="est-top"><div><div class="est-rotulo">' + ico('termo') + ' Estação agora · ' + esc(dataBr(u.quando)) + ' ' + esc(u.quando.slice(11, 16)) + '</div>' +
    '<div class="est-temp">' + (u.tempC != null ? br(u.tempC, 1) + '<span>°C</span>' : '—') + '</div>' +
    '<div class="est-sub">' + (sens != null ? 'sensação ' + br(sens, 0) + '° · ' : '') + (u.urPct != null ? 'UR ' + br(u.urPct, 0) + '%' : '') + (orv != null ? ' · orvalho ' + br(orv, 0) + '°' : '') + '</div></div>' +
    (dir != null ? rosaDosVentos(dir, u.ventoMs, rajada) : '') + '</div>' +
    '<div class="est-grid">' +
    stat('vento', 'Vento', u.ventoMs != null ? br(u.ventoMs, 1) + ' m/s' : '—', rajada != null ? 'rajada ' + br(rajada, 1) : '') +
    stat('sol', 'Radiação', u.radWm2 != null ? br(u.radWm2, 0) + ' W/m²' : '—', uv != null ? '<i style="color:' + faixaUv(uv)[1] + '">UV ' + br(uv, 0) + ' · ' + faixaUv(uv)[0] + '</i>' : '') +
    stat('chuva', 'Chuva hoje', u.chuvaAcumDia != null ? br(u.chuvaAcumDia, 1) + ' mm' : '—', taxa != null ? (taxa > 0 ? br(taxa, 1) + ' mm/h agora' : 'sem chuva agora') : '') +
    (pres != null ? stat('gauge', 'Pressão', String(Math.round(pres)) + ' hPa', u.pressaoTendencia3h != null ? (u.pressaoTendencia3h > 0.5 ? '↑ subindo' : u.pressaoTendencia3h < -0.5 ? '↓ caindo (chuva?)' : '→ estável') + ' ' + br(u.pressaoTendencia3h, 1) : '') : '') +
    (raios != null ? stat('raio', 'Raios (hora)', br(raios, 0), raioKm != null ? br(raioKm, 0) + ' km' : '') : '') +
    sensoresSolo(x) + '</div>' +
    (avisos.length ? '<ul class="alertas">' + avisos.map((a) => '<li>' + ico(a[0] === 'chuva' ? 'chuva' : a[0] === 'vento' ? 'vento' : a[0] === 'raio' ? 'raio' : 'alerta') + ' ' + esc(a[1]) + '</li>').join('') + '</ul>' : '') +
    blocoAplicacao(u, x) + '</div>';
}
function sensoresSolo(x) {
  return Object.keys(x).filter((k) => /^soil_ch\d+\.soilmoisture$/.test(k)).sort().map((k) => {
    const c = k.match(/\d+/)[0], t = x['temp_ch' + c + '.temperature'];
    const nome = (pivosCadastro().find((p) => String(p.sensorSolo) === c) || {}).nome;
    return '<div class="est-stat">' + ico('solo') + '<div><small>Solo ' + c + (nome ? ' · ' + esc(nome) : '') + '</small><b>' + br(x[k], 0) + '%</b>' + (t != null ? '<em>' + br(t, 1) + ' °C</em>' : '') + '</div></div>';
  }).join('');
}
/** Gráfico do clima diário da estação (Tmáx/Tmín, UR e chuva) para o Histórico. */
function graficoClima(cl) {
  if (!cl || cl.length < 2) return '';
  const W = 640, H = 220, mE = 34, mD = 34, mT = 12, mB = 26, w = W - mE - mD, alt = H - mT - mB;
  const tmax = Math.max(40, ...cl.map((d) => d.tmax || 0)), chMax = Math.max(20, ...cl.map((d) => d.chuva || 0));
  const x = (i) => mE + (i * w) / (cl.length - 1), yT = (v) => mT + alt - (v / tmax) * alt, yC = (v) => mT + alt - (v / chMax) * alt;
  const bw = Math.max(2, Math.min(12, (w / cl.length) * 0.5));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Clima da estação">';
  [0, 10, 20, 30, 40].forEach((v) => { s += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + yT(v) + '" y2="' + yT(v) + '" stroke="var(--line)"/><text x="' + (mE - 6) + '" y="' + (yT(v) + 4) + '" text-anchor="end">' + v + '°</text>'; });
  [0, chMax / 2, chMax].forEach((v) => { s += '<text x="' + (W - mD + 6) + '" y="' + (yC(v) + 4) + '">' + br(v, 0) + '</text>'; });
  cl.forEach((d, i) => { if (d.chuva > 0) s += '<rect x="' + (x(i) - bw / 2) + '" y="' + yC(d.chuva) + '" width="' + bw + '" height="' + (mT + alt - yC(d.chuva)) + '" fill="var(--chuva)" rx="1"><title>' + dataBr(d.data) + ': ' + br(d.chuva, 1) + ' mm</title></rect>'; });
  const linha = (campo, yy) => cl.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy(d[campo] || 0).toFixed(1)).join(' ');
  s += '<path d="' + linha('tmax', yT) + '" fill="none" stroke="var(--deficit)" stroke-width="2.2" stroke-linejoin="round"/>';
  s += '<path d="' + linha('tmin', yT) + '" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linejoin="round"/>';
  s += '<path d="' + cl.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + (mT + alt - ((d.ur || 0) / 100) * alt).toFixed(1)).join(' ') + '" fill="none" stroke="var(--afd)" stroke-width="1.5" stroke-dasharray="4 3"/>';
  const passo = Math.max(1, Math.ceil(cl.length / 7));
  cl.forEach((d, i) => { const ult = i === cl.length - 1; if ((i % passo === 0 && cl.length - 1 - i >= passo / 2) || ult) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : ult ? 'end' : 'middle') + '">' + dataBr(d.data) + '</text>'; });
  return s + '</svg>';
}

/* ================= HOJE ================= */
const classeDec = (d) => (d === 'IRRIGAR' ? 'irrigar' : d === 'SEM DADOS' ? 'sem' : 'nao');

V.hoje = function () {
  if (!DADOS) return semDados();
  const r = DADOS.resumo;
  if (!r) return '<div class="card vazio">' + esc(DADOS.erroCalculo || 'A planilha ainda não calculou nenhum dia.') + '</div>';
  const c = climaResumo() || r.clima, ult = estacao().ultimaLeitura;
  const pivos = pivosResumo();
  // resumo do dia: quantos pivôs em cada estado + chuva prevista + próxima irrigação mais perto
  const cont = { ruim: 0, atencao: 0, bom: 0, sem: 0 }; pivos.forEach((p) => { cont[semaforo(p)]++; });
  const pv = estacao().previsao, prox2 = pv && pv.dias ? pv.dias.filter((d) => d.data > r.dia).slice(0, 2) : [];
  const chuva2 = prox2.reduce((t, d) => t + (d.chuvaMm || 0), 0);
  const proximas = pivos.filter((p) => p.projecao && p.projecao.proximaIrrigacao && p.decisao !== 'IRRIGAR').map((p) => p.projecao.emDias);
  const frase = cont.ruim ? cont.ruim + (cont.ruim === 1 ? ' pivô pra irrigar' : ' pivôs pra irrigar') : proximas.length ? (function (n) { return n === 0 ? 'Irrigação prevista para hoje' : 'Próxima irrigação em ' + n + (n === 1 ? ' dia' : ' dias'); })(Math.min.apply(null, proximas)) : pivos.length ? 'Nenhum pivô pra irrigar' : 'Nenhum pivô ativo';
  let h = '<div class="resumo card"><div class="resumo-top"><div><div class="resumo-dia">' + esc(dataBr(r.dia)) + ' · até 18h</div><h2>' + esc(frase) + '</h2></div>' +
    '<div class="toolbar" style="margin:0;gap:6px"><button class="btn btn-outline btn-sm" data-act="pdf" title="Relatório do dia em PDF">' + ico('hoje') + ' PDF</button><button class="btn btn-outline btn-sm" data-act="recalcular">' + ico('refresh') + ' Recalcular</button></div></div>' +
    '<div class="semaforos">' + ['ruim', 'atencao', 'bom', 'sem'].map((k) => '<div class="sem-chip sem-' + k + (cont[k] ? '' : ' vazio') + '"><span class="ico">' + SEM_ICONE[k] + '</span><b>' + cont[k] + '</b><small>' + SEM_ROTULO[k] + '</small></div>').join('') + '</div>' +
    '<div class="chips"><span class="chip">ET₀ <b>' + br(c.et0, 1) + '</b> mm</span><span class="chip">Chuva <b>' + br(c.chuva, 1) + '</b> mm</span>' +
    (prox2.length ? '<a class="chip" href="#/clima">' + ico('chuva') + ' prev. 2 dias <b>' + br(chuva2, 1) + '</b> mm</a>' : '') +
    (c.n < 144 ? '<span class="chip">Leituras <b>' + esc(c.n) + '</b>/144</span>' : '') + '</div>' +
    '<p class="muted" style="margin-top:8px">Calculado ' + esc(dataBr(r.calculadoEm)) + ' ' + esc((r.calculadoEm || '').slice(11, 16)) +
    (ult ? ' · estação ' + esc(ult.quando.slice(11, 16)) + (ult.tempC != null ? ' ' + br(ult.tempC, 0) + '°' : '') : '') + ' · <a href="#/clima">ver o clima</a></p>' +
    (c.estimados && c.estimados.length ? '<ul class="alertas"><li>Estação sem dado de ' + esc(c.estimados.join(', ')) + ' — usado o dia vizinho.</li></ul>' : '') + '</div>';
  const res = reservatoriosResumo();
  if (res.length) h += '<div class="cards">' + res.map(cardReservatorio).join('') + '</div>';
  h += '<div class="cards">' + pivos.map(cardPivo).join('') + '</div>';
  return h || '<div class="card vazio">Nenhum pivô ativo.</div>';
};
/** Cartão do piscinão: quanto tem, quanto entra, quanto os pivôs puxam e pra quantos dias dá. */
function cardReservatorio(b) {
  const st = b.semaforo || 'sem';
  const temVol = b.volumeM3 != null;
  const pct = temVol ? Math.max(0, Math.min(100, b.pct)) : 0;
  const reserva = b.volumeUtilM3 > 0 ? Math.min(100, (b.reservaMinM3 / b.volumeUtilM3) * 100) : 0;
  const dias = b.diasAutonomia != null ? '<b>' + br(b.diasAutonomia, 1) + '</b><em>dias de irrigação</em>' : temVol ? '<b>cobre</b><em>' + (b.diasAteEncher != null ? 'enche em ' + br(b.diasAteEncher, 1) + ' d' : 'reposição ≥ consumo') + '</em>' : '<b>—</b><em>sem nível</em>';
  return '<div class="card reservatorio sem-' + st + '"><div class="row"><div><h2>' + ico('agua') + ' ' + esc(b.nome) + '</h2><div class="tags"><span class="tag">piscinão</span>' +
    (b.pivos && b.pivos.length ? '<span class="tag">' + esc(b.pivos.join(', ')) + '</span>' : '<span class="tag">sem pivô ligado</span>') + '</div></div>' +
    '<span class="badge ' + (st === 'ruim' ? 'irrigar' : st === 'atencao' ? 'atencao' : st === 'bom' ? 'nao' : 'sem') + '">' + (temVol ? br(b.pct, 0) + '%' : 'sem nível') + '</span></div>' +
    '<div class="bar agua" title="Volume em relação ao útil"><span style="width:' + pct.toFixed(1) + '%"></span>' + (reserva > 0 ? '<i style="left:' + reserva.toFixed(1) + '%"></i>' : '') + '</div>' +
    '<div class="bar-rotulos"><span>' + (temVol ? '<b>' + br(b.volumeM3, 0) + ' m³</b>' : 'nível não lançado') + '</span><span>útil ' + br(b.volumeUtilM3, 0) + ' m³</span></div>' +
    '<div class="kpis"><div><small>Entra (bomba)</small><b>' + br(b.reposicaoDiaM3, 0) + '</b><em>m³/dia</em></div><div><small>Pivôs puxam</small><b>' + br(b.demandaDiaM3, 0) + '</b><em>m³/dia</em></div>' +
    '<div><small>Pedem hoje</small><b>' + br(b.pedidoHojeM3, 0) + '</b><em>m³' + (b.cobreHoje === false ? ' · faltam ' + br(b.faltaHojeM3, 0) : '') + '</em></div><div><small>Água pra</small>' + dias + '</div></div>' +
    (b.alertas && b.alertas.length ? '<ul class="alertas">' + b.alertas.map((a) => '<li>' + ico('alerta') + ' ' + esc(a) + '</li>').join('') + '</ul>' : '') +
    '<p class="muted" style="margin-top:8px">' + (b.nivel ? 'Nível <b>' + br(b.nivel.pct, 0) + '%</b> lançado ' + esc(dataBr(b.nivel.data)) + (b.diasDesdeNivel ? ' (há ' + b.diasDesdeNivel + ' d: + ' + br(b.reposicaoDesdeNivelM3, 0) + ' m³ de bomba − ' + br(b.retiradoDesdeNivelM3, 0) + ' m³ puxados)' : '') : 'Lance o nível em Lançar → Nível do piscinão.') +
    (b.reservaMinM3 ? ' · reserva ' + br(b.reservaMinM3, 0) + ' m³' : '') + ' · <a href="#/lancar" data-act="lancar-nivel">lançar nível</a></p></div>';
}
/* ================= CLIMA (estação agora, previsão, histórico do tempo) ================= */
let CLIMA = null;
V.clima = function () {
  if (!DADOS) return semDados();
  const r = DADOS.resumo || {};
  return (cardEstacao() || '<div class="card vazio">A estação ainda não mandou nenhuma leitura.</div>') +
    cardRosa24h() +
    (cardPrevisao(r.dia) || '<div class="card vazio">Sem previsão ainda. Na planilha: 💧 Manejo → 🌧 Atualizar previsão do tempo.</div>') +
    miniMapa() +
    '<div class="card"><div class="row"><h2>Últimos 30 dias na estação</h2></div><div id="grafico-clima">' + (CLIMA ? graficoClima(CLIMA) : '<div class="esqueleto"><div class="sk sk-t"></div><div class="sk"></div><div class="sk sk-c"></div></div>') + '</div>' +
    '<div class="legenda"><span class="l" style="--c:var(--deficit)">Tmáx</span><span class="l" style="--c:var(--blue)">Tmín</span><span class="l" style="--c:var(--afd)">UR (0–100%)</span><span style="--c:var(--chuva)">Chuva (eixo da direita)</span></div></div>';
};
V.clima_depois = async function () {
  if (V.hoje_depois) V.hoje_depois();
  const ps = pivosCadastro();
  if (!ps.length || !syncUrl()) return;
  try {
    const r = await chamar('GET', { acao: 'historico', pivo: ps[0].nome, dias: 30, fazenda: chaveAtual() });
    if (r && r.ok && r.historico) { CLIMA = r.historico.clima || []; const el = $('#grafico-clima'); if (el) el.innerHTML = graficoClima(CLIMA) || '<div class="vazio">Sem dias calculados ainda.</div>'; }
  } catch (e) { const el = $('#grafico-clima'); if (el) el.innerHTML = '<div class="vazio">' + esc(e.message) + '</div>'; }
};
/** Cartão de um pivô na tela Hoje: o essencial em cima, o resto em "detalhes". */
/** Relatório meteorológico do ciclo (graus-dia, luz, sol, chuva, ET₀, extremos) em chips. */
function blocoCiclo(c, compacto) {
  if (!c) return '';
  const gd = '<div><small>Graus-dia</small><b>' + br(c.grausDia, 0) + '</b><em>' + (c.grausDiaCiclo ? br((c.fracaoGrausDia || 0) * 100, 0) + '% de ' + br(c.grausDiaCiclo, 0) : c.tBaseC != null ? 'base ' + c.tBaseC + ' °C' : '') + '</em></div>';
  const luz = '<div><small>Luz (fotoperíodo)</small><b>' + br(c.fotoperiodoHojeH, 1) + '<em style="display:inline"> h/dia</em></b><em>' + br(c.fotoperiodoAcumH, 0) + ' h no ciclo</em></div>';
  const sol = c.horasSolAcumH != null ? '<div><small>Horas de sol</small><b>' + br(c.horasSolAcumH, 0) + '</b><em>' + (c.horasSolHojeH != null ? br(c.horasSolHojeH, 1) + ' h hoje' : 'pela estação') + '</em></div>' : '';
  const chuva = '<div><small>Chuva no ciclo</small><b>' + br(c.chuvaMm, 0) + '<em style="display:inline"> mm</em></b><em>' + c.diasComChuva + ' dia' + (c.diasComChuva === 1 ? '' : 's') + ' · ET₀ ' + br(c.et0Mm, 0) + ' mm</em></div>';
  return '<div class="kpis kpis-ciclo">' + gd + luz + sol + chuva + '</div>' +
    (compacto ? '' : '<div class="chips"><span class="chip">' + (c.dias - 1) + ' dias desde o plantio' + (c.faltamDias >= 0 ? ' · faltam <b>' + c.faltamDias + '</b>' : ' · <b>ciclo encerrado</b> há ' + (-c.faltamDias) + ' d') + '</span>' +
      (c.tminAbs != null ? '<span class="chip">Extremos <b>' + br(c.tminAbs, 0) + '–' + br(c.tmaxAbs, 0) + ' °C</b> · média ' + br(c.tmedia, 1) + '</span>' : '') +
      (c.diasQuentes ? '<span class="chip chip-ruim"><b>' + c.diasQuentes + '</b> dia' + (c.diasQuentes === 1 ? '' : 's') + ' acima de 32 °C</span>' : '') +
      (c.diasFrios ? '<span class="chip"><b>' + c.diasFrios + '</b> dia' + (c.diasFrios === 1 ? '' : 's') + ' abaixo de 10 °C</span>' : '') +
      (c.diasComClima < c.dias ? '<span class="chip">clima de <b>' + c.diasComClima + '</b> dos ' + c.dias + ' dias</span>' : '') + '</div>');
}
function cardPivo(p) {
  if (!p.decisao) {
    const talhao = p.semBalanco || /^t/i.test(String(p.tipo || ''));
    return '<div class="card ' + (talhao ? 'sem-ciclo' : 'sem-sem') + '"><div class="row"><div><h2>' + (talhao ? ico('solo') + ' ' : '') + esc(p.nome) + '</h2><div class="tags"><span class="tag">' + esc(p.cultura) + '</span>' +
      (talhao ? '<span class="tag">talhão</span>' : '') + (p.das != null ? '<span class="tag">' + esc(p.das) + ' DAS</span>' : '') + '</div></div>' + (talhao ? '<span class="badge sem">ciclo</span>' : '') + '</div>' +
      (p.ciclo ? blocoCiclo(p.ciclo) : '<p class="muted">' + esc(p.aviso || 'sem cálculo') + '</p>') +
      (p.ciclo && !talhao ? '<p class="muted" style="margin-top:6px">' + esc(p.aviso || '') + '</p>' : '') + '</div>';
  }
  const st = semaforo(p);
  const pct = p.afd > 0 ? Math.min(100, (p.deficit / p.afd) * 100) : 0;
  const marca = p.afd > 0 && p.laminaMinimaMm != null ? Math.min(100, (p.laminaMinimaMm / p.afd) * 100) : null;
  const fim = p.fimCicloDas != null && p.das > p.fimCicloDas;
  const pj = p.projecao;
  let principal = '';
  if (p.decisao === 'IRRIGAR') {
    principal = p.rec
      ? '<div class="kpis"><div><small>Percentímetro</small><b>' + br(p.rec.percentimetroPct, 0) + '%</b></div><div><small>Volta</small><b>' + horas(p.rec.tempoVoltaH) + '</b></div>' +
        '<div><small>Lâmina bruta</small><b>' + br(p.rec.laminaBrutaMm, 1) + '</b><em>mm</em></div><div><small>' + (p.rec.ponta ? 'Ligar às ' + esc(p.rec.ponta.inicioSugerido) : 'Energia') + '</small><b>R$ ' + br(p.rec.custoRs, 0) + '</b><em>' + br(p.rec.energiaKwh, 0) + ' kWh' +
        (p.rec.ponta ? ' · na ponta R$ ' + br(p.rec.ponta.custoPiorRs, 0) : '') + '</em></div></div>' +
        (pj && pj.deficitFimVoltaMm != null ? '<p class="muted" style="margin-top:6px">Ao fim da volta o déficit chega a ≈ <b>' + br(pj.deficitFimVoltaMm, 1) + ' mm</b>' + (p.rec.limitado ? ' · uma volta não repõe tudo' : '') + '.</p>' : '')
      : '<p class="muted" style="margin-top:8px">Cadastre o equipamento do pivô para ver percentímetro, tempo e custo.</p>';
  } else if (pj && pj.dias && pj.dias.length) {
    principal = '<p class="prox">' + ico('calendario') + ' ' + (pj.proximaIrrigacao ? 'Próxima irrigação prevista: <b>' + esc(dataBr(pj.proximaIrrigacao)) + '</b> (em ' + pj.emDias + ' dia' + (pj.emDias === 1 ? '' : 's') + ', sem chuva)' : 'Sem irrigação prevista nos próximos ' + pj.dias.length + ' dias (sem chuva)') + '</p>';
  }
  const alertas = (p.alertas || []).filter((a) => a.indexOf('Só ') !== 0 && a.indexOf('Clima estimado') !== 0);
  // na frente só o que muda a decisão de hoje; o resto vai para "Detalhes"
  const naFrente = alertas.filter((a) => /AFD|Tensiômetro|Ciclo da cultura|Lâmina mínima|percolação/.test(a));
  const noDetalhe = alertas.filter((a) => naFrente.indexOf(a) < 0);
  const avisos = (p.avisoChuva ? '<ul class="alertas"><li>' + ico('chuva') + ' ' + esc(p.avisoChuva) + '</li></ul>' : '') +
    (naFrente.length ? '<ul class="alertas">' + naFrente.map((a) => '<li>' + ico('alerta') + ' ' + esc(a) + '</li>').join('') + '</ul>' : '');
  return '<div class="card pivo sem-' + st + '"><div class="row"><div><h2>' + esc(p.nome) + '</h2><div class="tags"><span class="tag">' + esc(p.cultura) + '</span><span class="tag">' + esc(p.estadio) + '</span><span class="tag">' + esc(p.das) + ' DAS' +
    (p.emergenciaDias ? ' · ' + esc(p.dae) + ' DAE' : '') + '</span>' + (fim ? '<span class="tag tag-erro">ciclo encerrado</span>' : '') + (p.fonte ? '<span class="tag">' + ico('agua') + ' ' + esc(p.fonte) + '</span>' : '') + '</div></div>' +
    '<span class="badge ' + classeDec(p.decisao) + '">' + SEM_ICONE[st] + ' ' + esc(p.decisao) + '</span></div>' +
    '<div class="bar" title="Déficit em relação à AFD"><span style="width:' + pct.toFixed(1) + '%"></span>' + (marca != null ? '<i style="left:' + marca.toFixed(1) + '%"></i>' : '') + '</div>' +
    '<div class="bar-rotulos"><span>Déficit <b>' + br(p.deficit, 1) + ' mm</b></span>' + (marca != null && marca > 22 && marca < 78 ? '<span class="marca" style="left:' + marca.toFixed(1) + '%">lâmina mín. ' + br(p.laminaMinimaMm, 0) + '</span>' : '') + '<span>AFD ' + br(p.afd, 1) + ' mm</span></div>' +
    principal + avisos +
    '<details class="det"><summary>Detalhes</summary>' +
    (p.sensorSolo ? '<p class="muted" style="margin-top:8px">' + ico('solo') + ' Sensor de solo ' + p.sensorSolo.canal + ': <b>' + br(p.sensorSolo.umidadePct, 0) + '%</b>' + (p.sensorSolo.tempC != null ? ' · ' + br(p.sensorSolo.tempC, 1) + ' °C' : '') + ' <span class="muted">(' + esc(dataBr(p.sensorSolo.quando)) + ' ' + esc(String(p.sensorSolo.quando).slice(11, 16)) + ', só informativo)</span></p>' : '') +
    '<div class="chips"><span class="chip">ETc <b>' + br(p.etc, 1) + '</b> mm</span><span class="chip">Kc <b>' + br(p.kc, 2) + '</b></span><span class="chip">CAD <b>' + br(p.cad, 1) + '</b> mm</span>' +
    (p.irrigacao ? '<span class="chip">Irrigado <b>' + br(p.irrigacao, 1) + '</b> mm</span>' : '') + (p.rec && p.decisao === 'IRRIGAR' ? '<span class="chip">Energia <b>' + br(p.rec.energiaKwh, 0) + '</b> kWh</span>' : '') + '</div>' +
    (pj && pj.dias && pj.dias.length ? '<p class="muted" style="margin-top:8px">Déficit previsto (sem chuva): ' + pj.dias.slice(0, 5).map((d) => esc(dataBr(d.data)) + ' <b>' + br(d.deficit, 0) + '</b>').join(' · ') + ' mm</p>' : '') +
    (p.ciclo ? '<h3>Ciclo da cultura</h3>' + blocoCiclo(p.ciclo) : '') +
    (noDetalhe.length ? '<ul class="alertas" style="margin-top:8px">' + noDetalhe.map((a) => '<li>' + ico('alerta') + ' ' + esc(a) + '</li>').join('') + '</ul>' : '') +
    (p.curvaKc ? '<details class="kc-det"><summary class="muted">Curva de Kc do ciclo</summary>' + graficoKc(p.curvaKc, p.das, p.emergenciaDias) + '</details>' : '') +
    (p.diasIncertos ? '<p class="muted" style="margin-top:8px">ℹ️ ' + esc(p.diasIncertos) + ' dia(s) do balanço com clima estimado ou incompleto.</p>' : '') + '</details></div>';
}
/** Miniatura do mapa na tela Hoje (clica e abre o Mapa). Só quando algum pivô tem posição. */
function miniMapa() {
  const com = pivosNoMapa().filter((p) => p.lat != null && p.lon != null);
  if (!com.length) return '';
  return '<a class="card mini-mapa" href="#/mapa" title="Abrir o mapa"><div id="mini-mapa"></div><span class="mini-rotulo">🗺️ Mapa dos pivôs</span></a>';
}
const SEM_ICONE = { bom: ico('ok'), atencao: ico('alerta'), ruim: ico('chuveiro'), sem: ico('bloq') };

V.hoje_depois = function () {
  const el = $('#mini-mapa'); if (!el) return;
  const com = pivosNoMapa().filter((p) => p.lat != null && p.lon != null);
  carregarLeaflet().then(() => {
    if (!$('#mini-mapa') || el._leaflet_id) return;
    const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }).addTo(m);
    const pontos = []; com.forEach((p) => { if (p.contorno) p.contorno.forEach((q) => pontos.push(q)); else { const d = (p.raioM || 300) / 111320; pontos.push([p.lat - d, p.lon - d], [p.lat + d, p.lon + d]); } });
    m.fitBounds(L.latLngBounds(pontos).pad(0.15));
    com.forEach((p) => { const cor = SEM_COR[semaforo(p)], st = { color: cor, weight: 2, fillColor: cor, fillOpacity: 0.45, interactive: false };
      (p.contorno ? L.polygon(p.contorno, st) : L.circle([p.lat, p.lon], Object.assign({ radius: p.raioM || 300 }, st))).addTo(m); });
  }).catch(() => { el.innerHTML = ''; });
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
  const pv = estacao().previsao; if (!pv || !pv.dias || !pv.dias.length) return '';
  const prox = pv.dias.filter((d) => d.data > (dia || '')).slice(0, 5);
  if (!prox.length) return '';
  const soma = prox.slice(0, 2).reduce((t, d) => t + (d.chuvaMm || 0), 0);
  return '<div class="card"><div class="row"><h2>' + ico('chuva') + ' Próximos dias</h2><span class="muted">' + br(soma, 1) + ' mm em 2 dias</span></div>' +
    '<div class="prev">' + prox.map((d) => '<div class="prev-dia' + ((d.chuvaMm || 0) >= 5 ? ' chuva' : '') + '"><small>' + esc(dataBr(d.data)) + '</small><b>' + (d.chuvaMm == null ? '?' : br(d.chuvaMm, 1)) + '<em> mm</em></b>' +
      '<span>' + (d.probPct == null ? '' : br(d.probPct, 0) + '%') + '</span>' + (d.tmin != null && d.tmax != null ? '<span>' + br(d.tmin, 0) + '–' + br(d.tmax, 0) + '°</span>' : '') + '</div>').join('') + '</div>' +
    (prox[0].resumo ? '<p class="muted" style="margin-top:8px">INMET amanhã — ' + esc(prox[0].resumo) + '</p>' : '') +
    '<p class="muted">Fonte: ' + esc((pv.fontes || []).join(' + ')) + ' · atualizado ' + esc(dataBr(pv.atualizadoEm)) + ' ' + esc((pv.atualizadoEm || '').slice(11, 16)) + '. A previsão não entra no balanço; só avisa.</p></div>';
}

/* ================= LANÇAR ================= */
let tipoLanc = 'irrigacao', modoLanc = 'pct';
/** Lâmina líquida (mm) que uma volta no percentímetro `pct` aplica no pivô — mesma conta do Motor. */
function laminaDoPct(nome, pct) {
  const p = pivosCadastro().find((x) => x.nome === nome); if (!p) return null;
  const raio = numBR(p.raioM), vazao = numBR(p.vazaoM3h), vel = numBR(p.velocidadeUltimaTorreMMin), ang = numBR(p.anguloGraus) || 360, ef = numBR(p.eficienciaPct) || 85;
  if (!raio || !vazao || !vel || !pct) return null;
  const fr = ang / 360, area = (Math.PI * raio * raio * fr) / 10000, t100 = (fr * 2 * Math.PI * raio) / (vel * 60);
  const l100 = (vazao * t100) / (area * 10), bruta = l100 / (pct / 100);
  return { brutaMm: bruta, liquidaMm: bruta * (ef / 100), horas: t100 / (pct / 100) };
}
function nomesPivos() {
  return pivosCadastro().filter((p) => (/^(SIM|S|TRUE|1)$/i.test(String(p.ativo).trim()) || p.ativo === true) && !(tipoLanc === 'irrigacao' && ehTalhaoSemBalanco(p))).map((p) => p.nome);
}
const ehTalhao = (p) => /^t/i.test(String(p.tipo || ''));
const ehTalhaoSemBalanco = (p) => ehTalhao(p) && (p.cc === '' || p.cc == null) && (p.pmp === '' || p.pmp == null);
V.lancar = function () {
  if (!DADOS) return semDados();
  const ps = nomesPivos();
  const f = fila();
  const pend = f.filter((x) => x.op === 'lancar');
  const apagando = f.filter((x) => x.op === 'apagar').map((x) => x.id);
  const lista = pend.map((x) => Object.assign({ pend: true, erro: x.erro }, itemDeFila(x)))
    .concat(lancs().filter((l) => !pend.some((p) => p.id === l.id) && apagando.indexOf(l.id) < 0));
  return '<div class="seg" role="tablist"><button type="button" data-act="tipo" data-tipo="irrigacao" class="' + (tipoLanc === 'irrigacao' ? 'on' : '') + '">🚿 Irrigação</button>' +
    '<button type="button" data-act="tipo" data-tipo="umidade" class="' + (tipoLanc === 'umidade' ? 'on' : '') + '">🌱 Umidade do solo</button>' +
    (reservatoriosCadastro().length ? '<button type="button" data-act="tipo" data-tipo="nivel" class="' + (tipoLanc === 'nivel' ? 'on' : '') + '">🏞 Nível do piscinão</button>' : '') + '</div>' +
    '<form class="card" id="f-lanc" autocomplete="off"><div class="grid2"><div><label for="l-pivo">' + (tipoLanc === 'nivel' ? 'Reservatório' : 'Pivô') + '</label><select id="l-pivo" required>' +
    (tipoLanc === 'nivel' ? reservatoriosCadastro().map((r) => r.nome) : ps).map((n) => '<option>' + esc(n) + '</option>').join('') + '</select></div><div><label for="l-data">Data</label><input id="l-data" type="date" required value="' + hojeIso() + '" max="' + hojeIso() + '"></div></div>' +
    (tipoLanc === 'nivel'
      ? '<div class="grid2"><div><label for="l-nivel">Nível (% do volume útil)</label><input id="l-nivel" inputmode="numeric" placeholder="ex.: 60"></div><div><label for="l-obs">Observação</label><input id="l-obs" placeholder="opcional"></div></div><p class="muted">Meça no fim do dia, depois das irrigações. A planilha estima o volume de hoje somando a bomba e descontando o que os pivôs puxaram.</p>'
      : tipoLanc === 'irrigacao'
      ? '<div class="seg seg-sub" role="tablist"><button type="button" data-act="modo-lanc" data-modo="pct" class="' + (modoLanc === 'pct' ? 'on' : '') + '">Pelo percentímetro</button><button type="button" data-act="modo-lanc" data-modo="mm" class="' + (modoLanc === 'mm' ? 'on' : '') + '">Pela lâmina (mm)</button></div>' +
        (modoLanc === 'pct'
          ? '<div class="grid2"><div><label for="l-pct">Percentímetro usado (%)</label><input id="l-pct" inputmode="numeric" placeholder="ex.: 40"></div><div><label for="l-obs">Observação</label><input id="l-obs" placeholder="opcional"></div></div><p class="muted" id="l-pct-info">A lâmina sai do equipamento cadastrado (raio, vazão, velocidade, eficiência).</p>'
          : '<div class="grid2"><div><label for="l-mm">Lâmina líquida aplicada (mm)</label><input id="l-mm" inputmode="decimal" placeholder="ex.: 12"></div><div><label for="l-obs">Observação</label><input id="l-obs" placeholder="ex.: percentímetro 40%"></div></div>')
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
    valores: d.tipo === 'nivel' ? [numBR(d.nivel), d.obs || ''] : d.tipo === 'irrigacao' ? [d.percentimetro ? (laminaDoPct(d.pivo, numBR(d.percentimetro)) || { liquidaMm: NaN }).liquidaMm : numBR(d.mm), (d.percentimetro ? 'percentímetro ' + d.percentimetro + '%' + (d.obs ? ' · ' : '') : '') + (d.obs || '')] : [numBR(d.umidadeRaiz), numBR(d.umidadeProfunda) == null ? '' : numBR(d.umidadeProfunda), numBR(d.tensao) == null ? '' : numBR(d.tensao), d.fonte || ''] };
}
function textoLanc(l) {
  const v = l.valores || [];
  return l.tipo === 'nivel'
    ? '🏞 nível ' + br(v[0], 0) + '%' + (v[1] ? ' · ' + esc(v[1]) : '')
    : l.tipo === 'irrigacao'
    ? '🚿 ' + br(v[0], 1) + ' mm' + (v[1] ? ' · ' + esc(v[1]) : '')
    : '🌱 ' + br(v[0], 1) + '%' + (v[1] !== '' && v[1] != null ? ' · prof. ' + br(v[1], 1) + '%' : '') + (v[2] !== '' && v[2] != null ? ' · ' + br(v[2], 0) + ' kPa' : '') + (v[3] ? ' · ' + esc(v[3]) : '');
}
V.lancar_depois = function () {
  const f = $('#f-lanc'); if (!f) return;
  const pct = $('#l-pct', f);
  if (pct) {
    const mostrar = () => { const l = laminaDoPct($('#l-pivo', f).value, numBR(pct.value)); const info = $('#l-pct-info', f);
      info.textContent = l ? '≈ ' + br(l.liquidaMm, 1) + ' mm líquidos (' + br(l.brutaMm, 1) + ' brutos) · volta de ' + horas(l.horas) : 'A lâmina sai do equipamento cadastrado (raio, vazão, velocidade, eficiência).'; };
    pct.addEventListener('input', mostrar); $('#l-pivo', f).addEventListener('change', mostrar);
  }
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = { id: novoId(), tipo: tipoLanc, pivo: $('#l-pivo').value, data: $('#l-data').value, fazenda: chaveAtual() };
    if (!d.pivo) return toast(tipoLanc === 'nivel' ? 'Cadastre o reservatório na aba RESERVATORIOS da planilha.' : 'Cadastre um pivô ativo primeiro.', true);
    if (d.data > hojeIso()) return toast('A data não pode ser no futuro.', true);
    if (tipoLanc === 'nivel') {
      d.nivel = $('#l-nivel').value; d.obs = $('#l-obs').value;
      const n = numBR(d.nivel); if (n == null || isNaN(n) || n < 0 || n > 100) return toast('Informe o nível em % (0 a 100).', true);
    } else if (tipoLanc === 'irrigacao' && modoLanc === 'pct') {
      d.mm = ''; d.percentimetro = $('#l-pct').value; d.obs = $('#l-obs').value;
      const n = numBR(d.percentimetro); if (n == null || isNaN(n) || n < 1 || n > 100) return toast('Informe o percentímetro usado (1 a 100%).', true);
      if (!laminaDoPct(d.pivo, n)) return toast('Esse pivô não tem equipamento cadastrado: lance pela lâmina (mm).', true);
    } else if (tipoLanc === 'irrigacao') {
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
  const pref = ler(HIST_KEY, {}); const ps = pivosCadastro().map((p) => p.nome);
  const piv = ps.indexOf(pref.pivo) >= 0 ? pref.pivo : ps[0];
  const dias = pref.dias || 30;
  return '<div class="card"><div class="grid2"><div><label for="h-pivo">Pivô</label><select id="h-pivo" data-act="hist">' + ps.map((n) => '<option' + (n === piv ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
    '<div><label for="h-dias">Período</label><select id="h-dias" data-act="hist">' + [15, 30, 60, 120].map((d) => '<option value="' + d + '"' + (d === dias ? ' selected' : '') + '>' + d + ' dias</option>').join('') + '</select></div></div></div>' +
    cardCicloHist(piv) +
    '<div id="resumo-hist">' + (HIST && HIST.pivo === piv ? resumoHist(HIST) : '') + '</div>' +
    '<div class="card"><div id="grafico">' + (HIST && HIST.pivo === piv ? grafico(HIST) : '<div class="esqueleto"><div class="sk sk-t"></div><div class="sk"></div><div class="sk sk-c"></div></div>') + '</div>' +
    '<div class="legenda"><span class="l" style="--c:var(--deficit)">Déficit</span><span class="l" style="--c:var(--afd)">AFD (limite de estresse)</span><span class="l" style="--c:var(--muted)">Lâmina mínima</span><span style="--c:var(--chuva)">Chuva</span><span style="--c:var(--irrig)">Irrigação</span><span style="--c:var(--red)">Dia em estresse</span></div></div>' +
    '<div class="card" id="tab-hist">' + (HIST && HIST.pivo === piv ? tabelaHist(HIST) : '') + '</div>';
};
/** Cartão do ciclo da cultura (do plantio até hoje) da área escolhida no Histórico. */
function cardCicloHist(nome) {
  const p = pivosResumo().find((x) => x.nome === nome); if (!p || !p.ciclo) return '';
  return '<div class="card"><div class="row"><h2>' + ico('calendario') + ' Ciclo da cultura · ' + esc(p.cultura) + '</h2><span class="muted">plantio ' + esc(dataBr(p.plantio || '')) + '</span></div>' + blocoCiclo(p.ciclo) + '</div>';
}
/** Totais do período: água que entrou e saiu, dias irrigados, dias em estresse, custo de irrigar. */
function resumoHist(h) {
  const ls = h.linhas; if (!ls || !ls.length) return '';
  const soma = (k) => ls.reduce((t, l) => t + (l[k] || 0), 0);
  const etc = soma('etc'), chuva = soma('chuva'), irrig = soma('irrigacao'), et0 = soma('et0');
  const diasIrrig = ls.filter((l) => l.irrigacao > 0).length, diasEstresse = ls.filter((l) => l.afd > 0 && l.deficit >= l.afd).length;
  const diasPedindo = ls.filter((l) => l.decisao === 'IRRIGAR').length, semDados = ls.filter((l) => l.decisao === 'SEM DADOS').length;
  const m3 = h.areaHa && h.eficienciaPct ? (irrig / (h.eficienciaPct / 100)) * h.areaHa * 10 : null;
  const ult = ls[ls.length - 1], ini = ls[0];
  const tend = ult.deficit - ini.deficit;
  return '<div class="card"><div class="row"><h2>' + esc(h.pivo) + ' · ' + ls.length + ' dias</h2><span class="muted">' + esc(dataBr(ini.data)) + ' – ' + esc(dataBr(ult.data)) + (h.cultura ? ' · ' + esc(h.cultura) : '') + '</span></div>' +
    '<div class="kpis kpis-hist"><div><small>Consumo (ETc)</small><b>' + br(etc, 0) + '</b><em>mm · ET₀ ' + br(et0, 0) + ' mm</em></div>' +
    '<div><small>Chuva útil</small><b>' + br(chuva, 0) + '</b><em>mm</em></div>' +
    '<div><small>Irrigação</small><b>' + br(irrig, 0) + '</b><em>mm líquidos em ' + diasIrrig + ' dia' + (diasIrrig === 1 ? '' : 's') + (m3 != null ? ' · ≈ ' + br(m3, 0) + ' m³ brutos' : '') + '</em></div>' +
    '<div><small>Déficit agora</small><b>' + br(ult.deficit, 1) + '</b><em>mm · ' + (tend > 0.05 ? '↑ subiu ' : tend < -0.05 ? '↓ caiu ' : '→ estável ') + br(Math.abs(tend), 1) + ' no período</em></div></div>' +
    '<div class="chips"><span class="chip">Pediu irrigação em <b>' + diasPedindo + '</b> dia' + (diasPedindo === 1 ? '' : 's') + '</span>' +
    '<span class="chip' + (diasEstresse ? ' chip-ruim' : '') + '">Estresse (déficit ≥ AFD) em <b>' + diasEstresse + '</b> dia' + (diasEstresse === 1 ? '' : 's') + '</span>' +
    (semDados ? '<span class="chip">Sem dados em <b>' + semDados + '</b> dia' + (semDados === 1 ? '' : 's') + '</span>' : '') +
    '<span class="chip">Cobertura: chuva + irrigação = <b>' + br(etc > 0 ? ((chuva + irrig) / etc) * 100 : 0, 0) + '%</b> do consumo</span></div>' +
    '<div class="toolbar" style="margin:10px 0 0"><button type="button" class="btn btn-outline btn-sm" data-act="hist-csv">⬇ Baixar CSV</button><button type="button" class="btn btn-outline btn-sm" data-act="hist-cols">' + (colsHist ? 'Menos colunas' : 'Mais colunas') + '</button></div></div>';
}
let colsHist = false;
function csvHist(h) {
  const cab = ['Data', 'DAS', 'Estádio', 'Kc', 'ET0 (mm)', 'ETc (mm)', 'Chuva (mm)', 'Irrigação (mm)', 'Raiz (cm)', 'CAD (mm)', 'f', 'AFD (mm)', 'Déficit (mm)', 'Medição', 'Decisão', 'Alertas'];
  const v = (x) => (x == null ? '' : String(x).replace('.', ','));
  const linhas = h.linhas.map((l) => [l.data, l.das, l.estadio, v(l.kc), v(l.et0), v(l.etc), v(l.chuva), v(l.irrigacao), v(l.raiz), v(l.cad), v(l.f), v(l.afd), v(l.deficit), l.medicao ? 'SIM' : '', l.decisao, (l.alertas || []).join(' | ')]
    .map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';'));
  const blob = new Blob(['\ufeff' + [cab.join(';')].concat(linhas).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'balanco_' + h.pivo.replace(/[^\w]+/g, '_') + '_' + h.linhas[0].data + '_' + h.linhas[h.linhas.length - 1].data + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
V.historico_depois = function () { carregarHist(); };
async function carregarHist() {
  const sel = $('#h-pivo'); if (!sel || !sel.value) return;
  const pref = { pivo: sel.value, dias: Number($('#h-dias').value) }; grava(HIST_KEY, pref);
  try {
    const r = await chamar('GET', { acao: 'historico', pivo: pref.pivo, dias: pref.dias, fazenda: chaveAtual() });
    if (!r || !r.ok) throw new Error((r && r.erro) || 'sem resposta');
    HIST = r.historico;
    if ($('#grafico')) { $('#grafico').innerHTML = grafico(HIST); $('#tab-hist').innerHTML = tabelaHist(HIST); $('#resumo-hist').innerHTML = resumoHist(HIST); }
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
  ls.forEach((l, i) => { const estresse = l.afd > 0 && l.deficit >= l.afd; s += '<circle cx="' + x(i) + '" cy="' + y(l.deficit || 0) + '" r="' + (l.medicao ? 4.5 : estresse ? 4 : 2.5) + '" fill="' + (l.medicao ? '#fff' : estresse ? 'var(--red)' : 'var(--deficit)') + '" stroke="' + (estresse ? 'var(--red)' : 'var(--deficit)') + '" stroke-width="2"><title>' + dataBr(l.data) + ': déficit ' + br(l.deficit, 1) + ' mm · ' + esc(l.decisao) + (estresse ? ' · ESTRESSE' : '') + '</title></circle>'; });
  const passo = Math.max(1, Math.ceil(ls.length / 7));
  ls.forEach((l, i) => {
    const ult = i === ls.length - 1;
    if ((i % passo === 0 && ls.length - 1 - i >= passo / 2) || ult) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : ult ? 'end' : 'middle') + '">' + dataBr(l.data) + '</text>';
  });
  return s + '</svg>';
}
function tabelaHist(h) {
  const ls = h.linhas.slice().reverse(); if (!ls.length) return '';
  const mais = colsHist;
  return '<div class="tbl-wrap"><table><thead><tr><th>Dia</th>' + (mais ? '<th>DAS</th><th>Estádio</th><th>Kc</th><th>ET₀</th>' : '') + '<th>ETc</th><th>Chuva</th><th>Irrig.</th>' + (mais ? '<th>Raiz</th><th>CAD</th>' : '') + '<th>AFD</th><th>Déficit</th><th>% AFD</th><th>Decisão</th></tr></thead><tbody>' +
    ls.map((l) => { const pct = l.afd > 0 ? (l.deficit / l.afd) * 100 : 0, estresse = l.afd > 0 && l.deficit >= l.afd, alertas = (l.alertas || []).filter((a) => !/^(Só |Clima estimado)/.test(a));
      return '<tr' + (estresse ? ' class="estresse"' : '') + ' title="' + esc(alertas.join('\n')) + '"><td>' + dataBr(l.data) + (l.medicao ? ' 🌱' : '') + (alertas.length ? ' <span class="muted">⚠︎</span>' : '') + '</td>' +
      (mais ? '<td>' + esc(l.das == null ? '' : l.das) + '</td><td style="text-align:left">' + esc(l.estadio || '') + '</td><td>' + br(l.kc, 2) + '</td><td>' + br(l.et0, 1) + '</td>' : '') +
      '<td>' + br(l.etc, 1) + '</td><td>' + (l.chuva ? br(l.chuva, 1) : '·') + '</td><td>' + (l.irrigacao ? '<b>' + br(l.irrigacao, 1) + '</b>' : '·') + '</td>' +
      (mais ? '<td>' + br(l.raiz, 0) + '</td><td>' + br(l.cad, 0) + '</td>' : '') +
      '<td>' + br(l.afd, 0) + '</td><td><b>' + br(l.deficit, 1) + '</b></td><td><span class="pct-afd"><i style="width:' + Math.min(100, pct).toFixed(0) + '%"></i></span>' + br(pct, 0) + '%</td>' +
      '<td><span class="badge ' + classeDec(l.decisao) + '">' + esc(l.decisao === 'NÃO IRRIGAR' ? 'NÃO' : l.decisao === 'SEM DADOS' ? 'S/ DADOS' : l.decisao) + '</span></td></tr>'; }).join('') + '</tbody></table></div>' +
    '<p class="muted" style="margin-top:6px">🌱 dia com medição de umidade · ⚠︎ dia com alerta (passe o dedo/mouse pra ler) · linha vermelha = déficit passou da AFD (estresse).</p>';
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
  const cad = pivosCadastro();
  const res = pivosResumo();
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
  ['Identificação', ['fazenda', 'tipo', 'nome', 'ativo', 'cultura', 'cicloDias', 'grausDiaCiclo', 'plantio', 'inicioBalanco', 'palhada']],
  ['Solo e raiz', ['umidadeInicialPct', 'cc', 'pmp', 'raizIniCm', 'raizMaxCm', 'diasRaiz', 'fatorFixo', 'sensorSolo']],
  ['Decisão', ['laminaMinimaMm', 'tensaoIrrigarKpa']],
  ['Localização (mapa)', ['latitude', 'longitude', 'contorno']],
  ['Equipamento', ['fonte', 'raioM', 'anguloGraus', 'vazaoM3h', 'velocidadeUltimaTorreMMin', 'percentimetroMinPct', 'eficienciaPct', 'potenciaKw', 'tarifaRsKwh', 'tarifaPontaRsKwh']],
];
const simNao = (v) => v === true || /^(SIM|S|TRUE|1|X)$/i.test(String(v).trim());
V.pivos = function (arg) {
  if (!DADOS || !DADOS.cadastro) return semDados();
  const c = DADOS.cadastro;
  if (arg !== undefined) return formPivo(arg === 'novo' ? null : c.pivos[Number(arg)]);
  return pivosCadastro().map((p) => '<div class="card"><div class="row"><div><h2>' + (ehTalhao(p) ? ico('solo') + ' ' : '') + esc(p.nome) + (simNao(p.ativo) ? '' : ' <span class="muted">(inativo)</span>') + '</h2>' +
    '<div class="muted">' + (ehTalhao(p) ? 'Talhão' + (ehTalhaoSemBalanco(p) ? ' (só relatório do ciclo)' : '') + ' · ' : '') + esc(nomeCultura(p.cultura)) + (p.cicloDias ? ' (' + esc(p.cicloDias) + ' dias)' : '') + ' · plantio ' + esc(dataBrAno(String(p.plantio))) + (ehTalhao(p) ? '' : p.raioM ? ' · raio ' + br(p.raioM, 0) + ' m' : ' · sem equipamento') + (p.fonte ? ' · água do ' + esc(p.fonte) : '') + '</div></div>' +
    '<a class="btn btn-outline btn-sm" href="#/pivos/' + p.__i + '">' + (ehAdmin() ? 'Editar' : 'Ver') + '</a></div></div>').join('') +
    (ehAdmin() ? '<a class="btn btn-outline btn-block" href="#/pivos/novo">+ Nova área (pivô ou talhão)</a>' : '') +
    '<h2 style="margin:18px 0 8px">' + ico('agua') + ' Fontes de água (piscinões)</h2>' +
    (reservatoriosCadastro().length ? reservatoriosCadastro().map((r) => '<div class="card"><div class="row"><div><h2>' + esc(r.nome) + '</h2><div class="muted">útil ' + br(r.volumeUtilM3, 0) + ' m³ · bomba ' + br(r.bombaM3h, 0) + ' m³/h × ' + br(r.horasBombaDia, 0) + ' h/dia = ' + br(r.bombaM3h * r.horasBombaDia, 0) + ' m³/dia' +
      (r.reservaMinM3 ? ' · reserva ' + br(r.reservaMinM3, 0) + ' m³' : '') + '<br>abastece: ' + (pivosCadastro().filter((p) => String(p.fonte || '').toLowerCase() === r.nome.toLowerCase()).map((p) => esc(p.nome)).join(', ') || '<i>nenhum pivô ainda</i>') + '</div></div>' +
      '<a class="btn btn-outline btn-sm" href="#/piscinao/' + r.__i + '">' + (ehAdmin() ? 'Editar' : 'Ver') + '</a></div></div>').join('')
      : '<p class="muted">Nenhum piscinão. Pivô sem fonte cadastrada é abastecimento direto.</p>') +
    (ehAdmin() ? '<a class="btn btn-outline btn-block" href="#/piscinao/novo">+ Novo piscinão</a>' +
      '<div class="card" style="margin-top:14px"><h2>📂 Importar KMZ com os pivôs</h2><p class="muted" style="margin:4px 0 10px">Arquivo do Google Earth com um desenho por pivô. Eu caso o nome do desenho com o pivô e guardo o centro, o contorno e o raio.</p>' +
      '<label class="btn btn-outline">Escolher arquivo .kmz / .kml<input type="file" id="kmz-todos" accept=".kmz,.kml" hidden></label><div id="kmz-lista"></div></div>' : '<p class="muted">Só o administrador edita os pivôs.</p>');
};
V.pivos_depois_lista = function () {
  const inp = $('#kmz-todos'); if (!inp) return;
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const box = $('#kmz-lista'); box.innerHTML = '<p class="muted">Lendo…</p>';
    try {
      const des = await lerKml(f), pivos = pivosCadastro();
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
            dados.fazenda = p.fazenda || ''; dados.fazendaOriginal = p.fazenda || '';
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
/* ================= PISCINÃO (cadastro) ================= */
V.piscinao = function (arg) {
  if (!DADOS || !DADOS.cadastro) return semDados();
  const so = !ehAdmin();
  const r = arg === 'novo' || arg === undefined ? null : (DADOS.cadastro.reservatorios || [])[Number(arg)];
  if (arg !== 'novo' && arg !== undefined && !r) return '<div class="card vazio">Piscinão não encontrado. <a href="#/pivos">Voltar</a></div>';
  const fa = fazendaAtual(), fs = fazendas();
  const b = r || { nome: '', fazenda: fa ? fa.nome : '', volumeUtilM3: '', bombaM3h: '', horasBombaDia: '', reservaMinM3: '', obs: '' };
  const num = (k, rot, ph) => '<div><label for="r_' + k + '">' + rot + '</label><input inputmode="decimal" id="r_' + k + '" name="' + k + '" value="' + esc(b[k] === '' || b[k] == null ? '' : String(b[k]).replace('.', ',')) + '" placeholder="' + ph + '"' + (so ? ' disabled' : '') + '></div>';
  const usam = r ? pivosCadastro().filter((p) => String(p.fonte || '').toLowerCase() === r.nome.toLowerCase()).map((p) => p.nome) : [];
  return '<form class="card" id="f-res" data-original="' + esc(r ? r.nome : '') + '" data-fazenda-original="' + esc(r ? r.fazenda || '' : '') + '" autocomplete="off"><div class="row"><h2>' + (r ? esc(r.nome) : 'Novo piscinão') + '</h2><a class="btn btn-outline btn-sm" href="#/pivos">Voltar</a></div>' +
    '<p class="muted" style="margin:0 0 8px">Reservatório que abastece um ou mais pivôs. A planilha estima o volume de hoje a partir do nível lançado, somando a bomba e descontando o que os pivôs ligados a ele puxaram.</p>' +
    '<div class="grid2">' + (fs.length < 2 ? '<input type="hidden" name="fazenda" value="' + esc(b.fazenda || (fs[0] ? fs[0].nome : '')) + '">' : '<div><label for="r_fazenda">Fazenda</label><select id="r_fazenda" name="fazenda"' + (so ? ' disabled' : '') + '>' + fs.map((f) => '<option' + (f.nome === b.fazenda ? ' selected' : '') + '>' + esc(f.nome) + '</option>').join('') + '</select></div>') +
    '<div><label for="r_nome">Nome</label><input id="r_nome" name="nome" value="' + esc(b.nome) + '" placeholder="ex.: Piscinão 1" required' + (so ? ' disabled' : '') + '></div>' +
    num('volumeUtilM3', 'Volume útil (m³)', 'ex.: 20000') + num('reservaMinM3', 'Reserva mínima (m³)', 'ex.: 2000') +
    num('bombaM3h', 'Bomba de reposição (m³/h)', 'ex.: 200') + num('horasBombaDia', 'Horas de bomba por dia', 'ex.: 10') +
    '<div><label for="r_obs">Observação</label><input id="r_obs" name="obs" value="' + esc(b.obs || '') + '" placeholder="opcional"' + (so ? ' disabled' : '') + '></div></div>' +
    '<p class="muted" id="r-info" style="margin-top:8px"></p>' +
    (r ? '<p class="muted">Abastece: ' + (usam.length ? esc(usam.join(', ')) : '<i>nenhum pivô ainda</i>') + '. O link se faz no cadastro de cada pivô, em Equipamento → Fonte de água.</p>' : '') +
    (so ? '' : '<button class="btn btn-primary btn-block" type="submit">Salvar na planilha</button>' +
      (r && !usam.length ? '<button class="btn btn-danger btn-block" type="button" data-act="apagar-res" style="margin-top:8px">Apagar piscinão</button>' : '')) + '</form>';
};
V.piscinao_depois = function () {
  const f = $('#f-res'); if (!f) return;
  const info = () => { const v = numBR($('#r_bombaM3h', f).value) || 0, h = numBR($('#r_horasBombaDia', f).value) || 0, u = numBR($('#r_volumeUtilM3', f).value) || 0;
    $('#r-info', f).textContent = v && h ? 'Entram ' + br(v * h, 0) + ' m³ por dia' + (u ? ' · do vazio ao cheio em ' + br(u / (v * h), 1) + ' dias sem irrigar' : '') : 'Sem bomba cadastrada, o piscinão só esvazia.'; };
  ['#r_bombaM3h', '#r_horasBombaDia', '#r_volumeUtilM3'].forEach((q) => $(q, f).addEventListener('input', info)); info();
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {}; $$('[name]', f).forEach((el) => { dados[el.name] = el.value; });
    dados.fazendaOriginal = f.dataset.fazendaOriginal || '';
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const r = await chamar('POST', null, { __reservatorio: { dados, original: f.dataset.original || null } });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
      DADOS.cadastro = r.cadastro; if (r.recalculo && r.recalculo.resumo) DADOS.resumo = r.recalculo.resumo; DADOS.hash = ''; grava(DADOS_KEY, DADOS);
      toast('✅ Piscinão salvo.'); location.hash = '#/pivos'; puxar(true);
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Salvar na planilha'; }
  });
  const ap = $('[data-act="apagar-res"]', f);
  if (ap) ap.addEventListener('click', async () => {
    if (ap.dataset.confirma !== '1') { ap.dataset.confirma = '1'; ap.textContent = 'Toque de novo para confirmar'; return; }
    ap.disabled = true;
    try {
      const r = await chamar('POST', null, { __reservatorio: { apagar: true, nome: f.dataset.original, fazenda: f.dataset.fazendaOriginal } });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
      DADOS.cadastro = r.cadastro; if (r.recalculo && r.recalculo.resumo) DADOS.resumo = r.recalculo.resumo; DADOS.hash = ''; grava(DADOS_KEY, DADOS);
      toast('Piscinão apagado.'); location.hash = '#/pivos'; puxar(true);
    } catch (e) { toast(e.message, true); ap.disabled = false; }
  });
};
function campoPivo(k, rot, v, so) {
  const id = 'p_' + k, dis = so ? ' disabled' : '';
  if (k === 'ativo' || k === 'palhada') return '<div><label for="' + id + '">' + esc(rot.replace(' (SIM/NÃO)', '')) + '</label><select id="' + id + '" name="' + k + '"' + dis + '><option value="SIM"' + (simNao(v) ? ' selected' : '') + '>Sim</option><option value="NÃO"' + (simNao(v) ? '' : ' selected') + '>Não</option></select></div>';
  if (k === 'cultura') return '<div><label for="' + id + '">' + esc(rot) + '</label><select id="' + id + '" name="' + k + '"' + dis + '>' + culturas().map((c) => '<option value="' + esc(c.chave) + '"' + (String(v).toLowerCase().trim() === c.chave ? ' selected' : '') + '>' + esc(c.nome) + (c.cicloDias ? ' (' + c.cicloDias + ' dias)' : '') + '</option>').join('') + '</select></div>';
  if (k === 'cicloDias') { const c = cultura($('#p_cultura') ? $('#p_cultura').value : ''); return '<div><label for="' + id + '">' + esc(rot) + '</label><input inputmode="numeric" id="' + id + '" name="' + k + '" value="' + esc(v === '' || v == null ? '' : v) + '" placeholder="padrão' + (c && c.cicloDias ? ' ' + c.cicloDias : '') + '"' + dis + '></div>'; }
  if (k === 'plantio' || k === 'inicioBalanco') return '<div><label for="' + id + '">' + esc(rot) + '</label><input type="date" id="' + id + '" name="' + k + '" value="' + esc(v) + '"' + dis + '></div>';
  if (k === 'nome') return '<div><label for="' + id + '">' + esc(rot) + '</label><input id="' + id + '" name="' + k + '" value="' + esc(v) + '" required' + dis + '></div>';
  if (k === 'fazenda') { const fs = fazendas(); if (fs.length < 2) return '<input type="hidden" id="' + id + '" name="' + k + '" value="' + esc(v || (fs[0] ? fs[0].nome : '')) + '">';
    return '<div><label for="' + id + '">Fazenda</label><select id="' + id + '" name="' + k + '"' + dis + '>' + fs.map((f) => '<option' + (f.nome === v ? ' selected' : '') + '>' + esc(f.nome) + '</option>').join('') + '</select></div>'; }
  if (k === 'tipo') return '<div><label for="' + id + '">Tipo</label><select id="' + id + '" name="' + k + '"' + dis + '><option value="pivô"' + (/^t/i.test(String(v)) ? '' : ' selected') + '>Pivô (balanço e irrigação)</option><option value="talhão"' + (/^t/i.test(String(v)) ? ' selected' : '') + '>Talhão (sem pivô — relatório do ciclo)</option></select></div>';
  if (k === 'fonte') { const rs = ((DADOS.cadastro && DADOS.cadastro.reservatorios) || []); const fz = $('#p_fazenda') ? $('#p_fazenda').value : '';
    const meus = rs.filter((r) => !fz || r.fazenda === fz || rs.length === 0);
    return '<div><label for="' + id + '">Fonte de água</label><select id="' + id + '" name="' + k + '"' + dis + '><option value="">Abastecimento direto</option>' +
      meus.map((r) => '<option value="' + esc(r.nome) + '"' + (String(v || '').toLowerCase() === r.nome.toLowerCase() ? ' selected' : '') + '>' + esc(r.nome) + ' (piscinão)</option>').join('') +
      (v && !meus.some((r) => r.nome.toLowerCase() === String(v).toLowerCase()) ? '<option selected>' + esc(v) + '</option>' : '') + '</select></div>'; }
  if (k === 'contorno') return '<input type="hidden" id="' + id + '" name="' + k + '" value="' + esc(typeof v === 'string' ? v : v ? JSON.stringify(v) : '') + '">';
  return '<div><label for="' + id + '">' + esc(rot) + '</label><input inputmode="decimal" id="' + id + '" name="' + k + '" value="' + esc(v === '' || v == null ? '' : String(v).replace('.', ',')) + '"' + dis + '></div>';
}
function formPivo(p) {
  const so = !ehAdmin(); const rot = {}; DADOS.cadastro.colunas.forEach((c) => { rot[c[0]] = c[1]; });
  const cs = culturas();
  const fa = fazendaAtual();
  const base = p || { ativo: 'SIM', cultura: cs.length ? cs[0].chave : '', palhada: 'SIM', tensaoIrrigarKpa: -70, laminaMinimaMm: 5, anguloGraus: 360, eficienciaPct: 85, percentimetroMinPct: 10, tipo: 'pivô', fazenda: fa ? fa.nome : '' };
  return '<form class="card" id="f-pivo" data-original="' + esc(p ? p.nome : '') + '" data-fazenda-original="' + esc(p ? p.fazenda || '' : '') + '" autocomplete="off"><div class="row"><h2>' + (p ? esc(p.nome) : 'Nova área') + '</h2><a class="btn btn-outline btn-sm" href="#/pivos">Voltar</a></div>' +
    '<p class="muted" id="tipo-info" style="margin:0 0 4px"></p>' +
    GRUPOS.map((g) => '<fieldset data-grupo="' + esc(g[0]) + '"><legend>' + esc(g[0]) + '</legend><div class="grid2">' + g[1].map((k) => campoPivo(k, rot[k] || k, base[k] == null ? '' : base[k], so)).join('') + '</div>' +
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
  // talhão: esconde equipamento e decisão; solo fica opcional (vazio = só o relatório do ciclo)
  const tipoEl = $('#p_tipo', f);
  const ajustarTipo = () => {
    const talhao = tipoEl && /^t/i.test(tipoEl.value);
    ['Decisão', 'Equipamento'].forEach((g) => { const fs = f.querySelector('fieldset[data-grupo="' + g + '"]'); if (fs) fs.hidden = !!talhao; });
    const info = $('#tipo-info', f);
    if (info) info.textContent = talhao ? 'Talhão sem pivô: cultura e plantio bastam pro relatório do ciclo (graus-dia, luz, chuva). Preencha o solo só se quiser o balanço hídrico.' : '';
  };
  if (tipoEl) { tipoEl.addEventListener('change', ajustarTipo); ajustarTipo(); }
  // trocou a fazenda: a lista de piscinões é a da fazenda nova
  const fazEl = $('#p_fazenda', f), fonteEl = $('#p_fonte', f);
  if (fazEl && fonteEl && fazEl.tagName === 'SELECT') fazEl.addEventListener('change', () => { fonteEl.parentElement.outerHTML = campoPivo('fonte', 'Fonte de água', '', !ehAdmin()); });
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
    dados.fazendaOriginal = f.dataset.fazendaOriginal || '';
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
    '<div class="card"><h2>Aparência</h2><div class="seg seg-3" role="tablist" style="margin-top:10px">' + [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']].map((t) => '<button type="button" data-act="tema" data-tema="' + t[0] + '" class="' + (temaAtual() === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div><p class="muted">Automático segue o ajuste do celular (escuro à noite).</p></div>' +
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
    (fazendas().length > 1 ? '<div><label for="u-faz">Fazendas que vê (vazio = todas)</label><select id="u-faz" multiple size="' + Math.min(4, fazendas().length) + '">' + fazendas().map((fz) => '<option value="' + esc(fz.nome) + '">' + esc(fz.nome) + '</option>').join('') + '</select></div>' : '') +
    '<div><label for="u-pin">PIN (4 a 6 números)</label><input id="u-pin" type="password" inputmode="numeric"></div></div>' +
    '<button class="btn btn-primary btn-block" type="submit">Salvar usuário</button></form></div>' +
    '<div class="card"><h2>Usuários</h2><ul class="lista" id="l-users" style="margin-top:6px"><li class="vazio">Carregando…</li></ul></div>';
};
V.usuarios_depois = async function () {
  if (!ehAdmin()) return;
  const desenhar = () => {
    $('#l-users').innerHTML = (USUARIOS || []).map((u) => '<li><div class="t"><b>' + esc(u.nome) + '</b> · ' + esc(u.login) + '<div class="muted">' + (u.perfil === 'ADMIN' ? 'Administrador' : 'Operador') + (u.ativo ? '' : ' · inativo') + (u.temPin ? '' : ' · sem PIN') + (u.fazendas && u.fazendas.length ? ' · ' + esc(u.fazendas.join(', ')) : fazendas().length > 1 ? ' · todas as fazendas' : '') + '</div></div>' +
      '<span class="toolbar" style="margin:0"><button class="btn btn-outline btn-sm" data-act="user-editar" data-login="' + esc(u.login) + '">Editar</button><button class="btn btn-danger btn-sm" data-act="user-excluir" data-login="' + esc(u.login) + '">Excluir</button></span></li>').join('') || '<li class="vazio">Nenhum.</li>';
  };
  $('#f-user').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const salvar = { nome: $('#u-nome').value, login: $('#u-login').value, perfil: $('#u-perfil').value, ativo: $('#u-ativo').value };
    if ($('#u-faz')) salvar.fazendas = Array.from($('#u-faz').selectedOptions).map((o) => o.value);
    if ($('#u-pin').value) salvar.pin = $('#u-pin').value;
    try { const r = await chamar('POST', null, { __usuario: { salvar } }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); USUARIOS = r.usuarios; desenhar(); ev.target.reset(); toast('Usuário salvo.'); }
    catch (e) { toast(e.message, true); }
  });
  try { const r = await chamar('GET', { acao: 'usuarios' }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); USUARIOS = r.usuarios; desenhar(); }
  catch (e) { $('#l-users').innerHTML = '<li class="vazio">' + esc(e.message) + '</li>'; }
};

function temaAtual() { try { return localStorage.getItem('irrigacao_tema') || 'claro'; } catch (e) { return 'claro'; } }
function aplicarTema(t) { try { localStorage.setItem('irrigacao_tema', t); } catch (e) { /* sem espaço */ } document.documentElement.dataset.tema = t; }

/* ================= ações (data-act) ================= */
document.addEventListener('click', async (ev) => {
  const go = ev.target.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
  const a = ev.target.closest('[data-act]'); if (!a || a.tagName === 'SELECT') return;
  const act = a.dataset.act;
  if (act === 'tipo') { tipoLanc = a.dataset.tipo; route({ manterRolagem: true }); }
  else if (act === 'lancar-nivel') { tipoLanc = 'nivel'; }
  else if (act === 'modo-lanc') { modoLanc = a.dataset.modo; route({ manterRolagem: true }); }
  else if (act === 'tema') { aplicarTema(a.dataset.tema); route({ manterRolagem: true }); }
  else if (act === 'rosa-periodo') rosaPeriodo($('#r-de').value, $('#r-ate').value);
  else if (act === 'rosa-24h') { ROSA = null; route({ manterRolagem: true }); }
  else if (act === 'hist-csv') { if (HIST) csvHist(HIST); }
  else if (act === 'pdf') {
    a.disabled = true; const antes = a.innerHTML; a.textContent = 'Gerando…';
    try {
      const r = await chamar('GET', { acao: 'pdf', fazenda: chaveAtual() });
      if (!r || !r.ok) throw new Error((r && r.erro) || 'A planilha não respondeu.');
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)), blob = new Blob([bin], { type: 'application/pdf' }), url = URL.createObjectURL(blob);
      const l = document.createElement('a'); l.href = url; l.download = r.nome; document.body.appendChild(l); l.click();
      setTimeout(() => { URL.revokeObjectURL(url); l.remove(); }, 2000);
      toast('📄 ' + r.nome + ' pronto. Também está na pasta RELATORIOS do Drive.');
    } catch (e) { toast(e.message, true); }
    a.disabled = false; a.innerHTML = antes;
  }
  else if (act === 'hist-cols') { colsHist = !colsHist; if (HIST) { $('#tab-hist').innerHTML = tabelaHist(HIST); $('#resumo-hist').innerHTML = resumoHist(HIST); } }
  else if (act === 'recalcular') {
    a.disabled = true; a.textContent = 'Recalculando…';
    try { const r = await chamar('POST', null, { __recalcular: {} }); if (!r || !r.ok) throw new Error((r && r.erro) || 'erro'); if (r.aviso) toast(r.aviso, true); else toast('Recalculado.'); await puxar(true); }
    catch (e) { toast(e.message, true); a.disabled = false; a.innerHTML = ico('refresh') + ' Recalcular'; }
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
    if ($('#u-faz')) Array.from($('#u-faz').options).forEach((o) => { o.selected = (u.fazendas || []).some((c) => c === o.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()); });
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

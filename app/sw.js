/* Service worker do Manejo de Irrigação — REDE PRIMEIRO, COM CÓPIA GUARDADA.
   Com internet boa, todo arquivo vem da rede (sempre a versão publicada mais nova) e uma cópia fica no
   aparelho. Com sinal fraco (mais de 4 s) ou sem internet, o app abre na hora com a cópia guardada e os dados
   do localStorage. A planilha (script.google.com) e os serviços de previsão passam direto, sem cache. */
const VERSAO = 'cache-v4';   // mudar este texto força os aparelhos a trocarem o worker
const CACHE = 'manejo-' + VERSAO;
const SHELL = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icon.svg'];
const TEMPO_REDE_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      await Promise.all(SHELL.map(async (u) => { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) await c.put(u, r); } catch (err) {} }));
    } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))); } catch (err) {}
    await self.clients.claim();
  })());
});

function paginaOffline() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sem internet</title><body style="font-family:system-ui,sans-serif;padding:32px;text-align:center;color:#16404d">' +
    '<h2>📴 Sem internet</h2><p>Ainda não há uma cópia do app neste aparelho.<br>Conecte-se uma vez e toque em recarregar.</p>' +
    '<p><button onclick="location.reload()" style="font-size:16px;padding:10px 18px;border-radius:10px;border:0;background:#16404d;color:#fff">↻ Recarregar</button></p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Rede com limite de tempo; se vier, guarda a cópia. Senão, a cópia guardada. */
async function redePrimeiro(req) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEMPO_REDE_MS);
  try {
    const r = await fetch(req, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (r && r.ok) { try { const c = await caches.open(CACHE); await c.put(req, r.clone()); } catch (err) {} }
    return r;
  } catch (err) {
    clearTimeout(timer);
    const guardada = await caches.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
      return (await caches.match('./index.html')) || paginaOffline();
    }
    return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // planilha, Open-Meteo, INMET e mapas passam direto
  e.respondWith(redePrimeiro(req));
});

// toque na notificação: abre (ou traz pra frente) o app na tela Hoje
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './#/hoje';
  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of lista) { if ('focus' in c) { try { await c.navigate(url); } catch (err) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});

/* ---- Web Push: a planilha manda um push vazio; aqui buscamos o alerta do dia e mostramos ---- */
function idbExec() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('manejo-irrigacao', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('cfg'); };
      req.onerror = () => resolve('');
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('cfg', 'readonly'), g = tx.objectStore('cfg').get('exec');
          g.onsuccess = () => resolve(g.result || ''); g.onerror = () => resolve('');
        } catch (e) { resolve(''); }
      };
    } catch (e) { resolve(''); }
  });
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let titulo = '💧 Manejo de irrigação', corpo = 'Abra o app para ver o manejo de hoje.', tag = 'manejo', url = './#/hoje';
    try {
      const exec = await idbExec();
      const sub = await self.registration.pushManager.getSubscription();
      if (exec && sub) {
        const r = await fetch(exec + '?acao=alerta&endpoint=' + encodeURIComponent(sub.endpoint), { cache: 'no-store' });
        const j = await r.json();
        if (j && j.ok && j.titulo) { titulo = j.titulo; corpo = j.corpo || ''; tag = j.tag || tag; }
      }
    } catch (err) { /* mostra o aviso genérico */ }
    await self.registration.showNotification(titulo, { body: corpo, tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url } });
  })());
});
// o serviço de push trocou a inscrição: o app refaz na próxima abertura (o service worker não tem a sessão)
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'reinscrever' }))));
});

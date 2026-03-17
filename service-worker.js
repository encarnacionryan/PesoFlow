/* ══════════════════════════════════════════
   service-worker.js  –  PesoFlow PWA cache
   ══════════════════════════════════════════ */

const CACHE_NAME = 'pesoflow-v2';

const ASSETS = [
  '/pesoflow/',
  '/pesoflow/index.html',
  '/pesoflow/style.css',
  '/pesoflow/app.js',
  '/pesoflow/db.js',
  '/pesoflow/manifest.json',
  '/pesoflow/icons/icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

/* ── Install: pre-cache all assets ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
    .then(cache => cache.addAll(ASSETS))
    .then(() => self.skipWaiting())
  );
});

/* ── Activate: remove old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for local, network-first for CDN ── */
self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  /* CDN: network first, fall back to cache */
  if (url.includes('cdnjs.cloudflare.com')) {
    e.respondWith(
      fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
    );
    return;
  }
  
  /* Local assets: cache first */
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});

/* ── Push notifications (required for App Capabilities score) ── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.text() : 'PesoFlow update';
  e.waitUntil(
    self.registration.showNotification('PesoFlow Tracker', {
      body: data,
      icon: '/pesoflow/icons/icon.png'
    })
  );
});

/* ── Background sync stub ── */
self.addEventListener('sync', e => {
  console.log('Background sync:', e.tag);
});
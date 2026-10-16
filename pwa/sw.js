// Service worker: carcasa de la app disponible sin conexión. Nunca cachea datos del buzón (Supabase ni MCP).
const C = 'buzon-v5';
const CASCARA = ['./', 'index.html', 'app.js', 'config.js', 'guias.js', 'estilo.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/supabase.js', 'offline.html', 'privacidad.html', 'terminos.html'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(CASCARA)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  // Red primero (para tener siempre lo último) y, si falla, la última copia; si no hay copia, pantalla "sin conexión".
  e.respondWith((async () => {
    const cache = await caches.open(C);
    try {
      const resp = await fetch(r);
      if (resp.ok) cache.put(r, resp.clone());
      return resp;
    } catch {
      const enCache = await cache.match(r, { ignoreSearch: true }) || (r.mode === 'navigate' && await cache.match('index.html'));
      if (enCache) return enCache;
      if (r.mode === 'navigate') return (await cache.match('offline.html')) || new Response('Sin conexión', { status: 503 });
      return new Response('', { status: 503 });
    }
  })());
});

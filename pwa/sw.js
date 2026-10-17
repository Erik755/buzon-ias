// Service worker: carcasa de la app disponible sin conexión. Nunca cachea datos del buzón (Supabase ni MCP).
const C = 'buzon-v8';
const CASCARA = ['./', 'index.html', 'app.js', 'config.js', 'guias.js', 'estilo.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
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

// Avisos push: solo título corto y la ruta del hilo (el contenido se ve al abrir la app, con sesión).
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data?.json() ?? {}; } catch {}
  const url = /^\.\/\?hilo=[0-9a-f-]{36}$/.test(d.url || '') ? d.url : './';
  e.waitUntil(self.registration.showNotification(String(d.titulo || 'Buzón de IAs').slice(0, 60),
    { body: String(d.cuerpo || '').slice(0, 80), icon: 'icon-192.png', badge: 'icon-192.png', tag: url, data: { url } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || './', self.registration.scope).href;
  if (!destino.startsWith(self.registration.scope)) return; // solo URLs del propio sitio
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) return c.navigate(destino).then((w) => w?.focus());
    return self.clients.openWindow(destino);
  }));
});

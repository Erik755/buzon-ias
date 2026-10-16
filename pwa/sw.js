// Service worker: solo cachea la carcasa estática; nunca datos del buzón.
const C = 'buzon-v4', CASCARA = ['./', 'index.html', 'app.js', 'estilo.css', 'manifest.webmanifest', 'icon.svg', 'vendor/supabase.js', 'guias.js', 'privacidad.html', 'terminos.html'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(CASCARA))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('config.js')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});

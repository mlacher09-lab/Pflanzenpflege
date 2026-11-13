// Service Worker: App-Shell offline verfügbar machen, API-Aufrufe immer ans Netz.
const VERSION = 'pfl-v2.2.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './css/fonts.css', './impressum.html', './datenschutz.html',
  './js/app.js', './js/api.js', './js/analytics.js', './js/plants-db.js', './js/plants-more.js', './js/store.js', './js/util.js', './js/scan.js', './js/finder.js', './js/wishlist.js',
  './fonts/dmsans-400-latin.woff2', './fonts/dmsans-500-latin.woff2', './fonts/dmsans-600-latin.woff2', './fonts/playfairdisplay-400-latin.woff2', './fonts/playfairdisplay-600-latin.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;                     // KI-Server: nie cachen
  if (url.origin !== self.location.origin) {                      // Schriften: cache, dann Netz
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => hit)));
    return;
  }
  // Eigene Dateien: Netz zuerst (damit Updates ankommen), sonst Cache; Navigation fällt auf index.html zurück
  e.respondWith(fetch(req).then(res => {
    if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});

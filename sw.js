// Offline support. Network first, so a new version shows up on the next
// load; when the network is slow or missing, the cached copy is used.
// Every app file is cached at install, so the app opens offline after one
// visit. tests/pwa.test.mjs checks that APP_FILES lists every app file.
const CACHE = 'novaplus-v2';
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/ble.js',
  'js/main.js',
  'js/runner.js',
  'js/store.js',
  'js/core/devices.js',
  'js/core/drills.js',
  'js/core/halo.js',
  'js/core/md5.js',
  'js/core/physics.js',
  'js/core/protocol.js',
  'js/core/scheduler.js',
  'js/core/timing.js',
  'js/core/variation.js',
  'js/ui/controls.js',
  'js/ui/dom.js',
  'js/ui/labels.js',
  'js/ui/trajectory.js',
  'js/ui/screens/ball.js',
  'js/ui/screens/combo.js',
  'js/ui/screens/drills.js',
  'js/ui/screens/head.js',
  'js/ui/screens/position.js',
  'js/ui/screens/prep.js',
  'js/ui/screens/serving.js',
  'js/ui/screens/settings.js',
  'assets/fonts/BaiJamjuree-Bold.ttf',
  'assets/fonts/BaiJamjuree-Medium.ttf',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon.svg',
  'assets/icons/maskable-512.png',
  'assets/img/halo-position-1.svg',
  'assets/img/halo-position-2.svg',
  'assets/img/halo-position-3.svg',
  'assets/img/nova-head.svg',
];

self.addEventListener('install', event => {
  // `reload` skips the HTTP cache, so the install never stores stale files.
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  // There is one page; any navigation (index.html, `?mock`, …) maps to it.
  const page = req.mode === 'navigate';
  const key = page ? new URL('./', location).href : req;
  const cached = () => cache.match(key);
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  // Keep the refresh going after a timeout, so the cache still updates.
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  return (await cached()) ?? network;
}

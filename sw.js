// Offline support: network first so updates arrive on the next load, cache as the fallback offline.
// Only same-origin GETs are cached; nothing the user enters ever reaches the network here.

const CACHE = 'evenly-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-maskable.svg', 'css/app.css',
  'js/main.js', 'js/app/app.js', 'js/app/store.js',
  'js/core/money.js', 'js/core/split.js', 'js/core/ledger.js', 'js/core/balances.js', 'js/core/recurring.js', 'js/core/receipt.js',
  'js/sync/codec.js', 'js/sync/links.js', 'js/sync/peer.js',
  'js/ui/dom.js', 'js/ui/motion.js', 'js/ui/nav.js', 'js/ui/sheet.js', 'js/ui/kit.js', 'js/ui/menu.js', 'js/ui/swipe.js',
  'js/screens/home.js', 'js/screens/group.js', 'js/screens/expense.js', 'js/screens/settle.js', 'js/screens/sync.js', 'js/screens/account.js', 'js/screens/describe.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('index.html'));
      }
    }),
  );
});

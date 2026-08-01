/* REIS Norge – service worker
   Strategi:
     app-skall  → stale-while-revalidate (rask start, oppdaterer i bakgrunnen)
     navigasjon → network-first med fallback til cachet index.html (dyplenker + offline)
     kartfliser → cache-first med tak på antall fliser
     API-er     → network-first med cachet fallback (tunnel/dårlig dekning)
*/
const VERSION = 'v5.1.0';
const SHELL_CACHE = `reis-shell-${VERSION}`;
const TILE_CACHE = `reis-tiles-${VERSION}`;
const DATA_CACHE = `reis-data-${VERSION}`;
const TILE_LIMIT = 600;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon.svg',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

const isTile = (u) =>
  /basemaps\.cartocdn|tile\.openstreetmap|server\.arcgisonline\.com|cache\.kartverket\.no/.test(u.host);

const isData = (u) =>
  /entur|wikipedia|wikimedia|overpass|open-meteo|urbansharing|oslobysykkel|gbfs/.test(u.host);

const isAsset = (u) =>
  /unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(u.host);

/* ------------------------------------------------------------------ install */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(async (c) => {
      // addAll feiler alt om én fil mangler – legg til hver for seg i stedet.
      await Promise.all(
        SHELL.map((url) =>
          c.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      /* Ikke ta over automatisk. Er en side allerede åpen, ville den fortsatt
         kjørt GAMMEL HTML mens en ny service worker serverte nye filer – det
         var derfor appen måtte lukkes og åpnes for at endringer skulle virke.
         Nå venter vi til brukeren sier fra (SKIP_WAITING). Er ingen side åpen
         fra før, tar vi over med én gang. */
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      if (clients.length === 0) await self.skipWaiting();
    })
  );
});

/* ----------------------------------------------------------------- activate */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, TILE_CACHE, DATA_CACHE];
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

/* -------------------------------------------------------------- meldinger */
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CLEAR_CACHES') {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  }
});

/* ------------------------------------------------------------------- hjelp */
async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

async function cacheFirst(req, cacheName, limit) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      c.put(req, res.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

/* ------------------------------------------------------------------- fetch */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1) Sidenavigasjon – alltid ende opp med noe brukbart
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const preload = await e.preloadResponse;
          if (preload) return preload;
          return await fetch(req);
        } catch (err) {
          const c = await caches.open(SHELL_CACHE);
          return (
            (await c.match('./index.html')) ||
            (await c.match('./')) ||
            new Response(
              '<meta charset="utf-8"><h1>Offline</h1><p>REIS er offline. Prøv igjen når du har nett.</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          );
        }
      })()
    );
    return;
  }

  // 2) Kartfliser
  if (isTile(url)) {
    e.respondWith(cacheFirst(req, TILE_CACHE, TILE_LIMIT));
    return;
  }

  // 3) Sanntids-API-er – ferskt først
  if (isData(url)) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // 4) Skrifter og bibliotek fra CDN
  if (isAsset(url)) {
    e.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // 5) Egne filer
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  }
});

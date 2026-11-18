// CHRONOS service worker: makes the app work offline.
//
// This is a template. At build time, the plugin in vite.config.ts fills in the
// cache version and the list of built files, and writes the result to dist/sw.js.
// Each build gets a new version, so browsers pick up updates automatically.

const CACHE_PREFIX = 'chronos-';
const CACHE = `${CACHE_PREFIX}__CACHE_VERSION__`;
const PRECACHE_URLS = ['__PRECACHE_URLS__'];

// Match by URL alone. Some servers send `Vary: Origin`, and module scripts are requested
// with an Origin header that the install-time fetch didn't have, so a strict match would
// miss and the app would fail to load offline. Safe here: every cached file is our own,
// and asset names change whenever their content does.
const MATCH = { cacheName: CACHE, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' bypasses the HTTP cache, so we never store a stale index.html
      // that points at files from an older build.
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Page loads: network first, so a new version shows up on the next visit;
  // fall back to the cached app when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./', copy)));
          }
          return response;
        })
        .catch(() => caches.match('./', MATCH).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Build files have content hashes in their names and never change: cache first.
  event.respondWith(caches.match(request, MATCH).then((cached) => cached || fetch(request)));
});

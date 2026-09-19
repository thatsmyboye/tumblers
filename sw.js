/**
 * Offline support. Network first, so nothing is ever stale while online; the
 * cache only answers when the network cannot.
 */

const CACHE = 'tumblers-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './icon.svg',
  './manifest.webmanifest',
  './src/app.js',
  './src/board.js',
  './src/daily.js',
  './src/engine.js',
  './src/game.js',
  './src/generator.js',
  './src/lockcode.js',
  './src/rng.js',
  './src/score.js',
  './src/solver.js',
  './src/storage.js',
  './src/words.js',
  './data/valid5.txt',
  './data/answers5.txt',
  './data/dailies.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});

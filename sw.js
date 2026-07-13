/*
  ARC — service worker
  Fa da cache per i file del gioco (non per Matter.js/i font, che restano su
  CDN esterno e passano alla rete normale). Cambia CACHE_NAME ad ogni
  aggiornamento importante dei file, cosi i visitatori ricevono la versione
  nuova invece di restare bloccati su quella vecchia in cache.
*/

const CACHE_NAME = "arc-game-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=11",
  "./js/audio.js?v=11",
  "./js/achievements.js?v=11",
  "./js/levels.js?v=11",
  "./js/mylevels.js?v=11",
  "./js/game.js?v=11",
  "./js/editor.js?v=11",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {
        /* se qualche asset non si riesce a precaricare, il gioco funziona comunque online */
      })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // mette in cache anche le richieste non previste inizialmente (stesso dominio)
          if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

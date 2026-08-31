/**
 * Service worker publicznego feedu.
 *
 * Wersje podnosimy przy kazdej zmianie strategii cache. Nazwy plikow aplikacji
 * sa hashowane przez build, wiec nie da sie ich wymienic w statycznej liscie -
 * zamiast tego cache'ujemy je dopiero w czasie dzialania (sa niezmienne, wiec
 * cache-first jest bezpieczny i nie zwroci nieaktualnej wersji).
 */
const CACHE = "telegram-feed-v16";

// Powloka: tylko adresy o stalych nazwach. Reszta wchodzi do cache w runtime.
const SHELL = ["/feed", "/manifest.webmanifest", "/telegram-icon.svg"];

const offlineFeedResponse = () =>
  new Response(JSON.stringify({ items: [], offline: true }), {
    headers: { "content-type": "application/json" },
  });

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Zapisuje odpowiedz w cache tylko gdy jest poprawna - inaczej utrwalilibysmy blad. */
async function cachePut(request, response) {
  if (!response.ok) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

/** Najpierw siec, cache jako zapas offline. Dla stron i danych redakcyjnych. */
async function networkFirst(request, offlineFallback) {
  try {
    const response = await fetch(request);
    void cachePut(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback();
  }
}

/** Najpierw cache, siec jako uzupelnienie. Dla zasobow niezmiennych. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  void cachePut(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dane redakcyjne: zawsze swieze, a offline pusty feed zamiast bledu.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, offlineFeedResponse));
    return;
  }

  // Nawigacje i strony materialow: nie pokazujemy starej wersji wydania.
  if (request.mode === "navigate" || url.pathname.startsWith("/a/")) {
    const feedFallback = async () => (await caches.match("/feed")) ?? Response.error();
    event.respondWith(networkFirst(request, feedFallback));
    return;
  }

  // Zasoby z hashem w nazwie oraz obrazki z proxy sa niezmienne.
  event.respondWith(cacheFirst(request));
});

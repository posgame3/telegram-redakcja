import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "./src/sources.mjs";
import { synchronize } from "./src/aggregator.mjs";
import { generateEditorialPackage, validateContextOriginality, validateEditorialMetadata, validateOriginality } from "./src/generator.mjs";
import { EditorialStore } from "./src/store.mjs";
import { ImageProxy, ImageProxyError } from "./src/image-proxy.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const listenHost = process.env.HOST || "127.0.0.1";
const cacheTtlMs = 2 * 60 * 1000;
const syncIntervalMinutes = Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES || 15));
// Zakres przegladanych wiadomosci: domyslnie 48 godzin, czyli dwa dni.
const windowHours = Math.max(1, Number(process.env.EVENT_WINDOW_HOURS || 48));
const feedLimit = Math.max(1, Number(process.env.FEED_ITEM_LIMIT || 25));
const maxGroups = Math.max(1, Number(process.env.MAX_GROUPS || 20));
const autoSyncEnabled = process.env.AUTO_SYNC !== "false";
const adminUser = process.env.ADMIN_USER || "redakcja";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const dataFile = process.env.TELEGRAM_DATA_FILE || path.join(path.dirname(root), ".telegram-redakcja-data", "editorial-state.json");
const configuredHosts = String(process.env.ALLOWED_HOSTS || "").split(",").map((value) => value.trim()).filter(Boolean);
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...configuredHosts]);
const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(listenHost);
const trustProxy = process.env.TRUST_PROXY === "true";
const trustedProxyIps = new Set(String(process.env.TRUSTED_PROXY_IPS || "").split(",").map((value) => value.trim()).filter(Boolean));
const requiresProxyHttps = !isLoopback || trustProxy;
const store = await new EditorialStore(dataFile).init();
const imageCacheDir = process.env.IMAGE_CACHE_DIR || path.join(root, "state", "image-cache");
const imageProxy = new ImageProxy(imageCacheDir);
let syncCache = null;
let syncPromise = null;
// Blokada na czas generowania: chroni przed podwojnym kliknieciem, ktore
// oznaczaloby dwa wywolania modelu dla tego samego materialu.
const regenerating = new Set();
// Limit ocen w pamieci procesu: okno 10 minut, 60 zapytan na adres.
// Trzymamy tylko licznik i czas, bez zadnego trwalego zapisu adresu.
const REACTION_WINDOW_MS = 10 * 60 * 1000;
const REACTION_LIMIT = 60;
const REACTION_CLIENTS_MAX = 5_000;
const reactionHits = new Map();

function allowReaction(client) {
  const now = Date.now();
  for (const [key, entry] of reactionHits) if (entry.resetAt <= now) reactionHits.delete(key);
  if (reactionHits.size > REACTION_CLIENTS_MAX) return false;
  const entry = reactionHits.get(client);
  if (!entry) {
    reactionHits.set(client, { count: 1, resetAt: now + REACTION_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= REACTION_LIMIT;
}
let schedulerTimer = null;
let lastSchedulerError = null;

if (requiresProxyHttps && (!adminPassword || configuredHosts.length === 0 || !trustProxy || trustedProxyIps.size === 0)) {
  throw new Error("Publiczne uruchomienie wymaga ADMIN_PASSWORD, ALLOWED_HOSTS, TRUST_PROXY=true oraz TRUSTED_PROXY_IPS.");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
const staticFiles = new Map([
  ["/", "index.html"], ["/admin", "index.html"], ["/index.html", "index.html"],
  ["/app.js", "app.js"], ["/styles.css", "styles.css"],
  ["/feed", "feed.html"], ["/feed.html", "feed.html"], ["/feed.js", "feed.js"], ["/feed.css", "feed.css"],
  ["/manifest.webmanifest", "manifest.webmanifest"], ["/sw.js", "sw.js"], ["/telegram-icon.svg", "telegram-icon.svg"],
]);
const categories = new Set(["kraj", "biznes", "gospodarka", "geopolityka", "rynki", "świat", "technologia", "inne"]);

function sendJson(response, status, body, cacheControl = "no-store") {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl, "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Tresc pochodzi od modelu i od wydawcow, wiec kazde wstawienie jest escapowane.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character]);
}

function httpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

// Adres obrazka wyswietlany klientowi zawsze prowadzi do wlasnego proxy,
// nigdy do oryginalnego serwera wydawcy: przegladarka nie laczy sie wtedy
// z cudzym CDN (koniec z hotlink-blockami) i dostaje lzejszy plik WebP.
function proxiedImageUrl(url, variant = "full") {
  if (!httpsUrl(url)) return "";
  return `/img?u=${encodeURIComponent(url)}&v=${variant}`;
}

function publicUrl(value, base) {
  try {
    const parsed = new URL(value, base);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'none'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
  });
  response.end(html);
}

function articlePage(publication, base) {
  const canonical = `${base}/a/${encodeURIComponent(publication.id)}`;
  const headline = publication.level1 || publication.title || "Telegram";
  const originalImage = httpsUrl(publication.image?.url);
  const image = originalImage ? `${base}${proxiedImageUrl(originalImage)}` : "";
  const published = publication.publishedAt || publication.updatedAt || "";
  const sources = (publication.sources || [])
    .map((source) => {
      const href = publicUrl(source.url, base);
      if (!href) return "";
      return `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(source.title)}</a><small>${escapeHtml(source.domain)} · ${escapeHtml(source.time)}</small></li>`;
    })
    .filter(Boolean)
    .join("");
  const media = image
    ? `<figure class="article-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(publication.image.alt || headline)}" referrerpolicy="no-referrer">${publication.image.credit ? `<figcaption>Fot. ${escapeHtml(publication.image.credit)}</figcaption>` : ""}</figure>`
    : "";

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1c1a16">
<title>${escapeHtml(headline.slice(0, 90))} — Telegram</title>
<meta name="description" content="${escapeHtml(headline)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:site_name" content="Telegram">
<meta property="og:type" content="article">
<meta property="og:locale" content="pl_PL">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(headline)}">
<meta property="og:description" content="${escapeHtml(publication.level2 || headline)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
${published ? `<meta property="article:published_time" content="${escapeHtml(published)}">` : ""}
<meta property="article:section" content="${escapeHtml(publication.category || "inne")}">
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(headline)}">
<meta name="twitter:description" content="${escapeHtml(publication.level2 || headline)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
<link rel="icon" href="/telegram-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/feed.css">
</head>
<body class="article-page">
<header class="masthead">
  <a class="masthead-title" href="/feed"><span>Telegram</span></a>
</header>
<main class="article">
  <p class="article-kicker"><span>${escapeHtml(publication.category || "inne")}</span><time>${escapeHtml(new Date(published).toLocaleString("pl-PL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}</time></p>
  ${media}
  <h1>${escapeHtml(headline)}</h1>
  ${publication.level2 ? `<p class="article-context">${escapeHtml(publication.level2)}</p>` : ""}
  <section aria-labelledby="zrodla">
    <div class="reader-sources-head"><span id="zrodla">Źródła materiału</span><span>${escapeHtml(String(publication.sourceCount || 0))}</span></div>
    <ol class="reader-sources">${sources}</ol>
    <p class="reader-sources-note">Materiał powstał z co najmniej dwóch niezależnych publikacji i został zatwierdzony przez redaktora. Odnośniki prowadzą do oryginałów.</p>
  </section>
  <a class="article-cta" href="/feed#${escapeHtml(encodeURIComponent(publication.id))}">Otwórz w aplikacji Telegram</a>
</main>
<footer class="colophon"><span>Telegram · synteza wieloźródłowa</span><span>Każdy materiał zatwierdzony przez redaktora</span></footer>
</body>
</html>`;
}

function articleMissingPage(base) {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nie znaleziono materiału — Telegram</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/feed.css">
</head>
<body class="article-page">
<header class="masthead"><a class="masthead-title" href="/feed"><span>Telegram</span></a></header>
<main class="article">
  <h1>Nie znaleziono materiału</h1>
  <p class="article-context">Ten telegram nie jest opublikowany albo został wycofany przez redakcję.</p>
  <a class="article-cta" href="${escapeHtml(`${base}/feed`)}">Przejdź do wydania</a>
</main>
</body>
</html>`;
}

function sendUnauthorized(response) {
  response.writeHead(401, { "www-authenticate": "Basic realm=\"Telegram Redakcja\", charset=\"UTF-8\"", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: "Wymagane logowanie redaktora" }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeRemoteAddress(value) {
  return String(value || "").replace(/^::ffff:/u, "");
}

function isTrustedHttpsRequest(request) {
  if (!requiresProxyHttps) return true;
  const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
  const trusted = trustedProxyIps.has(remoteAddress) || trustedProxyIps.has(request.socket.remoteAddress || "");
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return trustProxy && trusted && forwardedProto === "https";
}

// Adres publiczny dla linkow kanonicznych i Open Graph. Schemat bierzemy z
// naglowka proxy tylko wtedy, gdy proxy jest zaufane; inaczej zostaje http.
function publicBase(request, host) {
  const remote = normalizeRemoteAddress(request.socket.remoteAddress);
  const trusted = trustProxy && (trustedProxyIps.has(remote) || trustedProxyIps.has(request.socket.remoteAddress || ""));
  const forwarded = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return `${trusted && forwarded === "https" ? "https" : "http"}://${host}`;
}

function isAdmin(request) {
  if (!requiresProxyHttps && !adminPassword) return true;
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Basic ")) return false;
  try {
    const [user, password] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(/:(.*)/s);
    return safeEqual(user, adminUser) && safeEqual(password, adminPassword);
  } catch {
    return false;
  }
}

function isAuthorizedAction(request, action) {
  const host = request.headers.host || "";
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  let sameOrigin = true;
  if (origin) {
    try { sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; }
  }
  return allowedHosts.has(host)
    && sameOrigin
    && (!fetchSite || ["same-origin", "none"].includes(fetchSite))
    && request.headers["x-telegram-action"] === action
    && isAdmin(request);
}

async function readJsonBody(request, maxBytes = 24_576) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    const error = new Error("Wymagany Content-Type application/json");
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Treść żądania jest zbyt duża");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Nieprawidłowy JSON");
    error.statusCode = 400;
    throw error;
  }
}

function publicEvent(event) {
  const { validationId: _validationId, generation: _generation, verification: _verification, facts: _facts, ...safe } = event;
  return safe;
}

function editorialPayload(body) {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
  const level1 = typeof body.level1 === "string" ? body.level1.trim().slice(0, 500) : "";
  const level2 = typeof body.level2 === "string" ? body.level2.trim().slice(0, 2_500) : "";
  const category = categories.has(body.category) ? body.category : "inne";
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 5)
    : [];
  return { title, level1, level2, category, tags };
}

async function validateEditorial(event, patch) {
  const context = await store.getValidationContext(event.validationId || event.id);
  if (!context) return { valid: false, reasons: ["Brak trwałego kontekstu źródłowego. Uruchom ponowną synchronizację."] };
  const short = validateOriginality(patch.level1, context);
  const long = validateContextOriginality(patch.level2, context);
  const metadata = validateEditorialMetadata(patch, context);
  const reasons = [...short.reasons, ...long.reasons, ...metadata.reasons];
  return { valid: reasons.length === 0, reasons, short, long, metadata };
}

async function syncNow({ force = false } = {}) {
  if (!force && syncCache && Date.now() - syncCache.createdAt < cacheTtlMs) return { ...syncCache.value, cached: true };
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const value = await synchronize(SOURCES, { knownEvents: await store.listEvents(), feedLimit, maxGroups, windowHours });
    const { validationContexts, ...summary } = value;
    const events = await store.mergeSynchronization(summary, validationContexts);
    const result = { ...summary, events, cached: false };
    syncCache = { value: result, createdAt: Date.now() };
    lastSchedulerError = null;
    return result;
  })().catch((error) => {
    lastSchedulerError = { message: error.message, at: new Date().toISOString() };
    throw error;
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

function runScheduledSync() {
  syncNow({ force: true }).catch((error) => console.error("Automatyczna synchronizacja nie powiodła się:", error.message));
}

function startScheduler() {
  if (!autoSyncEnabled) return;
  schedulerTimer = setInterval(runScheduledSync, syncIntervalMinutes * 60_000);
  schedulerTimer.unref();
  setTimeout(runScheduledSync, 1_500).unref();
}

function requiresAdminStatic(pathname) {
  return ["/", "/admin", "/index.html", "/app.js", "/styles.css"].includes(pathname);
}

function requiresAdminApi(pathname) {
  return pathname === "/api/editorial/events" || pathname === "/api/editorial" || pathname === "/api/validate" || pathname === "/api/sync";
}

async function serveStatic(requestPath, response, isHead = false) {
  const fileName = staticFiles.get(requestPath);
  if (!fileName) return sendJson(response, 404, { error: "Nie znaleziono zasobu" });
  const target = path.join(root, fileName);
  try {
    const content = await readFile(target);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
      "cache-control": path.extname(target) === ".html" ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    });
    response.end(isHead ? undefined : content);
  } catch {
    sendJson(response, 404, { error: "Nie znaleziono zasobu" });
  }
}

const server = createServer(async (request, response) => {
  const host = request.headers.host || `localhost:${port}`;
  if (!allowedHosts.has(host)) return sendJson(response, 403, { error: "Niedozwolony Host" });
  const url = new URL(request.url || "/", `http://${host}`);
  try {
    if ((requiresAdminStatic(url.pathname) || requiresAdminApi(url.pathname)) && !isTrustedHttpsRequest(request)) {
      return sendJson(response, 426, { error: "Panel i API redakcyjne są dostępne wyłącznie przez zaufany reverse proxy HTTPS" });
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        sources: SOURCES.length,
        publications: (await store.listPublications()).length,
        events: (await store.listEvents()).length,
        reactions: Object.values(await store.getReactionCounts()).reduce((sum, counts) => ({ likes: sum.likes + counts.likes, dislikes: sum.dislikes + counts.dislikes }), { likes: 0, dislikes: 0 }),
        autoSyncEnabled,
        syncIntervalMinutes,
        windowHours,
        feedLimit,
        maxGroups,
        lastSync: await store.getLastSync(),
        lastSchedulerError,
      });
    }
    // Publiczna strona materialu. Wystawiamy wylacznie publikacje, wiec material
    // niezatwierdzony nie moze wyciec przez zgadniety identyfikator.
    if (["GET", "HEAD"].includes(request.method || "") && url.pathname.startsWith("/a/")) {
      const base = publicBase(request, host);
      const publication = await store.getPublication(decodeURIComponent(url.pathname.slice(3)));
      if (!publication) return sendHtml(response, 404, articleMissingPage(base));
      return sendHtml(response, 200, articlePage(publication, base));
    }
    if (request.method === "GET" && url.pathname === "/api/public/feed") {
      const publications = await store.listPublications();
      const items = await Promise.all(publications.map(async (item) => ({ ...item, reactions: await store.getReaction(item.id), image: item.image ? { ...item.image, url: proxiedImageUrl(item.image.url) } : null })));
      return sendJson(response, 200, { items, generatedAt: new Date().toISOString() }, "public, max-age=30");
    }
    // Proxy obrazkow: klient nigdy nie laczy sie z serwerem wydawcy. Adres
    // wejsciowy musi naleze do jakiegos wydarzenia/publikacji w bazie, inaczej
    // endpoint bylby otwartym proxy dla dowolnego https adresu.
    if (["GET", "HEAD"].includes(request.method || "") && url.pathname === "/img") {
      const sourceUrl = url.searchParams.get("u") || "";
      const variant = url.searchParams.get("v") === "thumb" ? "thumb" : "full";
      if (!sourceUrl || !(await store.isKnownImageUrl(sourceUrl))) return sendJson(response, 404, { error: "Nieznany obrazek" });
      try {
        const webp = await imageProxy.getWebp(sourceUrl, variant);
        response.writeHead(200, {
          "content-type": "image/webp",
          "cache-control": "public, max-age=1209600, immutable",
          "x-content-type-options": "nosniff",
        });
        return response.end(request.method === "HEAD" ? undefined : webp);
      } catch (error) {
        const status = error instanceof ImageProxyError ? error.statusCode : 502;
        return sendJson(response, status, { error: "Nie udało się przygotować obrazka", detail: error.message });
      }
    }
    // Publiczny zapis oceny. Bez identyfikatorow: klient przesyla zmiane wlasnego
    // glosu, serwer trzyma tylko liczniki. Adres IP sluzy wylacznie do limitu
    // zapytan w pamieci i nie jest nigdzie zapisywany.
    if (request.method === "POST" && url.pathname === "/api/public/reaction") {
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== host) return sendJson(response, 403, { error: "Niedozwolone źródło żądania" });
        } catch {
          return sendJson(response, 403, { error: "Nieprawidłowy nagłówek Origin" });
        }
      }
      if (!allowReaction(normalizeRemoteAddress(request.socket.remoteAddress))) {
        return sendJson(response, 429, { error: "Zbyt wiele ocen w krótkim czasie" });
      }
      const body = await readJsonBody(request, 1_024);
      const id = typeof body.id === "string" ? body.id.slice(0, 100) : "";
      const allowed = new Set(["like", "dislike", ""]);
      const from = allowed.has(body.from) ? body.from : "";
      const to = allowed.has(body.to) ? body.to : "";
      if (!id || (!from && !to) || from === to) return sendJson(response, 400, { error: "Nieprawidłowa ocena" });
      const counts = await store.recordReaction(id, from, to);
      if (!counts) return sendJson(response, 404, { error: "Nie znaleziono opublikowanego materiału" });
      return sendJson(response, 200, { id, reactions: counts });
    }
    if (request.method === "GET" && url.pathname === "/api/editorial/events") {
      if (!isAdmin(request)) return sendUnauthorized(response);
      return sendJson(response, 200, { events: await store.listEvents(), reactions: await store.getReactionCounts(), lastSync: await store.getLastSync() });
    }
    if (request.method === "POST" && url.pathname === "/api/sync") {
      if (!isAuthorizedAction(request, "sync")) return sendJson(response, 403, { error: "Niedozwolone żądanie synchronizacji" });
      return sendJson(response, 200, await syncNow({ force: true }));
    }
    if (request.method === "POST" && url.pathname === "/api/validate") {
      if (!isAuthorizedAction(request, "validate")) return sendJson(response, 403, { error: "Niedozwolone żądanie walidacji" });
      const body = await readJsonBody(request);
      const validationId = typeof body.validationId === "string" ? body.validationId.slice(0, 100) : "";
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const field = body.field === "level2" ? "level2" : "level1";
      if (!validationId || !text || text.length > 2_500) return sendJson(response, 400, { error: "Nieprawidłowy identyfikator lub tekst" });
      const context = await store.getValidationContext(validationId);
      if (!context) return sendJson(response, 409, { error: "Kontekst źródłowy wygasł. Wykonaj ponowną synchronizację." });
      return sendJson(response, 200, field === "level2" ? validateContextOriginality(text, context) : validateOriginality(text, context));
    }
    if (request.method === "POST" && url.pathname === "/api/editorial") {
      if (!isAuthorizedAction(request, "editorial")) return sendJson(response, 403, { error: "Niedozwolona operacja redakcyjna" });
      const body = await readJsonBody(request);
      const eventId = typeof body.eventId === "string" ? body.eventId.slice(0, 100) : "";
      const action = ["save", "approve", "reject", "publish", "reopen", "regenerate"].includes(body.action) ? body.action : "";
      const event = await store.getEvent(eventId);
      if (!event || !action) return sendJson(response, 404, { error: "Nie znaleziono materiału lub akcji" });

      if (action === "regenerate") {
        const context = await store.getValidationContext(event.validationId || event.id);
        if (!context) return sendJson(response, 409, { error: "Brak kontekstu źródłowego. Uruchom ponowną synchronizację." });
        if (regenerating.has(eventId)) return sendJson(response, 409, { error: "Generowanie tego materiału już trwa" });
        regenerating.add(eventId);
        try {
          const claims = Array.isArray(event.verification?.sharedClaims) ? event.verification.sharedClaims : [];
          const generated = await generateEditorialPackage({ claims, sourceTexts: context.sourceTexts || [] });
          const updated = await store.applyGeneration(eventId, generated);
          return sendJson(response, 200, { event: updated, generation: { status: generated.status, reason: generated.reason } });
        } finally {
          regenerating.delete(eventId);
        }
      }

      if (action === "reject") return sendJson(response, 200, { event: await store.setStatus(eventId, "rejected") });
      if (action === "reopen") return sendJson(response, 200, { event: await store.setStatus(eventId, "review") });
      if (action === "publish") {
        const publication = await store.publish(eventId);
        if (!publication) return sendJson(response, 409, { error: "Publikacja wymaga wcześniejszej akceptacji materiału" });
        return sendJson(response, 200, { publication, event: await store.getEvent(eventId) });
      }

      const patch = editorialPayload(body);
      const validation = await validateEditorial(event, patch);
      if (!validation.valid && action === "approve") return sendJson(response, 422, { error: "Materiał nie spełnia zasad redakcyjnych", validation });
      const updated = await store.updateEditorial(eventId, { ...patch, validation, resetDecision: true });
      if (action === "approve") await store.setStatus(eventId, "approved");
      return sendJson(response, 200, { event: await store.getEvent(eventId), validation });
    }
    if (!["GET", "HEAD"].includes(request.method || "")) return sendJson(response, 405, { error: "Metoda niedozwolona" });
    if (requiresAdminStatic(url.pathname) && !isAdmin(request)) return sendUnauthorized(response);
    return serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    console.error("Request failed:", error);
    return sendJson(response, error.statusCode || 500, { error: "Żądanie nie powiodło się", detail: error.message });
  }
});

server.listen(port, listenHost, () => {
  console.log(`Telegram Redakcja — panel: http://localhost:${port}/`);
  console.log(`Telegram Redakcja — feed: http://localhost:${port}/feed`);
  console.log(`Automatyczna synchronizacja: ${autoSyncEnabled ? `co ${syncIntervalMinutes} min` : "WYŁĄCZONA"}`);
  console.log(`Zakres wiadomości: ${windowHours} h, do ${feedLimit} pozycji na kanał, do ${maxGroups} wydarzeń na przebieg`);
  startScheduler();
});

function shutdown() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

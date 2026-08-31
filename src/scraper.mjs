import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import robotsParser from "robots-parser";
import { CRAWLER_NAME, USER_AGENT, isAllowedSourceUrl } from "./sources.mjs";

const MAX_RESPONSE_BYTES = 3_000_000;
const MIN_ARTICLE_WORDS = 50;
const REQUEST_GAP_MS = 700;
const MAX_REDIRECTS = 4;
const lastRequestByHost = new Map();
const robotsCache = new Map();

export class ScrapeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice(7);
    if (isIP(mappedIpv4) === 4) return isPrivateAddress(mappedIpv4);
    const hextets = mappedIpv4.split(":");
    if (hextets.length === 2 && hextets.every((part) => /^[0-9a-f]{1,4}$/u.test(part))) {
      const high = Number.parseInt(hextets[0], 16);
      const low = Number.parseInt(hextets[1], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 198 && [18, 19].includes(b))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
    || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
}

async function assertSafeTarget(url, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ScrapeError("INVALID_URL", "Nieprawidłowy adres źródła");
  }
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new ScrapeError("HOST_DENIED", `Adres poza allowlistą źródła: ${parsed.hostname}`);
  }
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ScrapeError("PRIVATE_ADDRESS", "Domena wskazuje na prywatny lub niedozwolony adres IP");
  }
}

async function observeHostDelay(url) {
  const host = new URL(url).host;
  const elapsed = Date.now() - (lastRequestByHost.get(host) ?? 0);
  if (elapsed < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - elapsed);
  lastRequestByHost.set(host, Date.now());
}

async function assertRobotsAllowed(url, allowedHosts) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  let cached = robotsCache.get(robotsUrl);
  if (!cached || cached.expiresAt < Date.now()) {
    try {
      const result = await fetchLimited(robotsUrl, "text/plain,*/*;q=0.5", { allowedHosts, respectRobots: false });
      cached = { parser: robotsParser(robotsUrl, result.text), expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    } catch {
      throw new ScrapeError("ROBOTS_UNAVAILABLE", `Nie udało się sprawdzić ${robotsUrl}`);
    }
    robotsCache.set(robotsUrl, cached);
  }
  if (cached.parser.isAllowed(url, CRAWLER_NAME) !== true) {
    throw new ScrapeError("ROBOTS_DENIED", "Pobieranie tej ścieżki nie jest jawnie dozwolone przez robots.txt");
  }
}

async function fetchLimited(url, accept, { allowedHosts, respectRobots = false }) {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertSafeTarget(currentUrl, allowedHosts);
    if (respectRobots) await assertRobotsAllowed(currentUrl, allowedHosts);
    await observeHostDelay(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(18_000),
      headers: {
        "user-agent": USER_AGENT,
        accept,
        "accept-language": "pl-PL,pl;q=0.9,en;q=0.4",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new ScrapeError("BAD_REDIRECT", "Przekierowanie bez nagłówka Location");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new ScrapeError("HTTP_ERROR", `HTTP ${response.status} dla ${currentUrl}`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new ScrapeError("TOO_LARGE", "Odpowiedź przekracza limit 3 MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESPONSE_BYTES) throw new ScrapeError("TOO_LARGE", "Odpowiedź przekracza limit 3 MB");
    return { text: buffer.toString("utf8"), finalUrl: currentUrl, contentType: response.headers.get("content-type") || "" };
  }
  throw new ScrapeError("TOO_MANY_REDIRECTS", "Przekroczono limit bezpiecznych przekierowań");
}

function cleanText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function wordCount(value) {
  return (value.match(/[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*/gu) || []).length;
}

function walkJson(value, visitor) {
  if (Array.isArray(value)) return value.forEach((item) => walkJson(item, visitor));
  if (!value || typeof value !== "object") return;
  visitor(value);
  Object.values(value).forEach((item) => walkJson(item, visitor));
}

function articleJsonLd($) {
  const candidates = [];
  $('script[type*="ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text().trim());
      walkJson(parsed, (node) => {
        const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (types.some((type) => ["Article", "NewsArticle", "ReportageNewsArticle", "AnalysisNewsArticle"].includes(type))) candidates.push(node);
      });
    } catch {
      // Wadliwy blok nie zatrzymuje pozostałych jawnych fallbacków.
    }
  });
  return candidates.sort((a, b) => String(b.articleBody || "").length - String(a.articleBody || "").length)[0] || null;
}

function assertPublicAccess($, jsonLd, source, item) {
  const freeValue = jsonLd?.isAccessibleForFree;
  if (freeValue === false || String(freeValue).toLowerCase() === "false") throw new ScrapeError("PAYWALL", "Metadane oznaczają treść płatną");
  const denySelectors = ["[data-paywall]", ".paywall", "[class*='paywall']", ...(source.rejectSelectors || [])];
  const matchesDenySelector = denySelectors.some((selector) => {
    try {
      return $(selector).length > 0;
    } catch {
      // Wadliwy selektor z konfiguracji zrodla nie moze przerwac sprawdzania pozostalych.
      return false;
    }
  });
  if (matchesDenySelector) {
    throw new ScrapeError("PAYWALL", "Strona zawiera znacznik treści płatnej");
  }

  const officialRssItem = item.sourceId === source.id && isAllowedSourceUrl(source, item.url);
  const explicitFree = freeValue === true || String(freeValue).toLowerCase() === "true";
  if (source.accessPolicy === "official-rss-public" && officialRssItem) return;
  if (source.accessPolicy === "explicit-free-metadata" && explicitFree) return;
  throw new ScrapeError("ACCESS_UNKNOWN", "Brak jednoznacznego sygnału publicznej dostępności treści");
}

function textFromSelector($, selector) {
  const selected = $(selector).first().clone();
  if (!selected.length) return "";
  selected.find("script, style, noscript, nav, aside, footer, form, button, iframe, [class*='advert'], [class*='related'], [class*='recommend'], [class*='social'], [aria-hidden='true']").remove();
  return cleanText(selected.find("p").map((_, paragraph) => cleanText($(paragraph).text())).get().filter((text) => wordCount(text) >= 4).join("\n\n"));
}

function readabilityText(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    return cleanText(new Readability(dom.window.document, { charThreshold: 300 }).parse()?.textContent || "");
  } catch {
    return "";
  }
}

function imageCandidate($, jsonLd) {
  const fromJsonLd = (() => {
    const image = jsonLd?.image;
    if (!image) return "";
    if (typeof image === "string") return image;
    if (Array.isArray(image)) {
      const first = image.find((entry) => typeof entry === "string" ? entry : entry?.url);
      return typeof first === "string" ? first : String(first?.url || "");
    }
    return String(image.url || "");
  })();
  return [
    fromJsonLd,
    $("meta[property='og:image:secure_url']").attr("content"),
    $("meta[property='og:image']").attr("content"),
    $("meta[name='twitter:image']").attr("content"),
    $("meta[name='twitter:image:src']").attr("content"),
  ].map((value) => cleanText(value || "")).find(Boolean) || "";
}

function articleImage($, jsonLd, baseUrl, source) {
  const candidate = imageCandidate($, jsonLd);
  if (!candidate) return null;
  let parsed;
  try {
    parsed = new URL(candidate, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) return null;
  const alt = cleanText($("meta[property='og:image:alt']").attr("content") || $("meta[name='twitter:image:alt']").attr("content") || "");
  return { url: parsed.toString(), alt: alt.slice(0, 300), credit: source.name };
}

function canonicalUrl($, fallback, source) {
  const candidate = $("link[rel='canonical']").attr("href") || fallback;
  try {
    const url = new URL(candidate, fallback);
    if (!isAllowedSourceUrl(source, url)) return fallback;
    [...url.searchParams.keys()].forEach((key) => {
      if (key.startsWith("utm_") || ["fbclid", "ref"].includes(key)) url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return fallback;
  }
}

export async function readFeed(source, limit = 8) {
  const { text, contentType } = await fetchLimited(source.feedUrl, "application/rss+xml,application/xml,text/xml;q=0.9", { allowedHosts: source.hosts });
  if (!/(rss|xml)/i.test(contentType)) throw new ScrapeError("INVALID_FEED_TYPE", `Nieprawidłowy Content-Type RSS: ${contentType}`);
  const $ = cheerio.load(text, { xmlMode: true });
  if (!$("rss channel").length) throw new ScrapeError("INVALID_FEED", "Dokument nie jest obsługiwanym kanałem RSS 2.0");
  const items = $("item").slice(0, limit).map((_, item) => {
    const node = $(item);
    const rawUrl = cleanText(node.find("link").first().text());
    if (!isAllowedSourceUrl(source, rawUrl)) return null;
    const parsed = new URL(rawUrl);
    [...parsed.searchParams.keys()].forEach((key) => {
      if (key.startsWith("utm_") || key === "fbclid") parsed.searchParams.delete(key);
    });
    return {
      sourceId: source.id,
      sourceName: source.name,
      ownerGroup: source.ownerGroup,
      title: cleanText(node.find("title").first().text()),
      description: cleanText(node.find("description").first().text().replace(/<[^>]+>/g, " ")),
      url: parsed.toString(),
      publishedAt: cleanText(node.find("pubDate").first().text()) || new Date().toISOString(),
    };
  }).get().filter((item) => item?.title && item.url);
  if (!items.length) throw new ScrapeError("EMPTY_FEED", "Kanał RSS nie zawiera prawidłowych elementów z dozwolonej domeny");
  return items;
}

export async function scrapeArticle(source, item) {
  if (!isAllowedSourceUrl(source, item.url)) throw new ScrapeError("HOST_DENIED", "URL artykułu nie należy do skonfigurowanego źródła");
  const { text: html, finalUrl, contentType } = await fetchLimited(item.url, "text/html,application/xhtml+xml;q=0.9", { allowedHosts: source.hosts, respectRobots: true });
  if (!contentType.includes("text/html")) throw new ScrapeError("NOT_HTML", "Artykuł nie zwrócił HTML");

  const $ = cheerio.load(html);
  const jsonLd = articleJsonLd($);
  assertPublicAccess($, jsonLd, source, item);

  let body = cleanText(jsonLd?.articleBody || "");
  let extractionMethod = body ? "json-ld" : "";
  if (wordCount(body) < MIN_ARTICLE_WORDS) {
    for (const selector of source.contentSelectors) {
      const candidate = textFromSelector($, selector);
      if (wordCount(candidate) > wordCount(body)) {
        body = candidate;
        extractionMethod = `selector:${selector}`;
      }
      if (wordCount(body) >= MIN_ARTICLE_WORDS) break;
    }
  }
  if (wordCount(body) < MIN_ARTICLE_WORDS) {
    const candidate = readabilityText(html, finalUrl);
    if (wordCount(candidate) > wordCount(body)) {
      body = candidate;
      extractionMethod = "readability";
    }
  }
  if (wordCount(body) < MIN_ARTICLE_WORDS) throw new ScrapeError("TOO_SHORT", "Wyodrębniona treść jest zbyt krótka lub urwana");

  return {
    ...item,
    title: cleanText(jsonLd?.headline || $("meta[property='og:title']").attr("content") || item.title),
    url: canonicalUrl($, finalUrl, source),
    author: cleanText($("meta[name='author']").attr("content") || ""),
    text: body,
    wordCount: wordCount(body),
    extractionMethod,
    image: articleImage($, jsonLd, finalUrl, source),
  };
}

export const testing = { isPrivateAddress };

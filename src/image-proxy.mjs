// Proxy obrazkow zrodlowych: pobiera oryginal z serwera wydawcy, konwertuje
// do WebP i cache'uje na dysku. Dzieki temu przegladarka nigdy nie laczy sie
// bezposrednio z cudzym CDN (koniec z hotlink-blockami i mieszana zawartoscia),
// a obrazki sa lzejsze niz oryginalne JPEG.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import sharp from "sharp";
import { isPrivateAddress } from "./scraper.mjs";
import { USER_AGENT } from "./sources.mjs";

const MAX_SOURCE_BYTES = 8_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 dni
const WIDTHS = { thumb: 480, full: 1280 };
const WEBP_QUALITY = 78;

export class ImageProxyError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = "ImageProxyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ImageProxy {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.ready = mkdir(cacheDir, { recursive: true });
    // Zapobiega rownoleglemu pobieraniu i konwersji tego samego adresu, gdy
    // kilka zakladek/urzadzen zada ten sam obrazek w tej samej chwili.
    this.pending = new Map();
  }

  #cacheKey(sourceUrl, variant) {
    const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 40);
    return `${hash}-${variant}.webp`;
  }

  async #assertSafeUrl(sourceUrl) {
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new ImageProxyError("INVALID_URL", "Nieprawidłowy adres obrazka", 400);
    }
    if (parsed.protocol !== "https:") throw new ImageProxyError("PROTOCOL_DENIED", "Wyłącznie adresy https:", 400);
    if (parsed.username || parsed.password) throw new ImageProxyError("URL_DENIED", "Adres z danymi logowania jest niedozwolony", 400);
    const hostname = parsed.hostname.toLowerCase();
    if (isIP(hostname) && isPrivateAddress(hostname)) throw new ImageProxyError("PRIVATE_ADDRESS", "Adres wskazuje na sieć wewnętrzną", 400);
    if (!isIP(hostname)) {
      const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
      if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
        throw new ImageProxyError("PRIVATE_ADDRESS", "Domena wskazuje na sieć wewnętrzną", 400);
      }
    }
    return parsed;
  }

  async #fetchOriginal(sourceUrl) {
    const response = await fetch(sourceUrl, {
      redirect: "error", // przekierowania omijalyby ponowna walidacje SSRF, wiec sa zablokowane
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
    }).catch((error) => {
      throw new ImageProxyError("FETCH_FAILED", `Nie udało się pobrać obrazka: ${error.message}`, 502);
    });
    if (!response.ok) throw new ImageProxyError("HTTP_ERROR", `Serwer źródłowy zwrócił HTTP ${response.status}`, 502);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new ImageProxyError("NOT_AN_IMAGE", `Zasób nie jest obrazkiem (${contentType})`, 502);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_SOURCE_BYTES) throw new ImageProxyError("TOO_LARGE", "Obrazek źródłowy przekracza limit 8 MB", 502);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) throw new ImageProxyError("TOO_LARGE", "Obrazek źródłowy przekracza limit 8 MB", 502);
    return buffer;
  }

  async #convert(buffer, variant) {
    const width = WIDTHS[variant] || WIDTHS.full;
    try {
      return await sharp(buffer, { failOn: "none" })
        .rotate() // uwzglednia orientacje EXIF przed skalowaniem
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (error) {
      throw new ImageProxyError("CONVERT_FAILED", `Konwersja do WebP nie powiodła się: ${error.message}`, 502);
    }
  }

  // Zwraca bufor WebP dla danego adresu i wariantu (thumb/full), z cache na dysku.
  async getWebp(sourceUrl, variant = "full") {
    await this.ready;
    const targetVariant = WIDTHS[variant] ? variant : "full";
    const cacheFile = path.join(this.cacheDir, this.#cacheKey(sourceUrl, targetVariant));
    try {
      return await readFile(cacheFile);
    } catch {
      // brak w cache, pobieramy nizej
    }
    const pendingKey = cacheFile;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const job = (async () => {
      await this.#assertSafeUrl(sourceUrl);
      const original = await this.#fetchOriginal(sourceUrl);
      const webp = await this.#convert(original, targetVariant);
      await writeFile(cacheFile, webp).catch(() => {});
      return webp;
    })();
    this.pending.set(pendingKey, job);
    try {
      return await job;
    } finally {
      this.pending.delete(pendingKey);
    }
  }

  // Usuwa z cache pliki starsze niz CACHE_MAX_AGE_MS. Wywolywane okresowo,
  // zeby dysk VPS nie rosl bez ograniczen wraz z rotacja zdjec w feedzie.
  async pruneOldCache() {
    await this.ready;
    const entries = await readdir(this.cacheDir).catch(() => []);
    const now = Date.now();
    await Promise.all(entries.map(async (name) => {
      const filePath = path.join(this.cacheDir, name);
      const info = await stat(filePath).catch(() => null);
      if (info && now - info.mtimeMs > CACHE_MAX_AGE_MS) await unlink(filePath).catch(() => {});
    }));
  }
}

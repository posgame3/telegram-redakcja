/**
 * Normalizacja danych przychodzacych z sieci.
 *
 * Kazda odpowiedz serwera traktujemy jako nieznana strukture: przycinamy dlugosci,
 * odrzucamy niepoprawne adresy i domykamy braki wartosciami domyslnymi. Dzieki temu
 * komponenty dostaja gotowe, w pelni okreslone obiekty i nie musza sprawdzac pol.
 */
import {
  CATEGORIES,
  EDITORIAL_STATUSES,
  type Category,
  type EditorialEvent,
  type EditorialStatus,
  type EventImage,
  type EventSource,
  type Generation,
  type Originality,
  type OriginalityStatus,
  type Publication,
  type PublicationSource,
  type ReactionCounts,
  type ReactionCountsById,
  type SyncError,
  type SyncStats,
  type UniqueClaim,
  type Verification,
  type VerificationClaim,
} from "./types";

/** Nieznany obiekt o dostepie po kluczu, bez rzutowania na any. */
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

export function safeText(value: unknown, maxLength = 1_000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function clamp(value: unknown, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

/** Adres bezwzgledny o protokole http albo https. Pusty ciag, gdy niepoprawny. */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * Adres zdjecia. Serwer zwraca teraz sciezke do wlasnego proxy (/img?u=...),
 * wiec dopuszczamy adresy wzgledne, ale wylacznie w obrebie tego samego hosta.
 */
export function sameOriginUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? url.toString() : "";
  } catch {
    return "";
  }
}

export function countWords(value: string): number {
  return (value.match(/[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function textList(value: unknown, maxLength: number, limit?: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((item) => safeText(item, maxLength)).filter(Boolean);
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

function normalizeCategory(value: unknown): Category {
  const text = safeText(value, 40);
  return CATEGORIES.includes(text as Category) ? (text as Category) : "inne";
}

function normalizeStatus(value: unknown): EditorialStatus {
  const text = safeText(value, 40);
  return EDITORIAL_STATUSES.includes(text as EditorialStatus)
    ? (text as EditorialStatus)
    : "review";
}

function nullableText(value: unknown, maxLength = 60): string | null {
  const text = safeText(value, maxLength);
  return text || null;
}

export function normalizeOriginality(input?: unknown): Originality {
  const value = asRecord(input);
  return {
    valid: value.valid === true,
    status: (safeText(value.status, 40) || "unverified") as OriginalityStatus,
    wordCount: clamp(value.wordCount, 0, 300),
    maxCopiedWords: clamp(value.maxCopiedWords, 0, 100),
    ngramOverlap: clamp(value.ngramOverlap, 0, 100),
    groundingScore: clamp(value.groundingScore, 0, 100),
    validatedText: safeText(value.validatedText, 2_500),
    reasons: textList(value.reasons, 300),
  };
}

function normalizeGeneration(input: unknown): Generation {
  const value = asRecord(input);
  return {
    status: (safeText(value.status, 40) || "unverified") as OriginalityStatus,
    reason: safeText(value.reason, 600),
    model: safeText(value.model, 120),
    basisIds: Array.isArray(value.basisIds)
      ? value.basisIds.filter((id): id is number => Number.isInteger(id))
      : [],
    originality: normalizeOriginality(value.originality),
    contextOriginality: normalizeOriginality(value.contextOriginality),
    regeneratedAt: nullableText(value.regeneratedAt, 40),
  };
}

/** Zwraca null, gdy zrodlo nie ma adresu albo tytulu - nie da sie go pokazac. */
function normalizeEventSource(input: unknown): EventSource | null {
  const value = asRecord(input);
  const url = safeUrl(value.url);
  const title = safeText(value.title, 300);
  if (!url || !title) return null;
  return {
    domain: safeText(value.domain, 80),
    time: safeText(value.time, 60),
    title,
    url,
    wordCount: Number.isFinite(value.wordCount) ? (value.wordCount as number) : null,
    extractionMethod: safeText(value.extractionMethod, 100),
    summary: safeText(value.summary, 1_000),
    preview: safeText(value.preview, 1_500),
    keyClaims: textList(value.keyClaims, 500, 4),
  };
}

function normalizeClaim(input: unknown): VerificationClaim | null {
  const value = asRecord(input);
  const text = safeText(value.text, 800);
  if (!text) return null;
  return {
    text,
    sources: textList(value.sources, 80),
    confidence: clamp(value.confidence, 0, 100),
  };
}

function normalizeUniqueClaim(input: unknown): UniqueClaim | null {
  const value = asRecord(input);
  const text = safeText(value.text, 800);
  if (!text) return null;
  return { text, source: safeText(value.source, 80) };
}

const EMPTY_ESSENCE: VerificationClaim = {
  text: "Brak podstawy esencji.",
  sources: [],
  confidence: 0,
};

function normalizeVerification(input: unknown): Verification {
  const value = asRecord(input);
  const claims = (source: unknown) =>
    Array.isArray(source)
      ? source.map(normalizeClaim).filter((claim): claim is VerificationClaim => claim !== null)
      : [];
  return {
    sharedClaims: claims(value.sharedClaims),
    conflicts: claims(value.conflicts),
    uniqueClaims: Array.isArray(value.uniqueClaims)
      ? value.uniqueClaims
          .map(normalizeUniqueClaim)
          .filter((claim): claim is UniqueClaim => claim !== null)
      : [],
    sharedSignals: Array.isArray(value.sharedSignals) ? value.sharedSignals : [],
    method: textList(value.method, 600),
    essenceBasis: normalizeClaim(value.essenceBasis) ?? EMPTY_ESSENCE,
  };
}

export function normalizeImage(input: unknown): EventImage | null {
  const value = asRecord(input);
  const url = sameOriginUrl(value.url);
  if (!url) return null;
  return { url, alt: safeText(value.alt, 300), credit: safeText(value.credit, 80) };
}

export function normalizeReactionCounts(input: unknown): ReactionCounts {
  const value = asRecord(input);
  return { likes: clamp(value.likes, 0, 1e9), dislikes: clamp(value.dislikes, 0, 1e9) };
}

/**
 * Materiał redakcyjny. Zwraca null, gdy brak identyfikatora albo zrodel -
 * taki wpis nie da sie ani pokazac, ani ocenic.
 */
export function normalizeEvent(input: unknown): EditorialEvent | null {
  const value = asRecord(input);
  const id = safeText(value.id, 100);
  if (!id) return null;
  const sources = Array.isArray(value.sources)
    ? value.sources
        .map(normalizeEventSource)
        .filter((source): source is EventSource => source !== null)
    : [];
  if (!sources.length) return null;

  // Starsze wpisy trzymaly skrot w polu draft; level1 jest wersja obowiazujaca.
  const level1 = safeText(value.level1 ?? value.draft, 500);
  return {
    id,
    validationId: safeText(value.validationId, 100) || id,
    title: safeText(value.title, 180),
    level1,
    level2: safeText(value.level2, 2_500),
    category: normalizeCategory(value.category),
    tags: textList(value.tags, 60, 5),
    detectedAt: safeText(value.detectedAt, 80),
    confidence: clamp(value.confidence, 0, 100),
    status: normalizeStatus(value.status),
    image: normalizeImage(value.image),
    sources,
    facts: textList(value.facts, 400),
    generation: normalizeGeneration(value.generation),
    verification: normalizeVerification(value.verification),
    editorialUpdatedAt: nullableText(value.editorialUpdatedAt, 40),
    publishedAt: nullableText(value.publishedAt, 40),
    updatedAt: nullableText(value.updatedAt, 40),
  };
}

function normalizePublicationSource(input: unknown): PublicationSource | null {
  const value = asRecord(input);
  const url = safeUrl(value.url);
  const title = safeText(value.title, 300);
  if (!url || !title) return null;
  return { domain: safeText(value.domain, 80), title, url, time: safeText(value.time, 80) };
}

/** Publikacja w feedzie. Zwraca null, gdy nie ma czym zatytulowac karty. */
export function normalizePublication(input: unknown): Publication | null {
  const value = asRecord(input);
  const id = safeText(value.id, 100);
  if (!id) return null;
  const level1 = safeText(value.level1, 500);
  const title = safeText(value.title, 180);
  if (!level1 && !title) return null;
  return {
    id,
    title,
    level1,
    level2: safeText(value.level2, 2_500),
    category: normalizeCategory(value.category),
    tags: textList(value.tags, 60, 5),
    image: normalizeImage(value.image),
    confidence: clamp(value.confidence, 0, 100),
    sourceCount: clamp(value.sourceCount, 0, 1e6),
    publishedAt: nullableText(value.publishedAt, 40),
    updatedAt: nullableText(value.updatedAt, 40),
    reactions: normalizeReactionCounts(value.reactions),
    sources: Array.isArray(value.sources)
      ? value.sources
          .map(normalizePublicationSource)
          .filter((source): source is PublicationSource => source !== null)
      : [],
  };
}

/** Statystyki przebiegu synchronizacji. Kazde pole liczbowe albo brak pola. */
export function normalizeSyncStats(input: unknown): Partial<SyncStats> {
  const value = asRecord(input);
  const keys: readonly (keyof SyncStats)[] = [
    "feedsOk",
    "feedsChecked",
    "feedItems",
    "itemsInWindow",
    "eventsCreated",
    "eventsSkippedExisting",
    "groupsProcessed",
    "scrapeFailures",
    "insufficientSourceGroups",
    "windowHours",
  ];
  const stats: Partial<SyncStats> = {};
  for (const key of keys) {
    if (Number.isFinite(Number(value[key]))) stats[key] = clamp(value[key], 0, 1e9);
  }
  return stats;
}

/** Bledy poszczegolnych zrodel z ostatniego przebiegu. */
export function normalizeSyncErrors(input: unknown): SyncError[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      const value = asRecord(entry);
      const message = safeText(value.message, 400);
      if (!message) return null;
      return { source: safeText(value.source, 120), message };
    })
    .filter((entry): entry is SyncError => entry !== null);
}

export function normalizeReactionCountsById(input: unknown): ReactionCountsById {
  const value = asRecord(input);
  const entries = Object.entries(value).map(
    ([id, counts]) => [id, normalizeReactionCounts(counts)] as const,
  );
  return Object.fromEntries(entries);
}

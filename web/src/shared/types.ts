/**
 * Typy domenowe wspolne dla panelu redakcyjnego i publicznego feedu.
 *
 * Odpowiadaja kształtowi danych zwracanemu przez server.mjs (patrz src/store.mjs,
 * funkcje toEvent i toPublication). Wszystko, co przychodzi z sieci, przechodzi
 * najpierw przez normalizatory z modulu ./normalize.
 */

/** Etap obiegu redakcyjnego. Odpowiada enumowi editorial_status w Postgresie. */
export type EditorialStatus = "review" | "approved" | "rejected" | "published";

export const EDITORIAL_STATUSES: readonly EditorialStatus[] = [
  "review",
  "approved",
  "rejected",
  "published",
];

/** Dzialy. Odpowiada enumowi editorial_category i liscie w server.mjs. */
export type Category =
  "kraj" | "biznes" | "gospodarka" | "geopolityka" | "rynki" | "świat" | "technologia" | "inne";

export const CATEGORIES: readonly Category[] = [
  "kraj",
  "biznes",
  "gospodarka",
  "geopolityka",
  "rynki",
  "świat",
  "technologia",
  "inne",
];

/**
 * Wynik generowania po stronie serwera.
 * "ready" oznacza tresc gotowa; kazdy wariant "blocked-*" znaczy, ze level1
 * i level2 sa puste, bo generator dziala fail-closed.
 */
export type GenerationStatus =
  | "ready"
  | "blocked-no-model"
  | "blocked-no-shared-facts"
  | "blocked-model-error"
  | "blocked-originality";

/**
 * Stan kontroli oryginalnosci. Poza wartosciami z serwera zawiera stany
 * wystepujace tylko w przegladarce, gdy redaktor wlasnie edytuje tekst.
 */
export type OriginalityStatus =
  GenerationStatus | "passed" | "checking" | "dirty" | "blocked" | "unverified";

/** Metryki kontroli tekstu wzgledem zrodel. */
export interface Originality {
  valid: boolean;
  status: OriginalityStatus;
  wordCount: number;
  maxCopiedWords: number;
  ngramOverlap: number;
  groundingScore: number;
  /** Tekst, dla ktorego wynik jest wazny. Pusty, gdy kontrola nie przeszla. */
  validatedText: string;
  reasons: string[];
}

/** Publikacja zrodlowa uzyta do zbudowania materialu. */
export interface EventSource {
  domain: string;
  time: string;
  title: string;
  url: string;
  wordCount: number | null;
  extractionMethod: string;
  summary: string;
  preview: string;
  keyClaims: string[];
}

/** Twierdzenie potwierdzone w wielu zrodlach albo rozbiezne miedzy nimi. */
export interface VerificationClaim {
  text: string;
  sources: string[];
  confidence: number;
}

/** Twierdzenie obecne tylko w jednym zrodle. */
export interface UniqueClaim {
  text: string;
  source: string;
}

export interface Verification {
  sharedClaims: VerificationClaim[];
  conflicts: VerificationClaim[];
  uniqueClaims: UniqueClaim[];
  sharedSignals: unknown[];
  method: string[];
  essenceBasis: VerificationClaim;
}

export interface Generation {
  status: OriginalityStatus;
  reason: string;
  model: string;
  basisIds: number[];
  originality: Originality;
  contextOriginality: Originality;
  regeneratedAt: string | null;
}

/** Zdjecie materialu. Adres wskazuje na wlasne proxy (/img?u=...). */
export interface EventImage {
  url: string;
  alt: string;
  credit: string;
}

/** Materiał w obiegu redakcyjnym, widoczny wylacznie w panelu. */
export interface EditorialEvent {
  id: string;
  /** Klucz kontekstu zrodlowego uzywany przez /api/validate. */
  validationId: string;
  title: string;
  /** Skrot 20-30 slow. Sluzy jako naglowek materialu. */
  level1: string;
  /** Kontekst 60-140 slow. */
  level2: string;
  category: Category;
  tags: string[];
  detectedAt: string;
  confidence: number;
  status: EditorialStatus;
  image: EventImage | null;
  sources: EventSource[];
  facts: string[];
  generation: Generation;
  verification: Verification;
  editorialUpdatedAt: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface ReactionCounts {
  likes: number;
  dislikes: number;
}

/** Glos czytelnika. Pusty ciag oznacza brak glosu. */
export type ReactionVote = "like" | "dislike";

/** Zrodlo pokazywane w publicznym feedzie (wezszy zestaw pol niz w panelu). */
export interface PublicationSource {
  domain: string;
  title: string;
  url: string;
  time: string;
}

/** Opublikowany material widoczny publicznie. */
export interface Publication {
  id: string;
  title: string;
  level1: string;
  level2: string;
  category: Category;
  tags: string[];
  image: EventImage | null;
  confidence: number;
  sourceCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  reactions: ReactionCounts;
  sources: PublicationSource[];
}

export interface SyncStats {
  feedsOk: number;
  feedsChecked: number;
  feedItems: number;
  itemsInWindow: number;
  eventsCreated: number;
  eventsSkippedExisting: number;
  groupsProcessed: number;
  scrapeFailures: number;
  insufficientSourceGroups: number;
  windowHours: number;
}

export interface SyncError {
  source: string;
  message: string;
}

export interface LastSync {
  syncedAt: string;
  stats: Partial<SyncStats>;
  errors: SyncError[];
}

/** Liczniki ocen dla wszystkich publikacji, kluczowane identyfikatorem. */
export type ReactionCountsById = Record<string, ReactionCounts>;

/** Pole tekstowe podlegajace kontroli oryginalnosci. */
export type ValidatedField = "level1" | "level2";

/** Operacje redakcyjne przyjmowane przez POST /api/editorial. */
export type EditorialAction = "save" | "approve" | "reject" | "publish" | "reopen" | "regenerate";

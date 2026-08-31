import type { EditorialEvent, EditorialStatus, OriginalityStatus } from "../shared/types";

export type QueueFilter = EditorialStatus | "all";

export const STATUS_LABELS: Record<EditorialStatus, string> = {
  review: "DO DECYZJI",
  approved: "ZATWIERDZONY",
  rejected: "ODRZUCONY",
  published: "OPUBLIKOWANY",
};

/** Kolejnosc zakladek kolejki. "Do decyzji" jest widokiem domyslnym. */
export const QUEUE_FILTERS: readonly { value: QueueFilter; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  { value: "review", label: "Do decyzji" },
  { value: "approved", label: "Przyjęte" },
  { value: "rejected", label: "Odrzucone" },
  { value: "published", label: "Opublikowane" },
];

export const DEFAULT_QUEUE_FILTER: QueueFilter = "review";

/**
 * Odstep miedzy automatycznymi odczytami kolejki. Backend synchronizuje sie
 * sam co 30 min, ale bez tego odpytywania panel nie dowiedzialby sie o nowych
 * materialach i zmianach statusu, dopoki redaktor recznie nie kliknie POBIERZ NOWE.
 */
export const QUEUE_POLL_INTERVAL_MS = 20_000;

/**
 * Opisy stanu kontroli tekstu. Warianty "blocked-*" pochodza z generatora
 * i znacza, ze material nie ma tresci; pozostale opisuja kontrole w przegladarce.
 */
export const GENERATION_STATUS_LABELS: Partial<Record<OriginalityStatus, string>> = {
  ready: "PAKIET AI GOTOWY",
  passed: "ZWERYFIKOWANY",
  checking: "SPRAWDZANIE...",
  dirty: "WYMAGA KONTROLI",
  blocked: "KONTROLA NIEMOŻLIWA",
  "blocked-no-model": "BRAK MODELU — FAIL-CLOSED",
  "blocked-no-shared-facts": "BRAK WSPÓLNYCH FAKTÓW",
  "blocked-model-error": "BŁĄD MODELU",
  "blocked-originality": "ODRZUCONY PRZEZ KONTROLĘ",
  unverified: "NIEZWERYFIKOWANY",
};

export const FALLBACK_GENERATION_LABEL = "NIEZWERYFIKOWANY";

/**
 * Naglowkiem materialu jest skrot, a nie osobny tytul: to on trafia do feedu
 * jako pierwsza linia. Tytul sluzy tylko za zapas, gdy skrotu jeszcze nie ma.
 */
export function headlineOf(event: Pick<EditorialEvent, "level1" | "title">): string {
  return event.level1 || event.title;
}

/** Progi redakcyjne wymuszane tez po stronie serwera. */
export const LIMITS = {
  shortWords: { min: 20, max: 30 },
  longWords: { min: 60, max: 140 },
  titleWords: { min: 3, max: 12 },
  minTags: 2,
} as const;

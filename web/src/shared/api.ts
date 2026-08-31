/**
 * Klient HTTP aplikacji.
 *
 * Jedno miejsce, w ktorym powstaja zapytania do backendu. Trzy rzeczy, ktore
 * wczesniej byly powtarzane przy kazdym wywolaniu fetch:
 *  - naglowek x-telegram-action, bez ktorego server.mjs odrzuca operacje (403),
 *  - wyciaganie komunikatu bledu z roznych pol odpowiedzi,
 *  - normalizacja danych do typow domenowych.
 */
import {
  normalizeEvent,
  normalizeOriginality,
  normalizePublication,
  normalizeReactionCounts,
  normalizeReactionCountsById,
  normalizeSyncErrors,
  normalizeSyncStats,
  safeText,
} from "./normalize";
import type {
  EditorialAction,
  EditorialEvent,
  LastSync,
  Originality,
  Publication,
  ReactionCounts,
  ReactionCountsById,
  ValidatedField,
} from "./types";

/** Blad zwrocony przez backend albo blad transportu. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

/**
 * Backend zglasza bledy na trzy sposoby, zaleznie od trasy: lista powodow
 * walidacji (422 przy zatwierdzaniu), pole error, albo pole detail (500).
 */
function extractErrorMessage(payload: unknown, status: number): string {
  const record = asRecord(payload);

  const validation = asRecord(record.validation);
  if (Array.isArray(validation.reasons)) {
    const reasons = validation.reasons.map((reason) => safeText(reason, 300)).filter(Boolean);
    if (reasons.length) return reasons.join(" ");
  }

  const error = safeText(record.error, 400);
  if (error) return error;

  const detail = safeText(record.detail, 400);
  if (detail) return detail;

  return `HTTP ${status}`;
}

interface RequestOptions {
  method?: "GET" | "POST";
  /** Wartosc naglowka x-telegram-action wymaganego przez operacje panelu. */
  action?: string;
  body?: unknown;
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = "GET", action, body } = options;

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (action) headers["x-telegram-action"] = action;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Brak połączenia z serwerem";
    throw new ApiError(message, 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Odpowiedz bez poprawnego JSON-a; komunikat zbudujemy ze statusu.
  }

  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, response.status), response.status);
  }
  return payload;
}

function normalizeLastSync(input: unknown): LastSync | null {
  const value = asRecord(input);
  const syncedAt = safeText(value.syncedAt, 40);
  if (!syncedAt) return null;
  return {
    syncedAt,
    stats: normalizeSyncStats(value.stats),
    errors: normalizeSyncErrors(value.errors),
  };
}

function normalizeEventList(input: unknown): EditorialEvent[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeEvent).filter((event): event is EditorialEvent => event !== null);
}

// --- Panel redakcyjny ---

export interface EditorialQueue {
  events: EditorialEvent[];
  reactions: ReactionCountsById;
  lastSync: LastSync | null;
}

export async function fetchEditorialQueue(): Promise<EditorialQueue> {
  const payload = asRecord(await request("/api/editorial/events"));
  return {
    events: normalizeEventList(payload.events),
    reactions: normalizeReactionCountsById(payload.reactions),
    lastSync: normalizeLastSync(payload.lastSync),
  };
}

export interface SyncResult {
  events: EditorialEvent[];
  syncedAt: string;
  stats: LastSync["stats"];
  errors: LastSync["errors"];
}

/** Uruchamia agregacje. Trwa kilkadziesiat sekund, bo pobiera i analizuje zrodla. */
export async function runSynchronization(): Promise<SyncResult> {
  const payload = asRecord(await request("/api/sync", { method: "POST", action: "sync" }));
  return {
    events: normalizeEventList(payload.events),
    syncedAt: safeText(payload.syncedAt, 40),
    stats: normalizeSyncStats(payload.stats),
    errors: normalizeSyncErrors(payload.errors),
  };
}

/** Kontrola oryginalnosci pojedynczego pola wzgledem zapisanego kontekstu zrodel. */
export async function validateText(
  validationId: string,
  field: ValidatedField,
  text: string,
): Promise<Originality> {
  const payload = await request("/api/validate", {
    method: "POST",
    action: "validate",
    body: { validationId, field, text },
  });
  return normalizeOriginality(payload);
}

/** Tresc materialu wysylana przy zapisie i zatwierdzaniu. */
export interface EditorialPatch {
  title: string;
  level1: string;
  level2: string;
  category: string;
  tags: string[];
}

export interface EditorialResult {
  event: EditorialEvent | null;
  /** Obecne przy akcji regenerate: informuje, czy model dal gotowy material. */
  generation: { status: string; reason: string } | null;
}

export async function submitEditorialAction(
  eventId: string,
  action: EditorialAction,
  patch?: EditorialPatch,
): Promise<EditorialResult> {
  const payload = asRecord(
    await request("/api/editorial", {
      method: "POST",
      action: "editorial",
      body: { eventId, action, ...patch },
    }),
  );

  const generation = asRecord(payload.generation);
  const generationStatus = safeText(generation.status, 40);

  return {
    event: normalizeEvent(payload.event),
    generation: generationStatus
      ? { status: generationStatus, reason: safeText(generation.reason, 600) }
      : null,
  };
}

// --- Publiczny feed ---

export interface PublicFeed {
  items: Publication[];
  generatedAt: string;
}

export async function fetchPublicFeed(): Promise<PublicFeed> {
  const payload = asRecord(await request("/api/public/feed"));
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizePublication).filter((item): item is Publication => item !== null)
    : [];
  return { items, generatedAt: safeText(payload.generatedAt, 40) };
}

/**
 * Zglasza zmiane wlasnego glosu. Serwer trzyma wylacznie liczniki, wiec
 * przesylamy poprzednia i nowa wartosc, a nie identyfikator glosujacego.
 */
export async function reportReaction(
  id: string,
  from: string,
  to: string,
): Promise<ReactionCounts | null> {
  try {
    const payload = asRecord(
      await request("/api/public/reaction", {
        method: "POST",
        body: { id, from, to },
      }),
    );
    return normalizeReactionCounts(payload.reactions);
  } catch {
    // Ocena jest dodatkiem: brak sieci nie moze przerywac czytania.
    return null;
  }
}

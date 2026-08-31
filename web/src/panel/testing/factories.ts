import { normalizeEvent } from "../../shared/normalize";
import type { EditorialEvent, EditorialStatus } from "../../shared/types";

/** Tekst o zadanej liczbie slow, do sprawdzania progow redakcyjnych. */
export function words(count: number, stem = "słowo"): string {
  return Array.from({ length: count }, (_, index) => `${stem}${index}`).join(" ");
}

interface EventOverrides {
  id?: string;
  status?: EditorialStatus;
  level1?: string;
  level2?: string;
  title?: string;
  tags?: string[];
  /** Czy zapisany wynik kontroli uznaje tresc za poprawna. */
  checksValid?: boolean;
}

/**
 * Material redakcyjny przechodzacy przez te sama normalizacje co dane z sieci,
 * zeby test operowal na dokladnie takim obiekcie, jaki widzi aplikacja.
 */
export function makeEvent(overrides: EventOverrides = {}): EditorialEvent {
  const level1 = overrides.level1 ?? words(24, "skrot");
  const level2 = overrides.level2 ?? words(80, "kontekst");
  const valid = overrides.checksValid ?? true;

  const event = normalizeEvent({
    id: overrides.id ?? "live-1",
    validationId: overrides.id ?? "live-1",
    title: overrides.title ?? "Prokuratura skierowała akt oskarżenia",
    level1,
    level2,
    category: "kraj",
    tags: overrides.tags ?? ["prokuratura", "sąd"],
    detectedAt: "31.08 / 11:54",
    confidence: 82,
    status: overrides.status ?? "review",
    sources: [
      {
        domain: "RMF24",
        time: "10:00",
        title: "Akt oskarżenia skierowany do sądu",
        url: "https://www.rmf24.pl/a",
        wordCount: 420,
        extractionMethod: "readability",
        summary: "Streszczenie robocze artykułu.",
        preview: "Fragment tekstu źródłowego.",
        keyClaims: ["Akt oskarżenia trafił do sądu."],
      },
      {
        domain: "ONET",
        time: "10:20",
        title: "Zarzuty o charakterze terrorystycznym",
        url: "https://wiadomosci.onet.pl/b",
        wordCount: 380,
        extractionMethod: "selector",
        summary: "Drugie streszczenie.",
        preview: "Inny fragment.",
        keyClaims: [],
      },
    ],
    facts: ["Pełną treść pobrano z 2 publikacji."],
    generation: {
      status: "ready",
      reason: "Pakiet gotowy.",
      model: "test",
      basisIds: [0],
      originality: {
        valid,
        status: valid ? "passed" : "blocked",
        wordCount: 24,
        maxCopiedWords: 3,
        ngramOverlap: 6,
        groundingScore: 44,
        validatedText: valid ? level1 : "",
        reasons: valid ? [] : ["Tekst ma zbyt słabe pokrycie w potwierdzonych informacjach."],
      },
      contextOriginality: {
        valid,
        status: valid ? "passed" : "blocked",
        wordCount: 80,
        maxCopiedWords: 4,
        ngramOverlap: 7,
        groundingScore: 38,
        validatedText: valid ? level2 : "",
        reasons: [],
      },
    },
    verification: {
      sharedClaims: [
        { text: "Akt oskarżenia trafił do sądu.", sources: ["RMF24", "ONET"], confidence: 88 },
      ],
      conflicts: [],
      uniqueClaims: [],
      method: ["Pobranie pełnych treści."],
      essenceBasis: {
        text: "Akt oskarżenia trafił do sądu.",
        sources: ["RMF24", "ONET"],
        confidence: 88,
      },
    },
    updatedAt: "2026-08-31T11:54:00.000Z",
  });

  if (!event) throw new Error("Nie udało się zbudować materiału testowego.");
  return event;
}

/** Material bez tresci: generator zadzialal fail-closed. */
export function makeEmptyEvent(id = "live-empty"): EditorialEvent {
  const event = normalizeEvent({
    id,
    validationId: id,
    title: "",
    level1: "",
    level2: "",
    category: "inne",
    tags: [],
    status: "review",
    confidence: 40,
    detectedAt: "31.08 / 09:10",
    sources: [
      { domain: "RMF24", time: "09:00", title: "Tytuł", url: "https://www.rmf24.pl/c" },
      { domain: "ONET", time: "09:05", title: "Tytuł 2", url: "https://wiadomosci.onet.pl/d" },
    ],
    generation: {
      status: "blocked-originality",
      reason: "Model nie spełnił zasad redakcyjnych w trzech próbach.",
    },
  });
  if (!event) throw new Error("Nie udało się zbudować materiału testowego.");
  return event;
}

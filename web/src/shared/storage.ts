/**
 * Dostep do localStorage odporny na tryb prywatny i brak miejsca.
 *
 * W trybie prywatnym Safari zapis rzuca wyjatkiem, a odczyt moze zwrocic null.
 * Zapis jest funkcja pomocnicza, nie krytyczna: jego nieudanie nie moze przerwac
 * czytania wydania, dlatego bledy sa tu celowo pochlaniane.
 */

/** Klucze uzywane przez aplikacje. Trzymane w jednym miejscu, zeby nie rozjechaly sie literowo. */
export const STORAGE_KEYS = {
  panelTheme: "telegram-theme",
  feedTheme: "feed-theme",
  feedFontStep: "feed-font-step",
  feedLastSeen: "feed-last-seen",
  reactions: "telegram-reactions",
  seen: "telegram-seen",
} as const;

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Tryb prywatny albo brak miejsca - pomijamy zapis.
  }
}

/** Odczyt JSON z wartoscia zapasowa. Uszkodzony wpis traktujemy jak brak wpisu. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Struktura cykliczna nie powinna tu trafic, ale nie przerywamy dzialania.
  }
}

/** Formatowanie dat i polskiej odmiany liczebnikow. */

const LOCALE = "pl-PL";

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

const dayMonthTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const fullDateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const weekdayFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Godzina i minuta, np. "14:05". Uzywane w paskach statusu. */
export function formatTime(value: string | null | undefined): string {
  const date = parse(value);
  return date ? timeFormat.format(date) : "—";
}

/** Dzien, miesiac i godzina, np. "31 sierpnia 14:05". */
export function formatDate(value: string | null | undefined): string {
  const date = parse(value);
  return date ? dayMonthTimeFormat.format(date) : "—";
}

/** Pelna data z rokiem. Uzywane w czytniku, gdzie liczy sie jednoznacznosc. */
export function formatFullDate(value: string | null | undefined): string {
  const date = parse(value);
  return date ? fullDateFormat.format(date) : "—";
}

/** Data wydania w winiecie, np. "poniedziałek, 31 sierpnia 2026". */
export function formatEditionDate(date: Date = new Date()): string {
  return weekdayFormat.format(date);
}

/**
 * Wiek wpisu wzgledem teraz, np. "3 godz. temu".
 * Mowi czytelnikowi, jak daleko w przeszlosc zaszedl w wydaniu.
 */
export function formatRelativeAge(value: string | null | undefined, now = Date.now()): string {
  const date = parse(value);
  if (!date) return "";

  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (minutes < 1) return "przed chwilą";
  if (minutes < 60) return `${minutes} min temu`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;

  const days = Math.round(hours / 24);
  if (days === 1) return "wczoraj";
  if (days < 31) return `${days} dni temu`;

  const months = Math.round(days / 30);
  return months === 1 ? "miesiąc temu" : `${months} mies. temu`;
}

/** Odmiana rzeczownika "wiadomość" przez liczebnik: 1 nowa, 2 nowe, 5 nowych. */
export function pluralNews(count: number): string {
  if (count === 1) return "nowa wiadomość";
  const rest = count % 10;
  const teens = count % 100;
  const isFewForm = rest >= 2 && rest <= 4 && !(teens >= 12 && teens <= 14);
  return isFewForm ? "nowe wiadomości" : "nowych wiadomości";
}

/** Znacznik czasu wpisu jako liczba, do porownan. Zwraca 0, gdy brak daty. */
export function timestampOf(value: {
  updatedAt?: string | null;
  publishedAt?: string | null;
}): number {
  const parsed = Date.parse(value.updatedAt ?? value.publishedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

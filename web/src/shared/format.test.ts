import { describe, expect, it } from "vitest";
import { formatFullDate, formatRelativeAge, formatTime, pluralNews, timestampOf } from "./format";

describe("pluralNews — odmiana przez liczebnik", () => {
  const przypadki: readonly [number, string][] = [
    [1, "nowa wiadomość"],
    [2, "nowe wiadomości"],
    [3, "nowe wiadomości"],
    [4, "nowe wiadomości"],
    [5, "nowych wiadomości"],
    [11, "nowych wiadomości"],
    // 12-14 to wyjatek: mimo koncowki 2-4 uzywamy formy dopelniaczowej.
    [12, "nowych wiadomości"],
    [13, "nowych wiadomości"],
    [14, "nowych wiadomości"],
    [22, "nowe wiadomości"],
    [23, "nowe wiadomości"],
    [25, "nowych wiadomości"],
    [112, "nowych wiadomości"],
    [122, "nowe wiadomości"],
  ];

  for (const [liczba, oczekiwane] of przypadki) {
    it(`${liczba} → ${oczekiwane}`, () => {
      expect(pluralNews(liczba)).toBe(oczekiwane);
    });
  }
});

describe("formatRelativeAge — wiek wpisu", () => {
  const teraz = Date.parse("2026-08-31T12:00:00.000Z");
  const przed = (minuty: number) => new Date(teraz - minuty * 60_000).toISOString();

  it("mniej niż minuta to 'przed chwilą'", () => {
    expect(formatRelativeAge(przed(0), teraz)).toBe("przed chwilą");
  });

  it("minuty", () => {
    expect(formatRelativeAge(przed(25), teraz)).toBe("25 min temu");
  });

  it("godziny", () => {
    expect(formatRelativeAge(przed(3 * 60), teraz)).toBe("3 godz. temu");
  });

  it("jeden dzień to 'wczoraj'", () => {
    expect(formatRelativeAge(przed(24 * 60), teraz)).toBe("wczoraj");
  });

  it("dni", () => {
    expect(formatRelativeAge(przed(5 * 24 * 60), teraz)).toBe("5 dni temu");
  });

  it("30 dni to jeszcze dni, granica wypada wyżej", () => {
    expect(formatRelativeAge(przed(30 * 24 * 60), teraz)).toBe("30 dni temu");
  });

  it("miesiąc zaczyna się od 31 dnia", () => {
    expect(formatRelativeAge(przed(31 * 24 * 60), teraz)).toBe("miesiąc temu");
  });

  it("miesiące", () => {
    expect(formatRelativeAge(przed(90 * 24 * 60), teraz)).toBe("3 mies. temu");
  });

  it("brak daty daje pusty ciąg, a nie 'Invalid Date'", () => {
    expect(formatRelativeAge(null, teraz)).toBe("");
    expect(formatRelativeAge("nie data", teraz)).toBe("");
  });
});

describe("formatowanie dat", () => {
  it("pełna data zawiera rok i godzinę", () => {
    const wynik = formatFullDate("2026-08-31T11:54:00.000Z");
    expect(wynik).toMatch(/\d{4}/);
    expect(wynik).toMatch(/\d{2}:\d{2}/);
  });

  it("brak daty daje kreskę, a nie 'Invalid Date'", () => {
    expect(formatFullDate(null)).toBe("—");
    expect(formatTime("nie data")).toBe("—");
  });
});

describe("timestampOf — porównywanie świeżości", () => {
  it("preferuje updatedAt nad publishedAt", () => {
    const wynik = timestampOf({
      updatedAt: "2026-08-31T12:00:00.000Z",
      publishedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(wynik).toBe(Date.parse("2026-08-31T12:00:00.000Z"));
  });

  it("bez dat zwraca zero, żeby wpis nie udawał najnowszego", () => {
    expect(timestampOf({})).toBe(0);
    expect(timestampOf({ updatedAt: null, publishedAt: null })).toBe(0);
  });
});

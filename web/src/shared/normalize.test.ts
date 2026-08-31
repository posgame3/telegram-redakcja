import { describe, expect, it } from "vitest";
import {
  clamp,
  countWords,
  normalizeEvent,
  normalizeImage,
  normalizeOriginality,
  normalizePublication,
  normalizeSyncStats,
  safeText,
  safeUrl,
  sameOriginUrl,
} from "./normalize";

describe("safeUrl — odrzuca adresy zdolne wykonac kod", () => {
  const groźne = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ];
  for (const wartość of groźne) {
    it(`odrzuca ${wartość.slice(0, 24)}`, () => {
      expect(safeUrl(wartość)).toBe("");
    });
  }

  it("dopuszcza http i https", () => {
    expect(safeUrl("https://www.rmf24.pl/a")).toBe("https://www.rmf24.pl/a");
    expect(safeUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("odrzuca wartości, które nie są tekstem", () => {
    expect(safeUrl(null)).toBe("");
    expect(safeUrl(42)).toBe("");
    expect(safeUrl({ url: "https://example.com" })).toBe("");
  });
});

describe("sameOriginUrl — zdjęcia wychodzą tylko z własnego proxy", () => {
  it("dopuszcza ścieżkę względną do proxy obrazków", () => {
    const wynik = sameOriginUrl("/img?u=https%3A%2F%2Fexample.com%2Fa.jpg&v=full");
    expect(wynik).toBe(`${window.location.origin}/img?u=https%3A%2F%2Fexample.com%2Fa.jpg&v=full`);
  });

  it("odrzuca adres z obcej domeny, żeby nie wrócił hotlink do CDN wydawcy", () => {
    expect(sameOriginUrl("https://galeria.bankier.pl/p/f/9/zdjecie.jpg")).toBe("");
  });

  it("odrzuca puste i niepoprawne wartości", () => {
    expect(sameOriginUrl("")).toBe("");
    expect(sameOriginUrl(null)).toBe("");
  });
});

describe("safeText i clamp — przycinanie danych z sieci", () => {
  it("przycina tekst do limitu i usuwa białe znaki z brzegów", () => {
    expect(safeText("  abc  ", 10)).toBe("abc");
    expect(safeText("abcdef", 3)).toBe("abc");
  });

  it("zwraca pusty ciąg dla wartości, które nie są tekstem", () => {
    expect(safeText(undefined)).toBe("");
    expect(safeText(123)).toBe("");
  });

  it("domyka liczby do zakresu, a wartości nieliczbowe do minimum", () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp("nie liczba", 0, 100)).toBe(0);
    expect(clamp(42.6, 0, 100)).toBe(43);
  });
});

describe("countWords — liczy słowa tak jak walidacja na serwerze", () => {
  it("liczy wyrazy z polskimi znakami", () => {
    expect(countWords("Prokuratura skierowała akt oskarżenia")).toBe(4);
  });

  it("traktuje wyraz z łącznikiem jako jeden", () => {
    expect(countWords("Calów-Jaszewska potwierdziła")).toBe(2);
  });

  it("zwraca zero dla tekstu bez wyrazów", () => {
    expect(countWords("   ---   ")).toBe(0);
  });
});

describe("normalizeEvent — odrzuca wpisy niemożliwe do pokazania", () => {
  const poprawneŹródło = {
    domain: "RMF24",
    time: "10:00",
    title: "Tytuł źródła",
    url: "https://www.rmf24.pl/a",
  };

  it("zwraca null bez identyfikatora", () => {
    expect(normalizeEvent({ sources: [poprawneŹródło] })).toBeNull();
  });

  it("zwraca null bez źródeł, bo materiału nie da się zweryfikować", () => {
    expect(normalizeEvent({ id: "live-1", sources: [] })).toBeNull();
  });

  it("odrzuca źródło bez adresu, ale zachowuje pozostałe", () => {
    const wynik = normalizeEvent({
      id: "live-1",
      sources: [poprawneŹródło, { domain: "X", title: "Bez adresu" }],
    });
    expect(wynik?.sources).toHaveLength(1);
  });

  it("uzupełnia braki wartościami domyślnymi", () => {
    const wynik = normalizeEvent({ id: "live-1", sources: [poprawneŹródło] });
    expect(wynik).toMatchObject({
      id: "live-1",
      status: "review",
      category: "inne",
      confidence: 0,
      tags: [],
      facts: [],
      image: null,
    });
    expect(wynik?.verification.essenceBasis.text).toBe("Brak podstawy esencji.");
  });

  it("przyjmuje skrót ze starszego pola draft, gdy brak level1", () => {
    const wynik = normalizeEvent({
      id: "live-1",
      draft: "Skrót ze starego pola",
      sources: [poprawneŹródło],
    });
    expect(wynik?.level1).toBe("Skrót ze starego pola");
  });

  it("nieznany status i dział sprowadza do wartości bezpiecznych", () => {
    const wynik = normalizeEvent({
      id: "live-1",
      status: "wymyślony",
      category: "wymyślona",
      sources: [poprawneŹródło],
    });
    expect(wynik?.status).toBe("review");
    expect(wynik?.category).toBe("inne");
  });

  it("ogranicza liczbę tagów do pięciu", () => {
    const wynik = normalizeEvent({
      id: "live-1",
      tags: ["a", "b", "c", "d", "e", "f", "g"],
      sources: [poprawneŹródło],
    });
    expect(wynik?.tags).toHaveLength(5);
  });
});

describe("normalizePublication — karta feedu", () => {
  it("zwraca null, gdy nie ma czym zatytułować karty", () => {
    expect(normalizePublication({ id: "a1" })).toBeNull();
  });

  it("wystarcza sam level1", () => {
    expect(normalizePublication({ id: "a1", level1: "Skrót" })?.level1).toBe("Skrót");
  });

  it("domyka liczniki ocen do zera", () => {
    const wynik = normalizePublication({ id: "a1", level1: "Skrót" });
    expect(wynik?.reactions).toEqual({ likes: 0, dislikes: 0 });
  });
});

describe("normalizeImage — zdjęcie materiału", () => {
  it("odrzuca zdjęcie z obcego hosta", () => {
    expect(normalizeImage({ url: "https://cdn.obcy.pl/a.jpg", alt: "x" })).toBeNull();
  });

  it("zachowuje opis i podpis dla zdjęcia z proxy", () => {
    const wynik = normalizeImage({ url: "/img?u=x&v=full", alt: "Opis", credit: "RMF24" });
    expect(wynik).toMatchObject({ alt: "Opis", credit: "RMF24" });
  });
});

describe("normalizeOriginality — metryki kontroli tekstu", () => {
  it("bez danych zwraca stan niezweryfikowany, nie poprawny", () => {
    const wynik = normalizeOriginality(undefined);
    expect(wynik.valid).toBe(false);
    expect(wynik.status).toBe("unverified");
  });

  it("uznaje za poprawny tylko jawne valid === true", () => {
    expect(normalizeOriginality({ valid: "true" }).valid).toBe(false);
    expect(normalizeOriginality({ valid: true }).valid).toBe(true);
  });
});

describe("normalizeSyncStats — statystyki przebiegu", () => {
  it("pomija pola nieliczbowe zamiast wstawiać zero", () => {
    const wynik = normalizeSyncStats({ feedsOk: 5, feedsChecked: "siedem" });
    expect(wynik.feedsOk).toBe(5);
    expect(wynik.feedsChecked).toBeUndefined();
  });
});

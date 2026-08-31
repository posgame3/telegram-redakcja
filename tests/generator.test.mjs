import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferCategories, validateContextOriginality, validateEditorialMetadata, validateOriginality } from "../src/generator.mjs";

const CLAIMS = [
  "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian.",
  "Stopa referencyjna pozostała na poziomie 5,75 procent.",
  "Decyzja była zgodna z oczekiwaniami większości ekonomistów.",
];
const SOURCES = [
  "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian. Stopa referencyjna pozostała na poziomie 5,75 procent. Decyzja była zgodna z oczekiwaniami większości ekonomistów ankietowanych przed posiedzeniem.",
  "Stopy procentowe pozostają bez zmian po posiedzeniu RPP. Stopa referencyjna wynosi 5,75 procent.",
];
const context = { sourceTexts: SOURCES, claimTexts: CLAIMS };

function reason(result, fragment) {
  return result.reasons.some((entry) => entry.toLowerCase().includes(fragment.toLowerCase()));
}

describe("validateOriginality — skrót", () => {
  it("przyjmuje tekst 20–30 słów oparty na faktach", () => {
    const text = "Rada Polityki Pieniężnej podjęła postanowienie o braku zmian w stopach procentowych, dlatego stopa referencyjna wynosi nadal 5,75 procent, co przewidywała większość ekonomistów.";
    const result = validateOriginality(text, context);
    assert.equal(result.valid, true, result.reasons.join(" "));
    assert.ok(result.wordCount >= 20 && result.wordCount <= 30);
  });

  it("odrzuca tekst krótszy niż 20 słów", () => {
    const result = validateOriginality("Stopy procentowe bez zmian.", context);
    assert.equal(result.valid, false);
    assert.ok(reason(result, "od 20 do 30 słów"));
  });

  it("odrzuca cytat", () => {
    const text = "Rada Polityki Pieniężnej podjęła „postanowienie” o braku zmian w stopach procentowych, dlatego stopa referencyjna wynosi nadal 5,75 procent, co przewidywali ekonomiści.";
    assert.ok(reason(validateOriginality(text, context), "cudzysłów"));
  });

  it("odrzuca przepisany fragment źródła dłuższy niż 5 słów", () => {
    const text = "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian, a stopa referencyjna pozostała na poziomie 5,75 procent zgodnie z oczekiwaniami.";
    const result = validateOriginality(text, context);
    assert.equal(result.valid, false);
    assert.ok(result.maxCopiedWords > 5);
  });

  it("odrzuca tekst bez pokrycia w potwierdzonych faktach", () => {
    const text = "Wczorajszy mecz koszykówki zakończył się remisem, a kibice opuścili halę zadowoleni, ponieważ obie drużyny zagrały wyrównane spotkanie bez kontuzji.";
    assert.ok(reason(validateOriginality(text, context), "pokrycie"));
  });

  it("blokuje pusty tekst, gdy brak potwierdzonych faktów", () => {
    const result = validateOriginality("", { sourceTexts: [], claimTexts: [] });
    assert.equal(result.valid, false);
    assert.ok(reason(result, "Brak faktów"));
  });
});

describe("validateContextOriginality — szerszy tekst", () => {
  it("wymaga co najmniej 60 słów", () => {
    const result = validateContextOriginality("Stopa referencyjna pozostaje na poziomie 5,75 procent, co potwierdziła Rada Polityki Pieniężnej.", context);
    assert.equal(result.valid, false);
    assert.ok(reason(result, "od 60 do 140 słów"));
  });

  it("dopuszcza dłuższy zapożyczony ciąg niż skrót, ale nie więcej niż 8 słów", () => {
    const copied = "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian oraz dodatkowo";
    const result = validateContextOriginality(copied, context);
    assert.ok(result.maxCopiedWords >= 7);
  });
});

describe("validateEditorialMetadata — tytuł, kategoria, tagi", () => {
  const base = {
    title: "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian",
    category: "gospodarka",
    tags: ["stopy procentowe", "stopa referencyjna"],
  };

  it("przyjmuje tytuł zbudowany ze słów jednego faktu", () => {
    const result = validateEditorialMetadata(base, context);
    assert.equal(result.valid, true, result.reasons.join(" "));
    assert.equal(result.titleSupportedByClaim, true);
  });

  it("odrzuca tytuł ze słowem, którego nie ma w faktach", () => {
    const result = validateEditorialMetadata({ ...base, title: "Rada Polityki Pieniężnej zaskoczyła rynki decyzją" }, context);
    assert.equal(result.valid, false);
    assert.ok(result.unsupportedTitleTokens.length > 0);
  });

  it("odrzuca tytuł, który odwraca negację faktu", () => {
    const claims = ["Prezydent nie podpisał ustawy budżetowej w piątek."];
    const result = validateEditorialMetadata(
      { title: "Prezydent podpisał ustawę budżetową", category: "kraj", tags: ["ustawy", "budżetowej"] },
      { sourceTexts: claims, claimTexts: claims },
    );
    assert.equal(result.titleSupportedByClaim, false);
  });

  it("odrzuca tag w innej formie gramatycznej niż w faktach", () => {
    const claims = ["Sąd Okręgowy w Warszawie odrzucił wniosek obrońcy Marcina Romanowskiego."];
    const context2 = { sourceTexts: claims, claimTexts: claims };
    const zly = validateEditorialMetadata({ title: "Sąd Okręgowy odrzucił wniosek obrońcy", category: "kraj", tags: ["marcin romanowski", "sąd okręgowy"] }, context2);
    assert.ok(zly.unsupportedTags.includes("marcin romanowski"));
    const dobry = validateEditorialMetadata({ title: "Sąd Okręgowy odrzucił wniosek obrońcy", category: "kraj", tags: ["marcina romanowskiego", "sąd okręgowy"] }, context2);
    assert.deepEqual(dobry.unsupportedTags, []);
  });

  it("odrzuca kategorię, która nie wynika z faktów", () => {
    const result = validateEditorialMetadata({ ...base, category: "technologia" }, context);
    assert.equal(result.valid, false);
    assert.ok(reason(result, "Kategoria nie wynika"));
  });

  it("wymaga od 2 do 5 tagów", () => {
    assert.ok(reason(validateEditorialMetadata({ ...base, tags: ["stopy procentowe"] }, context), "od 2 do 5 tagów"));
  });
});

describe("inferCategories — regresje fałszywych trafień", () => {
  it("dopasowuje rdzeń slowa mimo polskiej odmiany", () => {
    const claims = ["Żurek przekazał informacje o działaniach prokuratury w tej sprawie."];
    assert.deepEqual(inferCategories(claims), ["kraj"]);
  });

  it("nie wysyła Europejskiego Nakazu Aresztowania do działu rynki", () => {
    const claims = ["Sąd Okręgowy w Warszawie odrzucił wniosek o uchylenie Europejskiego Nakazu Aresztowania."];
    assert.ok(!inferCategories(claims).includes("rynki"), "słowo euro nie może dopasować się do Europejskiego");
  });

  it("nie traktuje akcji ratunkowej jako akcji giełdowych", () => {
    const claims = ["Akcja ratunkowa w Tatrach trwała kilka godzin i zakończyła się wieczorem."];
    assert.ok(!inferCategories(claims).includes("rynki"));
  });

  it("nie wysyła pracowników ochrony zdrowia do działu biznes", () => {
    const claims = ["Pacjent zaatakował pielęgniarkę oraz pozostałych pracowników ochrony zdrowia w szpitalu."];
    const categories = inferCategories(claims);
    assert.ok(!categories.includes("biznes"), "rdzeń pracownik nie może kwalifikować zdarzenia w szpitalu do biznesu");
    assert.ok(categories.includes("kraj"));
  });

  it("rozpoznaje giełdę i gospodarkę", () => {
    assert.ok(inferCategories(["Indeks WIG20 wzrósł, a akcje spółki podrożały na zamknięciu notowań."]).includes("rynki"));
    assert.ok(inferCategories(["Inflacja spadła, a stopy procentowe pozostały bez zmian."]).includes("gospodarka"));
  });

  it("zwraca pustą listę, gdy fakty nie pasują do żadnego działu", () => {
    assert.deepEqual(inferCategories(["Kot przeszedł przez podwórko i usiadł na parapecie sąsiada."]), []);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testing } from "../src/aggregator.mjs";

const { buildVerification, canonicalArticleUrl, chooseEvidence, extractNumbers, groupCandidates, meetsSourceRequirement, signaturesMatch, similarity, summarizeArticle } = testing;

function item(overrides = {}) {
  return {
    sourceId: "a",
    sourceName: "A",
    ownerGroup: "grupa-a",
    title: "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian",
    description: "Stopa referencyjna pozostała na poziomie 5,75 procent.",
    url: "https://example.test/artykul",
    publishedAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

function article(overrides = {}) {
  return {
    sourceName: "A",
    ownerGroup: "grupa-a",
    title: "Rada Polityki Pieniężnej utrzymała stopy procentowe",
    text: "Rada Polityki Pieniężnej utrzymała stopy procentowe bez zmian na poziomie 5,75 procent. Decyzja była zgodna z oczekiwaniami większości ankietowanych wcześniej ekonomistów rynkowych.",
    ...overrides,
  };
}

describe("meetsSourceRequirement — wymóg dwóch niezależnych źródeł", () => {
  it("odrzuca pojedynczy artykuł", () => {
    assert.equal(meetsSourceRequirement([item()]), false);
  });

  it("odrzuca dwa artykuły tego samego wydawcy", () => {
    assert.equal(meetsSourceRequirement([item(), item({ sourceName: "A2" })]), false);
  });

  it("przyjmuje dwa artykuły z niezależnych grup wydawniczych", () => {
    assert.equal(meetsSourceRequirement([item(), item({ ownerGroup: "grupa-b", sourceName: "B" })]), true);
  });
});

describe("groupCandidates — rozpoznawanie tego samego wydarzenia", () => {
  it("łączy zbliżone tytuły z różnych wydawnictw w jedno wydarzenie", () => {
    const groups = groupCandidates([
      item(),
      item({ ownerGroup: "grupa-b", sourceName: "B", title: "Stopy procentowe bez zmian po posiedzeniu Rady Polityki Pieniężnej" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 2);
  });

  it("nie łączy wiadomości o różnych sprawach", () => {
    const groups = groupCandidates([
      item(),
      item({
        ownerGroup: "grupa-b",
        sourceName: "B",
        title: "Turysta zginął po upadku w Tatrach podczas burzy",
        description: "Akcja ratunkowa w rejonie schroniska trwała kilka godzin.",
      }),
    ]);
    assert.equal(groups.length, 2);
  });

  it("nie łączy materiałów oddalonych o więcej niż 48 godzin", () => {
    const groups = groupCandidates([
      item(),
      item({ ownerGroup: "grupa-b", sourceName: "B", publishedAt: "2026-08-20T10:00:00.000Z" }),
    ]);
    assert.equal(groups.length, 2);
  });
});

describe("buildVerification — potwierdzenia i rozbieżności", () => {
  it("uznaje twierdzenie potwierdzone przez dwie niezależne grupy", () => {
    const verification = buildVerification([article(), article({ ownerGroup: "grupa-b", sourceName: "B" })]);
    assert.ok(verification.sharedClaims.length > 0);
    assert.ok(verification.sharedClaims[0].sources.length >= 2);
  });

  it("nie uznaje twierdzenia powtórzonego w tej samej grupie wydawniczej", () => {
    const verification = buildVerification([article(), article({ sourceName: "A2" })]);
    assert.equal(verification.sharedClaims.length, 0);
  });

  it("oznacza rozbieżność, gdy źródła podają różne liczby", () => {
    const wspolne = "Prokuratura zabezpieczyła środki na poczet przyszłych odszkodowań dla poszkodowanych klientów giełdy.";
    const verification = buildVerification([
      article({ text: `${wspolne} Zabezpieczono dotychczas ponad 100 mln zł w tej sprawie karnej.` }),
      article({ ownerGroup: "grupa-b", sourceName: "B", text: `${wspolne} Zabezpieczono dotychczas ponad 250 mln zł w tej sprawie karnej.` }),
    ]);
    assert.ok(verification.conflicts.length > 0, "różne liczby w tym samym zdaniu muszą dać rozbieżność");
  });

  it("zawsze opisuje metodę weryfikacji", () => {
    const verification = buildVerification([article(), article({ ownerGroup: "grupa-b", sourceName: "B" })]);
    assert.ok(verification.method.length >= 4);
  });
});

describe("extractNumbers — normalizacja liczb", () => {
  it("rozpoznaje liczbę z przecinkiem i wartość z jednostką", () => {
    const values = extractNumbers("Stopa referencyjna wynosi 5,75 procent, a zabezpieczono 100 mln zł.");
    assert.ok(values.includes("5.75"), JSON.stringify(values));
    assert.ok(values.some((value) => value.includes("100")), JSON.stringify(values));
  });

  it("nie zwraca duplikatów tej samej wartości", () => {
    const values = extractNumbers("Wzrost 5 procent oraz ponownie 5 procent w kolejnym kwartale.");
    assert.equal(values.filter((value) => value === "5").length, 1);
  });
});

describe("canonicalArticleUrl — porządkowanie adresów", () => {
  it("usuwa parametry kampanii, kotwicę i końcowy ukośnik", () => {
    const result = canonicalArticleUrl("https://example.test/artykul/?utm_source=fb&fbclid=123#sekcja");
    assert.equal(result, "https://example.test/artykul");
  });

  it("zachowuje parametry treściowe i sortuje je", () => {
    const result = canonicalArticleUrl("https://example.test/a?b=2&a=1");
    assert.equal(result, "https://example.test/a?a=1&b=2");
  });
});

describe("pozostałe funkcje pomocnicze", () => {
  it("chooseEvidence bierze najpierw po jednym materiale z każdej grupy", () => {
    const chosen = chooseEvidence([
      item(),
      item({ sourceName: "A2" }),
      item({ ownerGroup: "grupa-b", sourceName: "B" }),
    ], 2);
    assert.deepEqual([...new Set(chosen.map((entry) => entry.ownerGroup))].sort(), ["grupa-a", "grupa-b"]);
  });

  it("signaturesMatch wymaga wyraźnego pokrycia i odpowiedniej długości", () => {
    assert.equal(signaturesMatch(["a", "b", "c"], ["a", "b", "c"]), false, "za krótkie sygnatury nie mogą się zgadzać");
    assert.equal(signaturesMatch(["rada", "stopy", "procentowe", "referencyjna"], ["rada", "stopy", "procentowe", "referencyjna"]), true);
    assert.equal(signaturesMatch(["rada", "stopy", "procentowe", "referencyjna"], ["tatry", "turysta", "burza", "ratownicy"]), false);
  });

  it("similarity rośnie dla materiałów o tym samym wydarzeniu", () => {
    const bliskie = similarity(item(), item({ title: "Stopy procentowe bez zmian po decyzji Rady Polityki Pieniężnej" }));
    const dalekie = similarity(item(), item({ title: "Turysta zginął w Tatrach", description: "Akcja ratunkowa trwała godzinami." }));
    assert.ok(bliskie > dalekie);
  });

  it("summarizeArticle zwraca skrócone streszczenie", () => {
    const summary = summarizeArticle(article());
    assert.ok(summary.length > 0);
    assert.ok(summary.split(/\s+/).length <= 45);
  });
});

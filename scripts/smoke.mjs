import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testing as aggregator } from "../src/aggregator.mjs";
import { generateOriginalTelegram, validateEditorialMetadata, validateOriginality } from "../src/generator.mjs";
import { EditorialStore } from "../src/store.mjs";
import { readFeed, scrapeArticle, testing as scraper } from "../src/scraper.mjs";
import { SOURCES } from "../src/sources.mjs";

function countWords(value) {
  return (value.match(/[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*/gu) || []).length;
}

const relatedA = { title: "Rząd przedstawił nową reformę podatkową", description: "Zmiany w PIT i CIT zaczną obowiązywać od stycznia", ownerGroup: "a" };
const relatedB = { title: "Nowa reforma podatkowa rządu. Zmiany w PIT", description: "Projekt zmian podatkowych obejmuje również CIT", ownerGroup: "b" };
const unrelated = { title: "Reprezentacja wygrała wieczorny mecz", description: "Spotkanie zakończyło się wynikiem dwa do zera", ownerGroup: "c" };
assert(aggregator.similarity(relatedA, relatedB) > aggregator.similarity(relatedA, unrelated), "Grupowanie nie odróżnia podobnych tematów");
assert.equal(aggregator.chooseEvidence([relatedA, { ...relatedA, ownerGroup: "a" }, relatedB], 2).map((item) => item.ownerGroup).join(","), "a,b");
assert(!aggregator.meetsSourceRequirement([relatedA]), "Jedno źródło nie może utworzyć wydarzenia");
assert(!aggregator.meetsSourceRequirement([relatedA, { ...relatedA }]), "Dwa źródła tego samego właściciela nie mogą utworzyć wydarzenia");
assert(aggregator.meetsSourceRequirement([relatedA, relatedB]), "Dwa niezależne źródła powinny utworzyć wydarzenie");

const verificationArticles = [
  { ...relatedA, sourceName: "ŹRÓDŁO A", text: "Rząd ogłosił, że nowy program obejmie 100 firm i rozpocznie się w styczniu przyszłego roku." },
  { ...relatedB, sourceName: "ŹRÓDŁO B", text: "Rząd ogłosił, że nowy program obejmie 120 firm i rozpocznie się w styczniu przyszłego roku." }
];
const verification = aggregator.buildVerification(verificationArticles);
assert.equal(verification.sharedClaims.length, 0, "Twierdzenie ze sprzecznymi liczbami nie może być uznane za wspólne");
assert(verification.conflicts.length >= 1, "Nie wykryto potencjalnej rozbieżności liczbowej");
assert(verification.essenceBasis.sources.length >= 2, "Esencja nie wskazuje dwóch źródeł");
assert(countWords(aggregator.summarizeArticle(verificationArticles[0])) >= 8, "Streszczenie artykułu jest puste");

const compatibleVerification = aggregator.buildVerification([
  { ...verificationArticles[0], text: "Rząd ogłosił, że nowy program obejmie 100 firm i rozpocznie się w styczniu przyszłego roku." },
  { ...verificationArticles[1], text: "Rząd ogłosił, że nowy program obejmie 100 firm i rozpocznie się w styczniu przyszłego roku." },
]);
assert.equal(compatibleVerification.sharedClaims.length, 1, "Zgodna liczba powinna utworzyć wspólne twierdzenie");
assert.equal(compatibleVerification.conflicts.length, 0, "Zgodne liczby nie mogą tworzyć konfliktu");
assert.deepEqual(aggregator.extractNumbers("Wzrost wyniósł 6,50 proc."), aggregator.extractNumbers("Wzrost wyniósł 6.5%"), "Liczby i jednostki powinny być normalizowane");
assert.notDeepEqual(aggregator.extractNumbers("Spadek wyniósł -5 proc."), aggregator.extractNumbers("Wzrost wyniósł 5 proc."), "Znak liczby musi być zachowany");
assert.deepEqual(aggregator.extractNumbers("Przedział wynosi 5-7 mln"), ["5–7 mln"], "Zakres liczbowy musi pozostać pojedynczym sygnałem");
const signedConflict = aggregator.buildVerification([
  { ...verificationArticles[0], text: "Rząd podał, że wynik programu wyniósł -5 procent wobec poprzedniego roku." },
  { ...verificationArticles[1], text: "Rząd podał, że wynik programu wyniósł 5 procent wobec poprzedniego roku." },
]);
assert.equal(signedConflict.sharedClaims.length, 0, "Przeciwne znaki nie mogą utworzyć wspólnego twierdzenia");
assert.equal(signedConflict.conflicts.length, 1, "Przeciwne znaki muszą utworzyć konflikt liczbowy");
const signedAgreement = aggregator.buildVerification([
  { ...verificationArticles[0], text: "Rząd podał, że wynik programu wyniósł -5 procent wobec poprzedniego roku." },
  { ...verificationArticles[1], text: "Rząd podał, że wynik programu wyniósł -5 procent wobec poprzedniego roku." },
]);
assert(signedAgreement.sharedClaims[0].text.includes("-5"), "Znak liczby musi pozostać w gotowym wspólnym claimie");
assert.notDeepEqual(aggregator.extractNumbers("Przedział wyniósł -5--3 mln"), aggregator.extractNumbers("Wyniki wyniosły -5 i -3 mln"), "Podpisany zakres nie może być równy dwóm osobnym wartościom");
assert.equal(aggregator.canonicalArticleUrl("https://example.com/news?utm_source=x&id=7#top"), "https://example.com/news?id=7", "Parametry śledzące powinny być usuwane z URL");
const topicFacts = { sharedClaims: [{ text: "Rząd uruchomi program podatkowy obejmujący sto firm od stycznia." }] };
assert.equal(
  aggregator.topicIdentity([{ title: "Pierwszy nagłówek", publishedAt: "2026-01-01" }], topicFacts),
  aggregator.topicIdentity([{ title: "Całkiem inny nagłówek", publishedAt: "2026-01-02" }], topicFacts),
  "Klucz tematu nie może zależeć od nagłówka ani date bucketu, gdy dostępne są fakty",
);

const originalityContext = {
  sourceTexts: [
    "Rząd ogłosił że nowy program obejmie sto firm i rozpocznie się w styczniu przyszłego roku. Ministerstwo finansów przedstawi szczegółowy harmonogram wdrożenia programu.",
    "Od przyszłego stycznia program rządowy ma objąć sto przedsiębiorstw. Szczegółowy harmonogram wdrożenia przedstawi ministerstwo finansów."
  ],
  claimTexts: [
    "Nowy program rządowy obejmie sto firm i rozpocznie się w styczniu przyszłego roku.",
    "Ministerstwo finansów przedstawi szczegółowy harmonogram wdrożenia programu."
  ]
};
const copiedText = "Rząd ogłosił że nowy program obejmie sto firm i rozpocznie się w styczniu przyszłego roku a ministerstwo finansów przedstawi szczegółowy harmonogram wdrożenia programu.";
const quotedText = "„Od stycznia sto firm zostanie objętych nowym programem rządowym, a szczegółowy harmonogram wdrożenia ma przedstawić ministerstwo finansów po potwierdzeniu terminu.”";
const originalText = "Od stycznia sto firm zostanie objętych nowym programem rządowym; szczegółowy harmonogram jego wdrożenia ma przygotować i przedstawić ministerstwo finansów zainteresowanym przedsiębiorstwom.";
const copiedResult = validateOriginality(copiedText, originalityContext);
const quotedResult = validateOriginality(quotedText, originalityContext);
const originalResult = validateOriginality(originalText, originalityContext);
assert(!copiedResult.valid && copiedResult.maxCopiedWords > 5, "Bezpośrednia kopia źródła nie została odrzucona");
assert(!quotedResult.valid && quotedResult.reasons.some((reason) => reason.includes("cudzysłów")), "Cytat nie został odrzucony");
assert(originalResult.valid, `Oryginalna parafraza została błędnie odrzucona: ${originalResult.reasons.join(" ")}`);
assert(countWords(originalText) >= 20 && countWords(originalText) <= 30, "Parafraza ma nieprawidłową długość");

const validMetadata = validateEditorialMetadata({
  title: "Program rządowy obejmie sto firm",
  category: "kraj",
  tags: ["program", "rządowy"],
}, originalityContext);
assert(validMetadata.valid, `Poprawne metadane zostały odrzucone: ${validMetadata.reasons.join(" ")}`);
const inventedMetadata = validateEditorialMetadata({
  title: "Prezydent Francji ogłasza przełom kosmiczny",
  category: "technologia",
  tags: ["mars", "rakieta"],
}, originalityContext);
assert(!inventedMetadata.valid && inventedMetadata.unsupportedTags.length === 2, "Nieugruntowane metadane nie zostały odrzucone");
const mixedMetadata = validateEditorialMetadata({
  title: "Rząd program wywoła śmiertelny chaos",
  category: "kraj",
  tags: ["program marsjański", "rząd skandal"],
}, originalityContext);
assert(!mixedMetadata.valid && mixedMetadata.unsupportedTitleTokens.length >= 2 && mixedMetadata.unsupportedTags.length === 2, "Częściowo zgodne tokeny nie mogą ukryć wymyślonych metadanych");
const negationContext = { claimTexts: ["Rząd nie uruchomi programu dla firm.", "Ministerstwo opublikuje harmonogram programu."] };
const reversedNegation = validateEditorialMetadata({
  title: "Rząd uruchomi program dla firm",
  category: "kraj",
  tags: ["program ministerstwo", "rząd harmonogram"],
}, negationContext);
assert(!reversedNegation.valid && !reversedNegation.titleSupportedByClaim && reversedNegation.unsupportedTags.length === 2, "Tytuł odwracający negację i składane tagi muszą zostać odrzucone");

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "telegram-store-"));
const storeFile = path.join(temporaryDirectory, "state.json");
try {
  const editorial = {
    id: "event-1", validationId: "event-1", title: "Program rządowy obejmie sto firm", level1: originalText,
    level2: `${originalText} ${originalText} ${originalText}`, category: "kraj", tags: ["program", "rządowy"],
    confidence: 80, sources: [{ domain: "A", time: "DZISIAJ", title: "Źródło", url: "https://example.com/a" }],
  };
  const context = { "event-1": originalityContext };
  const store = await new EditorialStore(storeFile).init();
  await store.mergeSynchronization({ events: [editorial], syncedAt: new Date().toISOString(), stats: {}, errors: [] }, context);
  await store.setStatus("event-1", "approved");
  await store.publish("event-1");
  assert.equal(store.listPublications().length, 1, "Publikacja nie została zapisana");
  await store.setStatus("event-1", "review");
  assert.equal(store.listPublications().length, 0, "Reopen musi atomowo wycofać publikację");
  await store.setStatus("event-1", "approved");
  await store.publish("event-1");
  await store.updateEditorial("event-1", { ...editorial, title: "Zmieniony program obejmie sto firm", resetDecision: true });
  assert.equal(store.listPublications().length, 0, "Edycja musi atomowo wycofać publikację");
  await store.setStatus("event-1", "approved");
  await store.publish("event-1");
  await store.setStatus("event-1", "rejected");
  const restartedStore = await new EditorialStore(storeFile).init();
  assert.equal(restartedStore.listPublications().length, 0, "Reject musi trwale wycofać publikację");
  assert.equal(restartedStore.getEvent("event-1").status, "rejected", "Status odrzucenia nie przetrwał restartu");
  assert.equal((await stat(storeFile)).mode & 0o777, 0o600, "Magazyn musi zachować uprawnienia 0600");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const savedModelEnvironment = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL
};
delete process.env.LLM_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.OPENAI_MODEL;
const unavailableGeneration = await generateOriginalTelegram({
  claims: originalityContext.claimTexts.map((text) => ({ text, sources: ["A", "B"] })),
  sourceTexts: originalityContext.sourceTexts
});
Object.entries(savedModelEnvironment).forEach(([key, value]) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
});
assert.equal(unavailableGeneration.status, "blocked-no-model");
assert.equal(unavailableGeneration.text, "", "Brak modelu nie może uruchamiać ekstrakcyjnego fallbacku");

assert(scraper.isPrivateAddress("127.0.0.1"));
assert(scraper.isPrivateAddress("192.168.1.1"));
assert(scraper.isPrivateAddress("::ffff:172.16.0.1"));
assert(scraper.isPrivateAddress("::ffff:169.254.1.1"));
assert(scraper.isPrivateAddress("::ffff:100.64.0.1"));
assert(scraper.isPrivateAddress("::ffff:ac10:1"));
assert(scraper.isPrivateAddress("::ffff:a9fe:101"));
assert(scraper.isPrivateAddress("::ffff:6440:1"));
assert(!scraper.isPrivateAddress("1.1.1.1"));
console.log(`OK: agregacja, bezpieczeństwo adresów i oryginalność (${originalResult.wordCount} słów, grounding ${originalResult.groundingScore}%)`);

if (process.env.LIVE === "1") {
  for (const source of SOURCES) {
    try {
      const items = await readFeed(source, 1);
      assert(items.length === 1, `${source.name}: pusty RSS`);
      const article = await scrapeArticle(source, items[0]);
      assert(article.wordCount >= 50, `${source.name}: artykuł zbyt krótki`);
      console.log(`OK: ${source.name} — ${article.wordCount} słów, ${article.extractionMethod}`);
    } catch (error) {
      if (["PAYWALL", "ACCESS_UNKNOWN"].includes(error.code)) console.log(`SKIP: ${source.name} — brak potwierdzonego publicznego dostępu (fail-closed)`);
      else throw error;
    }
  }
}

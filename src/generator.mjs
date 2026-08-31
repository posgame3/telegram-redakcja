const WORD_RE = /[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*/gu;
const QUOTE_RE = /["„”«»]/u;
const STOP_WORDS = new Set("a aby ale albo bo być co czy dla do i ich jak jako jest już który która które ma mają na nad nie o od oraz po pod przez przy się są ten tego tej to w we z za ze że".split(" "));
const CATEGORIES = new Set(["kraj", "biznes", "gospodarka", "geopolityka", "rynki", "świat", "technologia", "inne"]);
// Sygnaly kategorii sa rdzeniami slow: jezyk polski odmienia, wiec "prokurat"
// dopasowuje zarowno "prokuratura", jak i "prokuratury" oraz "prokurator".
// Rdzenie o dlugosci do 3 znakow dopasowuja sie wylacznie doslownie.
const CATEGORY_SIGNALS = new Map([
  ["kraj", ["rząd", "sejm", "senat", "prezydent", "minist", "polska", "polski", "ustaw", "samorząd", "prokurat", "sąd", "śledztw", "policj", "poseł", "posł", "aresztowan", "nakaz", "wyrok", "przestęp", "zarzut", "postępowan", "immunitet", "trybunał",
    "szpital", "pacjent", "pielęgniar", "ratownik", "lekarz", "straż", "wypadek", "wypadk", "pożar", "powodz", "gmin", "wojewod"]],
  // "pracownik" wypadl z biznesu: lapal "pracownikow ochrony zdrowia" i wysylal
  // wiadomosci o zdarzeniach w szpitalach do dzialu biznes.
  ["biznes", ["firm", "spółk", "przedsiębior", "zarząd", "handel", "handl", "prezes", "fuzj", "upadłoś", "kontrakt"]],
  ["gospodarka", ["gospodark", "pkb", "inflacj", "podatek", "podatk", "budżet", "bezroboc", "wynagrodz", "stopy", "stopa", "stóp", "ceny", "cenach", "kredyt", "odszkodowan"]],
  ["geopolityka", ["nato", "unia", "unii", "wojn", "sankcj", "dyplomac", "sojusz", "granic", "schengen", "zbroj", "rakiet", "pocisk"]],
  ["rynki", ["giełd", "indeks", "akcje", "akcji", "obligacj", "walut", "złoty", "euro", "dolar", "ropa", "bitcoin", "krypto", "notowan", "kurs", "kursy"]],
  ["świat", ["usa", "chiny", "chin", "rosj", "rosyj", "ukrain", "niemc", "francj", "brytan", "zagranicz", "petersburg", "moskw"]],
  ["technologia", ["technolog", "cyfrow", "internet", "oprogramowan", "sztuczn", "inteligencj", "ai", "chip", "cyber", "aplikacj", "serwer"]],
]);

function normalizedWords(value) {
  return (String(value).toLowerCase().match(WORD_RE) || []).map((word) => word.replace(/[–-]/g, "-"));
}

function meaningfulTokens(value) {
  return new Set(normalizedWords(value).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
}

function longestCommonRun(left, right) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  let longest = 0;
  const previous = new Array(b.length + 1).fill(0);
  for (let index = 1; index <= a.length; index += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let other = 1; other <= b.length; other += 1) {
      if (a[index - 1] === b[other - 1]) {
        current[other] = previous[other - 1] + 1;
        longest = Math.max(longest, current[other]);
      }
    }
    for (let position = 0; position < current.length; position += 1) previous[position] = current[position];
  }
  return longest;
}

function ngrams(value, size = 4) {
  const input = normalizedWords(value);
  const result = new Set();
  for (let index = 0; index <= input.length - size; index += 1) result.add(input.slice(index, index + size).join(" "));
  return result;
}

function maxNgramOverlap(text, sourceTexts) {
  const generated = ngrams(text);
  if (!generated.size) return 0;
  let max = 0;
  for (const source of sourceTexts) {
    const sourceNgrams = ngrams(source);
    const shared = [...generated].filter((gram) => sourceNgrams.has(gram)).length;
    max = Math.max(max, shared / generated.size);
  }
  return max;
}

function groundingScore(text, claimTexts) {
  const generated = meaningfulTokens(text);
  const evidence = meaningfulTokens(claimTexts.join(" "));
  if (!generated.size || !evidence.size) return 0;
  return [...generated].filter((token) => evidence.has(token)).length / generated.size;
}

function isOrderedSubsequence(needle, haystack) {
  let position = 0;
  for (const word of haystack) {
    if (word === needle[position]) position += 1;
    if (position === needle.length) return true;
  }
  return needle.length === 0;
}

function containsPhrase(phrase, text) {
  const needle = normalizedWords(phrase);
  const haystack = normalizedWords(text);
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some((_, index) => needle.every((word, offset) => haystack[index + offset] === word));
}

function hasNegation(value) {
  return normalizedWords(value).includes("nie");
}

// Slowa, ktore po dopasowaniu rdzeniem dawaly falszywe trafienia:
// "euro" w "Europejskiego", "akcje" w "akcja ratunkowa", "kurs" w "kursowanie".
const EXACT_SIGNALS = new Set(["euro", "akcje", "akcji", "kurs", "kursy", "ceny", "cenach", "stopy", "stopa", "stóp", "ropa", "unia", "unii", "nato", "usa", "chin", "chiny", "polska", "polski"]);

function matchesSignal(evidenceTokens, signal) {
  if (signal.length <= 3 || EXACT_SIGNALS.has(signal)) return evidenceTokens.has(signal);
  for (const token of evidenceTokens) if (token.startsWith(signal)) return true;
  return false;
}

export function inferCategories(claimTexts) {
  const evidence = meaningfulTokens((Array.isArray(claimTexts) ? claimTexts : []).join(" "));
  return [...CATEGORY_SIGNALS.entries()]
    .filter(([, signals]) => signals.some((signal) => matchesSignal(evidence, signal)))
    .map(([name]) => name);
}

export function validateEditorialMetadata(metadata, context) {
  const claimTexts = Array.isArray(context?.claimTexts) ? context.claimTexts : [];
  const evidence = meaningfulTokens(claimTexts.join(" "));
  const title = String(metadata?.title || "").trim();
  const category = String(metadata?.category || "").trim().toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean) : [];
  const titleTokens = meaningfulTokens(title);
  const unsupportedTitleTokens = [...titleTokens].filter((token) => !evidence.has(token));
  const groundedTitleTokens = [...titleTokens].filter((token) => evidence.has(token));
  const titleGrounding = titleTokens.size ? groundedTitleTokens.length / titleTokens.size : 0;
  const titleSupportedByClaim = claimTexts.some((claim) => {
    const claimTokens = [...meaningfulTokens(claim)];
    return hasNegation(title) === hasNegation(claim) && isOrderedSubsequence([...titleTokens], claimTokens);
  });
  const titleWordCount = normalizedWords(title).length;
  const inferredCategories = inferCategories(claimTexts);
  const unsupportedTags = tags.filter((tag) => !claimTexts.some((claim) => containsPhrase(tag, claim)));
  const reasons = [];

  if (titleWordCount < 3 || titleWordCount > 12) reasons.push("Tytuł musi mieć od 3 do 12 słów.");
  if (QUOTE_RE.test(title)) reasons.push("Tytuł nie może zawierać cytatu.");
  if (!claimTexts.length || groundedTitleTokens.length < 2 || unsupportedTitleTokens.length || !titleSupportedByClaim) reasons.push("Tytuł nie zachowuje potwierdzonego twierdzenia, kolejności pojęć lub negacji.");
  if (!CATEGORIES.has(category)) reasons.push("Kategoria jest nieprawidłowa.");
  if (category === "inne" ? inferredCategories.length > 0 : !inferredCategories.includes(category)) reasons.push("Kategoria nie wynika z potwierdzonych informacji.");
  if (tags.length < 2 || tags.length > 5) reasons.push("Materiał musi mieć od 2 do 5 tagów.");
  if (unsupportedTags.length) reasons.push(`Tagi bez oparcia w faktach: ${unsupportedTags.join(", ")}.`);

  return {
    valid: reasons.length === 0,
    status: reasons.length ? "blocked" : "passed",
    titleWordCount,
    titleGroundingScore: Math.round(titleGrounding * 100),
    titleSupportedByClaim,
    unsupportedTitleTokens,
    inferredCategories,
    unsupportedTags,
    reasons,
  };
}

function validateText(text, context, limits) {
  const sourceTexts = Array.isArray(context?.sourceTexts) ? context.sourceTexts : [];
  const claimTexts = Array.isArray(context?.claimTexts) ? context.claimTexts : [];
  const wordCount = normalizedWords(text).length;
  const maxCopiedWords = sourceTexts.reduce((max, source) => Math.max(max, longestCommonRun(text, source)), 0);
  const ngramOverlap = maxNgramOverlap(text, sourceTexts);
  const grounding = groundingScore(text, claimTexts);
  const reasons = [];

  if (wordCount < limits.minWords || wordCount > limits.maxWords) reasons.push(`Tekst musi mieć od ${limits.minWords} do ${limits.maxWords} słów.`);
  if (QUOTE_RE.test(text)) reasons.push("Tekst zawiera cudzysłów lub bezpośredni cytat.");
  if (!claimTexts.length) reasons.push("Brak faktów potwierdzonych w minimum dwóch źródłach.");
  if (maxCopiedWords > limits.maxCopiedWords) reasons.push(`Wykryto ${maxCopiedWords} kolejnych słów zgodnych ze źródłem; limit wynosi ${limits.maxCopiedWords}.`);
  if (ngramOverlap > limits.maxOverlap) reasons.push("Zbyt duża część czterowyrazowych fragmentów pokrywa się ze źródłem.");
  if (grounding < limits.minGrounding) reasons.push("Tekst ma zbyt słabe pokrycie w potwierdzonych informacjach.");

  return {
    valid: reasons.length === 0,
    status: reasons.length ? "blocked" : "passed",
    wordCount,
    maxCopiedWords,
    ngramOverlap: Math.round(ngramOverlap * 100),
    groundingScore: Math.round(grounding * 100),
    reasons,
  };
}

export function validateOriginality(text, context) {
  return validateText(text, context, { minWords: 20, maxWords: 30, maxCopiedWords: 5, maxOverlap: 0.18, minGrounding: 0.24 });
}

export function validateContextOriginality(text, context) {
  return validateText(text, context, { minWords: 60, maxWords: 140, maxCopiedWords: 8, maxOverlap: 0.18, minGrounding: 0.2 });
}

function providerConfig() {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL;
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const maxTokens = Math.max(700, Number(process.env.LLM_MAX_TOKENS) || 3_000);
  return apiKey && model ? { apiKey, model, baseUrl, maxTokens } : null;
}

function parseModelJson(value) {
  const cleaned = String(value).trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

function capitalizeFirst(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase("pl-PL") + trimmed.slice(1) : "";
}

function cleanPackage(input) {
  const category = String(input.category || "").trim().toLowerCase();
  return {
    title: capitalizeFirst(input.title),
    level1: capitalizeFirst(input.level1 || input.text),
    level2: capitalizeFirst(input.level2),
    category: CATEGORIES.has(category) ? category : "inne",
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 5) : [],
    basisIds: Array.isArray(input.basisIds) ? input.basisIds : [],
  };
}

async function callModel(config, claims, correction = "", allowedCategories = []) {
  const categoryRule = allowedCategories.length
    ? `category: wybierz dokładnie jedną z: ${allowedCategories.join(", ")}. Nie używaj żadnej innej kategorii.`
    : "category: ustaw dokładnie na: inne. Żadna inna kategoria nie jest dopuszczalna dla tych faktów.";
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      max_tokens: config.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Jesteś doświadczonym redaktorem depesz agencyjnych, piszesz zwięzłą polszczyzną w stylu dobrej gazety, nie urzędowym żargonem. Korzystaj wyłącznie z podanych faktów potwierdzonych w minimum dwóch niezależnych źródłach.",
            "Nie dodawaj opinii, ocen ani informacji, których nie ma w faktach. Nie używaj cudzysłowów i nie kopiuj składni źródeł.",
            "STYL: pisz naturalnie i konkretnie, jak człowiek, nie jak automat. Nie zaczynaj kolejnych zdań tym samym podmiotem lub słowem — użyj zaimka, synonimu albo przebuduj zdanie. Nie powtarzaj tego samego rzeczownika lub czasownika w dwóch sąsiadujących zdaniach (np. nie pisz \"wydał ostrzeżenie... ostrzeżenie dotyczy... ostrzeżenie obejmuje\" — to brzmi głupio i sztucznie). Jedno zdanie może nieść więcej niż jeden fakt. Unikaj rozbudowanych nominalizacji i biernika urzędowego (\"zostało sklasyfikowane jako\", \"dotyczy zjawisk określonych jako\") — pisz prosto: kto, co zrobił, kiedy, z jakim skutkiem. Pokrycie faktami mierzone jest tylko dla nazw, liczb i kluczowych pojęć, więc możesz swobodnie różnicować słownictwo w resztę zdania.",
            "Zwróć wyłącznie JSON: {title,level1,level2,category,tags,basisIds}.",
            "title: od 3 do 12 słów. Wybierz JEDEN fakt i zbuduj tytuł wyłącznie ze słów występujących w tym fakcie, zachowując ich kolejność z tego faktu. Nie dodawaj żadnego słowa, którego nie ma w faktach. Jeśli wybrany fakt zawiera negację „nie”, zachowaj ją; jeśli nie zawiera, nie dodawaj jej.",
            "level1: od 20 do 30 słów, jedno zwarte zdanie lub dwa krótkie. Najważniejszy fakt podany konkretnie, bez powtórzeń słów. Nie przepisuj więcej niż 5 kolejnych słów ze źródła.",
            "level2: od 60 do 140 słów, 3–5 zdań o zróżnicowanej strukturze i długości, każde niosące nową informację (kontekst, liczby, skutki, tło). Zabronione jest budowanie kolejnych zdań według tego samego szablonu \"[Instytucja] + [ten sam czasownik/rzeczownik]\". Parafrazuj: nie przepisuj więcej niż 8 kolejnych słów ze źródła i nie powtarzaj całych zdań źródła.",
            categoryRule,
            "tags: od 2 do 5 tagów. Każdy tag skopiuj dosłownie z treści faktów, w dokładnie takiej formie gramatycznej, w jakiej tam występuje, łącznie z odmianą. Nie zmieniaj przypadka ani liczby, na przykład gdy w fakcie jest „Marcina Romanowskiego”, tag musi brzmieć „Marcina Romanowskiego”.",
            "basisIds: indeksy wykorzystanych faktów.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ facts: claims.map((claim, id) => ({ id, fact: claim.text, sources: claim.sources })), correction }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Model zwrócił HTTP ${response.status}`);
  const payload = await response.json();
  // Obcieta odpowiedz daje niepelny JSON. Jawny komunikat jest czytelniejszy
  // w panelu niz blad parsowania i wskazuje, co realnie podniesc.
  if (payload.choices?.[0]?.finish_reason === "length") {
    throw new Error(`Odpowiedź modelu została obcięta na limicie ${config.maxTokens} tokenów. Zwiększ LLM_MAX_TOKENS.`);
  }
  return cleanPackage(parseModelJson(payload.choices?.[0]?.message?.content || ""));
}

function blockedPackage(status, reason, context) {
  return {
    title: "",
    level1: "",
    text: "",
    level2: "",
    category: "",
    tags: [],
    basisIds: [],
    status,
    reason,
    originality: validateOriginality("", context),
    contextOriginality: validateContextOriginality("", context),
  };
}

export async function generateEditorialPackage({ claims, sourceTexts }) {
  const context = { sourceTexts, claimTexts: claims.map((claim) => claim.text) };
  if (!claims.length) return blockedPackage("blocked-no-shared-facts", "Brak faktów potwierdzonych w minimum dwóch źródłach.", context);

  const config = providerConfig();
  if (!config) return blockedPackage("blocked-no-model", "Brak konfiguracji LLM_API_KEY i LLM_MODEL. Treści nie zostały utworzone metodą ekstrakcyjną.", context);

  const allowedCategories = inferCategories(context.claimTexts);
  let correction = "";
  let lastReasons = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const generated = await callModel(config, claims, correction, allowedCategories);
      const validBasis = generated.basisIds.length > 0 && generated.basisIds.every((id) => Number.isInteger(id) && claims[id]?.sources?.length >= 2);
      const originality = validateOriginality(generated.level1, context);
      const contextOriginality = validateContextOriginality(generated.level2, context);
      const metadataValidation = validateEditorialMetadata(generated, context);
      if (validBasis && metadataValidation.valid && originality.valid && contextOriginality.valid) {
        return {
          ...generated,
          text: generated.level1,
          status: "ready",
          reason: "Pakiet redakcyjny wygenerowany wyłącznie z potwierdzonych faktów.",
          originality,
          contextOriginality,
          metadataValidation,
          model: config.model,
        };
      }
      const reasons = [...originality.reasons, ...contextOriginality.reasons, ...metadataValidation.reasons];
      if (!validBasis) reasons.push("Model nie wskazał prawidłowych faktów bazowych.");
      lastReasons = reasons.join(" ");
      correction = lastReasons;
    } catch (error) {
      if (attempt === 2) return blockedPackage("blocked-model-error", error.message, context);
      correction = `Poprzednia odpowiedź była nieprawidłowa: ${error.message}`;
    }
  }
  return blockedPackage("blocked-originality", `Model nie spełnił zasad redakcyjnych w trzech próbach. Powody: ${lastReasons}`, context);
}

export async function generateOriginalTelegram(input) {
  return generateEditorialPackage(input);
}

export const testing = { normalizedWords, longestCommonRun, maxNgramOverlap, groundingScore };

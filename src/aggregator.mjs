import { createHash } from "node:crypto";
import { readFeed, scrapeArticle } from "./scraper.mjs";
import { generateEditorialPackage } from "./generator.mjs";

const STOP_WORDS = new Set("a aby ale albo bo być co czy dla do i ich jak jako jest już który która które ma mają na nad nie o od oraz po pod przez przy się są ten tego tej to w we z za ze że".split(" "));
const WORD_RE = /(?:[-+−]?\d+(?:[.,]\d+)?(?:[–-][-+−]?\d+(?:[.,]\d+)?)?|[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*)[.,:;!?]?/gu;
const NUMBER_RE = /(?<![\p{L}\p{N}])[-+−]?\d+(?:[.,]\d+)?(?:\s?[–-]\s?[-+−]?\d+(?:[.,]\d+)?)?(?:\s?(?:%|proc\.|mln|mld|tys\.|zł|euro|dolar(?:ów|y)?|km|kg))?(?![\p{L}\p{N}])/giu;

function tokens(value) {
  return new Set((String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function similarity(left, right) {
  const a = tokens(`${left.title} ${left.description || ""}`);
  const b = tokens(`${right.title} ${right.description || ""}`);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.min(a.size, b.size);
}

function sentenceSimilarity(left, right) {
  return similarity({ title: left }, { title: right });
}

function eventTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function groupCandidates(items) {
  const groups = [];
  for (const item of [...items].sort((a, b) => eventTime(b.publishedAt) - eventTime(a.publishedAt))) {
    let best = null;
    let bestScore = 0;
    for (const group of groups) {
      if (Math.abs(eventTime(group[0].publishedAt) - eventTime(item.publishedAt)) / 3_600_000 > 48) continue;
      const score = Math.max(...group.map((member) => similarity(member, item)));
      if (score > bestScore) {
        best = group;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.32) best.push(item);
    else groups.push([item]);
  }
  return groups;
}

function independentCount(items) {
  return new Set(items.map((item) => item.ownerGroup)).size;
}

function meetsSourceRequirement(items) {
  return items.length >= 2 && independentCount(items) >= 2;
}

function words(value) {
  return String(value).match(WORD_RE) || [];
}

function trimWords(value, limit) {
  const selected = words(value).slice(0, limit);
  return selected.length ? `${selected.join(" ").replace(/[.,:;!?]+$/, "")}.` : "";
}

function articleSentences(article) {
  return String(article.text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((text) => text.trim())
    .filter((text) => words(text).length >= 8 && words(text).length <= 55)
    .slice(0, 14)
    .map((text, position) => ({
      text,
      position,
      sourceName: article.sourceName,
      ownerGroup: article.ownerGroup,
      title: article.title,
    }));
}

function rankedSentences(article) {
  const titleTokens = tokens(article.title);
  return articleSentences(article).sort((a, b) => {
    const score = (sentence) => [...tokens(sentence.text)].filter((token) => titleTokens.has(token)).length * 4 - sentence.position * 0.2;
    return score(b) - score(a);
  });
}

function summarizeArticle(article) {
  const ranked = rankedSentences(article);
  const selected = [];
  for (const sentence of ranked) {
    if (!selected.some((existing) => sentenceSimilarity(existing.text, sentence.text) > 0.72)) selected.push(sentence);
    if (selected.length === 2) break;
  }
  return trimWords(selected.map((sentence) => sentence.text).join(" ") || article.text, 44);
}

function normalizeNumberSignal(value) {
  const compact = String(value).toLowerCase().replace(/−/gu, "-").replace(/\s+/g, " ").trim();
  const match = compact.match(/^([-+]?\d+(?:[.,]\d+)?)(?:\s?[–-]\s?([-+]?\d+(?:[.,]\d+)?))?(.*)$/u);
  if (!match) return compact;
  const start = Number(match[1].replace(",", "."));
  const rangeEnd = match[2] === undefined ? "" : `–${Number(match[2].replace(",", "."))}`;
  const unit = match[3].trim().replace(/^proc\.$/u, "%");
  return `${start}${rangeEnd}${unit ? ` ${unit}` : ""}`;
}

function extractNumbers(value) {
  return [...new Set((String(value).match(NUMBER_RE) || []).map(normalizeNumberSignal))];
}

function sameNumberSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function buildVerification(articles) {
  const candidates = articles.flatMap(articleSentences);
  const matches = [];
  const matchedIndexes = new Set();
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (candidates[left].ownerGroup === candidates[right].ownerGroup) continue;
      const score = sentenceSimilarity(candidates[left].text, candidates[right].text);
      if (score >= 0.34) {
        const leftNumbers = extractNumbers(candidates[left].text);
        const rightNumbers = extractNumbers(candidates[right].text);
        const numbersCompatible = !leftNumbers.length && !rightNumbers.length
          ? true
          : leftNumbers.length > 0 && rightNumbers.length > 0 && sameNumberSet(leftNumbers, rightNumbers);
        matches.push({ left, right, score, leftNumbers, rightNumbers, numbersCompatible });
        if (numbersCompatible) {
          matchedIndexes.add(left);
          matchedIndexes.add(right);
        }
      }
    }
  }

  const sharedClaims = [];
  for (const match of matches.filter((candidate) => candidate.numbersCompatible).sort((a, b) => b.score - a.score)) {
    const pair = [candidates[match.left], candidates[match.right]];
    const claimText = pair.sort((a, b) => words(a.text).length - words(b.text).length)[0].text;
    const existing = sharedClaims.find((claim) => sentenceSimilarity(claim.text, claimText) > 0.66);
    const sources = [...new Set(pair.map((claim) => claim.sourceName))];
    if (existing) {
      existing.sources = [...new Set([...existing.sources, ...sources])];
      existing.confidence = Math.max(existing.confidence, Math.round(55 + match.score * 40));
    } else {
      sharedClaims.push({ text: trimWords(claimText, 34), sources, confidence: Math.round(55 + match.score * 40) });
    }
    if (sharedClaims.length === 5) break;
  }

  const conflicts = [];
  for (const match of matches.filter((candidate) => !candidate.numbersCompatible && candidate.leftNumbers.length && candidate.rightNumbers.length)) {
    const left = candidates[match.left];
    const right = candidates[match.right];
    const key = [left.sourceName, right.sourceName, ...match.leftNumbers, ...match.rightNumbers].join("|");
    if (conflicts.some((conflict) => conflict.key === key)) continue;
    conflicts.push({
      key,
      text: `Potencjalna rozbieżność liczbowa: ${left.sourceName} podaje ${match.leftNumbers.join(", ")}, a ${right.sourceName} — ${match.rightNumbers.join(", ")}.`,
      sources: [left.sourceName, right.sourceName],
    });
    if (conflicts.length === 3) break;
  }

  const signalsByValue = new Map();
  articles.forEach((article) => {
    extractNumbers(article.text).slice(0, 20).forEach((value) => {
      const entry = signalsByValue.get(value) || new Set();
      entry.add(article.sourceName);
      signalsByValue.set(value, entry);
    });
  });
  const sharedSignals = [...signalsByValue.entries()]
    .filter(([, sources]) => sources.size >= 2)
    .slice(0, 8)
    .map(([value, sources]) => ({ value, sources: [...sources] }));

  const uniqueClaims = candidates
    .filter((_, index) => !matchedIndexes.has(index))
    .filter((claim, index, all) => all.findIndex((candidate) => candidate.sourceName === claim.sourceName) === index)
    .slice(0, 4)
    .map((claim) => ({ text: trimWords(claim.text, 30), source: claim.sourceName }));

  const essenceBasis = sharedClaims[0] || {
    text: trimWords(articles[0].title, 34),
    sources: [...new Set(articles.map((article) => article.sourceName))],
    confidence: Math.max(35, averageSimilarity(articles)),
  };

  return {
    sharedClaims,
    conflicts: conflicts.map(({ key: _key, ...conflict }) => conflict),
    sharedSignals,
    uniqueClaims,
    essenceBasis,
    method: [
      "Pełny tekst jest pobierany wyłącznie z publicznych stron, które przeszły robots.txt, kontrolę domeny i paywalla.",
      "Zdania są porównywane między niezależnymi grupami wydawniczymi na podstawie wspólnych pojęć, nazw i liczb.",
      "Zgodne informacje otrzymują listę źródeł; różne liczby są oznaczane jako potencjalna rozbieżność.",
      "Telegram jest tworzony od nowa wyłącznie z potwierdzonych twierdzeń, przechodzi kontrolę kopiowania, cytatów, długości i pokrycia faktami, a potem wymaga decyzji redaktora.",
    ],
  };
}

function averageSimilarity(items) {
  if (items.length < 2) return 45;
  const scores = [];
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) scores.push(similarity(items[index], items[other]));
  }
  return Math.round(Math.min(0.98, scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100);
}

function canonicalArticleUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$|campaign$)/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/u, "");
  } catch {
    return String(value || "").trim();
  }
}

function topicSignature(items, verification = null) {
  const input = verification?.sharedClaims?.length
    ? verification.sharedClaims.map((claim) => claim.text)
    : items.map((item) => item.title);
  const frequencies = new Map();
  input.forEach((value) => tokens(value).forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1)));
  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pl"))
    .slice(0, 12)
    .map(([token]) => token)
    .sort((a, b) => a.localeCompare(b, "pl"));
}

function topicIdentity(items, verification = null) {
  return topicSignature(items, verification).join("-") || "wydarzenie";
}

function stableId(topicKey) {
  return `live-${createHash("sha256").update(topicKey).digest("hex").slice(0, 12)}`;
}

function signaturesMatch(left, right) {
  if (left.length < 4 || right.length < 4) return false;
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  return shared / Math.min(left.length, right.length) >= 0.75;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "PRZED CHWILĄ";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", " / ");
}

function chooseEvidence(group, limit = 4) {
  const chosen = [];
  const owners = new Set();
  for (const item of group) {
    if (!owners.has(item.ownerGroup)) {
      chosen.push(item);
      owners.add(item.ownerGroup);
    }
    if (chosen.length === limit) return chosen;
  }
  for (const item of group) {
    if (!chosen.includes(item)) chosen.push(item);
    if (chosen.length === limit) break;
  }
  return chosen;
}

async function scrapeGroup(group, sourceMap, knownIndex, packageGenerator = generateEditorialPackage) {
  const selected = chooseEvidence(group);
  const settled = await Promise.allSettled(selected.map((item) => scrapeArticle(sourceMap.get(item.sourceId), item)));
  const articles = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failures = settled.filter((result) => result.status === "rejected").map((result) => ({ code: result.reason?.code || "SCRAPE_ERROR", message: result.reason?.message || "Nieznany błąd ekstrakcji" }));
  const independent = independentCount(articles);
  if (!meetsSourceRequirement(articles)) return { event: null, failures, insufficientSources: true };

  const verification = buildVerification(articles);
  const sourceTexts = articles.map((article) => article.text);
  const topicKey = topicIdentity(articles, verification);
  const signature = topicSignature(articles, verification);
  const canonicalUrls = articles.map((article) => canonicalArticleUrl(article.url)).filter(Boolean);
  const id = stableId(topicKey);
  const alreadyKnown = knownIndex.ids.has(id)
    || canonicalUrls.some((url) => knownIndex.urls.has(url))
    || knownIndex.topicKeys.has(topicKey)
    || knownIndex.signatures.some((known) => signaturesMatch(signature, known));
  if (alreadyKnown) return { event: null, failures, existingEvent: true };
  const generation = await packageGenerator({ claims: verification.sharedClaims, sourceTexts });
  const confidence = Math.max(35, Math.min(98, averageSimilarity(articles) + Math.min(18, (independent - 1) * 9)));
  const facts = [
    `Pełną treść pobrano z ${articles.length} publikacji należących do ${independent} niezależnych grup wydawniczych.`,
    `Znaleziono ${verification.sharedClaims.length} zbieżnych twierdzeń i ${verification.conflicts.length} potencjalnych rozbieżności.`,
    failures.length ? `${failures.length} źródła pominięto z powodu walidacji, paywalla lub błędu pobierania.` : "Wszystkie wybrane źródła przeszły walidację ekstrakcji.",
  ];

  return {
    event: {
      id,
      validationId: id,
      topicKey,
      topicSignature: signature,
      canonicalUrls,
      title: generation.title || articles[0].title,
      image: articles.map((article) => article.image).find(Boolean) || null,
      detectedAt: formatTime(articles[0].publishedAt),
      confidence,
      status: "review",
      level1: generation.level1,
      draft: generation.level1,
      level2: generation.level2,
      category: generation.category || "inne",
      tags: generation.tags,
      generation: {
        status: generation.status,
        reason: generation.reason,
        model: generation.model || "",
        basisIds: generation.basisIds,
        originality: { ...generation.originality, validatedText: generation.originality?.valid ? generation.level1 : "" },
        contextOriginality: { ...generation.contextOriginality, validatedText: generation.contextOriginality?.valid ? generation.level2 : "" },
      },
      facts,
      verification,
      sourceMode: "multi-source",
      sources: articles.map((article) => ({
        domain: article.sourceName.toUpperCase(),
        time: formatTime(article.publishedAt),
        title: article.title,
        url: article.url,
        wordCount: article.wordCount,
        extractionMethod: article.extractionMethod,
        summary: summarizeArticle(article),
        preview: trimWords(article.text, 70),
        keyClaims: rankedSentences(article).slice(0, 3).map((claim) => trimWords(claim.text, 32)),
      })),
    },
    validationContext: {
      sourceTexts,
      claimTexts: verification.sharedClaims.map((claim) => claim.text),
    },
    failures,
  };
}

export async function synchronize(sources, options = {}) {
  const feedLimit = options.feedLimit ?? 25;
  const maxGroups = options.maxGroups ?? 20;
  const windowHours = options.windowHours ?? 48;
  const feedResults = await Promise.all(sources.map(async (source) => {
    try {
      return { ok: true, source, items: await readFeed(source, feedLimit) };
    } catch (error) {
      return { ok: false, source, error };
    }
  }));
  const successful = feedResults.filter((result) => result.ok);
  const feedErrors = feedResults.filter((result) => !result.ok).map((result) => ({ source: result.source.name, message: result.error?.message || "Błąd RSS" }));
  const allItems = successful.flatMap((result) => result.items);
  // Okno czasowe: bierzemy pod uwage materialy z ostatnich windowHours godzin,
  // dzieki czemu w kolejce widac wydarzenia z wiecej niz jednego dnia.
  const oldestAllowed = Date.now() - windowHours * 3_600_000;
  const items = allItems.filter((item) => eventTime(item.publishedAt) >= oldestAllowed);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const knownEvents = Array.isArray(options.knownEvents) ? options.knownEvents : [];
  const knownIndex = {
    ids: new Set([...(options.knownEventIds || []), ...knownEvents.map((event) => event.id).filter(Boolean)]),
    urls: new Set(knownEvents.flatMap((event) => [
      ...(Array.isArray(event.canonicalUrls) ? event.canonicalUrls : []),
      ...(Array.isArray(event.sources) ? event.sources.map((source) => canonicalArticleUrl(source.url)) : []),
    ]).filter(Boolean)),
    topicKeys: new Set(knownEvents.map((event) => event.topicKey).filter(Boolean)),
    signatures: knownEvents.map((event) => Array.isArray(event.topicSignature) && event.topicSignature.length
      ? event.topicSignature
      : topicSignature([{ title: event.title || "" }])).filter((signature) => signature.length),
  };
  const candidateGroups = groupCandidates(items);
  const groups = candidateGroups
    .filter((group) => independentCount(group) >= 2)
    .sort((a, b) => independentCount(b) - independentCount(a) || eventTime(b[0].publishedAt) - eventTime(a[0].publishedAt))
    .slice(0, maxGroups);

  const groupResults = [];
  const packageGenerator = options.generateEditorialPackage || generateEditorialPackage;
  for (const group of groups) groupResults.push(await scrapeGroup(group, sourceMap, knownIndex, packageGenerator));
  return {
    events: groupResults.map((result) => result.event).filter(Boolean),
    validationContexts: Object.fromEntries(groupResults
      .filter((result) => result.event && result.validationContext)
      .map((result) => [result.event.validationId, result.validationContext])),
    stats: {
      feedsChecked: sources.length,
      feedsOk: successful.length,
      feedItems: allItems.length,
      itemsInWindow: items.length,
      windowHours,
      groupsProcessed: groups.length,
      eventsCreated: groupResults.filter((result) => result.event).length,
      eventsSkippedExisting: groupResults.filter((result) => result.existingEvent).length,
      insufficientSourceGroups: candidateGroups.filter((group) => independentCount(group) < 2).length + groupResults.filter((result) => result.insufficientSources).length,
      scrapeFailures: groupResults.reduce((sum, result) => sum + result.failures.length, 0),
    },
    errors: feedErrors,
    syncedAt: new Date().toISOString(),
  };
}

export const testing = {
  tokens,
  similarity,
  groupCandidates,
  topicIdentity,
  topicSignature,
  canonicalArticleUrl,
  signaturesMatch,
  chooseEvidence,
  meetsSourceRequirement,
  summarizeArticle,
  buildVerification,
  extractNumbers,
};

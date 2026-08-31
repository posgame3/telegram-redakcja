let events = [];
let selectedId = null;
// Domyslnie kolejka pokazuje tylko materialy do decyzji, nie caly zbior -
// widok "Wszystkie" wczesniej wprowadzal chaos, bo miesza wszystkie statusy.
let activeFilter = "review";
// Liczniki ocen czytelnikow, wylacznie agregaty z serwera.
let reactionCounts = {};
let modalTrigger = null;
let modalCloseTimer = null;
const validationTimers = { level1: null, level2: null };
const validationSequences = { level1: 0, level2: 0 };
// Tryb prosty jest domyslny: pola sa tylko do czytania, a kolumna zrodel ukryta.
let editing = false;

// Na telefonie widok jest jednoekranowy: albo kolejka tematow, albo material.
// Na szerokim ekranie oba panele sa widoczne i ta wartosc nic nie zmienia.
function isNarrow() { return window.matchMedia("(max-width: 760px)").matches; }
// Wejscie w material dopisuje wpis do historii, wiec systemowy przycisk cofania
// i gest cofniecia w telefonie wracaja do kolejki, a nie wychodza z aplikacji.
function setView(view, { push = true } = {}) {
  document.body.dataset.view = view;
  const event = selectedEvent();
  if (view === "detail" && event) {
    const target = `#${event.id}`;
    const state = { view: "detail", id: event.id };
    if (push && location.hash !== target) history.pushState(state, "", target);
    else history.replaceState(state, "", target);
  } else if (view === "list") {
    if (push) history.pushState({ view: "list" }, "", location.pathname);
    else history.replaceState({ view: "list" }, "", location.pathname);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

function goToList() {
  editing = false;
  applyEditMode();
  render();
  if (history.state?.view === "detail") history.back();
  else setView("list", { push: false });
}

window.addEventListener("popstate", (event) => {
  const state = event.state;
  if (state?.view === "detail" && state.id && events.some((item) => item.id === state.id)) {
    selectedId = state.id;
    editing = false;
    applyEditMode();
    render();
    document.body.dataset.view = "detail";
    return;
  }
  editing = false;
  applyEditMode();
  render();
  document.body.dataset.view = "list";
});
function skrot(event) { return event?.level1 || event?.draft || event?.title || ""; }

function applyEditMode() {
  document.body.classList.toggle("is-editing", editing);
  elements.editButton.textContent = editing ? "ZAKOŃCZ EDYCJĘ" : "EDYTUJ";
  elements.editButton.setAttribute("aria-pressed", String(editing));
}

const elements = {
  eventList: document.querySelector("#event-list"), queueCount: document.querySelector("#queue-count"),
  eventNumber: document.querySelector("#event-number"), eventTitle: document.querySelector("#event-title"), eventStatus: document.querySelector("#event-status"),
  sourceCount: document.querySelector("#source-count"), detectedAt: document.querySelector("#detected-at"), confidence: document.querySelector("#confidence"),
  readerReactions: document.querySelector("#reader-reactions"),
  editButton: document.querySelector("#edit-button"), backButton: document.querySelector("#back-to-queue"),
  form: document.querySelector("#telegram-form"), title: document.querySelector("#editorial-title"), category: document.querySelector("#editorial-category"),
  tags: document.querySelector("#editorial-tags"), textarea: document.querySelector("#telegram-text"), contextText: document.querySelector("#context-text"),
  wordCount: document.querySelector("#word-count"), wordHint: document.querySelector("#word-hint"), contextWordCount: document.querySelector("#context-word-count"),
  contextHint: document.querySelector("#context-hint"), approveButton: document.querySelector("#approve-button"), publishButton: document.querySelector("#publish-button"),
  rejectButton: document.querySelector("#reject-button"), saveButton: document.querySelector("#save-button"), undoButton: document.querySelector("#undo-button"),
  regenerateButton: document.querySelector("#regenerate-button"),
  decisionNote: document.querySelector("#decision-note"), sourceSummary: document.querySelector("#source-summary"), sourceList: document.querySelector("#source-list"),
  factsList: document.querySelector("#facts-list"), verificationList: document.querySelector("#verification-list"), conflictsList: document.querySelector("#conflicts-list"),
  methodList: document.querySelector("#method-list"), essenceBasis: document.querySelector("#essence-basis"), essenceSources: document.querySelector("#essence-sources"),
  essenceConfidence: document.querySelector("#essence-confidence"), generationStatus: document.querySelector("#generation-status"), generationReason: document.querySelector("#generation-reason"),
  originalityCheck: document.querySelector(".originality-check"), copyRun: document.querySelector("#copy-run"), ngramOverlap: document.querySelector("#ngram-overlap"),
  groundingScore: document.querySelector("#grounding-score"), fetchButton: document.querySelector("#fetch-button"), lastSync: document.querySelector("#last-sync"),
  themeToggle: document.querySelector("#theme-toggle"), sourceModal: document.querySelector("#source-modal"), sourceModalClose: document.querySelector("#source-modal-close"),
  sourceModalDomain: document.querySelector("#source-modal-domain"), sourceModalMeta: document.querySelector("#source-modal-meta"), sourceModalTitle: document.querySelector("#source-modal-title"),
  sourceModalSummary: document.querySelector("#source-modal-summary"), sourceModalPreview: document.querySelector("#source-modal-preview"),
  sourceModalClaimsSection: document.querySelector("#source-modal-claims-section"), sourceModalClaims: document.querySelector("#source-modal-claims"),
  sourceModalLink: document.querySelector("#source-modal-link"),
};

const statusLabels = { review: "DO DECYZJI", approved: "ZATWIERDZONY", rejected: "ODRZUCONY", published: "OPUBLIKOWANY" };

function safeText(value, maxLength = 1_000) { return typeof value === "string" ? value.trim().slice(0, maxLength) : ""; }
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; } }
function countWords(value) { return (String(value).match(/[\p{L}\p{N}]+(?:[–-][\p{L}\p{N}]+)*/gu) || []).length; }
function selectedEvent() { return events.find((event) => event.id === selectedId) || null; }

function normalizeOriginality(input) {
  const value = input && typeof input === "object" ? input : {};
  const metric = (number, max = 100) => Math.max(0, Math.min(max, Math.round(Number(number) || 0)));
  return {
    valid: value.valid === true, status: safeText(value.status, 40) || "unverified", wordCount: metric(value.wordCount, 300),
    maxCopiedWords: metric(value.maxCopiedWords, 100), ngramOverlap: metric(value.ngramOverlap), groundingScore: metric(value.groundingScore),
    validatedText: safeText(value.validatedText, 2_500), reasons: Array.isArray(value.reasons) ? value.reasons.map((reason) => safeText(reason, 300)).filter(Boolean) : [],
  };
}

function normalizeSource(source) {
  const url = safeUrl(source?.url); const title = safeText(source?.title, 300);
  if (!url || !title) return null;
  return {
    domain: safeText(source.domain, 80), time: safeText(source.time, 60), title, url,
    wordCount: Number.isFinite(source.wordCount) ? source.wordCount : null, extractionMethod: safeText(source.extractionMethod, 100),
    summary: safeText(source.summary, 1_000), preview: safeText(source.preview, 1_500),
    keyClaims: Array.isArray(source.keyClaims) ? source.keyClaims.map((claim) => safeText(claim, 500)).filter(Boolean).slice(0, 4) : [],
  };
}

function normalizeVerificationItem(item) {
  const text = safeText(item?.text, 800); if (!text) return null;
  return { text, sources: Array.isArray(item.sources) ? item.sources.map((source) => safeText(source, 80)).filter(Boolean) : [], confidence: Math.max(0, Math.min(100, Math.round(Number(item.confidence) || 0))) };
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const sources = Array.isArray(event.sources) ? event.sources.map(normalizeSource).filter(Boolean) : [];
  if (!safeText(event.id, 100) || !sources.length) return null;
  const verification = event.verification && typeof event.verification === "object" ? event.verification : {};
  const generation = event.generation && typeof event.generation === "object" ? event.generation : {};
  return {
    ...event,
    id: safeText(event.id, 100), validationId: safeText(event.validationId, 100) || safeText(event.id, 100), title: safeText(event.title, 180),
    level1: safeText(event.level1 || event.draft, 500), draft: safeText(event.level1 || event.draft, 500), level2: safeText(event.level2, 2_500),
    category: safeText(event.category, 40) || "inne", tags: Array.isArray(event.tags) ? event.tags.map((tag) => safeText(tag, 60)).filter(Boolean).slice(0, 5) : [],
    detectedAt: safeText(event.detectedAt, 80), confidence: Math.max(0, Math.min(100, Math.round(Number(event.confidence) || 0))),
    status: statusLabels[event.status] ? event.status : "review", sources,
    facts: Array.isArray(event.facts) ? event.facts.map((fact) => safeText(fact, 400)).filter(Boolean) : [],
    generation: { ...generation, originality: normalizeOriginality(generation.originality), contextOriginality: normalizeOriginality(generation.contextOriginality) },
    verification: {
      sharedClaims: Array.isArray(verification.sharedClaims) ? verification.sharedClaims.map(normalizeVerificationItem).filter(Boolean) : [],
      conflicts: Array.isArray(verification.conflicts) ? verification.conflicts.map(normalizeVerificationItem).filter(Boolean) : [],
      uniqueClaims: Array.isArray(verification.uniqueClaims) ? verification.uniqueClaims.map((item) => ({ text: safeText(item?.text, 800), source: safeText(item?.source, 80) })).filter((item) => item.text) : [],
      sharedSignals: Array.isArray(verification.sharedSignals) ? verification.sharedSignals : [],
      method: Array.isArray(verification.method) ? verification.method.map((item) => safeText(item, 600)).filter(Boolean) : [],
      essenceBasis: normalizeVerificationItem(verification.essenceBasis) || { text: "Brak podstawy esencji.", sources: [], confidence: 0 },
    },
  };
}

function appendTextElement(parent, tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; parent.append(node); return node;
}

function replaceEvent(input) {
  const normalized = normalizeEvent(input); if (!normalized) return;
  const index = events.findIndex((event) => event.id === normalized.id);
  if (index >= 0) events[index] = normalized; else events.unshift(normalized);
  selectedId ||= normalized.id;
}

function renderQueue() {
  const visible = activeFilter === "all" ? events : events.filter((event) => event.status === activeFilter);
  elements.queueCount.textContent = String(visible.length).padStart(2, "0");
  elements.eventList.replaceChildren();
  if (!visible.length) return appendTextElement(elements.eventList, "p", "empty-state", "Brak materiałów w tym widoku.");
  visible.forEach((event) => {
    const row = document.createElement("button"); row.type = "button"; row.className = `event-row${event.id === selectedId ? " is-selected" : ""}`;
    row.setAttribute("aria-pressed", String(event.id === selectedId));
    // Status widoczny takze jako kolor tla wiersza, nie tylko jako tekst -
    // inaczej opublikowane i odrzucone materialy nie da sie odroznic na pierwszy rzut oka.
    row.dataset.status = event.status;
    const top = document.createElement("span"); top.className = "event-row-top";
    appendTextElement(top, "span", "event-row-time", event.detectedAt || "—"); appendTextElement(top, "span", "event-row-status", statusLabels[event.status]); row.append(top);
    const hasContent = Boolean(skrot(event));
    if (!hasContent) row.dataset.missingContent = "true";
    appendTextElement(row, "strong", "event-row-title", hasContent ? skrot(event) : "⚠ Bez treści — wymaga generowania");
    appendTextElement(row, "span", "event-row-meta", `${event.category.toUpperCase()} / ${event.sources.length} ŹRÓDŁA / ZGODNOŚĆ ${event.confidence}%`);
    row.addEventListener("click", () => {
      selectedId = event.id; editing = false; applyEditMode(); render();
      if (isNarrow()) setView("detail");
      else document.querySelector("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.eventList.append(row);
  });
}

function renderGenerationStatus(event) {
  const originality = event?.generation?.originality || normalizeOriginality();
  const labels = { ready: "PAKIET AI GOTOWY", passed: "ZWERYFIKOWANY", checking: "SPRAWDZANIE...", dirty: "WYMAGA KONTROLI", "blocked-no-model": "BRAK MODELU — FAIL-CLOSED", "blocked-no-shared-facts": "BRAK WSPÓLNYCH FAKTÓW", "blocked-model-error": "BŁĄD MODELU", "blocked-originality": "ODRZUCONY PRZEZ KONTROLĘ", unverified: "NIEZWERYFIKOWANY" };
  const status = originality.valid ? "passed" : (["checking", "dirty"].includes(originality.status) ? originality.status : event?.generation?.status || "unverified");
  elements.generationStatus.textContent = labels[status] || "NIEZWERYFIKOWANY";
  elements.generationReason.textContent = originality.valid ? "Skrót przeszedł kontrolę długości, kopiowania i pokrycia faktami." : (originality.reasons.join(" ") || event?.generation?.reason || "Tekst wymaga kontroli.");
  elements.originalityCheck.dataset.valid = String(originality.valid);
  elements.copyRun.textContent = `${originality.maxCopiedWords} / LIMIT 5 SŁÓW`; elements.ngramOverlap.textContent = `${originality.ngramOverlap}% / LIMIT 18%`; elements.groundingScore.textContent = `${originality.groundingScore}% / MIN. 24%`;
}

function validCurrentText(event, field) {
  const key = field === "level2" ? "contextOriginality" : "originality";
  const text = field === "level2" ? elements.contextText.value.trim() : elements.textarea.value.trim();
  return event?.generation?.[key]?.valid === true && event.generation[key].validatedText === text;
}

function updateCounters() {
  const event = selectedEvent();
  const shortWords = countWords(elements.textarea.value); const longWords = countWords(elements.contextText.value);
  const shortValid = shortWords >= 20 && shortWords <= 30 && validCurrentText(event, "level1");
  const longValid = longWords >= 60 && longWords <= 140 && validCurrentText(event, "level2");
  elements.wordCount.textContent = `${shortWords} / 20–30 słów`; elements.wordCount.classList.toggle("is-valid", shortValid); elements.wordCount.classList.toggle("is-invalid", !shortValid);
  elements.contextWordCount.textContent = `${longWords} / 60–140 słów`; elements.contextWordCount.classList.toggle("is-valid", longValid); elements.contextWordCount.classList.toggle("is-invalid", !longValid);
  elements.wordHint.textContent = shortValid ? "Skrót jest gotowy do akceptacji." : "Skrót musi mieć 20–30 słów i przejść kontrolę źródłową.";
  elements.contextHint.textContent = longValid ? "Kontekst jest gotowy do akceptacji." : "Kontekst musi mieć 60–140 słów i przejść kontrolę źródłową.";
  const titleWords = countWords(elements.title.value); const tagCount = elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean).length;
  elements.approveButton.disabled = event?.status !== "review" || !shortValid || !longValid || titleWords < 3 || titleWords > 12 || tagCount < 2;
  elements.publishButton.disabled = event?.status !== "approved";
}

function renderEditor() {
  const event = selectedEvent();
  if (!event) {
    elements.eventTitle.textContent = "Brak materiałów";
    [elements.title, elements.category, elements.tags, elements.textarea, elements.contextText].forEach((field) => { field.value = ""; field.disabled = true; });
    return;
  }
  elements.eventNumber.textContent = `02 / MATERIAŁ / ${event.id.toUpperCase()}`;
  elements.eventTitle.textContent = skrot(event) || "Materiał bez treści";
  elements.eventStatus.textContent = statusLabels[event.status]; elements.eventStatus.dataset.status = event.status;
  elements.sourceCount.textContent = String(event.sources.length); elements.detectedAt.textContent = event.detectedAt || "—"; elements.confidence.textContent = `${event.confidence}%`;
  const counts = reactionCounts[event.id];
  elements.readerReactions.textContent = counts ? `▲ ${counts.likes} / ▼ ${counts.dislikes}` : "—";
  elements.title.value = event.title; elements.category.value = event.category; elements.tags.value = event.tags.join(", "); elements.textarea.value = event.level1; elements.contextText.value = event.level2;
  const essence = event.verification.essenceBasis; elements.essenceBasis.textContent = essence.text; elements.essenceSources.textContent = essence.sources.length ? `ŹRÓDŁA: ${essence.sources.join(" + ")}` : "BRAK POTWIERDZENIA"; elements.essenceConfidence.textContent = essence.confidence ? `ZGODNOŚĆ ${essence.confidence}%` : "DO KONTROLI";
  const locked = event.status !== "review";
  const readOnly = locked || !editing;
  [elements.title, elements.category, elements.tags].forEach((field) => { field.disabled = readOnly; });
  // W trybie prostym tekst ma byc czytelny, wiec readOnly zamiast disabled.
  [elements.textarea, elements.contextText].forEach((field) => { field.disabled = locked; field.readOnly = !editing; });
  elements.editButton.disabled = locked;
  // Generowanie nadpisuje tresc, wiec dopuszczamy je tylko dla materialu do decyzji.
  elements.regenerateButton.disabled = locked;
  elements.saveButton.disabled = locked; elements.rejectButton.disabled = locked; elements.undoButton.classList.toggle("is-hidden", event.status === "review");
  renderGenerationStatus(event); updateCounters(); updateDecisionNote(event.status);
}

function renderEvidence() {
  const event = selectedEvent();
  elements.sourceList.replaceChildren(); elements.factsList.replaceChildren(); elements.verificationList.replaceChildren(); elements.conflictsList.replaceChildren(); elements.methodList.replaceChildren();
  if (!event) return;
  elements.sourceSummary.textContent = `${event.sources.length} PUBLIKACJE`;
  event.sources.forEach((source) => {
    const item = document.createElement("article"); item.className = "source-item"; const domain = document.createElement("div"); domain.className = "source-domain";
    appendTextElement(domain, "span", "", source.domain); appendTextElement(domain, "time", "", [source.time, source.wordCount ? `${source.wordCount} SŁÓW` : ""].filter(Boolean).join(" / ")); item.append(domain);
    const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = source.title; item.append(link);
    const button = document.createElement("button"); button.type = "button"; button.className = "source-preview-button"; button.textContent = "OTWÓRZ STRESZCZENIE →"; button.setAttribute("aria-haspopup", "dialog"); button.addEventListener("click", () => openSourceModal(source, button)); item.append(button); elements.sourceList.append(item);
  });
  event.facts.forEach((fact) => appendTextElement(elements.factsList, "li", "", fact));
  if (!event.verification.sharedClaims.length) appendTextElement(elements.verificationList, "p", "verification-empty", "Brak twierdzeń potwierdzonych w dwóch źródłach.");
  event.verification.sharedClaims.forEach((claim) => { const item = document.createElement("article"); item.className = "verification-item"; appendTextElement(item, "p", "", claim.text); appendTextElement(item, "div", "verification-meta", `${claim.sources.join(" + ")} / ZGODNOŚĆ ${claim.confidence}%`); elements.verificationList.append(item); });
  event.verification.conflicts.forEach((conflict) => { const item = document.createElement("article"); item.className = "verification-item is-conflict"; appendTextElement(item, "p", "", conflict.text); appendTextElement(item, "div", "verification-meta", conflict.sources.join(" + ")); elements.conflictsList.append(item); });
  event.verification.uniqueClaims.forEach((claim) => { const item = document.createElement("article"); item.className = "verification-item"; appendTextElement(item, "p", "", claim.text); appendTextElement(item, "div", "verification-meta", `TYLKO: ${claim.source}`); elements.conflictsList.append(item); });
  if (!event.verification.conflicts.length && !event.verification.uniqueClaims.length) appendTextElement(elements.conflictsList, "p", "verification-empty", "Brak wykrytych rozbieżności.");
  event.verification.method.forEach((step) => appendTextElement(elements.methodList, "li", "", step));
}

function updateDecisionNote(status, message = "") {
  elements.decisionNote.className = "decision-note";
  if (message) { elements.decisionNote.textContent = message; return; }
  if (status === "approved") { elements.decisionNote.classList.add("is-approved"); elements.decisionNote.textContent = "Materiał zatwierdzony. Kliknij PUBLIKUJ, aby trafił do publicznego feedu."; }
  else if (status === "published") { elements.decisionNote.classList.add("is-approved"); elements.decisionNote.textContent = "Materiał jest opublikowany w publicznym feedzie."; }
  else if (status === "rejected") { elements.decisionNote.classList.add("is-rejected"); elements.decisionNote.textContent = "Materiał odrzucony i niewidoczny publicznie."; }
  else elements.decisionNote.textContent = "Materiał wymaga decyzji redaktora. Publikacja jest osobnym krokiem po zatwierdzeniu.";
}

function editorialBody(action) {
  return { eventId: selectedId, action, title: elements.title.value.trim(), level1: elements.textarea.value.trim(), level2: elements.contextText.value.trim(), category: elements.category.value, tags: elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) };
}

async function editorialAction(action) {
  const event = selectedEvent(); if (!event) return;
  updateDecisionNote(event.status, "Zapisuję operację redakcyjną...");
  try {
    const response = await fetch("/api/editorial", { method: "POST", headers: { "content-type": "application/json", "x-telegram-action": "editorial" }, body: JSON.stringify(editorialBody(action)) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.validation?.reasons?.join(" ") || payload.error || `HTTP ${response.status}`);
    if (payload.event) replaceEvent(payload.event);
    editing = false;
    applyEditMode();
    render();
    // Po decyzji zamykajacej material wracamy na telefonie do listy tematow.
    if (isNarrow() && ["publish", "reject"].includes(action)) goToList();
  } catch (error) { updateDecisionNote(event.status, `Operacja nie powiodła się: ${error.message}`); }
}

function markFieldForValidation(field) {
  const event = selectedEvent(); if (!event || event.status !== "review") return;
  const key = field === "level2" ? "contextOriginality" : "originality";
  const text = field === "level2" ? elements.contextText.value.trim() : elements.textarea.value.trim();
  clearTimeout(validationTimers[field]); validationSequences[field] += 1;
  event.generation[key] = normalizeOriginality({ status: "dirty", reasons: ["Tekst zmieniono i wymaga ponownej kontroli."] });
  renderGenerationStatus(event); updateCounters();
  if (!text) return;
  const sequence = validationSequences[field];
  validationTimers[field] = setTimeout(() => validateField(event, field, text, sequence), 450);
}

async function validateField(event, field, text, sequence) {
  const key = field === "level2" ? "contextOriginality" : "originality";
  event.generation[key].status = "checking"; updateCounters();
  try {
    const response = await fetch("/api/validate", { method: "POST", headers: { "content-type": "application/json", "x-telegram-action": "validate" }, body: JSON.stringify({ validationId: event.validationId, field, text }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const currentText = field === "level2" ? elements.contextText.value.trim() : elements.textarea.value.trim();
    if (sequence !== validationSequences[field] || currentText !== text || selectedId !== event.id) return;
    event.generation[key] = normalizeOriginality({ ...payload, validatedText: payload.valid ? text : "" });
  } catch (error) { if (sequence === validationSequences[field] && selectedId === event.id) event.generation[key] = normalizeOriginality({ status: "blocked", reasons: [error.message] }); }
  renderGenerationStatus(event); updateCounters();
}

async function loadEvents() {
  try {
    const response = await fetch("/api/editorial/events", { headers: { accept: "application/json" } }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    events = Array.isArray(payload.events) ? payload.events.map(normalizeEvent).filter(Boolean) : [];
    reactionCounts = payload.reactions && typeof payload.reactions === "object" ? payload.reactions : {};
    const fromLink = decodeURIComponent(location.hash.slice(1));
    const openFromLink = Boolean(fromLink) && events.some((event) => event.id === fromLink);
    if (openFromLink) selectedId = fromLink;
    else if (!events.some((event) => event.id === selectedId)) selectedId = events[0]?.id || null;
    if (openFromLink && isNarrow()) setView("detail", { push: false });
    if (payload.lastSync?.syncedAt) elements.lastSync.textContent = `OSTATNI ODCZYT ${new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.lastSync.syncedAt))}`;
    render();
  } catch (error) { updateDecisionNote("review", `Nie udało się wczytać kolejki: ${error.message}`); }
}

async function synchronize() {
  elements.fetchButton.disabled = true; elements.fetchButton.textContent = "AGREGUJĘ..."; updateDecisionNote(selectedEvent()?.status || "review", "Pobieram źródła i uruchamiam analizę. To może potrwać kilkadziesiąt sekund.");
  try {
    const response = await fetch("/api/sync", { method: "POST", headers: { accept: "application/json", "x-telegram-action": "sync" } }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
    events = payload.events.map(normalizeEvent).filter(Boolean); if (!events.some((event) => event.id === selectedId)) selectedId = events[0]?.id || null;
    elements.lastSync.textContent = `OSTATNI ODCZYT ${new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.syncedAt))}`; render();
    updateDecisionNote(selectedEvent()?.status || "review", `Synchronizacja zakończona: ${payload.stats.feedsOk}/${payload.stats.feedsChecked} RSS, ${payload.stats.eventsCreated} nowych zdarzeń.`);
  } catch (error) { updateDecisionNote(selectedEvent()?.status || "review", `Synchronizacja nie powiodła się: ${error.message}`); }
  finally { elements.fetchButton.disabled = false; elements.fetchButton.textContent = "POBIERZ NOWE"; }
}

function openSourceModal(source, trigger) {
  clearTimeout(modalCloseTimer); modalTrigger = trigger; elements.sourceModal.classList.remove("is-closing");
  elements.sourceModalDomain.textContent = source.domain; elements.sourceModalMeta.textContent = [source.time, source.wordCount ? `${source.wordCount} SŁÓW` : "", source.extractionMethod].filter(Boolean).join(" / ");
  elements.sourceModalTitle.textContent = source.title; elements.sourceModalSummary.textContent = source.summary || "Brak streszczenia."; elements.sourceModalPreview.textContent = source.preview || "Brak podglądu.";
  elements.sourceModalClaims.replaceChildren(); source.keyClaims.forEach((claim) => appendTextElement(elements.sourceModalClaims, "li", "", claim)); elements.sourceModalClaimsSection.hidden = !source.keyClaims.length; elements.sourceModalLink.href = source.url;
  document.body.classList.add("has-modal"); elements.sourceModal.showModal(); elements.sourceModalClose.focus();
}
function finishClosingSourceModal() { if (elements.sourceModal.open) elements.sourceModal.close(); elements.sourceModal.classList.remove("is-closing"); document.body.classList.remove("has-modal"); modalTrigger?.focus(); modalTrigger = null; }
function closeSourceModal() { if (!elements.sourceModal.open || elements.sourceModal.classList.contains("is-closing")) return; if (matchMedia("(prefers-reduced-motion: reduce)").matches) return finishClosingSourceModal(); elements.sourceModal.classList.add("is-closing"); modalCloseTimer = setTimeout(finishClosingSourceModal, 150); }

function render() { renderQueue(); renderEditor(); renderEvidence(); }

elements.form.addEventListener("submit", (event) => { event.preventDefault(); editorialAction("save"); });
async function regenerate() {
  const event = selectedEvent();
  if (!event || event.status !== "review") return;
  if (event.editorialUpdatedAt && !confirm("Materiał był edytowany. Ponowne generowanie nadpisze wersję redaktora. Kontynuować?")) return;
  elements.regenerateButton.disabled = true;
  const previousLabel = elements.regenerateButton.textContent;
  elements.regenerateButton.textContent = "GENERUJĘ...";
  updateDecisionNote(event.status, "Model przygotowuje nową wersję materiału. To może potrwać kilkadziesiąt sekund.");
  try {
    const response = await fetch("/api/editorial", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-action": "editorial" },
      body: JSON.stringify({ eventId: event.id, action: "regenerate" }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.event) replaceEvent(payload.event);
    editing = false;
    applyEditMode();
    render();
    const status = payload.generation?.status;
    if (status !== "ready") updateDecisionNote("review", `Generowanie nie dało gotowego materiału: ${payload.generation?.reason || status}`);
  } catch (error) {
    updateDecisionNote(event.status, `Generowanie nie powiodło się: ${error.message}`);
  } finally {
    elements.regenerateButton.textContent = previousLabel;
    elements.regenerateButton.disabled = selectedEvent()?.status !== "review";
  }
}

elements.regenerateButton.addEventListener("click", regenerate);
elements.editButton.addEventListener("click", () => { editing = !editing; applyEditMode(); render(); });
elements.backButton.addEventListener("click", goToList);
elements.approveButton.addEventListener("click", () => editorialAction("approve")); elements.publishButton.addEventListener("click", () => editorialAction("publish"));
elements.rejectButton.addEventListener("click", () => editorialAction("reject")); elements.undoButton.addEventListener("click", () => editorialAction("reopen")); elements.fetchButton.addEventListener("click", synchronize);
elements.textarea.addEventListener("input", () => markFieldForValidation("level1")); elements.contextText.addEventListener("input", () => markFieldForValidation("level2"));
[elements.title, elements.category, elements.tags].forEach((field) => field.addEventListener("input", updateCounters));
elements.sourceModalClose.addEventListener("click", closeSourceModal); elements.sourceModal.addEventListener("cancel", (event) => { event.preventDefault(); closeSourceModal(); }); elements.sourceModal.addEventListener("click", (event) => { if (event.target === elements.sourceModal) closeSourceModal(); });
document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("is-active", item === button)); renderQueue(); }));

const savedTheme = localStorage.getItem("telegram-theme") || "light"; document.documentElement.dataset.theme = savedTheme; updateThemeLabel(savedTheme);
elements.themeToggle.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("telegram-theme", next); updateThemeLabel(next); });
function updateThemeLabel(theme) { elements.themeToggle.textContent = `TRYB: ${theme === "dark" ? "CIEMNY" : "JASNY"}`; }

document.body.dataset.view = "list";
history.replaceState({ view: "list" }, "", location.hash || location.pathname);
render();
loadEvents();

const REACTIONS_KEY = "telegram-reactions";

const BASE_TITLE = document.title;

let items = [];          // materialy pokazane na ekranie
let fetched = [];        // ostatnio pobrane z serwera
let pendingCount = 0;    // nowe, jeszcze niepokazane
let sessionNewIds = new Set();
let lastSeenAt = Number(localStorage.getItem("feed-last-seen")) || 0;
let visible = [];
// Kolejka trybu pelnoekranowego. Powstaje przy otwarciu i pomija przeczytane,
// zeby te same materialy nie wracaly przy kazdym przegladaniu.
let readerQueue = [];
let activeCategory = "all";
let installPrompt = null;
let readerIndex = -1;
let reactions = loadReactions();
let lastFocused = null;

const elements = {
  feed: document.querySelector("#feed"), updated: document.querySelector("#feed-updated"), install: document.querySelector("#install-button"), theme: document.querySelector("#feed-theme"),
  mastheadDate: document.querySelector("#masthead-date"),
  reader: document.querySelector("#reader"), readerCard: document.querySelector("#reader-card"), readerClose: document.querySelector("#reader-close"), readerPosition: document.querySelector("#reader-position"),
  media: document.querySelector("#reader-media"), category: document.querySelector("#reader-category"), time: document.querySelector("#reader-time"), rating: document.querySelector("#reader-rating"),
  age: document.querySelector("#reader-age"),
  title: document.querySelector("#reader-title"), deck: document.querySelector("#reader-deck"),
  photoDialog: document.querySelector("#photo-dialog"), photoFull: document.querySelector("#photo-full"), photoCredit: document.querySelector("#photo-credit"), photoClose: document.querySelector("#photo-close"),
  sourceCount: document.querySelector("#reader-source-count"), sources: document.querySelector("#reader-sources"),
  stampLike: document.querySelector("#stamp-like"), stampSkip: document.querySelector("#stamp-skip"),
  share: document.querySelector("#reader-share"),
  readerMore: document.querySelector("#reader-more"), sheet: document.querySelector("#reader-sheet"), sheetClose: document.querySelector("#sheet-close"),
  actionPrev: document.querySelector("#action-prev"), actionNext: document.querySelector("#action-next"), actionLike: document.querySelector("#action-like"), actionSkip: document.querySelector("#action-skip"),
  pending: document.querySelector("#pending-bar"),
  fontSmaller: document.querySelector("#font-smaller"), fontBigger: document.querySelector("#font-bigger"), fontLevel: document.querySelector("#font-level"),
  installDialog: document.querySelector("#install-dialog"), installClose: document.querySelector("#install-close"), installNow: document.querySelector("#install-now"), installSteps: document.querySelector("#install-steps"),
};

function text(value, max = 2_500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; } }
// Adres obrazka pochodzi teraz z wlasnego proxy (/img?...), wiec jest wzgledny
// wobec biezacej strony. Rozwiazujemy go do absolutnego adresu tego samego
// hosta i odrzucamy wszystko, co wskazywalo poza wlasna domene.
function safeImageUrl(value) { try { const url = new URL(value, location.origin); return url.origin === location.origin ? url.toString() : ""; } catch { return ""; } }
function append(parent, tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; node.textContent = value; parent.append(node); return node; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatFullDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }

// Wiek wpisu mowi czytelnikowi, jak daleko w przeszlosc zaszedl.
function relativeAge(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  const minutes = Math.round((Date.now() - parsed) / 60_000);
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

// --- Przeczytane materialy ---
const SEEN_KEY = "telegram-seen";
const SEEN_LIMIT = 800;

function loadSeen() {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return new Set(Array.isArray(list) ? list.slice(-SEEN_LIMIT) : []);
  } catch {
    return new Set();
  }
}

const seen = loadSeen();

function markSeen(id) {
  if (!id || seen.has(id)) return;
  seen.add(id);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_LIMIT))); } catch { /* tryb prywatny */ }
}

// Naglowkiem wiadomosci jest skrot 20-30 slow, a nie osobny tytul.
function headline(item) { return item.level1 || item.title; }

// --- Wykrywanie nowych materialow ---
function itemTime(item) { const value = Date.parse(item?.updatedAt || item?.publishedAt || ""); return Number.isFinite(value) ? value : 0; }
function newestTime(list) { return list.reduce((max, item) => Math.max(max, itemTime(item)), 0); }
function inCategory(list) { return activeCategory === "all" ? list : list.filter((item) => item.category === activeCategory); }

function pluralNews(count) {
  if (count === 1) return "nowa wiadomość";
  const rest = count % 10;
  const teens = count % 100;
  if (rest >= 2 && rest <= 4 && !(teens >= 12 && teens <= 14)) return "nowe wiadomości";
  return "nowych wiadomości";
}

function renderPending() {
  elements.pending.hidden = pendingCount === 0;
  elements.pending.textContent = pendingCount ? `↑ ${pendingCount} ${pluralNews(pendingCount)} — pokaż` : "";
  document.title = pendingCount ? `(${pendingCount}) ${BASE_TITLE}` : BASE_TITLE;
}

function recomputePending() {
  pendingCount = inCategory(fetched).filter((item) => itemTime(item) > lastSeenAt && !items.some((shown) => shown.id === item.id)).length;
  renderPending();
}

// Przenosi pobrane materialy na ekran i zapamietuje, co uzytkownik juz widzial.
function adoptFetched() {
  if (lastSeenAt > 0) sessionNewIds = new Set(fetched.filter((item) => itemTime(item) > lastSeenAt).map((item) => item.id));
  items = fetched;
  lastSeenAt = Math.max(lastSeenAt, newestTime(items));
  try { localStorage.setItem("feed-last-seen", String(lastSeenAt)); } catch { /* tryb prywatny */ }
  pendingCount = 0;
  renderPending();
  renderList();
}

elements.pending.addEventListener("click", () => {
  adoptFetched();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function loadReactions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REACTIONS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReactions() {
  try { localStorage.setItem(REACTIONS_KEY, JSON.stringify(reactions)); } catch { /* tryb prywatny lub brak miejsca */ }
}

function normalizeImage(value) {
  if (!value || typeof value !== "object") return null;
  const url = safeImageUrl(value.url);
  return url ? { url, alt: text(value.alt, 300), credit: text(value.credit, 80) } : null;
}

function normalize(item) {
  if (!item || typeof item !== "object" || !text(item.id, 100)) return null;
  const normalized = {
    id: text(item.id, 100), title: text(item.title, 180), level1: text(item.level1, 500), level2: text(item.level2), category: text(item.category, 40) || "inne", image: normalizeImage(item.image),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 5) : [], confidence: Math.max(0, Math.min(100, Number(item.confidence) || 0)),
    sourceCount: Math.max(0, Number(item.sourceCount) || 0), publishedAt: item.publishedAt, updatedAt: item.updatedAt,
    reactions: { likes: Math.max(0, Number(item.reactions?.likes) || 0), dislikes: Math.max(0, Number(item.reactions?.dislikes) || 0) },
    sources: Array.isArray(item.sources) ? item.sources.map((source) => ({ domain: text(source.domain, 80), title: text(source.title, 300), url: safeUrl(source.url), time: text(source.time, 80) })).filter((source) => source.url && source.title) : [],
  };
  return headline(normalized) ? normalized : null;
}

// Karty listy pokazuja miniature (lzejszy wariant "thumb"), a czytnik i pełny
// podglad korzystaja z wariantu "full" zwracanego domyslnie przez serwer.
function withImageVariant(url, variant) {
  try {
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set("v", variant);
    return parsed.pathname + "?" + parsed.searchParams.toString();
  } catch {
    return url;
  }
}

function buildMedia(item, className, withCredit = false) {
  const figure = document.createElement("figure");
  figure.className = className;
  const fallback = () => {
    figure.dataset.fallback = "true";
    const box = document.createElement("div");
    box.className = "media-fallback";
    append(box, "span", "media-fallback-category", item.category);
    append(box, "span", "media-fallback-mark", "Telegram");
    figure.prepend(box);
  };
  if (!item.image) {
    fallback();
    return figure;
  }
  const image = document.createElement("img");
  image.src = withImageVariant(item.image.url, className.includes("feed-item-media") ? "thumb" : "full");
  image.alt = item.image.alt || headline(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => { image.remove(); fallback(); }, { once: true });
  figure.append(image);
  if (withCredit && item.image.credit) append(figure, "figcaption", "", `Fot. ${item.image.credit}`);
  return figure;
}

// Ocena nigdy nie jest przekazywana samym kolorem: zawsze ma znak i opis.
function ratingLabel(id) {
  if (reactions[id] === "like") return "▲ Podoba się";
  if (reactions[id] === "dislike") return "▼ Nie podoba się";
  return "";
}

function renderList() {
  visible = activeCategory === "all" ? items : items.filter((item) => item.category === activeCategory);
  elements.feed.replaceChildren();
  elements.feed.setAttribute("aria-busy", "false");
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-feed";
    append(empty, "strong", "", "Brak wiadomości w tym dziale");
    append(empty, "span", "", "Redakcja przygotowuje materiały. Wydanie odświeża się automatycznie.");
    elements.feed.append(empty);
    return;
  }

  visible.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = index === 0 ? "feed-item is-lead" : "feed-item";
    if (reactions[item.id]) row.dataset.rated = reactions[item.id];
    if (sessionNewIds.has(item.id)) row.dataset.fresh = "true";
    if (seen.has(item.id)) row.dataset.seen = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "feed-item-button";
    button.setAttribute("aria-label", `Otwórz wiadomość: ${headline(item)}`);
    button.append(buildMedia(item, index === 0 ? "feed-item-media is-lead" : "feed-item-media"));

    const body = document.createElement("div");
    body.className = "feed-item-body";
    const meta = document.createElement("div");
    meta.className = "feed-item-meta";
    append(meta, "span", "feed-item-category", item.category);
    append(meta, "time", "", formatDate(item.updatedAt || item.publishedAt));
    // Oznaczenie slowem, a nie tylko kolorem.
    if (sessionNewIds.has(item.id)) append(meta, "span", "feed-item-fresh", "Nowe");
    body.append(meta);
    append(body, "h2", "", headline(item));
    const footer = document.createElement("div");
    footer.className = "feed-item-footer";
    append(footer, "span", "", `${item.sourceCount} źródła`);
    if (seen.has(item.id)) append(footer, "span", "feed-item-read", "Przeczytane");
    if (reactions[item.id]) append(footer, "span", "feed-item-rating", ratingLabel(item.id));
    body.append(footer);
    button.append(body);

    button.addEventListener("click", () => openReader(item, button));
    row.append(button);
    elements.feed.append(row);
  });
}

function renderReader() {
  const item = readerQueue[readerIndex];
  if (!item) return closeReader();
  elements.readerPosition.textContent = `${readerIndex + 1} z ${readerQueue.length}`;
  elements.media.replaceChildren(...[...buildMedia(item, "reader-figure", true).childNodes]);
  elements.media.dataset.fallback = item.image ? "false" : "true";
  if (item.image) {
    // Maly przycisk w narozniku daje dostep z klawiatury; dotkniecie zdjecia
    // dziala tak samo, ale nie zabiera powierzchni pod gesty.
    const zoom = document.createElement("button");
    zoom.type = "button";
    zoom.className = "media-zoom";
    zoom.textContent = "Powiększ";
    zoom.addEventListener("click", () => openPhoto(item));
    elements.media.append(zoom);
  }
  elements.category.textContent = item.category;
  elements.time.textContent = formatFullDate(item.publishedAt || item.updatedAt);
  elements.age.textContent = relativeAge(item.publishedAt || item.updatedAt);
  elements.rating.textContent = ratingLabel(item.id);
  elements.title.textContent = headline(item);
  elements.deck.textContent = item.level2;
  elements.deck.hidden = !item.level2;
  elements.deck.scrollTop = 0;
  elements.sourceCount.textContent = `${item.sourceCount}`;
  elements.sources.replaceChildren();
  item.sources.forEach((source) => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title;
    row.append(link);
    append(row, "small", "", `${source.domain} · ${source.time}`);
    elements.sources.append(row);
  });
  elements.actionLike.dataset.active = String(reactions[item.id] === "like");
  elements.actionSkip.dataset.active = String(reactions[item.id] === "dislike");
  renderReactionCounts(item);
  elements.actionPrev.disabled = readerIndex === 0;
  elements.actionNext.disabled = readerIndex >= readerQueue.length - 1;
  closeSheet();
  resetCardTransform();
}

function openReader(item, trigger, { push = true } = {}) {
  if (!item) return;
  lastFocused = trigger || null;
  // Kolejka pomija przeczytane, ale zawsze zawiera material otwarty świadomie z listy.
  readerQueue = visible.filter((entry) => !seen.has(entry.id) || entry.id === item.id);
  readerIndex = readerQueue.findIndex((entry) => entry.id === item.id);
  if (readerIndex < 0) {
    readerQueue = [item];
    readerIndex = 0;
  }
  // Wpis w historii sprawia, ze cofniecie zamyka artykul zamiast wychodzic z aplikacji.
  if (item) {
    const state = { reader: item.id };
    if (push) history.pushState(state, "", `#${item.id}`);
    else history.replaceState(state, "", `#${item.id}`);
  }
  elements.reader.hidden = false;
  document.body.classList.add("is-reading");
  renderReader();
  // Fokus laduje na realnym przycisku, a nie na karcie: nie rysuje obwodki
  // wokol calej karty, a klawiatura i tak dziala globalnie.
  elements.readerClose.focus({ preventScroll: true });
  if (document.fullscreenEnabled && !document.fullscreenElement) elements.reader.requestFullscreen?.().catch(() => {});
}

function dismissReader() {
  // Zamkniecie materialu tez znaczy, ze zostal przeczytany.
  const current = readerQueue[readerIndex];
  if (current) {
    markSeen(current.id);
    renderList();
  }
  elements.reader.hidden = true;
  document.body.classList.remove("is-reading");
  readerIndex = -1;
  closeSheet();
  closePhoto();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  lastFocused?.focus?.();
  lastFocused = null;
}

function closeReader() {
  // Cofamy wpis w historii, zeby przycisk Zamknij i systemowe cofniecie
  // prowadzily do tego samego stanu.
  if (history.state?.reader) {
    history.back();
    return;
  }
  dismissReader();
  if (location.hash) history.replaceState(null, "", location.pathname);
}

window.addEventListener("popstate", (event) => {
  const id = event.state?.reader;
  if (id) {
    const target = visible.find((item) => item.id === id);
    if (target) {
      const inQueue = readerQueue.findIndex((item) => item.id === id);
      if (!elements.reader.hidden && inQueue >= 0) { readerIndex = inQueue; renderReader(); }
      else openReader(target, null, { push: false });
      return;
    }
  }
  if (!elements.reader.hidden) dismissReader();
});

function move(step, animate = true) {
  const next = readerIndex + step;
  if (next < 0 || next >= readerQueue.length) {
    snapBack();
    flash(step > 0 ? "To wszystkie nowe wiadomości" : "To pierwsza wiadomość");
    return;
  }
  const leaving = readerQueue[readerIndex];
  const go = () => {
    // Przejscie dalej oznacza material jako przeczytany. Powrot w lewo nie,
    // bo czytelnik chce wtedy do niego wrocic.
    if (leaving && step > 0) {
      markSeen(leaving.id);
      renderList();
    }
    readerIndex = next;
    const item = readerQueue[readerIndex];
    // Przechodzenie miedzy artykulami podmienia wpis, zeby cofniecie zamykalo
    // czytnik jednym ruchem, a nie odtwarzalo kazdego przesuniecia.
    if (item) history.replaceState({ reader: item.id }, "", `#${item.id}`);
    renderReader();
  };
  if (animate) flyOut(step > 0 ? "right" : "left", go);
  else go();
}

function flash(message) {
  elements.readerPosition.textContent = message;
  setTimeout(() => { if (readerIndex >= 0) elements.readerPosition.textContent = `${readerIndex + 1} z ${readerQueue.length}`; }, 1_200);
}

// Ocena: ponowne uzycie tej samej oceny ja wycofuje. Po ocenie przechodzimy dalej.
// Wysyla wylacznie zmiane wlasnego glosu. Serwer nie dostaje zadnego identyfikatora.
async function reportReaction(id, from, to) {
  try {
    const response = await fetch("/api/public/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, from: from || "", to: to || "" }),
    });
    if (!response.ok) return;
    const payload = await response.json();
    const target = fetched.find((entry) => entry.id === id) || items.find((entry) => entry.id === id);
    if (target && payload.reactions) target.reactions = payload.reactions;
    if (readerQueue[readerIndex]?.id === id) renderReactionCounts(readerQueue[readerIndex]);
  } catch { /* ocena jest dodatkiem, brak sieci nie moze psuc czytania */ }
}

function renderReactionCounts(item) {
  const counts = item?.reactions || { likes: 0, dislikes: 0 };
  elements.actionLike.textContent = counts.likes ? `▲ Tak ${counts.likes}` : "▲ Tak";
  elements.actionSkip.textContent = counts.dislikes ? `▼ Nie ${counts.dislikes}` : "▼ Nie";
}

function rate(value, animate = true) {
  const item = readerQueue[readerIndex];
  if (!item) return;
  const apply = () => {
    const previous = reactions[item.id] || "";
    if (reactions[item.id] === value) delete reactions[item.id];
    else reactions[item.id] = value;
    saveReactions();
    reportReaction(item.id, previous, reactions[item.id] || "");
    // Ocena to tez odczytanie: material nie wroci w trybie pelnoekranowym.
    markSeen(item.id);
    renderList();
    if (readerIndex < readerQueue.length - 1) move(1, false);
    else renderReader();
  };
  if (animate) flyOut(value === "like" ? "up" : "down", apply);
  else apply();
}

const drag = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, pointerId: null, locked: null };
const SWIPE_X = 90;
const SWIPE_Y = 110;
// Odroznia dotkniecie od przesuniecia, zeby gest nie otwieral podgladu zdjecia.
let lastGestureMoved = false;

function resetCardTransform() {
  elements.readerCard.style.transition = "";
  elements.readerCard.style.transform = "";
  elements.readerCard.style.opacity = "";
  elements.stampLike.style.opacity = "0";
  elements.stampSkip.style.opacity = "0";
}

// --- Animacje przesuwania: karta wylatuje w kierunku gestu, nastepna wjezdza
//     z przeciwnej strony. Przy ustawieniu ograniczonego ruchu zmiana jest natychmiastowa. ---
let animating = false;
const OUT = { left: "translateX(-130%) rotate(-14deg)", right: "translateX(130%) rotate(14deg)", up: "translateY(-125%) rotate(-3deg)", down: "translateY(125%) rotate(3deg)" };
const IN = { left: "translateX(52%)", right: "translateX(-52%)", up: "translateY(28px)", down: "translateY(-28px)" };

function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

function flyIn(direction) {
  if (reducedMotion()) return;
  const card = elements.readerCard;
  card.style.transition = "none";
  card.style.transform = IN[direction] || "";
  card.style.opacity = "0";
  requestAnimationFrame(() => {
    card.style.transition = "transform .3s cubic-bezier(.22,.61,.36,1), opacity .22s ease-out";
    card.style.transform = "";
    card.style.opacity = "1";
  });
}

function flyOut(direction, after) {
  if (reducedMotion()) { after(); return; }
  if (animating) return;
  animating = true;
  const card = elements.readerCard;
  card.style.transition = "transform .24s cubic-bezier(.4,0,.7,.2), opacity .24s ease-in";
  card.style.transform = OUT[direction];
  card.style.opacity = "0";
  setTimeout(() => {
    after();
    flyIn(direction);
    animating = false;
  }, 215);
}

function snapBack() {
  const card = elements.readerCard;
  card.style.transition = reducedMotion() ? "none" : "transform .32s cubic-bezier(.34,1.4,.64,1)";
  card.style.transform = "";
  elements.stampLike.style.opacity = "0";
  elements.stampSkip.style.opacity = "0";
}

elements.readerCard.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target.closest("a, button")) return;
  // Gest zaczety w przewijanym tekscie nalezy do przegladarki (przewijanie
  // tresci), nie do przesuwania karty — inaczej dluzsze skroty nie dalyby sie
  // przewinac dotykiem, bo touch-action rodzica ogranicza dzieci.
  if (event.target.closest(".reader-deck")) return;
  drag.active = true;
  drag.pointerId = event.pointerId;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.dx = 0;
  drag.dy = 0;
  drag.locked = null;
  lastGestureMoved = false;
  elements.readerCard.style.transition = "none";
});

elements.readerCard.addEventListener("pointermove", (event) => {
  if (!drag.active || event.pointerId !== drag.pointerId) return;
  drag.dx = event.clientX - drag.startX;
  drag.dy = event.clientY - drag.startY;
  if (!drag.locked && (Math.abs(drag.dx) > 12 || Math.abs(drag.dy) > 12)) drag.locked = Math.abs(drag.dx) > Math.abs(drag.dy) ? "x" : "y";
  if (!drag.locked) return;
  if (drag.locked === "x") {
    elements.readerCard.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 30}deg) scale(.99)`;
  } else {
    elements.readerCard.style.transform = `translateY(${drag.dy}px) scale(.99)`;
    elements.stampLike.style.opacity = String(Math.min(1, Math.max(0, -drag.dy / SWIPE_Y)));
    elements.stampSkip.style.opacity = String(Math.min(1, Math.max(0, drag.dy / SWIPE_Y)));
  }
});

function endDrag() {
  if (!drag.active) return;
  drag.active = false;
  const { dx, dy, locked } = drag;
  lastGestureMoved = Math.abs(dx) > 8 || Math.abs(dy) > 8;
  // Karta kontynuuje ruch od miejsca, w ktorym palec ja zostawil.
  if (locked === "x" && Math.abs(dx) >= SWIPE_X) return move(dx < 0 ? -1 : 1);
  if (locked === "y" && dy <= -SWIPE_Y) return rate("like");
  if (locked === "y" && dy >= SWIPE_Y) return rate("dislike");
  snapBack();
}

elements.readerCard.addEventListener("pointerup", endDrag);
elements.readerCard.addEventListener("pointercancel", endDrag);

// Udostepnianie: natywne okno systemowe i schowek wymagaja HTTPS, wiec przy
// polaczeniu bez szyfrowania schodzimy do starego mechanizmu kopiowania.
function legacyCopy(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "readonly");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  field.remove();
  return copied;
}

async function shareCurrent() {
  const item = readerQueue[readerIndex];
  if (!item) return;
  const link = `${location.origin}/a/${encodeURIComponent(item.id)}`;
  const label = elements.share.textContent;
  const done = (message) => {
    elements.share.textContent = message;
    setTimeout(() => { elements.share.textContent = label; }, 1_800);
  };
  try {
    if (navigator.share) {
      await navigator.share({ title: "Telegram", text: headline(item), url: link });
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
      done("Skopiowano");
      return;
    }
    done(legacyCopy(link) ? "Skopiowano" : link);
  } catch {
    done(legacyCopy(link) ? "Skopiowano" : "Nie udało się");
  }
}

elements.share.addEventListener("click", shareCurrent);

function openPhoto(item) {
  if (!item?.image) return;
  elements.photoFull.src = item.image.url;
  elements.photoFull.alt = item.image.alt || headline(item);
  elements.photoCredit.textContent = item.image.credit ? `Fot. ${item.image.credit}` : "";
  elements.photoDialog.showModal();
  elements.photoClose.focus();
}

function closePhoto() {
  if (elements.photoDialog.open) elements.photoDialog.close();
}

elements.photoClose.addEventListener("click", closePhoto);
elements.photoDialog.addEventListener("cancel", (event) => { event.preventDefault(); closePhoto(); });
elements.photoDialog.addEventListener("click", (event) => { if (event.target === elements.photoDialog) closePhoto(); });

// Dotkniecie zdjecia otwiera podglad, ale tylko gdy nie byl to gest przesuniecia.
elements.media.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  if (lastGestureMoved) return;
  openPhoto(readerQueue[readerIndex]);
});

function openSheet() {
  elements.sheet.hidden = false;
  elements.sheetClose.focus();
}

function closeSheet() {
  elements.sheet.hidden = true;
}

elements.readerMore.addEventListener("click", openSheet);
elements.sheetClose.addEventListener("click", () => { closeSheet(); elements.readerMore.focus({ preventScroll: true }); });

document.addEventListener("keydown", (event) => {
  if (elements.installDialog.open) return;
  if (elements.photoDialog.open) { if (event.key === "Escape") closePhoto(); return; }
  if (elements.reader.hidden) return;
  if (!elements.sheet.hidden) { if (event.key === "Escape") closeSheet(); return; }
  if (event.key === "Escape") closeReader();
  else if (event.key === "ArrowRight") move(1);
  else if (event.key === "ArrowLeft") move(-1);
  else if (event.key === "ArrowUp") { event.preventDefault(); rate("like"); }
  else if (event.key === "ArrowDown") { event.preventDefault(); rate("dislike"); }
});

elements.readerClose.addEventListener("click", closeReader);
elements.actionNext.addEventListener("click", () => move(1));
elements.actionPrev.addEventListener("click", () => move(-1));
elements.actionLike.addEventListener("click", () => rate("like"));
elements.actionSkip.addEventListener("click", () => rate("dislike"));

document.querySelectorAll(".category-filter button").forEach((button) => button.addEventListener("click", () => {
  activeCategory = button.dataset.category;
  document.querySelectorAll(".category-filter button").forEach((item) => item.classList.toggle("is-active", item === button));
  // Przycisk wybrany dotykiem przy prawej krawedzi paska mogl wczesniej zostac
  // poza widocznym obszarem (pasek przewija sie w bok, a nic nie doprowadzalo
  // wybranej kategorii z powrotem do widoku).
  button.scrollIntoView({ block: "nearest", inline: "nearest" });
  renderList();
  recomputePending();
}));

function platformSteps() {
  const agent = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(agent) || (agent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(agent);
  if (isIos) return [["iPhone lub iPad", ["Otwórz tę stronę w Safari.", "Dotknij ikony Udostępnij na dolnym pasku.", "Wybierz Dodaj do ekranu początkowego.", "Potwierdź przyciskiem Dodaj."]]];
  if (isAndroid) return [["Android", ["Otwórz menu przeglądarki, czyli trzy kropki.", "Wybierz Zainstaluj aplikację lub Dodaj do ekranu głównego.", "Potwierdź instalację."]]];
  return [
    ["Komputer, Chrome lub Edge", ["Kliknij ikonę instalacji po prawej stronie paska adresu.", "Albo otwórz menu przeglądarki i wybierz Zainstaluj.", "Aplikacja uruchomi się w osobnym oknie."]],
    ["Komputer, Safari", ["Otwórz menu Plik.", "Wybierz Dodaj do Docka."]],
  ];
}

function renderInstallSteps() {
  elements.installSteps.replaceChildren();
  elements.installNow.hidden = !installPrompt;
  platformSteps().forEach(([label, steps]) => {
    const section = document.createElement("section");
    append(section, "h3", "", label);
    const list = document.createElement("ol");
    steps.forEach((step) => append(list, "li", "", step));
    section.append(list);
    elements.installSteps.append(section);
  });
}

elements.install.addEventListener("click", () => { renderInstallSteps(); elements.installDialog.showModal(); });
elements.installClose.addEventListener("click", () => elements.installDialog.close());
elements.installDialog.addEventListener("click", (event) => { if (event.target === elements.installDialog) elements.installDialog.close(); });
elements.installNow.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  elements.installDialog.close();
});

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; });
window.addEventListener("appinstalled", () => { installPrompt = null; elements.install.hidden = true; });
if (window.matchMedia("(display-mode: standalone)").matches) elements.install.hidden = true;

async function loadFeed() {
  try {
    const response = await fetch("/api/public/feed", { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    fetched = Array.isArray(payload.items) ? payload.items.map(normalize).filter(Boolean) : [];
    elements.updated.textContent = `Aktualizacja ${new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    const openId = readerIndex >= 0 ? readerQueue[readerIndex]?.id : decodeURIComponent(location.hash.slice(1));
    // Podmieniamy liste tylko wtedy, gdy nie przerwiemy czytania: przy pierwszym
    // wczytaniu, gdy czytnik jest zamkniety i jestesmy na gorze, albo gdy wchodzimy z linku.
    const readerOpen = !elements.reader.hidden;
    if (!items.length || openId || (!readerOpen && window.scrollY < 80)) adoptFetched();
    else recomputePending();
    if (openId) {
      const target = visible.find((item) => item.id === openId);
      if (!target) { if (readerIndex >= 0) dismissReader(); }
      else if (readerIndex < 0) openReader(target, null, { push: false });
    }
  } catch {
    elements.updated.textContent = "Tryb offline";
    renderList();
  }
}

elements.mastheadDate.textContent = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

// --- Wielkosc tekstu: skala bazowa dla calej aplikacji, zapisywana lokalnie ---
const FONT_STEPS = [14, 16, 18, 20, 22];
// Uwaga: Number(null) daje 0, wiec brak zapisu trzeba sprawdzic osobno.
const storedFontStep = localStorage.getItem("feed-font-step");
let fontIndex = storedFontStep === null ? 1 : Number(storedFontStep);
if (!Number.isInteger(fontIndex) || fontIndex < 0 || fontIndex >= FONT_STEPS.length) fontIndex = 1;

function applyFontSize() {
  const size = FONT_STEPS[fontIndex];
  document.documentElement.style.setProperty("--base-font", `${size}px`);
  elements.fontLevel.textContent = `${Math.round((size / 16) * 100)}%`;
  elements.fontSmaller.disabled = fontIndex === 0;
  elements.fontBigger.disabled = fontIndex === FONT_STEPS.length - 1;
  try { localStorage.setItem("feed-font-step", String(fontIndex)); } catch { /* tryb prywatny */ }
}

elements.fontSmaller.addEventListener("click", () => { if (fontIndex > 0) { fontIndex -= 1; applyFontSize(); } });
elements.fontBigger.addEventListener("click", () => { if (fontIndex < FONT_STEPS.length - 1) { fontIndex += 1; applyFontSize(); } });
applyFontSize();

const theme = localStorage.getItem("feed-theme") || "light";
document.documentElement.dataset.theme = theme;
elements.theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("feed-theme", next);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
loadFeed();
setInterval(loadFeed, 60_000);

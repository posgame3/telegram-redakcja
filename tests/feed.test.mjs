// Test zachowania publicznego feedu w jsdom: kolejka trybu pelnoekranowego
// pomija przeczytane, a lista je wygasza.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const HTML = readFileSync(new URL("../feed.html", import.meta.url), "utf8");
const SCRIPT = readFileSync(new URL("../feed.js", import.meta.url), "utf8");

function publication(id, minutesAgo) {
  const time = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    title: `Tytuł ${id}`,
    level1: `Skrót materiału ${id} zawiera najważniejsze fakty potwierdzone w dwóch niezależnych publikacjach źródłowych z dzisiejszego dnia.`,
    level2: `Szerszy kontekst materiału ${id}.`,
    category: "kraj",
    tags: ["tag"],
    confidence: 80,
    sourceCount: 2,
    publishedAt: time,
    updatedAt: time,
    image: null,
    sources: [{ domain: "RMF24", time: "10:00", title: "Źródło", url: "https://www.rmf24.pl/a" }],
    reactions: { likes: 0, dislikes: 0 },
  };
}

const items = [publication("a1", 5), publication("a2", 90), publication("a3", 3_000)];
const domy = [];

async function boot() {
  const dom = new JSDOM(HTML.replace('<script src="/feed.js"></script>', ""), {
    url: "http://localhost/feed",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  domy.push(dom);
  const { window } = dom;
  // jsdom nie ma matchMedia ani fetch, a feed z nich korzysta.
  window.matchMedia = (query) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
  window.fetch = async () => ({ ok: true, json: async () => ({ items, generatedAt: new Date().toISOString() }) });
  const script = window.document.createElement("script");
  script.textContent = SCRIPT;
  window.document.body.append(script);
  await wait(60);
  return window;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rows(window) {
  return [...window.document.querySelectorAll(".feed-item")];
}

function key(window, name) {
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

after(() => domy.forEach((dom) => dom.window.close()));

describe("feed — kolejka trybu pełnoekranowego pomija przeczytane", () => {
  it("wyświetla wszystkie materiały i otwiera pierwszy z pełną kolejką", async () => {
    const window = await boot();
    assert.equal(rows(window).length, 3);
    rows(window)[0].querySelector("button").click();
    assert.equal(window.document.querySelector("#reader").hidden, false);
    assert.equal(window.document.querySelector("#reader-position").textContent, "1 z 3");
  });

  it("oznacza materiał jako przeczytany po przejściu dalej i po zamknięciu", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    key(window, "ArrowRight");
    await wait(320);
    assert.equal(window.document.querySelector("#reader-position").textContent, "2 z 3");
    key(window, "Escape");
    await wait(30);
    const zapisane = JSON.parse(window.localStorage.getItem("telegram-seen") || "[]");
    assert.deepEqual(zapisane.sort(), ["a1", "a2"], "przejście dalej i zamknięcie oznaczają odczyt");
  });

  it("po ponownym otwarciu pokazuje tylko materiały nieprzeczytane", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    key(window, "ArrowRight");
    await wait(320);
    key(window, "Escape");
    await wait(30);
    rows(window)[2].querySelector("button").click();
    assert.equal(window.document.querySelector("#reader-position").textContent, "1 z 1", "w kolejce zostaje jedyny nieprzeczytany materiał");
  });

  it("ocena też oznacza materiał jako przeczytany", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    key(window, "ArrowUp");
    await wait(320);
    const zapisane = JSON.parse(window.localStorage.getItem("telegram-seen") || "[]");
    assert.ok(zapisane.includes("a1"));
  });

  it("pozwala wrócić do przeczytanego materiału otwartego z listy", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    key(window, "Escape");
    await wait(30);
    rows(window)[0].querySelector("button").click();
    assert.equal(window.document.querySelector("#reader").hidden, false, "świadome otwarcie z listy musi działać także dla przeczytanego");
  });
});

describe("feed — lista klasyczna i data publikacji", () => {
  it("wygasza przeczytane i opisuje je słowem, nie tylko kolorem", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    key(window, "Escape");
    await wait(30);
    const row = rows(window)[0];
    assert.equal(row.dataset.seen, "true");
    assert.match(row.textContent, /Przeczytane/);
    assert.equal(rows(window)[1].dataset.seen, undefined);
  });

  it("pokazuje pełną datę z rokiem oraz wiek materiału", async () => {
    const window = await boot();
    rows(window)[0].querySelector("button").click();
    const czas = window.document.querySelector("#reader-time").textContent;
    const wiek = window.document.querySelector("#reader-age").textContent;
    assert.match(czas, /\d{4}/, "pełna data zawiera rok");
    assert.match(czas, /\d{2}:\d{2}/, "pełna data zawiera godzinę");
    assert.match(wiek, /min temu|godz\. temu|przed chwilą/);
  });

  it("odróżnia materiał świeży od starego", async () => {
    const window = await boot();
    rows(window)[2].querySelector("button").click();
    assert.match(window.document.querySelector("#reader-age").textContent, /dni temu|wczoraj/);
  });
});

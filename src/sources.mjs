export const CRAWLER_NAME = "TelegramRedakcjaPrototype";
export const USER_AGENT = `${CRAWLER_NAME}/0.2 (+local editorial research tool)`;

export const SOURCES = [
  {
    id: "rmf24",
    name: "RMF24",
    ownerGroup: "bauer",
    feedUrl: "https://www.rmf24.pl/fakty/feed",
    hosts: ["www.rmf24.pl", "rmf24.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: [".article-page__content.article_speakable", "article.article-page"],
  },
  {
    id: "polsatnews",
    name: "Polsat News",
    ownerGroup: "polsat-plus",
    feedUrl: "https://www.polsatnews.pl/rss/wszystkie.xml",
    hosts: ["www.polsatnews.pl", "polsatnews.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: [".news__content", "main article"],
  },
  {
    id: "onet",
    name: "Onet Wiadomości",
    ownerGroup: "rasp",
    feedUrl: "https://wiadomosci.onet.pl/.feed",
    hosts: ["wiadomosci.onet.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: ["main article", "main"],
  },
  {
    id: "interia",
    name: "Interia Wydarzenia",
    ownerGroup: "polsat-plus",
    feedUrl: "https://wydarzenia.interia.pl/feed",
    hosts: ["wydarzenia.interia.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: ["article.article-container", "article"],
  },
  {
    id: "bankier",
    name: "Bankier.pl",
    ownerGroup: "bonnier",
    feedUrl: "https://www.bankier.pl/rss/wiadomosci.xml",
    hosts: ["www.bankier.pl", "bankier.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: ["article#article .o-article-content", "article#article"],
  },
  {
    id: "money",
    name: "Money.pl",
    ownerGroup: "wp",
    feedUrl: "https://www.money.pl/rss/",
    hosts: ["www.money.pl", "money.pl"],
    accessPolicy: "official-rss-public",
    contentSelectors: ["main.wp-main-article article .article-body-grid", "main.wp-main-article article"],
  },
  {
    id: "businessinsider",
    name: "Business Insider Polska",
    ownerGroup: "rasp",
    feedUrl: "https://businessinsider.com.pl/.feed",
    hosts: ["businessinsider.com.pl"],
    accessPolicy: "explicit-free-metadata",
    contentSelectors: ["article.article section.main", "article.article"],
    rejectSelectors: [".contentPremium", "[data-paywall]", ".paywall"],
  },
];

export function isAllowedSourceUrl(source, value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && source.hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

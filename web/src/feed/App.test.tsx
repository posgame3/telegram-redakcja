import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../shared/api";
import { STORAGE_KEYS } from "../shared/storage";
import type { Publication } from "../shared/types";
import { App } from "./App";
import { makePublication } from "./testing/factories";

const { fetchPublicFeed, reportReaction } = vi.hoisted(() => ({
  fetchPublicFeed: vi.fn(),
  reportReaction: vi.fn(),
}));

vi.mock("../shared/api", async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, fetchPublicFeed, reportReaction };
});

const items = [
  makePublication({ id: "a1", minutesAgo: 5 }),
  makePublication({ id: "a2", minutesAgo: 90 }),
  makePublication({ id: "a3", minutesAgo: 3_000 }),
];

function feedOf(list: readonly Publication[]) {
  return { items: [...list], generatedAt: new Date().toISOString() };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  fetchPublicFeed.mockResolvedValue(feedOf(items));
  reportReaction.mockResolvedValue({ likes: 1, dislikes: 0 });
});

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".feed-item"));
}

async function openFirst(): Promise<void> {
  await waitFor(() => expect(rows()).toHaveLength(items.length));
  const button = rows()[0]!.querySelector("button");
  await userEvent.click(button!);
}

const position = () => screen.getByText(/^\d+ z \d+$/).textContent;
const seenIds = () =>
  (JSON.parse(localStorage.getItem(STORAGE_KEYS.seen) ?? "[]") as string[]).sort();

describe("feed — kolejka trybu pełnoekranowego pomija przeczytane", () => {
  it("wyświetla wszystkie materiały i otwiera pierwszy z pełną kolejką", async () => {
    render(<App />);
    await openFirst();

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(position()).toBe("1 z 3");
  });

  it("przejście dalej oznacza poprzedni materiał jako przeczytany", async () => {
    render(<App />);
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "Następna wiadomość" }));

    await waitFor(() => expect(position()).toBe("2 z 3"));
    expect(seenIds()).toContain("a1");
  });

  it("zamknięcie też oznacza materiał jako przeczytany", async () => {
    render(<App />);
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    await waitFor(() => expect(seenIds()).toContain("a1"));
  });

  it("po ponownym otwarciu w kolejce zostają tylko nieprzeczytane", async () => {
    render(<App />);
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "Następna wiadomość" }));
    await waitFor(() => expect(position()).toBe("2 z 3"));
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    // a1 i a2 sa przeczytane, wiec swiadome otwarcie a3 daje kolejke jednoelementowa.
    await userEvent.click(rows()[2]!.querySelector("button")!);

    await waitFor(() => expect(position()).toBe("1 z 1"));
  });

  it("pozwala wrócić do przeczytanego materiału otwartego świadomie z listy", async () => {
    render(<App />);
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(seenIds()).toContain("a1"));

    await userEvent.click(rows()[0]!.querySelector("button")!);

    // Przeczytany material wraca do kolejki tylko dlatego, ze otwarto go
    // swiadomie; a2 i a3 sa nieprzeczytane, wiec zostaja w kolejce.
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(position()).toBe("1 z 3");
  });

  it("ocena również oznacza materiał jako przeczytany", async () => {
    render(<App />);
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "Oceń pozytywnie" }));

    await waitFor(() => expect(seenIds()).toContain("a1"));
  });

  it("informuje, gdy nie ma kolejnych materiałów", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([items[0]!]));
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(rows()[0]!.querySelector("button")!);

    await userEvent.keyboard("{ArrowRight}");

    expect(await screen.findByText("To wszystkie nowe wiadomości")).toBeInTheDocument();
  });
});

describe("feed — lista klasyczna", () => {
  it("wygasza przeczytane i opisuje je słowem, nie tylko kolorem", async () => {
    render(<App />);
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    await waitFor(() => expect(rows()[0]).toHaveAttribute("data-seen", "true"));
    expect(rows()[0]).toHaveTextContent("Przeczytane");
    expect(rows()[1]).not.toHaveAttribute("data-seen");
  });

  it("pokazuje pełną datę z rokiem oraz wiek materiału", async () => {
    render(<App />);
    await openFirst();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/\d{4}/);
    expect(dialog).toHaveTextContent(/\d{2}:\d{2}/);
    expect(dialog).toHaveTextContent(/min temu|godz\. temu|przed chwilą/);
  });

  it("odróżnia materiał świeży od starego", async () => {
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(rows()[2]!.querySelector("button")!);

    expect(screen.getByRole("dialog")).toHaveTextContent(/dni temu|wczoraj/);
  });

  it("pokazuje komunikat, gdy dział jest pusty", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([]));
    render(<App />);

    expect(await screen.findByText("Brak wiadomości w tym dziale")).toBeInTheDocument();
  });
});

describe("feed — działy", () => {
  it("zawęża listę do wybranego działu", async () => {
    fetchPublicFeed.mockResolvedValue(
      feedOf([
        makePublication({ id: "kraj-1", category: "kraj" }),
        makePublication({ id: "rynki-1", category: "rynki" }),
      ]),
    );
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: "Rynki" }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("rynki-1");
  });
});

describe("feed — oceny", () => {
  it("wysyła zmianę głosu i zapisuje ją lokalnie", async () => {
    render(<App />);
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "Oceń pozytywnie" }));

    await waitFor(() => expect(reportReaction).toHaveBeenCalledWith("a1", "", "like"));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.reactions) ?? "{}") as Record<
      string,
      string
    >;
    expect(stored.a1).toBe("like");
  });

  it("powtórna ocena wycofuje głos", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([items[0]!]));
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(rows()[0]!.querySelector("button")!);

    await userEvent.click(screen.getByRole("button", { name: "Oceń pozytywnie" }));
    await waitFor(() => expect(reportReaction).toHaveBeenCalledWith("a1", "", "like"));
    await userEvent.click(screen.getByRole("button", { name: "Oceń pozytywnie" }));

    await waitFor(() => expect(reportReaction).toHaveBeenLastCalledWith("a1", "like", ""));
  });

  it("pokazuje liczniki zwrócone przez serwer", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([items[0]!]));
    reportReaction.mockResolvedValue({ likes: 7, dislikes: 2 });
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(rows()[0]!.querySelector("button")!);

    await userEvent.click(screen.getByRole("button", { name: "Oceń pozytywnie" }));

    // Licznik dochodzi dopiero po odpowiedzi serwera, wiec czekamy na tresc,
    // a nie tylko na obecnosc przycisku.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Oceń pozytywnie" })).toHaveTextContent("▲ Tak 7"),
    );
  });
});

describe("feed — nowe materiały nie podmieniają treści pod palcem", () => {
  it("pierwsze wczytanie pokazuje materiały od razu, bez paska", async () => {
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(3));

    // Pasek jest ukryty i bez tresci, wiec nie ma dostepnej nazwy do wyszukania.
    const bar = document.querySelector(".pending-bar");
    expect(bar).not.toBeVisible();
    expect(bar).toHaveTextContent("");
  });

  it("materiał nowy w tej sesji jest oznaczony słowem", async () => {
    // Znacznik ostatnio widzianego ustawiony w przeszlosc: material z 5 minut
    // temu jest wtedy nowoscia dla czytelnika.
    localStorage.setItem(STORAGE_KEYS.feedLastSeen, String(Date.now() - 30 * 60_000));
    render(<App />);

    await waitFor(() => expect(rows()[0]).toHaveAttribute("data-fresh", "true"));
    expect(rows()[0]).toHaveTextContent("Nowe");
    expect(rows()[1]).not.toHaveAttribute("data-fresh");
  });
});

describe("feed — zdjęcie materiału", () => {
  it("pokazuje kadr zastępczy, gdy materiał nie ma zdjęcia", async () => {
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(3));

    const figure = rows()[0]!.querySelector("figure");
    expect(figure).toHaveAttribute("data-fallback", "true");
    expect(figure).toHaveTextContent("Telegram");
  });

  it("miniatura na liście używa lżejszego wariantu z proxy", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([makePublication({ id: "z1", withImage: true })]));
    render(<App />);

    await waitFor(() => expect(rows()).toHaveLength(1));
    const image = rows()[0]!.querySelector("img");
    expect(image).toHaveAttribute("src", expect.stringContaining("v=thumb"));
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("czytnik używa wariantu pełnego", async () => {
    fetchPublicFeed.mockResolvedValue(feedOf([makePublication({ id: "z1", withImage: true })]));
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(rows()[0]!.querySelector("button")!);

    const image = screen.getByRole("dialog").querySelector("img");
    expect(image).toHaveAttribute("src", expect.stringContaining("v=full"));
  });
});

describe("feed — tryb offline", () => {
  it("informuje o braku połączenia zamiast pustego ekranu", async () => {
    fetchPublicFeed.mockRejectedValue(new Error("fetch failed"));
    render(<App />);

    expect(await screen.findByText("Tryb offline")).toBeInTheDocument();
  });
});

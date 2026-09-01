import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../shared/api";
import type { EditorialQueue } from "../shared/api";
import { App } from "./App";
import { makeEmptyEvent, makeEvent, words } from "./testing/factories";

const { fetchEditorialQueue, submitEditorialAction, validateText, runSynchronization } = vi.hoisted(
  () => ({
    fetchEditorialQueue: vi.fn(),
    submitEditorialAction: vi.fn(),
    validateText: vi.fn(),
    runSynchronization: vi.fn(),
  }),
);

vi.mock("../shared/api", async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    fetchEditorialQueue,
    submitEditorialAction,
    validateText,
    runSynchronization,
  };
});

function queue(events: EditorialQueue["events"]): EditorialQueue {
  return { events, reactions: {}, lastSync: null };
}

beforeEach(() => {
  // Bez tego wywolania mockow przeciekaja miedzy testami i licznik wywolan
  // pokazuje operacje z poprzedniego przypadku.
  vi.clearAllMocks();
  window.location.hash = "";
  fetchEditorialQueue.mockResolvedValue(queue([makeEvent()]));
  submitEditorialAction.mockResolvedValue({ event: null, generation: null });
  validateText.mockResolvedValue({});
  runSynchronization.mockResolvedValue({ events: [], syncedAt: "", stats: {}, errors: [] });
});

/**
 * Wiersze kolejki. Sprawdzamy tu atrybut data-status, ktory jest szczegolem DOM
 * niosacym informacje o statusie, wiec siegamy po klase wiersza.
 */
function queueRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".event-row"));
}

describe("panel — domyślny widok kolejki", () => {
  it("startuje na widoku 'Do decyzji', nie na 'Wszystkie'", async () => {
    fetchEditorialQueue.mockResolvedValue(
      queue([
        makeEvent({ id: "do-decyzji", status: "review" }),
        makeEvent({ id: "opublikowany", status: "published" }),
        makeEvent({ id: "odrzucony", status: "rejected" }),
      ]),
    );
    render(<App />);

    await waitFor(() => expect(queueRows()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Do decyzji" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(queueRows()[0]).toHaveAttribute("data-status", "review");
  });

  it("przełączenie na 'Wszystkie' pokazuje pozostałe statusy", async () => {
    fetchEditorialQueue.mockResolvedValue(
      queue([
        makeEvent({ id: "do-decyzji", status: "review" }),
        makeEvent({ id: "opublikowany", status: "published" }),
      ]),
    );
    render(<App />);
    await waitFor(() => expect(queueRows()).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "Wszystkie" }));

    expect(queueRows()).toHaveLength(2);
    const statusy = queueRows().map((row) => row.getAttribute("data-status"));
    expect(statusy).toContain("published");
  });

  it("każdy wiersz niesie status w atrybucie, żeby dało się go odróżnić kolorem", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ id: "a", status: "published" })]));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Opublikowane" }));

    await waitFor(() => expect(queueRows()[0]).toHaveAttribute("data-status", "published"));
  });
});

describe("panel — materiał bez wygenerowanej treści", () => {
  it("nie pojawia się w kolejce - redaktor nie ma na nim nic do zrobienia", async () => {
    fetchEditorialQueue.mockResolvedValue(
      queue([makeEmptyEvent(), makeEvent({ id: "z-tresc" })]),
    );
    render(<App />);

    // Tylko material z tresci trafia do listy; bez tresci jest odfiltrowany
    // z widoku (zostaje w bazie, zeby aggregator nie zescrapowal tematu
    // ponownie w kolko, ale redaktor nigdy go nie widzi jako pozycje kolejki).
    await waitFor(() => expect(queueRows()).toHaveLength(1));
    expect(queueRows()[0]).not.toHaveAttribute("data-missing-content");
  });

  it("pusta kolejka pokazuje puste-stanowy komunikat, gdy wszystkie materiały są bez treści", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEmptyEvent()]));
    render(<App />);

    expect(await screen.findByText("Brak materiałów w tym widoku.")).toBeInTheDocument();
  });
});

describe("panel — warunki zatwierdzenia materiału", () => {
  const zatwierdz = () => screen.getByRole("button", { name: "ZATWIERDŹ" });

  it("pozwala zatwierdzić materiał spełniający wszystkie progi", async () => {
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeEnabled());
  });

  it("blokuje zatwierdzenie, gdy kontrola źródłowa nie przeszła", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ checksValid: false })]));
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeDisabled());
  });

  it("blokuje zatwierdzenie, gdy skrót jest za krótki", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ level1: words(10, "skrot") })]));
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeDisabled());
  });

  it("blokuje zatwierdzenie, gdy kontekst jest za krótki", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ level2: words(20, "kontekst") })]));
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeDisabled());
  });

  it("blokuje zatwierdzenie przy mniej niż dwóch tagach", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ tags: ["jeden"] })]));
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeDisabled());
  });

  it("blokuje zatwierdzenie, gdy tytuł ma mniej niż trzy słowa", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ title: "Krótki" })]));
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeDisabled());
  });

  it("unieważnia kontrolę po zmianie tekstu, więc zatwierdzenie znów jest zablokowane", async () => {
    render(<App />);
    await waitFor(() => expect(zatwierdz()).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "EDYTUJ" }));
    await userEvent.type(screen.getByLabelText("SKRÓT"), " dopisek");

    expect(zatwierdz()).toBeDisabled();
    expect(screen.getByText("WYMAGA KONTROLI")).toBeInTheDocument();
  });
});

describe("panel — publikacja jest osobnym krokiem", () => {
  it("materiał do decyzji nie daje się opublikować", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "PUBLIKUJ" })).toBeDisabled());
  });

  it("materiał zatwierdzony daje się opublikować", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ status: "approved" })]));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "PUBLIKUJ" })).toBeEnabled());
  });

  it("materiał zatwierdzony jest zablokowany do edycji", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ status: "approved" })]));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "EDYTUJ" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "ODRZUĆ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "WYGENERUJ PONOWNIE" })).toBeDisabled();
  });

  it("materiał po decyzji pozwala ją cofnąć", async () => {
    fetchEditorialQueue.mockResolvedValue(queue([makeEvent({ status: "rejected" })]));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Odrzucone" }));

    const cofnij = await screen.findByRole("button", { name: "COFNIJ DECYZJĘ" });
    await userEvent.click(cofnij);

    expect(submitEditorialAction).toHaveBeenCalledWith("live-1", "reopen", undefined);
  });
});

describe("panel — regeneracja nadpisująca wersję redaktora", () => {
  it("pyta o potwierdzenie, gdy materiał był edytowany, i przerywa po odmowie", async () => {
    const edited = makeEvent();
    fetchEditorialQueue.mockResolvedValue(
      queue([{ ...edited, editorialUpdatedAt: "2026-08-31T10:00:00.000Z" }]),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "WYGENERUJ PONOWNIE" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(submitEditorialAction).not.toHaveBeenCalled();
  });

  it("nie pyta, gdy materiał nie był edytowany", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "WYGENERUJ PONOWNIE" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(submitEditorialAction).toHaveBeenCalledWith("live-1", "regenerate", undefined);
  });

  it("informuje, gdy generowanie nie dało gotowego materiału", async () => {
    submitEditorialAction.mockResolvedValue({
      event: makeEmptyEvent("live-1"),
      generation: { status: "blocked-originality", reason: "Zbyt słabe pokrycie faktami." },
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "WYGENERUJ PONOWNIE" }));

    expect(
      await screen.findByText(
        /Generowanie nie dało gotowego materiału: Zbyt słabe pokrycie faktami./,
      ),
    ).toBeInTheDocument();
  });
});

describe("panel — źródła materiału", () => {
  it("pokazuje wszystkie publikacje źródłowe z odnośnikami do oryginałów", async () => {
    render(<App />);
    const lista = await screen.findByRole("heading", { name: "Artykuły i streszczenia" });
    const sekcja = lista.closest("section");
    expect(sekcja).not.toBeNull();

    const linki = within(sekcja as HTMLElement).getAllByRole("link");
    expect(linki).toHaveLength(2);
    expect(linki[0]).toHaveAttribute("href", "https://www.rmf24.pl/a");
    expect(linki[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("otwiera podgląd streszczenia w okně modalnym", async () => {
    render(<App />);
    const przyciski = await screen.findAllByRole("button", { name: "OTWÓRZ STRESZCZENIE →" });
    await userEvent.click(przyciski[0]!);

    expect(await screen.findByText("Streszczenie robocze artykułu.")).toBeInTheDocument();
  });
});

describe("panel — błąd odczytu kolejki", () => {
  it("pokazuje powód, zamiast pustego ekranu bez wyjaśnienia", async () => {
    fetchEditorialQueue.mockRejectedValue(new Error("HTTP 401"));
    render(<App />);

    expect(await screen.findByText(/Nie udało się wczytać kolejki: HTTP 401/)).toBeInTheDocument();
  });
});

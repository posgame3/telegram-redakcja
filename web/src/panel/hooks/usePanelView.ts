import { useCallback, useEffect, useRef, useState } from "react";

export type PanelView = "list" | "detail";

const NARROW_QUERY = "(max-width: 760px)";

interface HistoryEntry {
  view: PanelView;
  id?: string;
}

function currentEntry(): HistoryEntry | null {
  const state: unknown = window.history.state;
  if (state === null || typeof state !== "object") return null;
  const view = (state as { view?: unknown }).view;
  if (view !== "list" && view !== "detail") return null;
  const id = (state as { id?: unknown }).id;
  return { view, id: typeof id === "string" ? id : undefined };
}

export interface UsePanelView {
  view: PanelView;
  isNarrow: boolean;
  /** Otwiera material. Na telefonie przechodzi na drugi ekran i dopisuje wpis do historii. */
  openDetail: (id: string) => void;
  /** Wraca do kolejki. Cofa wpis w historii, jesli material byl otwarty swiadomie. */
  backToList: () => void;
}

/**
 * Panel na telefonie dziala jak dwa ekrany: kolejka tematow, potem material.
 * Na szerokim ekranie oba sa widoczne naraz i widok nie ma znaczenia.
 *
 * Kazde wejscie w material dopisuje wpis do historii, wiec systemowy przycisk
 * cofania i gest cofniecia wracaja do kolejki, zamiast wychodzic z aplikacji.
 */
export function usePanelView(onRestoreSelection: (id: string) => void): UsePanelView {
  // Wejscie z linkiem do konkretnego materialu otwiera go od razu, zeby
  // udostepniony adres prowadzil do tresci, a nie do kolejki.
  const [view, setView] = useState<PanelView>(() => (window.location.hash ? "detail" : "list"));
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);

  // Referencja pozwala obsluzyc popstate bez ponownego podpinania nasluchu
  // przy kazdej zmianie zaznaczenia. Aktualizowana w efekcie, bo zapis do
  // referencji w trakcie renderowania jest niedozwolony.
  const restoreRef = useRef(onRestoreSelection);
  useEffect(() => {
    restoreRef.current = onRestoreSelection;
  }, [onRestoreSelection]);

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setIsNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.body.dataset.view = view;
  }, [view]);

  useEffect(() => {
    if (currentEntry() === null) {
      window.history.replaceState(
        { view: "list" } satisfies HistoryEntry,
        "",
        window.location.hash || window.location.pathname,
      );
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const entry = currentEntry();
      if (entry?.view === "detail" && entry.id) {
        restoreRef.current(entry.id);
        setView("detail");
        return;
      }
      setView("list");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openDetail = useCallback((id: string) => {
    const target = `#${encodeURIComponent(id)}`;
    if (window.location.hash !== target) {
      window.history.pushState({ view: "detail", id } satisfies HistoryEntry, "", target);
    } else {
      window.history.replaceState({ view: "detail", id } satisfies HistoryEntry, "", target);
    }
    setView("detail");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const backToList = useCallback(() => {
    if (currentEntry()?.view === "detail") {
      window.history.back();
      return;
    }
    window.history.pushState({ view: "list" } satisfies HistoryEntry, "", window.location.pathname);
    setView("list");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return { view, isNarrow, openDetail, backToList };
}

import { useCallback, useEffect, useState } from "react";
import { submitEditorialAction, type EditorialPatch } from "../shared/api";
import { useTheme } from "../shared/hooks/useTheme";
import { STORAGE_KEYS } from "../shared/storage";
import type { EditorialAction } from "../shared/types";
import { EditorPanel } from "./components/EditorPanel";
import { EvidencePanel } from "./components/EvidencePanel";
import { QueuePanel } from "./components/QueuePanel";
import { TopBar } from "./components/TopBar";
import { useEditorialQueue } from "./hooks/useEditorialQueue";
import { usePanelView } from "./hooks/usePanelView";
import { DEFAULT_QUEUE_FILTER, type QueueFilter } from "./labels";

/** Identyfikator materialu wskazany w adresie, np. po udostepnieniu linku. */
function idFromHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

export function App() {
  const [filter, setFilter] = useState<QueueFilter>(DEFAULT_QUEUE_FILTER);
  // Zaznaczenie startuje od identyfikatora z adresu, jesli link go zawiera.
  const [selectedId, setSelectedId] = useState<string | null>(() => idFromHash() || null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Automatyczne odswiezanie kolejki jest wstrzymane w trybie edycji, zeby nie
  // nadpisac tekstu, ktory redaktor wlasnie pisze.
  const queue = useEditorialQueue(editing);
  const { theme, toggle: toggleTheme } = useTheme(STORAGE_KEYS.panelTheme);

  const view = usePanelView(setSelectedId);
  // Material bez wygenerowanej tresci (generator zadzialal fail-closed) nie
  // ma niczego do zaakceptowania - redaktor nie moze na nim nic zrobic, wiec
  // nie ma powodu, by mu sie w ogole pojawial, nawet gdy jest wskazany
  // linkiem (#live-...). Zostaje w bazie (aggregator wciaz go widzi jako
  // znany temat, wiec nie zescrapuje go ponownie w kolko) - filtrujemy go
  // tylko z widoku.
  // Sprawdzamy level1, nie title: aggregator.mjs zawsze wypelnia title
  // tytulem artykulu zrodlowego jako zapas (title: generation.title ||
  // articles[0].title), wiec title nigdy nie jest puste, nawet gdy generator
  // nic nie wygenerowal - to dawalo pozycje w kolejce ze skrotem "0/20-30 slow".
  const events = queue.events.filter((event) => Boolean(event.level1));

  // Zaznaczenie wyliczamy przy renderowaniu: gdy wskazany material zniknal
  // z kolejki (albo link byl nieaktualny), pokazujemy pierwszy dostepny.
  const selectedEvent = events.find((event) => event.id === selectedId) ?? events[0] ?? null;

  // Blad odczytu kolejki jest pokazywany w notce decyzji, ale nie zapisujemy go
  // do stanu - inaczej trzeba by go czyscic przy kazdej udanej operacji.
  const note = message ?? (queue.error ? `Nie udało się wczytać kolejki: ${queue.error}` : null);

  // Tryb edycji przelacza widocznosc kolumny dowodowej i pol pomocniczych,
  // co jest sterowane z arkusza stylow przez klase na <body>.
  useEffect(() => {
    document.body.classList.toggle("is-editing", editing);
  }, [editing]);

  const selectEvent = useCallback(
    (id: string) => {
      setSelectedId(id);
      setEditing(false);
      setMessage(null);
      if (view.isNarrow) {
        view.openDetail(id);
      } else {
        // Na szerokim ekranie oba panele sa widoczne, wiec tylko przewijamy do edytora.
        document.querySelector("#editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [view],
  );

  const synchronize = useCallback(async () => {
    setMessage("Pobieram źródła i uruchamiam analizę. To może potrwać kilkadziesiąt sekund.");
    try {
      setMessage(await queue.synchronize());
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "nieznany błąd";
      setMessage(`Synchronizacja nie powiodła się: ${reason}`);
    }
  }, [queue]);

  const runAction = useCallback(
    async (action: EditorialAction, patch?: EditorialPatch) => {
      const event = selectedEvent;
      if (!event) return;

      if (action === "regenerate") {
        // Regeneracja nadpisuje wersje redaktora, wiec wymaga potwierdzenia.
        const editedByHuman = Boolean(event.editorialUpdatedAt);
        const confirmed =
          !editedByHuman ||
          window.confirm(
            "Materiał był edytowany. Ponowne generowanie nadpisze wersję redaktora. Kontynuować?",
          );
        if (!confirmed) return;
        setRegenerating(true);
        setMessage(
          "Model przygotowuje nową wersję materiału. To może potrwać kilkadziesiąt sekund.",
        );
      } else {
        setBusy(true);
        setMessage("Zapisuję operację redakcyjną...");
      }

      try {
        const result = await submitEditorialAction(event.id, action, patch);
        if (result.event) queue.replaceEvent(result.event);
        setEditing(false);

        if (action === "regenerate" && result.generation && result.generation.status !== "ready") {
          setMessage(
            `Generowanie nie dało gotowego materiału: ${result.generation.reason || result.generation.status}`,
          );
        } else {
          setMessage(null);
        }

        // Decyzja zamykajaca material konczy prace z nim, wiec na telefonie
        // wracamy do kolejki zamiast zostawiac puste szczegoly.
        if (view.isNarrow && (action === "publish" || action === "reject")) view.backToList();
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "nieznany błąd";
        const label = action === "regenerate" ? "Generowanie" : "Operacja";
        setMessage(`${label} nie powiodła się: ${reason}`);
      } finally {
        setBusy(false);
        setRegenerating(false);
      }
    },
    [queue, selectedEvent, view],
  );

  return (
    <>
      <a className="skip-link" href="#editor">
        Przejdź do edytora
      </a>

      <TopBar
        lastSync={queue.lastSync}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSynchronize={() => void synchronize()}
        syncing={queue.syncing}
      />

      <main className="workspace">
        <QueuePanel
          events={events}
          selectedId={selectedEvent?.id ?? null}
          filter={filter}
          onFilterChange={setFilter}
          onSelect={selectEvent}
        />

        <EditorPanel
          event={selectedEvent}
          reactions={selectedEvent ? queue.reactions[selectedEvent.id] : undefined}
          editing={editing}
          onToggleEditing={() => setEditing((current) => !current)}
          onBack={view.backToList}
          onAction={(action, patch) => void runAction(action, patch)}
          message={note}
          busy={busy}
          regenerating={regenerating}
        />

        <EvidencePanel event={selectedEvent} />
      </main>

      <footer className="footer">
        <span>TRWAŁY PIPELINE / ANALIZA WIELOŹRÓDŁOWA / PUBLIKACJA PWA</span>
        <a href="/feed">OTWÓRZ PUBLICZNY FEED →</a>
      </footer>
    </>
  );
}

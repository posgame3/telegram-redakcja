import { useState } from "react";
import type { EditorialPatch } from "../../shared/api";
import { countWords } from "../../shared/normalize";
import {
  CATEGORIES,
  type Category,
  type EditorialAction,
  type EditorialEvent,
  type ReactionCounts,
} from "../../shared/types";
import { useOriginalityChecks } from "../hooks/useOriginalityChecks";
import { headlineOf, LIMITS, STATUS_LABELS } from "../labels";
import { OriginalityTrace } from "./OriginalityTrace";

interface Draft {
  title: string;
  category: Category;
  tags: string;
  level1: string;
  level2: string;
}

function draftFrom(event: EditorialEvent): Draft {
  return {
    title: event.title,
    category: event.category,
    tags: event.tags.join(", "),
    level1: event.level1,
    level2: event.level2,
  };
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface EditorPanelProps {
  event: EditorialEvent | null;
  reactions: ReactionCounts | undefined;
  editing: boolean;
  onToggleEditing: () => void;
  onBack: () => void;
  onAction: (action: EditorialAction, patch?: EditorialPatch) => void;
  /** Komunikat operacji. Gdy null, notka opisuje sam status materialu. */
  message: string | null;
  busy: boolean;
  regenerating: boolean;
}

export function EditorPanel({
  event,
  reactions,
  editing,
  onToggleEditing,
  onBack,
  onAction,
  message,
  busy,
  regenerating,
}: EditorPanelProps) {
  if (!event) return <EmptyEditor message={message} />;
  return (
    <EditorForm
      event={event}
      reactions={reactions}
      editing={editing}
      onToggleEditing={onToggleEditing}
      onBack={onBack}
      onAction={onAction}
      message={message}
      busy={busy}
      regenerating={regenerating}
    />
  );
}

function EmptyEditor({ message }: { message: string | null }) {
  return (
    <section className="editor" id="editor" aria-labelledby="event-title">
      <div className="editor-head">
        <div>
          <p className="kicker">02 / MATERIAŁ</p>
          <h2 id="event-title">Brak materiałów</h2>
        </div>
        <span className="status">—</span>
      </div>
      <div className="decision-note" role="status" aria-live="polite">
        {message ?? "Kolejka jest pusta. Uruchom POBIERZ NOWE, aby zebrać materiały."}
      </div>
    </section>
  );
}

type EditorFormProps = EditorPanelProps & { event: EditorialEvent };

function EditorForm({
  event,
  reactions,
  editing,
  onToggleEditing,
  onBack,
  onAction,
  message,
  busy,
  regenerating,
}: EditorFormProps) {
  // Tresc pol jest wiazana z materialem, z ktorego pochodzi. Gdy z serwera
  // przyjdzie nowy obiekt (po zapisie, decyzji albo regeneracji), wersja
  // robocza przestaje pasowac i pola pokazuja dane z serwera - tak samo jak
  // przed migracja, ale bez efektu nadpisujacego stan.
  const [edited, setEdited] = useState<{ source: EditorialEvent; draft: Draft } | null>(null);
  const draft = edited?.source === event ? edited.draft : draftFrom(event);

  const updateDraft = (change: Partial<Draft>) => {
    setEdited({ source: event, draft: { ...draft, ...change } });
  };

  const { checks, markChanged, isValidFor } = useOriginalityChecks(event);

  const shortWords = countWords(draft.level1);
  const longWords = countWords(draft.level2);
  const titleWords = countWords(draft.title);
  const tagCount = parseTags(draft.tags).length;

  const shortValid =
    shortWords >= LIMITS.shortWords.min &&
    shortWords <= LIMITS.shortWords.max &&
    isValidFor("level1", draft.level1.trim());
  const longValid =
    longWords >= LIMITS.longWords.min &&
    longWords <= LIMITS.longWords.max &&
    isValidFor("level2", draft.level2.trim());

  const locked = event.status !== "review";
  const readOnlyMeta = locked || !editing;
  const canApprove =
    !locked &&
    shortValid &&
    longValid &&
    titleWords >= LIMITS.titleWords.min &&
    titleWords <= LIMITS.titleWords.max &&
    tagCount >= LIMITS.minTags;

  const patch = (): EditorialPatch => ({
    title: draft.title.trim(),
    level1: draft.level1.trim(),
    level2: draft.level2.trim(),
    category: draft.category,
    tags: parseTags(draft.tags),
  });

  const updateText = (field: "level1" | "level2", value: string) => {
    updateDraft({ [field]: value });
    markChanged(field, value.trim());
  };

  const title = headlineOf(event) || "Materiał bez treści";

  return (
    <section className="editor" id="editor" aria-label={title}>
      <button className="button button-ghost back-to-queue" type="button" onClick={onBack}>
        ← Cofnij
      </button>

      {/* Naglowek/kicker/status sa widoczne dopiero po wejsciu w EDYTUJ - to
          metadane redakcyjne, nie tresc do oceny. Domyslny (prosty) widok,
          uzywany glownie na telefonie, zaczyna sie prosto od SKROTU. */}
      <div className="editor-head edit-only">
        <div>
          <p className="kicker">02 / MATERIAŁ / {event.id.toUpperCase()}</p>
          <h2>{title}</h2>
        </div>
        <span className="status" data-status={event.status}>
          {STATUS_LABELS[event.status]}
        </span>
      </div>

      {/* Redaktor odpalajac panel na telefonie widzi najpierw wygenerowany
          tekst do oceny (skrot, kontekst), a decyzja jest zaraz pod nim -
          metadane materialu (zrodla, data, zgodnosc) ida na dol, bo sluza
          tylko do sprawdzenia w razie wątpliwości, nie do pierwszej oceny. */}
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          onAction("save", patch());
        }}
      >
        <div className="editorial-grid edit-only">
          <label className="editorial-field" htmlFor="editorial-category">
            <span>Kategoria</span>
            <select
              id="editorial-category"
              value={draft.category}
              disabled={readOnlyMeta}
              onChange={(changeEvent) =>
                updateDraft({ category: changeEvent.target.value as Category })
              }
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="editorial-field" htmlFor="editorial-tags">
            <span>Tagi — rozdziel przecinkami</span>
            <input
              id="editorial-tags"
              maxLength={180}
              placeholder="nbp, stopy procentowe"
              value={draft.tags}
              disabled={readOnlyMeta}
              onChange={(changeEvent) => updateDraft({ tags: changeEvent.target.value })}
            />
          </label>
        </div>

        <div className="field-head">
          <label htmlFor="telegram-text">SKRÓT</label>
          <span className={`word-count ${shortValid ? "is-valid" : "is-invalid"}`}>
            {shortWords} / {LIMITS.shortWords.min}–{LIMITS.shortWords.max} słów
          </span>
        </div>
        <textarea
          id="telegram-text"
          rows={5}
          maxLength={500}
          placeholder="Najważniejsza informacja do przeczytania w 10–20 sekund."
          value={draft.level1}
          disabled={locked}
          readOnly={!editing}
          onChange={(changeEvent) => updateText("level1", changeEvent.target.value)}
        />
        <p className="field-help">
          {shortValid
            ? "Skrót jest gotowy do akceptacji."
            : "Skrót musi mieć 20–30 słów i przejść kontrolę źródłową."}
        </p>

        <div className="field-head level-two-head">
          <label htmlFor="context-text">CZYTAJ WIĘCEJ</label>
          <span className={`word-count ${longValid ? "is-valid" : "is-invalid"}`}>
            {longWords} / {LIMITS.longWords.min}–{LIMITS.longWords.max} słów
          </span>
          <button
            className="button button-ghost edit-toggle"
            type="button"
            aria-pressed={editing}
            disabled={locked}
            onClick={onToggleEditing}
          >
            {editing ? "ZAKOŃCZ EDYCJĘ" : "EDYTUJ"}
          </button>
        </div>
        <textarea
          id="context-text"
          rows={8}
          maxLength={2500}
          placeholder="Szerszy kontekst, liczby i znaczenie wydarzenia do przeczytania w 30–60 sekund."
          value={draft.level2}
          disabled={locked}
          readOnly={!editing}
          onChange={(changeEvent) => updateText("level2", changeEvent.target.value)}
        />
        <p className="field-help">
          {longValid
            ? "Kontekst jest gotowy do akceptacji."
            : "Kontekst musi mieć 60–140 słów i przejść kontrolę źródłową."}
        </p>

        <div className="edit-only">
          <OriginalityTrace event={event} shortCheck={checks.level1} />
        </div>

        {/* Decyzja glowna. ODRZUC/ZATWIERDZ oceniaja material do decyzji;
            PUBLIKUJ i COFNIJ DECYZJE dzialaja na materiale juz oswiazonym
            (zatwierdzonym/odrzuconym/opublikowanym) i musza byc widoczne
            zawsze - to sa dalsze kroki tej samej decyzji, nie edycja tekstu,
            wiec nie moga chowac sie za EDYTUJ (byl to blad: po ZATWIERDZ
            redaktor nie mial czym kliknac PUBLIKUJ). */}
        <div className="decision-bar">
          <button
            className="button button-danger"
            type="button"
            disabled={locked || busy}
            onClick={() => onAction("reject")}
          >
            ODRZUĆ
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!canApprove || busy}
            onClick={() => onAction("approve", patch())}
          >
            ZATWIERDŹ
          </button>
        </div>

        <div className="decision-bar-secondary">
          {event.status !== "review" && (
            <button
              className="button button-ghost"
              type="button"
              disabled={busy}
              onClick={() => onAction("reopen")}
            >
              COFNIJ DECYZJĘ
            </button>
          )}
          <button
            className="button button-publish"
            type="button"
            disabled={event.status !== "approved" || busy}
            onClick={() => onAction("publish")}
          >
            PUBLIKUJ
          </button>
        </div>

        {/* Operacje redakcyjne (zapis wersji roboczej, ponowne wygenerowanie
            tekstu) - widoczne dopiero po EDYTUJ, bo dotycza redagowania, nie
            samej decyzji. */}
        <div className="decision-bar-secondary edit-only">
          <button className="button button-ghost" type="submit" disabled={locked || busy}>
            ZAPISZ WERSJĘ
          </button>
          <button
            className="button button-ghost"
            type="button"
            disabled={locked || regenerating}
            onClick={() => onAction("regenerate")}
          >
            {regenerating ? "GENERUJĘ..." : "WYGENERUJ PONOWNIE"}
          </button>
        </div>
      </form>

      <DecisionNote status={event.status} message={message} />

      {/* Zrodla, wykrycie, zgodnosc i oceny czytelnikow - widoczne dopiero
          po EDYTUJ, bo sluza do sprawdzenia w razie wątpliwości, nie do
          pierwszej, szybkiej oceny materialu. */}
      <dl className="event-meta edit-only">
        <div>
          <dt>ŹRÓDŁA</dt>
          <dd>{event.sources.length}</dd>
        </div>
        <div>
          <dt>WYKRYTO</dt>
          <dd>{event.detectedAt || "—"}</dd>
        </div>
        <div>
          <dt>ZGODNOŚĆ</dt>
          <dd>{event.confidence}%</dd>
        </div>
        <div>
          <dt>OCENY CZYTELNIKÓW</dt>
          <dd>{reactions ? `▲ ${reactions.likes} / ▼ ${reactions.dislikes}` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

const STATUS_NOTES: Record<EditorialEvent["status"], { text: string; className: string }> = {
  review: {
    text: "Materiał wymaga decyzji redaktora. Publikacja jest osobnym krokiem po zatwierdzeniu.",
    className: "decision-note",
  },
  approved: {
    text: "Materiał zatwierdzony. Kliknij PUBLIKUJ, aby trafił do publicznego feedu.",
    className: "decision-note is-approved",
  },
  published: {
    text: "Materiał jest opublikowany w publicznym feedzie.",
    className: "decision-note is-approved",
  },
  rejected: {
    text: "Materiał odrzucony i niewidoczny publicznie.",
    className: "decision-note is-rejected",
  },
};

function DecisionNote({
  status,
  message,
}: {
  status: EditorialEvent["status"];
  message: string | null;
}) {
  // Komunikat operacji zawsze wygrywa nad opisem statusu i nie jest kolorowany,
  // bo moze dotyczyc bledu, ktory nie zmienil stanu materialu.
  if (message) {
    return (
      <div className="decision-note" role="status" aria-live="polite">
        {message}
      </div>
    );
  }
  const note = STATUS_NOTES[status];
  return (
    <div className={note.className} role="status" aria-live="polite">
      {note.text}
    </div>
  );
}

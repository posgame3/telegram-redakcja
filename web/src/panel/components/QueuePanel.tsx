import type { EditorialEvent } from "../../shared/types";
import { headlineOf, QUEUE_FILTERS, STATUS_LABELS, type QueueFilter } from "../labels";

interface QueuePanelProps {
  events: EditorialEvent[];
  selectedId: string | null;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  onSelect: (id: string) => void;
}

export function QueuePanel({
  events,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
}: QueuePanelProps) {
  const visible = filter === "all" ? events : events.filter((event) => event.status === filter);

  return (
    <aside className="queue" aria-labelledby="queue-title">
      <div className="section-heading">
        <div>
          <p className="kicker">01 / KOLEJKA</p>
          <h1 id="queue-title">Wydarzenia</h1>
        </div>
        <span className="count-badge">{String(visible.length).padStart(2, "0")}</span>
      </div>

      <nav className="filters" aria-label="Filtry kolejki">
        {QUEUE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            className={value === filter ? "filter is-active" : "filter"}
            type="button"
            aria-pressed={value === filter}
            onClick={() => onFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="event-list" aria-live="polite">
        {visible.length === 0 ? (
          <p className="empty-state">Brak materiałów w tym widoku.</p>
        ) : (
          visible.map((event) => (
            <QueueRow
              key={event.id}
              event={event}
              selected={event.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  );
}

interface QueueRowProps {
  event: EditorialEvent;
  selected: boolean;
  onSelect: (id: string) => void;
}

function QueueRow({ event, selected, onSelect }: QueueRowProps) {
  // Materialy bez wygenerowanej tresci (generator zadzialal fail-closed) sa
  // odfiltrowane wczesniej, w App.tsx - tutaj headline jest juz zawsze
  // niepustym tekstem.
  const headline = headlineOf(event);

  return (
    <button
      type="button"
      className={selected ? "event-row is-selected" : "event-row"}
      aria-pressed={selected}
      data-status={event.status}
      onClick={() => onSelect(event.id)}
    >
      <span className="event-row-top">
        <span className="event-row-time">{event.detectedAt || "—"}</span>
        <span className="event-row-status">{STATUS_LABELS[event.status]}</span>
      </span>
      <strong className="event-row-title">{headline}</strong>
      <span className="event-row-meta">
        {event.category.toUpperCase()} / {event.sources.length} ŹRÓDŁA / ZGODNOŚĆ {event.confidence}
        %
      </span>
    </button>
  );
}

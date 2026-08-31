import { formatDate } from "../../shared/format";
import type { Publication } from "../../shared/types";
import { headlineOf } from "../publication";
import { MediaFigure } from "./MediaFigure";

interface FeedListProps {
  items: readonly Publication[];
  seen: ReadonlySet<string>;
  freshIds: ReadonlySet<string>;
  ratingFor: (id: string) => string;
  onOpen: (item: Publication, trigger: HTMLElement) => void;
  busy: boolean;
}

/** Lista klasyczna wydania. Przeczytane sa wygaszone, ale nadal dostepne. */
export function FeedList({ items, seen, freshIds, ratingFor, onOpen, busy }: FeedListProps) {
  return (
    <main id="feed" className="feed-list" aria-busy={busy} aria-label="Wiadomości">
      {items.length === 0 ? (
        <div className="empty-feed">
          <strong>Brak wiadomości w tym dziale</strong>
          <span>Redakcja przygotowuje materiały. Wydanie odświeża się automatycznie.</span>
        </div>
      ) : (
        items.map((item, position) => (
          <FeedItem
            key={item.id}
            item={item}
            position={position}
            lead={position === 0}
            seen={seen.has(item.id)}
            fresh={freshIds.has(item.id)}
            rating={ratingFor(item.id)}
            onOpen={onOpen}
          />
        ))
      )}
    </main>
  );
}

interface FeedItemProps {
  item: Publication;
  /** Numer porzadkowy w wydaniu (od 0). Wyswietlany w marginesie jako nosnik stanu. */
  position: number;
  lead: boolean;
  seen: boolean;
  fresh: boolean;
  rating: string;
  onOpen: (item: Publication, trigger: HTMLElement) => void;
}

function FeedItem({ item, position, lead, seen, fresh, rating, onOpen }: FeedItemProps) {
  const headline = headlineOf(item);
  const ratedValue = rating ? (rating.startsWith("▲") ? "like" : "dislike") : undefined;

  return (
    <article
      className={lead ? "feed-item is-lead" : "feed-item"}
      data-rated={ratedValue}
      data-fresh={fresh ? "true" : undefined}
      data-seen={seen ? "true" : undefined}
    >
      {/* Margines nalezy do stanu i oceny, nigdy do tresci: numer, nowosc
          i wlasny glos sa tu widoczne bez wchodzenia w material. Element jest
          dekoracyjny - przycisk ponizej ma juz pelny opis dla czytnikow ekranu. */}
      <span className="feed-item-index" aria-hidden="true">
        {String(position + 1).padStart(2, "0")}
        {ratedValue === "like" && <span className="feed-item-index-rating">▲</span>}
        {ratedValue === "dislike" && <span className="feed-item-index-rating">▼</span>}
      </span>
      <button
        type="button"
        className="feed-item-button"
        aria-label={`Otwórz wiadomość: ${headline}`}
        onClick={(event) => onOpen(item, event.currentTarget)}
      >
        <div className="feed-item-body">
          <div className="feed-item-meta">
            <span className="feed-item-category">{item.category}</span>
            <time>{formatDate(item.updatedAt ?? item.publishedAt)}</time>
            {/* Oznaczenie slowem, a nie tylko kolorem. */}
            {fresh && <span className="feed-item-fresh">Nowe</span>}
          </div>
          <h2>{headline}</h2>
          <div className="feed-item-footer">
            <span>{item.sourceCount} źródła</span>
            {seen && <span className="feed-item-read">Przeczytane</span>}
            {rating && <span className="feed-item-rating">{rating}</span>}
          </div>
        </div>
        <MediaFigure
          item={item}
          className={lead ? "feed-item-media is-lead" : "feed-item-media"}
          variant="thumb"
        />
      </button>
    </article>
  );
}

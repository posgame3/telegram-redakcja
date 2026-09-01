import type { Publication } from "../../shared/types";
import { headlineOf } from "../publication";

interface PopularSidebarProps {
  /** Cale wydanie, nie zawezone dzialem - popularnosc liczy sie globalnie. */
  items: readonly Publication[];
  onOpen: (item: Publication, trigger: HTMLElement) => void;
}

/** Ile pozycji pokazujemy w bocznej liscie najbardziej polubionych. */
const POPULAR_LIMIT = 6;

/**
 * Boczna lista najczesciej polubionych materialow. Widoczna tylko na szerokim
 * ekranie (chowana przez CSS w responsive.css) - na telefonie nie ma na nia
 * miejsca bez kosztu dla glownej kolumny czytania.
 *
 * Liczba polubien pochodzi z Publication.reactions.likes, ktore serwer zwraca
 * jako prawdziwa suma glosow wszystkich czytelnikow (nie lokalny stan).
 * Material bez zadnego polubienia nie trafia na liste - inaczej pokazywalaby
 * przypadkowa kolejnosc materialow z zerem glosow, nie realna popularnosc.
 */
export function PopularSidebar({ items, onOpen }: PopularSidebarProps) {
  const popular = [...items]
    .filter((item) => item.reactions.likes > 0)
    .sort((a, b) => b.reactions.likes - a.reactions.likes)
    .slice(0, POPULAR_LIMIT);

  if (popular.length === 0) return null;

  return (
    <aside className="popular-sidebar" aria-label="Najczęściej polubione materiały">
      <p className="popular-sidebar-kicker">Najczęściej polubione</p>
      <ol className="popular-list">
        {popular.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className="popular-item"
              aria-label={`Otwórz wiadomość: ${headlineOf(item)}`}
              onClick={(event) => onOpen(item, event.currentTarget)}
            >
              <span className="popular-item-rank" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="popular-item-body">
                <span className="popular-item-category">{item.category}</span>
                <span className="popular-item-title">{headlineOf(item)}</span>
                <span className="popular-item-likes">▲ {item.reactions.likes}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

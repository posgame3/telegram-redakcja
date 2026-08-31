import { CATEGORY_FILTERS, type CategoryFilter as CategoryFilterValue } from "../labels";

interface CategoryFilterProps {
  active: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
  /** Liczba nieprzeczytanych materialow per dzial (klucz = kategoria, nie "all"). */
  counts: ReadonlyMap<string, number>;
}

/**
 * Pasek dzialow. Nie miesci sie na waskim ekranie, wiec przewija sie w bok;
 * po wyborze doprowadzamy przycisk do widoku, zeby nie zostal za krawedzia.
 * Licznik nieprzeczytanych jest dekoracyjny (aria-hidden) i nie wchodzi do
 * accessible name przycisku - testy i czytniki ekranu nadal widza "Rynki".
 */
export function CategoryFilter({ active, onChange, counts }: CategoryFilterProps) {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);

  return (
    <nav className="category-filter" aria-label="Działy">
      {CATEGORY_FILTERS.map(({ value, label }) => {
        const count = value === "all" ? total : counts.get(value) ?? 0;
        return (
          <button
            key={value}
            type="button"
            className={value === active ? "is-active" : undefined}
            aria-pressed={value === active}
            onClick={(event) => {
              onChange(value);
              event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            {label}
            {count > 0 && <span className="category-filter-count" aria-hidden="true">{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

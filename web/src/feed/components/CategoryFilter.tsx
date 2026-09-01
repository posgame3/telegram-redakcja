import { CATEGORY_FILTERS, type CategoryFilter as CategoryFilterValue } from "../labels";

interface CategoryFilterProps {
  active: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}

/**
 * Pasek dzialow. Nie miesci sie na waskim ekranie, wiec przewija sie w bok;
 * po wyborze doprowadzamy przycisk do widoku, zeby nie zostal za krawedzia.
 */
export function CategoryFilter({ active, onChange }: CategoryFilterProps) {
  return (
    <nav className="category-filter" aria-label="Działy">
      {CATEGORY_FILTERS.map(({ value, label }) => (
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
        </button>
      ))}
    </nav>
  );
}

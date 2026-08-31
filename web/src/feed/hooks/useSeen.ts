import { useCallback, useState } from "react";
import { readJson, STORAGE_KEYS, writeJson } from "../../shared/storage";
import { SEEN_LIMIT } from "../labels";

function load(): Set<string> {
  const stored = readJson<unknown>(STORAGE_KEYS.seen, []);
  if (!Array.isArray(stored)) return new Set();
  const ids = stored.filter((id): id is string => typeof id === "string");
  return new Set(ids.slice(-SEEN_LIMIT));
}

export interface UseSeen {
  /** Zbior przeczytanych materialow. Traktowac jako niezmienny. */
  seen: ReadonlySet<string>;
  markSeen: (id: string) => void;
}

/**
 * Przeczytane materialy. Sluza do dwoch rzeczy: w trybie pelnoekranowym
 * przeczytane nie wracaja do kolejki, a na liscie klasycznej sa wygaszone.
 *
 * Lista jest przycinana do ostatnich SEEN_LIMIT pozycji, zeby zapis nie rosl
 * bez ograniczen przy dlugim korzystaniu z aplikacji.
 */
export function useSeen(): UseSeen {
  const [seen, setSeen] = useState<ReadonlySet<string>>(load);

  const markSeen = useCallback((id: string) => {
    if (!id) return;
    setSeen((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      writeJson(STORAGE_KEYS.seen, [...next].slice(-SEEN_LIMIT));
      return next;
    });
  }, []);

  return { seen, markSeen };
}

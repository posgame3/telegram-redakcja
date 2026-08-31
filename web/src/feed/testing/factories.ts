import { normalizePublication } from "../../shared/normalize";
import type { Publication } from "../../shared/types";

interface PublicationOverrides {
  id: string;
  /** Ile minut temu material zostal opublikowany. */
  minutesAgo?: number;
  category?: string;
  withImage?: boolean;
}

/**
 * Publikacja przechodzaca przez te sama normalizacje co dane z sieci, zeby test
 * operowal na dokladnie takim obiekcie, jaki widzi aplikacja.
 */
export function makePublication({
  id,
  minutesAgo = 5,
  category = "kraj",
  withImage = false,
}: PublicationOverrides): Publication {
  const time = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const item = normalizePublication({
    id,
    title: `Tytuł ${id}`,
    level1: `Skrót materiału ${id} zawiera najważniejsze fakty potwierdzone w dwóch niezależnych publikacjach źródłowych.`,
    level2: `Szerszy kontekst materiału ${id}.`,
    category,
    tags: ["tag"],
    confidence: 80,
    sourceCount: 2,
    publishedAt: time,
    updatedAt: time,
    image: withImage ? { url: "/img?u=x&v=full", alt: "Opis zdjęcia", credit: "RMF24" } : null,
    sources: [
      { domain: "RMF24", time: "10:00", title: "Źródło pierwsze", url: "https://www.rmf24.pl/a" },
      {
        domain: "ONET",
        time: "10:20",
        title: "Źródło drugie",
        url: "https://wiadomosci.onet.pl/b",
      },
    ],
    reactions: { likes: 0, dislikes: 0 },
  });

  if (!item) throw new Error("Nie udało się zbudować publikacji testowej.");
  return item;
}

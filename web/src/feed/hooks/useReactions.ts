import { useCallback, useState } from "react";
import { reportReaction } from "../../shared/api";
import { readJson, STORAGE_KEYS, writeJson } from "../../shared/storage";
import type { ReactionCounts, ReactionVote } from "../../shared/types";

/** Wlasne glosy czytelnika, kluczowane identyfikatorem publikacji. */
type Votes = Record<string, ReactionVote>;

function load(): Votes {
  const stored = readJson<unknown>(STORAGE_KEYS.reactions, {});
  if (stored === null || typeof stored !== "object") return {};
  const entries = Object.entries(stored as Record<string, unknown>).filter(
    (entry): entry is [string, ReactionVote] => entry[1] === "like" || entry[1] === "dislike",
  );
  return Object.fromEntries(entries);
}

export interface UseReactions {
  votes: Readonly<Votes>;
  /**
   * Zmienia glos i zwraca nowe liczniki z serwera albo null, gdy zapis
   * sie nie udal. Powtorne uzycie tej samej oceny wycofuje glos.
   */
  vote: (id: string, value: ReactionVote) => Promise<ReactionCounts | null>;
  labelFor: (id: string) => string;
}

/**
 * Oceny czytelnika. Wlasny glos jest trzymany lokalnie, a serwer prowadzi
 * wylacznie liczniki - dlatego wysylamy zmiane (poprzedni glos i nowy),
 * a nie zadnego identyfikatora osoby.
 */
export function useReactions(): UseReactions {
  const [votes, setVotes] = useState<Votes>(load);

  const vote = useCallback(
    async (id: string, value: ReactionVote): Promise<ReactionCounts | null> => {
      const previous = votes[id] ?? "";
      const next: Votes = { ...votes };
      if (previous === value) delete next[id];
      else next[id] = value;

      setVotes(next);
      writeJson(STORAGE_KEYS.reactions, next);
      return reportReaction(id, previous, next[id] ?? "");
    },
    [votes],
  );

  // Ocena nigdy nie jest przekazywana samym kolorem: zawsze ma znak i opis.
  const labelFor = useCallback(
    (id: string) => {
      if (votes[id] === "like") return "▲ Podoba się";
      if (votes[id] === "dislike") return "▼ Nie podoba się";
      return "";
    },
    [votes],
  );

  return { votes, vote, labelFor };
}

import { useCallback, useEffect, useState } from "react";
import { fetchEditorialQueue, runSynchronization } from "../../shared/api";
import type { EditorialEvent, LastSync, ReactionCountsById } from "../../shared/types";

interface QueueData {
  events: EditorialEvent[];
  reactions: ReactionCountsById;
  lastSync: LastSync | null;
}

const EMPTY: QueueData = { events: [], reactions: {}, lastSync: null };

export interface UseEditorialQueue extends QueueData {
  loading: boolean;
  syncing: boolean;
  /** Ostatni blad odczytu albo synchronizacji, do pokazania w notce decyzji. */
  error: string | null;
  reload: () => Promise<void>;
  /** Uruchamia agregacje zrodel. Zwraca podsumowanie do pokazania redaktorowi. */
  synchronize: () => Promise<string>;
  /** Podmienia jeden material po operacji redakcyjnej, bez ponownego odczytu calej kolejki. */
  replaceEvent: (event: EditorialEvent) => void;
}

/** Dane kolejki redakcyjnej: odczyt, synchronizacja i punktowe podmiany materialow. */
export function useEditorialQueue(): UseEditorialQueue {
  const [data, setData] = useState<QueueData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Odczyt kolejki. Flaga przerwania chroni przed zapisem stanu po odmontowaniu,
   * gdy odpowiedz wroci juz po zamknieciu panelu.
   */
  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const queue = await fetchEditorialQueue();
      if (isCancelled()) return;
      setData(queue);
      setError(null);
    } catch (cause) {
      if (isCancelled()) return;
      setError(cause instanceof Error ? cause.message : "Nie udało się wczytać kolejki");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // set-state-in-effect ostrzega przed kaskadami synchronicznych renderowan.
    // Tutaj stan jest ustawiany dopiero po zakonczeniu zadania sieciowego,
    // a odpowiedz po odmontowaniu jest odrzucana przez flage ponizej.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const reload = useCallback(() => load(() => false), [load]);

  const synchronize = useCallback(async (): Promise<string> => {
    setSyncing(true);
    try {
      const result = await runSynchronization();
      setData((current) => ({
        ...current,
        events: result.events,
        lastSync: { syncedAt: result.syncedAt, stats: result.stats, errors: result.errors },
      }));
      setError(null);
      const { feedsOk, feedsChecked, eventsCreated } = result.stats;
      return `Synchronizacja zakończona: ${feedsOk ?? 0}/${feedsChecked ?? 0} RSS, ${eventsCreated ?? 0} nowych zdarzeń.`;
    } finally {
      setSyncing(false);
    }
  }, []);

  const replaceEvent = useCallback((event: EditorialEvent) => {
    setData((current) => {
      const index = current.events.findIndex((entry) => entry.id === event.id);
      if (index < 0) return { ...current, events: [event, ...current.events] };
      const events = [...current.events];
      events[index] = event;
      return { ...current, events };
    });
  }, []);

  return { ...data, loading, syncing, error, reload, synchronize, replaceEvent };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPublicFeed } from "../../shared/api";
import { formatTime, timestampOf } from "../../shared/format";
import { readString, STORAGE_KEYS, writeString } from "../../shared/storage";
import type { Publication, ReactionCounts } from "../../shared/types";
import { REFRESH_INTERVAL_MS } from "../labels";

/** Do tej wysokosci przewiniecia uznajemy, ze czytelnik jest na poczatku wydania. */
const TOP_SCROLL_THRESHOLD = 80;

function loadLastSeenAt(): number {
  const stored = Number(readString(STORAGE_KEYS.feedLastSeen));
  return Number.isFinite(stored) ? stored : 0;
}

function newestTime(items: readonly Publication[]): number {
  return items.reduce((max, item) => Math.max(max, timestampOf(item)), 0);
}

/** Stan czytnika w chwili odswiezenia. Decyduje, czy wolno podmienic liste. */
export interface ReaderSnapshot {
  open: boolean;
  currentId: string | null;
}

interface FeedState {
  /** Materialy pokazane na ekranie. */
  items: Publication[];
  /** Ostatnia odpowiedz serwera; moze wyprzedzac to, co widzi czytelnik. */
  fetched: Publication[];
  /** Znacznik najnowszego materialu, ktory czytelnik juz widzial. */
  lastSeenAt: number;
  /** Materialy nowe w tej sesji - dostaja etykiete "Nowe". */
  freshIds: ReadonlySet<string>;
}

export interface UsePublicFeed extends FeedState {
  updatedLabel: string;
  /** Ostatnie odswiezenie nie powiodlo sie - czytelnik czyta stara wersje wydania. */
  offline: boolean;
  loaded: boolean;
  /** Przenosi pobrane materialy na ekran i zapamietuje, co zostalo pokazane. */
  adopt: () => void;
  refresh: (reader: ReaderSnapshot) => Promise<void>;
  /** Wpisuje liczniki zwrocone przez serwer po oddaniu glosu. */
  applyReactionCounts: (id: string, counts: ReactionCounts) => void;
}

/**
 * Dane publicznego wydania.
 *
 * Kluczowa zasada: nowe materialy nie podmieniaja tresci pod palcem czytajacego.
 * Podmiana nastepuje tylko wtedy, gdy nie przerwie lektury - przy pierwszym
 * wczytaniu, przy wejsciu z linku albo gdy czytnik jest zamkniety i czytelnik
 * jest na gorze wydania. W pozostalych przypadkach pojawia sie pasek z licznikiem.
 */
export function usePublicFeed(getReaderSnapshot: () => ReaderSnapshot): UsePublicFeed {
  const [state, setState] = useState<FeedState>({
    items: [],
    fetched: [],
    lastSeenAt: loadLastSeenAt(),
    freshIds: new Set<string>(),
  });
  const [updatedLabel, setUpdatedLabel] = useState("Aktualizuję…");
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /** Promuje pobrane materialy na ekran, wyliczajac, ktore sa nowe dla czytelnika. */
  const promote = useCallback((current: FeedState): FeedState => {
    const freshIds =
      current.lastSeenAt > 0
        ? new Set(
            current.fetched
              .filter((item) => timestampOf(item) > current.lastSeenAt)
              .map((item) => item.id),
          )
        : new Set<string>();

    const lastSeenAt = Math.max(current.lastSeenAt, newestTime(current.fetched));
    writeString(STORAGE_KEYS.feedLastSeen, String(lastSeenAt));
    return { ...current, items: current.fetched, lastSeenAt, freshIds };
  }, []);

  const adopt = useCallback(() => setState(promote), [promote]);

  const applyReactionCounts = useCallback((id: string, counts: ReactionCounts) => {
    const update = (list: Publication[]) =>
      list.map((item) => (item.id === id ? { ...item, reactions: counts } : item));
    setState((current) => ({
      ...current,
      items: update(current.items),
      fetched: update(current.fetched),
    }));
  }, []);

  const refresh = useCallback(
    async (reader: ReaderSnapshot) => {
      try {
        const feed = await fetchPublicFeed();
        setUpdatedLabel(`Aktualizacja ${formatTime(new Date().toISOString())}`);
        setOffline(false);
        setState((current) => {
          const next = { ...current, fetched: feed.items };
          const atTop = window.scrollY < TOP_SCROLL_THRESHOLD;
          const canReplace =
            current.items.length === 0 || reader.currentId !== null || (!reader.open && atTop);
          return canReplace ? promote(next) : next;
        });
      } catch {
        setUpdatedLabel("Tryb offline");
        setOffline(true);
      } finally {
        setLoaded(true);
      }
    },
    [promote],
  );

  // Odswiezanie w tle. Referencje trzymaja najswiezsze funkcje, zeby odliczanie
  // nie startowalo od nowa przy kazdym renderowaniu.
  const refreshRef = useRef(refresh);
  const snapshotRef = useRef(getReaderSnapshot);
  useEffect(() => {
    refreshRef.current = refresh;
    snapshotRef.current = getReaderSnapshot;
  }, [getReaderSnapshot, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshRef.current(snapshotRef.current());
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return { ...state, updatedLabel, offline, loaded, adopt, refresh, applyReactionCounts };
}

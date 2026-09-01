import { useCallback, useEffect, useRef, useState } from "react";
import type { Publication, ReactionVote } from "../../shared/types";
import { useCardAnimation } from "./useCardAnimation";

/** Przesuniecie w poziomie, od ktorego zmieniamy material. */
const SWIPE_X = 90;
/** Przesuniecie w pionie, od ktorego material zostaje oceniony. */
const SWIPE_Y = 110;
/** Dystans, po ktorym gest zostaje przypisany do jednej osi. */
const AXIS_LOCK = 12;
/** Jak dlugo pokazujemy komunikat zamiast pozycji w kolejce. */
const FLASH_MS = 1_200;

function readerIdFromHistory(): string | null {
  const state: unknown = window.history.state;
  if (state === null || typeof state !== "object") return null;
  const id = (state as { reader?: unknown }).reader;
  return typeof id === "string" ? id : null;
}

interface UseReaderQueueOptions {
  /** Materialy widoczne w biezacym dziale. */
  visible: readonly Publication[];
  seen: ReadonlySet<string>;
  markSeen: (id: string) => void;
  vote: (id: string, value: ReactionVote) => void;
}

/**
 * Kolejka trzyma identyfikatory, nie kopie materialow. Dzieki temu karta
 * pokazuje zawsze najswiezsze dane - w szczegolnosci liczniki ocen, ktore
 * serwer zwraca po oddaniu glosu.
 */

export interface UseReaderQueue {
  current: Publication | null;
  isOpen: boolean;
  /** Tekst na pasku: pozycja w kolejce albo komunikat o koncu listy. */
  positionLabel: string;
  hasPrevious: boolean;
  hasNext: boolean;
  animation: ReturnType<typeof useCardAnimation>;
  openReader: (item: Publication, trigger?: HTMLElement | null) => void;
  close: () => void;
  move: (step: 1 | -1, animate?: boolean) => void;
  rate: (value: ReactionVote, animate?: boolean) => void;
  /** Uchwyty gestow dla karty czytnika. */
  gestureHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  /** Czy ostatni gest byl przesunieciem - dotkniecie zdjecia nie moze wtedy otwierac podgladu. */
  lastGestureMoved: () => boolean;
}

/**
 * Tryb pelnoekranowy: kolejka materialow, gesty i oceny.
 *
 * Kolejka pomija przeczytane, zeby te same materialy nie wracaly przy kazdym
 * przegladaniu. Material otwarty swiadomie z listy trafia do kolejki nawet
 * wtedy, gdy byl juz czytany.
 */
export function useReaderQueue({
  visible,
  seen,
  markSeen,
  vote,
}: UseReaderQueueOptions): UseReaderQueue {
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [flash, setFlash] = useState<string | null>(null);
  const animation = useCardAnimation(SWIPE_Y);

  const triggerRef = useRef<HTMLElement | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const drag = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, dx: 0, dy: 0 });
  const movedRef = useRef(false);
  /**
   * Tresc materialow zapamietana przy otwarciu kolejki. Sluzy jako zapas, gdy
   * material wypadnie z biezacego dzialu w trakcie czytania. Jest stanem,
   * a nie referencja, bo bierze udzial w renderowaniu.
   */
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Publication>>(new Map());

  const isOpen = index >= 0;
  const currentId = queue[index] ?? null;
  const current =
    currentId === null
      ? null
      : (visible.find((item) => item.id === currentId) ?? snapshots.get(currentId) ?? null);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const openReader = useCallback(
    (item: Publication, trigger?: HTMLElement | null) => {
      triggerRef.current = trigger ?? null;
      // Kolejka pomija przeczytane, ale material otwarty swiadomie zostaje w niej
      // nawet wtedy, gdy byl juz czytany.
      const nextQueue = visible.filter((entry) => !seen.has(entry.id) || entry.id === item.id);
      const position = nextQueue.findIndex((entry) => entry.id === item.id);
      const chosen = position < 0 ? [item] : nextQueue;

      setSnapshots(new Map(chosen.map((entry) => [entry.id, entry])));
      setQueue(chosen.map((entry) => entry.id));
      setIndex(position < 0 ? 0 : position);

      // Wpis w historii sprawia, ze systemowe cofniecie zamyka material,
      // a nie wychodzi z aplikacji.
      if (readerIdFromHistory() === null) {
        window.history.pushState({ reader: item.id }, "", `#${encodeURIComponent(item.id)}`);
      } else {
        window.history.replaceState({ reader: item.id }, "", `#${encodeURIComponent(item.id)}`);
      }
      animation.reset();
    },
    [animation, seen, visible],
  );

  /** Zamyka czytnik. Zamkniecie znaczy tez, ze material zostal przeczytany. */
  const dismiss = useCallback(() => {
    if (current) markSeen(current.id);
    setIndex(-1);
    setQueue([]);
    animation.reset();
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [animation, current, markSeen]);

  const close = useCallback(() => {
    if (readerIdFromHistory() !== null) {
      // Cofniecie wpisu prowadzi do tego samego stanu co przycisk systemowy.
      window.history.back();
      return;
    }
    dismiss();
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [dismiss]);

  const move = useCallback(
    (step: 1 | -1, animate = true) => {
      const next = index + step;
      if (next < 0 || next >= queue.length) {
        animation.snapBack();
        showFlash(step > 0 ? "To wszystkie nowe wiadomości" : "To pierwsza wiadomość");
        return;
      }

      const leavingId = queue[index];
      const go = () => {
        // Przejscie dalej oznacza material jako przeczytany. Powrot w lewo nie,
        // bo czytelnik chce wtedy do niego wrocic.
        if (leavingId && step > 0) markSeen(leavingId);
        setIndex(next);
        const targetId = queue[next];
        if (targetId) {
          // Podmiana wpisu zamiast dopisania: cofniecie zamyka czytnik jednym
          // ruchem, a nie odtwarza kazdego przesuniecia.
          window.history.replaceState({ reader: targetId }, "", `#${encodeURIComponent(targetId)}`);
        }
      };

      if (animate) animation.animateOut(step > 0 ? "right" : "left", go);
      else go();
    },
    [animation, index, markSeen, queue, showFlash],
  );

  const rate = useCallback(
    (value: ReactionVote, animate = true) => {
      const item = current;
      if (!item) return;

      const apply = () => {
        vote(item.id, value);
        // Ocena to tez odczytanie: material nie wroci w trybie pelnoekranowym.
        markSeen(item.id);
        if (index < queue.length - 1) move(1, false);
      };

      if (animate) animation.animateOut(value === "like" ? "up" : "down", apply);
      else apply();
    },
    [animation, current, index, markSeen, move, queue.length, vote],
  );

  // Systemowe cofniecie i przejscia w historii.
  const stateRef = useRef({ visible, queue, isOpen, openReader, dismiss });
  useEffect(() => {
    stateRef.current = { visible, queue, isOpen, openReader, dismiss };
  }, [dismiss, isOpen, openReader, queue, visible]);

  useEffect(() => {
    const onPopState = () => {
      const wanted = readerIdFromHistory();
      const scope = stateRef.current;

      if (wanted !== null) {
        const inQueue = scope.queue.indexOf(wanted);
        if (scope.isOpen && inQueue >= 0) {
          setIndex(inQueue);
          return;
        }
        const target = scope.visible.find((entry) => entry.id === wanted);
        if (target) {
          scope.openReader(target, null);
          return;
        }
      }
      if (scope.isOpen) scope.dismiss();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // --- Gesty ---

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button")) return;
    // Panel zrodel jest wizualnie nad karta, ale oba sa dzieckiem tego samego
    // kontenera, na ktorym wisi gest - bez tego wylaczenia przeciagniecie po
    // liscie zrodel przelaczaloby material pod spodem.
    if (target.closest(".reader-sheet")) return;

    // Przechwycenie pointera: gest kontynuuje sie na tym elemencie nawet gdy
    // palec zjedzie poza jego granice (np. przy szybkim, dlugim przeciagnieciu
    // blisko krawedzi ekranu) - bez tego move/up czasem nie dochodzily i swipe
    // wygladal jak "nie zlapany".
    event.currentTarget.setPointerCapture?.(event.pointerId);

    drag.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
    };
    movedRef.current = false;
  }, []);

  const axisRef = useRef<"x" | "y" | null>(null);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state.active || event.pointerId !== state.pointerId) return;

      state.dx = event.clientX - state.startX;
      state.dy = event.clientY - state.startY;

      if (axisRef.current === null) {
        const passed = Math.abs(state.dx) > AXIS_LOCK || Math.abs(state.dy) > AXIS_LOCK;
        if (!passed) return;
        axisRef.current = Math.abs(state.dx) > Math.abs(state.dy) ? "x" : "y";
      }
      animation.followDrag(state.dx, state.dy, axisRef.current);
    },
    [animation],
  );

  const endDrag = useCallback(() => {
    const state = drag.current;
    if (!state.active) return;
    state.active = false;

    const { dx, dy } = state;
    const axis = axisRef.current;
    axisRef.current = null;
    movedRef.current = Math.abs(dx) > 8 || Math.abs(dy) > 8;

    if (axis === "x" && Math.abs(dx) >= SWIPE_X) {
      move(dx < 0 ? -1 : 1);
      return;
    }
    if (axis === "y" && dy <= -SWIPE_Y) {
      rate("like");
      return;
    }
    if (axis === "y" && dy >= SWIPE_Y) {
      rate("dislike");
      return;
    }
    animation.snapBack();
  }, [animation, move, rate]);

  const positionLabel = flash ?? `${index + 1} z ${queue.length}`;

  return {
    current,
    isOpen,
    positionLabel,
    hasPrevious: index > 0,
    hasNext: index < queue.length - 1,
    animation,
    openReader,
    close,
    move,
    rate,
    gestureHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    lastGestureMoved: () => movedRef.current,
  };
}

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "../../shared/hooks/usePrefersReducedMotion";

export type ExitDirection = "left" | "right" | "up" | "down";

/** Czas, po ktorym karta jest juz poza ekranem i mozna podmienic tresc. */
const EXIT_MS = 215;

const EXIT_TRANSFORMS: Record<ExitDirection, string> = {
  left: "translateX(-130%) rotate(-14deg)",
  right: "translateX(130%) rotate(14deg)",
  up: "translateY(-125%) rotate(-3deg)",
  down: "translateY(125%) rotate(3deg)",
};

/** Kierunek, z ktorego wjezdza nastepna karta - przeciwny do wyjscia. */
const ENTER_TRANSFORMS: Record<ExitDirection, string> = {
  left: "translateX(52%)",
  right: "translateX(-52%)",
  up: "translateY(28px)",
  down: "translateY(-28px)",
};

const EXIT_TRANSITION = "transform .24s cubic-bezier(.4,0,.7,.2), opacity .24s ease-in";
const ENTER_TRANSITION = "transform .3s cubic-bezier(.22,.61,.36,1), opacity .22s ease-out";
const SNAP_TRANSITION = "transform .32s cubic-bezier(.34,1.4,.64,1)";

interface CardStyle {
  transform?: string;
  opacity?: number;
  transition?: string;
}

export interface UseCardAnimation {
  style: CSSProperties;
  /** Krycie pieczatek oceny, rosnace wraz z przesunieciem w pionie. */
  likeStamp: number;
  skipStamp: number;
  /** Czy trwa animacja wyjscia - blokuje kolejne przejscia. */
  animating: boolean;
  followDrag: (dx: number, dy: number, axis: "x" | "y") => void;
  snapBack: () => void;
  /** Wyprowadza karte z ekranu, wykonuje akcje, potem wprowadza nowa. */
  animateOut: (direction: ExitDirection, after: () => void) => void;
  reset: () => void;
}

/**
 * Ruch karty w czytniku: przesuwanie palcem, powrot na miejsce i przejscia
 * miedzy materialami. Przy wlaczonym ograniczeniu ruchu zmiany sa natychmiastowe.
 */
export function useCardAnimation(swipeThresholdY: number): UseCardAnimation {
  const [style, setStyle] = useState<CardStyle>({});
  const [stamps, setStamps] = useState({ like: 0, skip: 0 });
  const [animating, setAnimating] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const reset = useCallback(() => {
    setStyle({});
    setStamps({ like: 0, skip: 0 });
  }, []);

  const followDrag = useCallback(
    (dx: number, dy: number, axis: "x" | "y") => {
      if (axis === "x") {
        setStyle({
          transition: "none",
          transform: `translateX(${dx}px) rotate(${dx / 30}deg) scale(.99)`,
        });
        setStamps({ like: 0, skip: 0 });
        return;
      }
      setStyle({ transition: "none", transform: `translateY(${dy}px) scale(.99)` });
      setStamps({
        like: Math.min(1, Math.max(0, -dy / swipeThresholdY)),
        skip: Math.min(1, Math.max(0, dy / swipeThresholdY)),
      });
    },
    [swipeThresholdY],
  );

  const snapBack = useCallback(() => {
    setStyle({ transition: reducedMotion ? "none" : SNAP_TRANSITION, transform: "" });
    setStamps({ like: 0, skip: 0 });
  }, [reducedMotion]);

  const animateOut = useCallback(
    (direction: ExitDirection, after: () => void) => {
      if (reducedMotion) {
        after();
        reset();
        return;
      }
      if (animating) return;

      setAnimating(true);
      setStyle({ transition: EXIT_TRANSITION, transform: EXIT_TRANSFORMS[direction], opacity: 0 });

      timers.current.push(
        window.setTimeout(() => {
          after();
          setStamps({ like: 0, skip: 0 });
          // Nowa karta startuje z przeciwnej strony, bez animacji, i dopiero
          // w nastepnej ramce wjezdza na miejsce.
          setStyle({ transition: "none", transform: ENTER_TRANSFORMS[direction], opacity: 0 });
          requestAnimationFrame(() => {
            setStyle({ transition: ENTER_TRANSITION, transform: "", opacity: 1 });
          });
          setAnimating(false);
        }, EXIT_MS),
      );
    },
    [animating, reducedMotion, reset],
  );

  return {
    style,
    likeStamp: stamps.like,
    skipStamp: stamps.skip,
    animating,
    followDrag,
    snapBack,
    animateOut,
    reset,
  };
}

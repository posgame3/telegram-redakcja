import { useCallback, useEffect, useState } from "react";
import { readString, STORAGE_KEYS, writeString } from "../../shared/storage";
import { DEFAULT_FONT_INDEX, FONT_STEPS } from "../labels";

const BASE_SIZE = 16;

function loadIndex(): number {
  const stored = readString(STORAGE_KEYS.feedFontStep);
  // Number(null) daje 0, wiec brak zapisu trzeba sprawdzic osobno.
  if (stored === null) return DEFAULT_FONT_INDEX;
  const index = Number(stored);
  const valid = Number.isInteger(index) && index >= 0 && index < FONT_STEPS.length;
  return valid ? index : DEFAULT_FONT_INDEX;
}

export interface UseFontScale {
  /** Skala wzgledem 16 px, np. "125%". */
  label: string;
  canDecrease: boolean;
  canIncrease: boolean;
  decrease: () => void;
  increase: () => void;
}

/**
 * Skala tekstu calej aplikacji. Ustawiana jako --base-font na <html>, bo
 * rozmiary tresci sa wyrazone w rem i skaluja sie razem z ta wartoscia.
 */
export function useFontScale(): UseFontScale {
  const [index, setIndex] = useState(loadIndex);

  useEffect(() => {
    const size = FONT_STEPS[index] ?? BASE_SIZE;
    document.documentElement.style.setProperty("--base-font", `${size}px`);
    writeString(STORAGE_KEYS.feedFontStep, String(index));
  }, [index]);

  const decrease = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const increase = useCallback(
    () => setIndex((current) => Math.min(FONT_STEPS.length - 1, current + 1)),
    [],
  );

  const size = FONT_STEPS[index] ?? BASE_SIZE;
  return {
    label: `${Math.round((size / BASE_SIZE) * 100)}%`,
    canDecrease: index > 0,
    canIncrease: index < FONT_STEPS.length - 1,
    decrease,
    increase,
  };
}

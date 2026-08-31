import { useCallback, useEffect, useState } from "react";
import { readString, writeString } from "../storage";

export type Theme = "light" | "dark";

/**
 * Tryb kolorystyczny zapisywany lokalnie i wystawiany jako data-theme na <html>,
 * bo caly arkusz stylow opiera warianty kolorow na tym atrybucie.
 *
 * Panel i feed uzywaja osobnych kluczy, zeby ustawienie w jednym nie zmienialo
 * drugiego - to dwie rozne aplikacje dla dwoch roznych odbiorcow.
 */
export function useTheme(storageKey: string): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    readString(storageKey) === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      writeString(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return { theme, toggle };
}

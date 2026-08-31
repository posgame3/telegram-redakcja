import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateText } from "../../shared/api";
import { normalizeOriginality } from "../../shared/normalize";
import type { EditorialEvent, Originality, ValidatedField } from "../../shared/types";

/** Opoznienie miedzy ostatnim znakiem a wyslaniem tekstu do kontroli. */
const DEBOUNCE_MS = 450;

type Checks = Record<ValidatedField, Originality>;

/**
 * Lokalne wyniki kontroli wraz z materialem, ktorego dotycza. Powiazanie ze
 * zrodlem pozwala uniewaznic je bez efektu: gdy z serwera przyjdzie nowy obiekt
 * materialu, nadpisania po prostu przestaja pasowac i nie sa brane pod uwage.
 */
interface Overlay {
  source: EditorialEvent;
  values: Partial<Checks>;
}

const DIRTY = normalizeOriginality({
  status: "dirty",
  reasons: ["Tekst zmieniono i wymaga ponownej kontroli."],
});

export interface UseOriginalityChecks {
  checks: Checks;
  /** Zglasza zmiane tekstu: oznacza pole jako wymagajace kontroli i planuje sprawdzenie. */
  markChanged: (field: ValidatedField, text: string) => void;
  /** Czy wynik kontroli dotyczy dokladnie tego tekstu, ktory jest teraz w polu. */
  isValidFor: (field: ValidatedField, text: string) => boolean;
}

/**
 * Kontrola oryginalnosci obu pol tekstowych wzgledem zapisanego kontekstu zrodel.
 *
 * Wynik z serwera jest wiazany z konkretna trescia (validatedText). Kazda zmiana
 * tekstu uniewaznia wynik, bo inaczej redaktor moglby zatwierdzic material na
 * podstawie kontroli poprzedniej wersji.
 *
 * Licznik sekwencji odrzuca odpowiedzi, ktore wrocily po kolejnej zmianie -
 * bez tego wolniejsza odpowiedz nadpisywalaby nowsza.
 */
export function useOriginalityChecks(event: EditorialEvent): UseOriginalityChecks {
  const [overlay, setOverlay] = useState<Overlay>({ source: event, values: {} });

  const timers = useRef<Partial<Record<ValidatedField, number>>>({});
  const sequences = useRef<Record<ValidatedField, number>>({ level1: 0, level2: 0 });

  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) window.clearTimeout(timer);
    },
    [],
  );

  const values = overlay.source === event ? overlay.values : {};

  const checks = useMemo<Checks>(
    () => ({
      level1: values.level1 ?? event.generation.originality,
      level2: values.level2 ?? event.generation.contextOriginality,
    }),
    [values.level1, values.level2, event.generation],
  );

  /** Zapisuje wynik pola, zawsze wiazac go z materialem widocznym w tej chwili. */
  const putCheck = useCallback(
    (field: ValidatedField, next: (previous: Originality | undefined) => Originality) => {
      setOverlay((current) => {
        const base = current.source === event ? current.values : {};
        return { source: event, values: { ...base, [field]: next(base[field]) } };
      });
    },
    [event],
  );

  const runCheck = useCallback(
    async (field: ValidatedField, text: string, sequence: number) => {
      putCheck(field, (previous) => ({ ...(previous ?? DIRTY), status: "checking" }));
      try {
        const result = await validateText(event.validationId, field, text);
        if (sequence !== sequences.current[field]) return;
        putCheck(field, () => ({ ...result, validatedText: result.valid ? text : "" }));
      } catch (cause) {
        if (sequence !== sequences.current[field]) return;
        const message = cause instanceof Error ? cause.message : "Kontrola nie powiodła się";
        putCheck(field, () => normalizeOriginality({ status: "blocked", reasons: [message] }));
      }
    },
    [event.validationId, putCheck],
  );

  const markChanged = useCallback(
    (field: ValidatedField, text: string) => {
      window.clearTimeout(timers.current[field]);
      sequences.current[field] += 1;
      const sequence = sequences.current[field];

      putCheck(field, () => DIRTY);
      if (!text) return;

      timers.current[field] = window.setTimeout(() => {
        void runCheck(field, text, sequence);
      }, DEBOUNCE_MS);
    },
    [putCheck, runCheck],
  );

  const isValidFor = useCallback(
    (field: ValidatedField, text: string) => {
      const check = checks[field];
      return check.valid && check.validatedText === text;
    },
    [checks],
  );

  return { checks, markChanged, isValidFor };
}

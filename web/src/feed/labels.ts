import { CATEGORIES, type Category } from "../shared/types";

export type CategoryFilter = Category | "all";

/** Zakladki dzialow. "Wszystkie" jest widokiem domyslnym wydania. */
export const CATEGORY_FILTERS: readonly { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  ...CATEGORIES.filter((category) => category !== "inne").map((category) => ({
    value: category,
    label: category.charAt(0).toUpperCase() + category.slice(1),
  })),
];

/** Kroki skali tekstu w pikselach. Indeks 1 (16 px) to wartosc domyslna. */
export const FONT_STEPS = [14, 16, 18, 20, 22] as const;
export const DEFAULT_FONT_INDEX = 1;

/** Ile przeczytanych materialow pamietamy. Starsze wypadaja z listy. */
export const SEEN_LIMIT = 800;

/** Odstep miedzy odswiezeniami wydania. */
export const REFRESH_INTERVAL_MS = 60_000;

/**
 * Instrukcja instalacji zalezy od systemu, bo kazda przegladarka ukrywa
 * te opcje w innym miejscu. Wykrywanie po user agencie jest tu wystarczajace:
 * pomylka daje tylko mniej trafny opis, nie psuje dzialania.
 */
export function installSteps(): readonly { platform: string; steps: readonly string[] }[] {
  const agent = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(agent) || (agent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(agent);

  if (isIos) {
    return [
      {
        platform: "iPhone lub iPad",
        steps: [
          "Otwórz tę stronę w Safari.",
          "Dotknij ikony Udostępnij na dolnym pasku.",
          "Wybierz Dodaj do ekranu początkowego.",
          "Potwierdź przyciskiem Dodaj.",
        ],
      },
    ];
  }

  if (isAndroid) {
    return [
      {
        platform: "Android",
        steps: [
          "Otwórz menu przeglądarki, czyli trzy kropki.",
          "Wybierz Zainstaluj aplikację lub Dodaj do ekranu głównego.",
          "Potwierdź instalację.",
        ],
      },
    ];
  }

  return [
    {
      platform: "Komputer, Chrome lub Edge",
      steps: [
        "Kliknij ikonę instalacji po prawej stronie paska adresu.",
        "Albo otwórz menu przeglądarki i wybierz Zainstaluj.",
        "Aplikacja uruchomi się w osobnym oknie.",
      ],
    },
    {
      platform: "Komputer, Safari",
      steps: ["Otwórz menu Plik.", "Wybierz Dodaj do Docka."],
    },
  ];
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { timestampOf } from "../shared/format";
import { useTheme } from "../shared/hooks/useTheme";
import { STORAGE_KEYS } from "../shared/storage";
import type { Publication, ReactionVote } from "../shared/types";
import { CategoryFilter } from "./components/CategoryFilter";
import { FeedList } from "./components/FeedList";
import { InstallDialog } from "./components/InstallDialog";
import { Masthead } from "./components/Masthead";
import { PendingBar } from "./components/PendingBar";
import { Reader } from "./components/Reader";
import { useFontScale } from "./hooks/useFontScale";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { usePublicFeed, type ReaderSnapshot } from "./hooks/usePublicFeed";
import { useReactions } from "./hooks/useReactions";
import { useReaderQueue } from "./hooks/useReaderQueue";
import { useSeen } from "./hooks/useSeen";
import type { CategoryFilter as CategoryFilterValue } from "./labels";

const BASE_TITLE = "Telegram — Wydanie Codzienne";

function idFromHash(): string | null {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || null;
  } catch {
    return null;
  }
}

export function App() {
  // Referencja nalezy do tego komponentu, a odswiezanie w tle tylko ja czyta -
  // dzieki temu stan czytnika nie wymusza restartu odliczania.
  const readerSnapshot = useRef<ReaderSnapshot>({ open: false, currentId: null });
  const feed = usePublicFeed(useCallback(() => readerSnapshot.current, []));
  const { toggle: toggleTheme } = useTheme(STORAGE_KEYS.feedTheme);
  const font = useFontScale();
  const install = useInstallPrompt();
  const { seen, markSeen } = useSeen();
  const reactions = useReactions();

  const [category, setCategory] = useState<CategoryFilterValue>("all");
  const [installOpen, setInstallOpen] = useState(false);

  const inCategory = useCallback(
    (list: readonly Publication[]) =>
      category === "all" ? list : list.filter((item) => item.category === category),
    [category],
  );

  const visible = inCategory(feed.items);

  // Nowe materialy czekajace na pokazanie: sa w odpowiedzi serwera, sa swiezsze
  // niz to, co czytelnik widzial, i nie ma ich jeszcze na ekranie.
  const pending = inCategory(feed.fetched).filter(
    (item) =>
      timestampOf(item) > feed.lastSeenAt && !feed.items.some((shown) => shown.id === item.id),
  ).length;

  // Licznik nieprzeczytanych na dzial: materialy juz pokazane na ekranie
  // (feed.items), swiezsze niz ostatnio widziane i jeszcze nie przeczytane.
  // Dziala na feed.items, a nie feed.fetched, bo dotyczy tego, co czytelnik
  // realnie widzi na liscie, nie tego, co czeka w pasku "N nowych".
  const freshByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of feed.items) {
      if (!feed.freshIds.has(item.id) || seen.has(item.id)) continue;
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [feed.items, feed.freshIds, seen]);

  const vote = useCallback(
    (id: string, value: ReactionVote) => {
      void reactions.vote(id, value).then((counts) => {
        if (counts) feed.applyReactionCounts(id, counts);
      });
    },
    [feed, reactions],
  );

  const reader = useReaderQueue({ visible, seen, markSeen, vote });

  // Odswiezanie w tle musi znac stan czytnika, zeby nie podmienic tresci
  // w trakcie lektury.
  const readerId = reader.current?.id ?? null;
  useEffect(() => {
    readerSnapshot.current = { open: reader.isOpen, currentId: readerId };
  }, [reader.isOpen, readerId]);

  useEffect(() => {
    document.title = pending > 0 ? `(${pending}) ${BASE_TITLE}` : BASE_TITLE;
  }, [pending]);

  // Pierwsze wczytanie wydania.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void feed.refresh({ open: false, currentId: idFromHash() });
  }, [feed]);

  // Wejscie z linkiem do materialu otwiera go, gdy tylko wydanie sie wczyta.
  const linkOpened = useRef(false);
  useEffect(() => {
    if (linkOpened.current || !feed.loaded) return;
    const wanted = idFromHash();
    if (!wanted) {
      linkOpened.current = true;
      return;
    }
    const target = feed.items.find((item) => item.id === wanted);
    if (!target) return;
    linkOpened.current = true;
    reader.openReader(target, null);
  }, [feed.items, feed.loaded, reader]);

  return (
    <>
      <a className="skip-link" href="#feed">
        Przejdź do wiadomości
      </a>

      <Masthead
        updatedLabel={feed.updatedLabel}
        font={font}
        installAvailable={install.available}
        onOpenInstall={() => setInstallOpen(true)}
        onToggleTheme={toggleTheme}
      />

      <CategoryFilter active={category} onChange={setCategory} counts={freshByCategory} />

      <PendingBar
        count={pending}
        onShow={() => {
          feed.adopt();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <FeedList
        items={visible}
        seen={seen}
        freshIds={feed.freshIds}
        ratingFor={reactions.labelFor}
        onOpen={reader.openReader}
        busy={!feed.loaded}
      />

      <Reader
        reader={reader}
        ratingLabel={reader.current ? reactions.labelFor(reader.current.id) : ""}
        keyboardBlocked={installOpen}
      />

      <InstallDialog
        open={installOpen}
        canPromptDirectly={install.canPromptDirectly}
        onInstall={() => {
          void install.promptInstall();
          setInstallOpen(false);
        }}
        onClose={() => setInstallOpen(false)}
      />

      <footer className="colophon">
        <span>Telegram · synteza wieloźródłowa</span>
        <span>Każdy materiał zatwierdzony przez redaktora</span>
      </footer>
    </>
  );
}

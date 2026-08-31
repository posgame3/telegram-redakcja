import { useEffect, useRef, useState } from "react";
import { formatDate, formatFullDate, formatRelativeAge } from "../../shared/format";
import type { Publication } from "../../shared/types";
import type { UseReaderQueue } from "../hooks/useReaderQueue";
import { headlineOf } from "../publication";
import { MediaFigure } from "./MediaFigure";
import { PhotoDialog } from "./PhotoDialog";
import { ReaderSheet } from "./ReaderSheet";

/** Jak dlugo przycisk udostepniania pokazuje potwierdzenie. */
const SHARE_FEEDBACK_MS = 1_800;

/**
 * Kopiowanie zapasowe dla polaczen bez HTTPS: navigator.share i clipboard
 * wymagaja bezpiecznego kontekstu, execCommand dziala takze bez niego.
 */
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "readonly");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}

/** Ile segmentow pokazujemy naraz w pasku postepu paska statusu. */
const PROGRESS_SEGMENTS = 6;

/**
 * Pasek segmentowy w pasku statusu czytnika: przeczytane materialy pelne,
 * biezacy w akcencie, pozostale wygaszone. Odpowiednik segmentow z makiety
 * "Margines" (widok 1a) - nosnik stanu kolejki, nie tresci materialu.
 */
function ReaderProgress({ position, total }: { position: number; total: number }) {
  if (total <= 0) return null;
  const count = Math.min(PROGRESS_SEGMENTS, total);
  return (
    <div className="reader-progress">
      {Array.from({ length: count }, (_, i) => {
        const state = i + 1 < position ? "done" : i + 1 === position ? "current" : "upcoming";
        return <span key={i} className={`reader-progress-seg is-${state}`} />;
      })}
    </div>
  );
}

interface ReaderProps {
  reader: UseReaderQueue;
  ratingLabel: string;
  /** Czy biezacy material jest nieprzeczytana nowoscia - steruje znacznikiem NOWE. */
  fresh: boolean;
  /** Czy inne okno modalne przejmuje klawiature. */
  keyboardBlocked: boolean;
}

export function Reader({ reader, ratingLabel, fresh, keyboardBlocked }: ReaderProps) {
  const { current, isOpen } = reader;
  const sectionRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Panel zrodel i podglad zdjecia sa wiazane z identyfikatorem materialu.
  // Dzieki temu przejscie dalej albo zamkniecie czytnika zwija je samo,
  // bez efektu czyszczacego stan.
  const [sheetSource, setSheetSource] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState("Udostępnij");

  const sheetOpen = current !== null && sheetSource === current.id;
  const photoItem: Publication | null =
    current !== null && photoSource === current.id ? current : null;

  useEffect(() => {
    document.body.classList.toggle("is-reading", isOpen);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      return;
    }
    // Fokus laduje na realnym przycisku, a nie na karcie: nie rysuje obwodki
    // wokol calej karty, a klawiatura i tak dziala globalnie.
    closeRef.current?.focus({ preventScroll: true });
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      void sectionRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || keyboardBlocked) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (photoItem) {
        if (event.key === "Escape") setPhotoSource(null);
        return;
      }
      if (sheetOpen) {
        if (event.key === "Escape") setSheetSource(null);
        return;
      }
      if (event.key === "Escape") reader.close();
      else if (event.key === "ArrowRight") reader.move(1);
      else if (event.key === "ArrowLeft") reader.move(-1);
      else if (event.key === "ArrowUp") {
        event.preventDefault();
        reader.rate("like");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        reader.rate("dislike");
      } else if (event.key === " " && current) {
        event.preventDefault();
        setSheetSource(current.id);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, isOpen, keyboardBlocked, photoItem, reader, sheetOpen]);

  const share = async () => {
    if (!current) return;
    const link = `${window.location.origin}/a/${encodeURIComponent(current.id)}`;
    const done = (message: string) => {
      setShareLabel(message);
      window.setTimeout(() => setShareLabel("Udostępnij"), SHARE_FEEDBACK_MS);
    };

    try {
      if (navigator.share) {
        await navigator.share({ title: "Telegram", text: headlineOf(current), url: link });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        done("Skopiowano");
        return;
      }
      done(legacyCopy(link) ? "Skopiowano" : link);
    } catch {
      done(legacyCopy(link) ? "Skopiowano" : "Nie udało się");
    }
  };

  const published = current?.publishedAt ?? current?.updatedAt ?? null;

  return (
    <section
      ref={sectionRef}
      className="reader"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-title"
      hidden={!isOpen}
    >
      <div className="reader-bar">
        <button ref={closeRef} type="button" onClick={reader.close}>
          Zamknij
        </button>
        <span aria-live="polite">{reader.positionLabel}</span>
        <button type="button" onClick={() => void share()}>
          {shareLabel}
        </button>
      </div>

      <div className="reader-stage">
        {current && (
          <div className="reader-margin" aria-hidden="true">
            <span className="reader-margin-like">▲ TAK</span>
            <span className="reader-margin-track" />
            <span className="reader-margin-skip">▼ NIE</span>
          </div>
        )}

        {current && (
          <article
            className="reader-card"
            tabIndex={-1}
            style={reader.animation.style}
            {...reader.gestureHandlers}
          >
            <div
              className="reader-stamp reader-stamp-like"
              aria-hidden="true"
              style={{ opacity: reader.animation.likeStamp }}
            >
              ▲ Podoba się
            </div>
            <div
              className="reader-stamp reader-stamp-skip"
              aria-hidden="true"
              style={{ opacity: reader.animation.skipStamp }}
            >
              ▼ Nie podoba się
            </div>

            <div className="reader-status" aria-hidden="true">
              <span className="reader-status-fresh">
                {fresh && <span className="reader-status-dot" />} nieprzeczytane{" "}
                {reader.queuePosition} z {reader.queueTotal}
              </span>
              <ReaderProgress position={reader.queuePosition} total={reader.queueTotal} />
              <span className="reader-status-meta">
                {current.category} · {formatDate(published)}
              </span>
            </div>

            <div className="reader-columns">
              <div className="reader-body">
                <div className="reader-meta">
                  {fresh && <span className="reader-meta-fresh">NOWE</span>}
                  <span className="reader-meta-rule" />
                  <span>{current.sourceCount} źródła</span>
                </div>
                <h1 id="reader-title">{headlineOf(current)}</h1>
                <div className="reader-deck">
                  {current.level2 && <p>{current.level2}</p>}
                </div>
                <div className="reader-sources-row">
                  {current.sources.slice(0, 2).map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                  ))}
                </div>
              </div>

              <div
                className="reader-media-col"
                onClick={(event) => {
                  // Dotkniecie zdjecia otwiera podglad, ale nie wtedy, gdy byl to gest.
                  if ((event.target as HTMLElement).closest("button")) return;
                  if (reader.lastGestureMoved()) return;
                  if (current.image) setPhotoSource(current.id);
                }}
              >
                <MediaFigure item={current} className="reader-media" variant="full" withCredit>
                  {current.image && (
                    <button
                      type="button"
                      className="media-zoom"
                      onClick={() => setPhotoSource(current.id)}
                    >
                      Powiększ
                    </button>
                  )}
                </MediaFigure>
                <p className="reader-hint">
                  <span>↑ TAK · ↓ NIE · → NASTĘPNA</span>
                  <span>SPACJA = ŹRÓDŁA</span>
                </p>
              </div>
            </div>
            {/* Metadane pozostaja w DOM dla czytnikow ekranu i testow, bez
                duplikowania warstwy wizualnej opisanej wyzej paskiem statusu. */}
            <div className="sr-only-meta">
              <time>{formatFullDate(published)}</time>
              <span>{formatRelativeAge(published)}</span>
              <span>{ratingLabel}</span>
            </div>
          </article>
        )}

        {current && (
          <ReaderSheet item={current} open={sheetOpen} onClose={() => setSheetSource(null)} />
        )}
      </div>

      <PhotoDialog item={photoItem} onClose={() => setPhotoSource(null)} />

      {/* Nawigacja i oceny dzialaja juz przez gesty (przesuniecie karty), wiec
          na dole zostaje tylko dostep do zrodel - bez duplikujacych przyciskow,
          ktorych tekst zawijal sie na waskich ekranach. */}
      <button
        className="reader-more"
        type="button"
        disabled={!current}
        onClick={() => current && setSheetSource(current.id)}
      >
        Sprawdź źródła
      </button>
    </section>
  );
}

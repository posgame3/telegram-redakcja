import { useEffect, useRef, useState } from "react";
import { formatFullDate, formatRelativeAge } from "../../shared/format";
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

interface ReaderProps {
  reader: UseReaderQueue;
  ratingLabel: string;
  /** Czy inne okno modalne przejmuje klawiature. */
  keyboardBlocked: boolean;
}

export function Reader({ reader, ratingLabel, keyboardBlocked }: ReaderProps) {
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
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, keyboardBlocked, photoItem, reader, sheetOpen]);

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

  const counts = current?.reactions ?? { likes: 0, dislikes: 0 };
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

            <div
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
            </div>

            <div className="reader-body">
              <div className="reader-meta">
                <span>{current.category}</span>
                <time>{formatFullDate(published)}</time>
                <span className="reader-age">{formatRelativeAge(published)}</span>
                <span className="reader-rating">{ratingLabel}</span>
              </div>
              <h1 id="reader-title">{headlineOf(current)}</h1>
              {current.level2 && <p className="reader-deck">{current.level2}</p>}
              <button
                className="reader-more"
                type="button"
                onClick={() => setSheetSource(current.id)}
              >
                Sprawdź źródła
              </button>
              <p className="reader-hint">
                Przesuń w górę, aby ocenić pozytywnie. W dół, aby ocenić negatywnie. W prawo, aby
                przejść dalej. Dotknij zdjęcia, aby je powiększyć.
              </p>
            </div>
          </article>
        )}

        {current && (
          <ReaderSheet item={current} open={sheetOpen} onClose={() => setSheetSource(null)} />
        )}
      </div>

      <PhotoDialog item={photoItem} onClose={() => setPhotoSource(null)} />

      <div className="reader-actions">
        <button
          type="button"
          aria-label="Poprzednia wiadomość"
          disabled={!reader.hasPrevious}
          onClick={() => reader.move(-1)}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Oceń negatywnie"
          data-active={ratingLabel.startsWith("▼")}
          onClick={() => reader.rate("dislike")}
        >
          {counts.dislikes ? `▼ Nie ${counts.dislikes}` : "▼ Nie"}
        </button>
        <button
          type="button"
          aria-label="Oceń pozytywnie"
          data-active={ratingLabel.startsWith("▲")}
          onClick={() => reader.rate("like")}
        >
          {counts.likes ? `▲ Tak ${counts.likes}` : "▲ Tak"}
        </button>
        <button
          type="button"
          aria-label="Następna wiadomość"
          disabled={!reader.hasNext}
          onClick={() => reader.move(1)}
        >
          →
        </button>
      </div>
    </section>
  );
}

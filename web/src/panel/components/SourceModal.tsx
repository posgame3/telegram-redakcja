import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../shared/hooks/usePrefersReducedMotion";
import type { EventSource } from "../../shared/types";

/** Czas trwania animacji zamykania. Musi odpowiadac przejsciu w arkuszu stylow. */
const CLOSE_ANIMATION_MS = 150;

interface SourceModalProps {
  source: EventSource | null;
  onClose: () => void;
}

/** Podglad artykulu zrodlowego: streszczenie, fragment tekstu i twierdzenia. */
export function SourceModal({ source, onClose }: SourceModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const finishClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    dialogRef.current?.close();
    document.body.classList.remove("has-modal");
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (reducedMotion) {
      finishClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(finishClose, CLOSE_ANIMATION_MS);
  }, [closing, finishClose, reducedMotion]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (source && !dialog.open) {
      dialog.showModal();
      document.body.classList.add("has-modal");
    }
  }, [source]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      document.body.classList.remove("has-modal");
    },
    [],
  );

  return (
    <dialog
      ref={dialogRef}
      className={closing ? "source-modal is-closing" : "source-modal"}
      aria-labelledby="source-modal-title"
      aria-describedby="source-modal-summary"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      {source && (
        <div className="source-modal-panel">
          <header className="source-modal-head">
            <div>
              <p className="kicker">PODGLĄD MATERIAŁU ŹRÓDŁOWEGO</p>
              <p className="source-modal-domain">{source.domain}</p>
            </div>
            <button
              className="button button-ghost source-modal-close"
              type="button"
              onClick={requestClose}
              aria-label="Zamknij podgląd artykułu"
              autoFocus
            >
              ZAMKNIJ ×
            </button>
          </header>

          <div className="source-modal-body">
            <p className="source-modal-meta">
              {[
                source.time,
                source.wordCount ? `${source.wordCount} SŁÓW` : "",
                source.extractionMethod,
              ]
                .filter(Boolean)
                .join(" / ")}
            </p>
            <h2 id="source-modal-title">{source.title}</h2>

            <section className="source-modal-section" aria-labelledby="source-modal-summary-label">
              <h3 id="source-modal-summary-label">STRESZCZENIE ROBOCZE</h3>
              <p id="source-modal-summary">{source.summary || "Brak streszczenia."}</p>
            </section>

            <section className="source-modal-section" aria-labelledby="source-modal-preview-label">
              <h3 id="source-modal-preview-label">PODGLĄD TEKSTU</h3>
              <blockquote>{source.preview || "Brak podglądu."}</blockquote>
            </section>

            {source.keyClaims.length > 0 && (
              <section className="source-modal-section" aria-labelledby="source-modal-claims-label">
                <h3 id="source-modal-claims-label">NAJWAŻNIEJSZE TWIERDZENIA</h3>
                <ul>
                  {source.keyClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </section>
            )}

            <a
              className="button button-primary source-modal-link"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              OTWÓRZ ORYGINALNY ARTYKUŁ ↗
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}

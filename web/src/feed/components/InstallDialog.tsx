import { useEffect, useRef } from "react";
import { installSteps } from "../labels";

interface InstallDialogProps {
  open: boolean;
  canPromptDirectly: boolean;
  onInstall: () => void;
  onClose: () => void;
}

/**
 * Instrukcja instalacji aplikacji. Przegladarki oparte na Chromium pozwalaja
 * zainstalowac jednym kliknieciem; pozostale wymagaja krokow recznych, wiec
 * pokazujemy oba warianty.
 */
export function InstallDialog({ open, canPromptDirectly, onInstall, onClose }: InstallDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="install-dialog"
      aria-labelledby="install-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="install-panel">
        <header className="install-head">
          <h2 id="install-title">Pobierz aplikację</h2>
          <button type="button" onClick={onClose}>
            Zamknij
          </button>
        </header>
        <p className="install-lead">
          Aplikacja działa na telefonie i na komputerze. Otwiera się w osobnym oknie, bez paska
          przeglądarki, i pokazuje ostatnio wczytane wiadomości także bez internetu.
        </p>
        {canPromptDirectly && (
          <button className="install-primary" type="button" onClick={onInstall}>
            Zainstaluj teraz
          </button>
        )}
        <section className="install-steps">
          {open &&
            installSteps().map(({ platform, steps }) => (
              <section key={platform}>
                <h3>{platform}</h3>
                <ol>
                  {steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            ))}
        </section>
      </div>
    </dialog>
  );
}

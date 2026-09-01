import { formatEditionDate } from "../../shared/format";
import type { UseFontScale } from "../hooks/useFontScale";

interface MastheadProps {
  font: UseFontScale;
  installAvailable: boolean;
  onOpenInstall: () => void;
  /** Ostatnie odswiezenie nie powiodlo sie - czytelnik czyta stara wersje wydania. */
  offline: boolean;
}

/** Winieta wydania: data i skala tekstu. */
export function Masthead({ font, installAvailable, onOpenInstall, offline }: MastheadProps) {
  return (
    <header className="masthead">
      <div className="masthead-utility">
        {/* Godzina aktualizacji zniknela z winiety - zostaje tylko ostrzezenie
            o trybie offline, bo to informuje czytelnika, ze widzi nieaktualne
            wydanie, nie tylko kosmetyczny znacznik czasu. */}
        {offline && (
          <span id="feed-offline-notice" role="status">
            Tryb offline
          </span>
        )}
        <div className="masthead-buttons">
          <span className="font-control" role="group" aria-label="Wielkość tekstu">
            <button
              type="button"
              aria-label="Zmniejsz tekst"
              disabled={!font.canDecrease}
              onClick={font.decrease}
            >
              A−
            </button>
            <span id="font-level" aria-live="polite">
              {font.label}
            </span>
            <button
              type="button"
              aria-label="Zwiększ tekst"
              disabled={!font.canIncrease}
              onClick={font.increase}
            >
              A+
            </button>
          </span>
          {installAvailable && (
            <button type="button" aria-label="Pobierz aplikację" onClick={onOpenInstall}>
              <span className="label-long">Pobierz aplikację</span>
              <span className="label-short" aria-hidden="true">
                Apka
              </span>
            </button>
          )}
        </div>
      </div>

      <a className="masthead-title" href="/feed">
        <span>Telegram</span>
      </a>

      <p className="masthead-line">
        <span id="masthead-date">{formatEditionDate()}</span>
        <span aria-hidden="true">·</span>
        <span>Wydanie codzienne</span>
        <span aria-hidden="true">·</span>
        <span>Synteza z wielu źródeł</span>
      </p>
    </header>
  );
}

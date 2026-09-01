import { formatTime } from "../../shared/format";
import type { LastSync } from "../../shared/types";

interface TopBarProps {
  lastSync: LastSync | null;
  onSynchronize: () => void;
  syncing: boolean;
}

/**
 * Pasek gorny: jedna, niska linia zamiast trzech szerokich kolumn. Nazwa
 * aplikacji i przelacznik trybu kolorystycznego usuniete (tak jak w winiecie
 * publicznego feedu) - synchronizacja dziala automatycznie w tle (patrz
 * scheduler w server.mjs), wiec POBIERZ NOWE zostaje tylko jako reczny
 * trigger na wypadek, gdy redaktor nie chce czekac na kolejny cykl.
 */
export function TopBar({ lastSync, onSynchronize, syncing }: TopBarProps) {
  const syncLabel = lastSync
    ? `ODCZYT ${formatTime(lastSync.syncedAt)}`
    : "OCZEKUJE NA ODCZYT";

  return (
    <header className="topbar">
      <div className="system-state" aria-label="Stan systemu">
        <span className="live-dot" aria-hidden="true" />
        <span>{syncLabel}</span>
      </div>

      <button
        className="button button-ghost"
        type="button"
        onClick={onSynchronize}
        disabled={syncing}
      >
        {syncing ? "AGREGUJĘ..." : "POBIERZ NOWE"}
      </button>
    </header>
  );
}

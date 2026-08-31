import { formatTime } from "../../shared/format";
import type { Theme } from "../../shared/hooks/useTheme";
import type { LastSync } from "../../shared/types";

interface TopBarProps {
  lastSync: LastSync | null;
  theme: Theme;
  onToggleTheme: () => void;
  onSynchronize: () => void;
  syncing: boolean;
}

export function TopBar({ lastSync, theme, onToggleTheme, onSynchronize, syncing }: TopBarProps) {
  const syncLabel = lastSync
    ? `OSTATNI ODCZYT ${formatTime(lastSync.syncedAt)}`
    : "OCZEKUJE NA ODCZYT";

  return (
    <header className="topbar">
      <div className="brand" aria-label="Telegram, panel redakcyjny">
        <span className="brand-mark" aria-hidden="true">
          T.
        </span>
        <div>
          <strong>TELEGRAM</strong>
          <small>PANEL REDAKCYJNY / MVP</small>
        </div>
      </div>

      <div className="system-state" aria-label="Stan systemu">
        <span className="live-dot" aria-hidden="true" />
        <span>MONITOR AKTYWNY</span>
        <span className="separator" aria-hidden="true">
          /
        </span>
        <span>{syncLabel}</span>
      </div>

      <div className="topbar-actions">
        <button
          className="button button-ghost"
          type="button"
          onClick={onToggleTheme}
          aria-label="Przełącz tryb kolorystyczny"
        >
          TRYB: {theme === "dark" ? "CIEMNY" : "JASNY"}
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={onSynchronize}
          disabled={syncing}
        >
          {syncing ? "AGREGUJĘ..." : "POBIERZ NOWE"}
        </button>
      </div>
    </header>
  );
}

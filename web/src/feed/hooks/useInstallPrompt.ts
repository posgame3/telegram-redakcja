import { useCallback, useEffect, useState } from "react";

/**
 * Zdarzenie beforeinstallprompt nie jest w standardowych typach DOM,
 * bo wspiera je tylko czesc przegladarek.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface UseInstallPrompt {
  /** Czy pokazywac przycisk instalacji. Ukryty, gdy aplikacja juz dziala samodzielnie. */
  available: boolean;
  /** Czy przegladarka oferuje instalacje jednym kliknieciem. */
  canPromptDirectly: boolean;
  promptInstall: () => Promise<void>;
}

/**
 * Instalacja aplikacji. Przegladarki oparte na Chromium daja zdarzenie
 * pozwalajace wywolac systemowe okno; pozostale wymagaja instrukcji recznej,
 * dlatego przycisk jest widoczny takze bez tego zdarzenia.
 */
export function useInstallPrompt(): UseInstallPrompt {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Bez tego przegladarka pokaze wlasny pasek instalacji obok naszego okna.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }, [prompt]);

  return { available: !installed, canPromptDirectly: prompt !== null, promptInstall };
}

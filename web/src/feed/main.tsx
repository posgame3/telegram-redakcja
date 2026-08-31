import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../styles/feed.css";

const container = document.querySelector("#root");
if (!container) throw new Error("Brak elementu #root w dokumencie feedu.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker daje tryb offline i szybkie ponowne wejscia. Brak rejestracji
// nie moze przerwac dzialania aplikacji, wiec bledy sa tu pochlaniane.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../styles/panel.css";

const container = document.querySelector("#root");
if (!container) throw new Error("Brak elementu #root w dokumencie panelu.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

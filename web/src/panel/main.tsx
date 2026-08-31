import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.querySelector("#root");
if (!container) throw new Error("Brak elementu #root w dokumencie panelu.");

createRoot(container).render(
  <StrictMode>
    <p>Panel redakcyjny — szkielet</p>
  </StrictMode>,
);

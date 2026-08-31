import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Kazdy test startuje z czystym DOM i czystym localStorage, zeby stan
// zapisany przez poprzedni przypadek nie wplywal na nastepny.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

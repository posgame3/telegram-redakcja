import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

// jsdom nie implementuje matchMedia, a aplikacja opiera na nim wykrywanie
// waskiego ekranu i preferencji ograniczonego ruchu.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // jsdom nie implementuje trybu modalnego elementu <dialog>. Podgladu zrodla
  // i podgladu zdjecia nie da sie bez tego przetestowac.
  const dialog = window.HTMLDialogElement.prototype;
  if (typeof dialog.showModal !== "function") {
    dialog.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof dialog.close !== "function") {
    dialog.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new window.Event("close"));
    };
  }
});

// Kazdy test startuje z czystym DOM i czystym localStorage, zeby stan
// zapisany przez poprzedni przypadek nie wplywal na nastepny.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

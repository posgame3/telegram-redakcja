import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
// defineConfig z vitest/config, a nie z vite - inaczej sekcja test nie ma typow.
import { defineConfig } from "vitest/config";

const webRoot = resolve(import.meta.dirname, "web");

// Port backendu (server.mjs) uzywany jako cel proxy w trybie deweloperskim.
const BACKEND_PORT = Number(process.env.PORT ?? 4173);
const BACKEND_TARGET = `http://127.0.0.1:${BACKEND_PORT}`;

/**
 * Dwa niezalezne wejscia:
 *  - index.html  -> panel redakcyjny (chroniony Basic Auth)
 *  - feed.html   -> publiczny feed PWA
 * Nazwy plikow wyjsciowych odpowiadaja trasom, ktore serwuje server.mjs.
 */
export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    // Bez map zrodel na produkcji: nie ujawniamy kodu i nie wysylamy na serwer
    // plikow, ktore sa potrzebne wylacznie przy lokalnym debugowaniu.
    sourcemap: false,
    // Manifest pozwala serwerowi odnalezc hashowane nazwy plikow. Jest potrzebny
    // dla strony materialu (/a/:id), ktora jest skladana po stronie serwera
    // i musi wskazac wlasciwy arkusz stylow.
    manifest: true,
    rollupOptions: {
      input: {
        panel: resolve(webRoot, "index.html"),
        feed: resolve(webRoot, "feed.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    // changeOrigin jest konieczne: server.mjs odrzuca zadania z nieznanym
    // naglowkiem Host (403), a bez podmiany trafialby tam host serwera Vite.
    proxy: Object.fromEntries(
      ["/api", "/img", "/a"].map((path) => [path, { target: BACKEND_TARGET, changeOrigin: true }]),
    ),
  },
});

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Reguly wspolne dla calego repozytorium.
 *
 * max-statements-per-line jest tu celowo: poprzednia wersja frontendu miala
 * linie po 350+ znakow z kilkoma instrukcjami wcisnietymi w jedna linie.
 * Prettier sam tego nie rozbije, bo formatuje, a nie dzieli instrukcji.
 */
const sharedRules = {
  "max-statements-per-line": ["error", { max: 1 }],
  curly: ["error", "multi-line"],
  eqeqeq: ["error", "always"],
  "no-var": "error",
  "prefer-const": "error",
  "object-shorthand": ["error", "always"],
  "no-console": ["warn", { allow: ["warn", "error", "info"] }],
  // ignoreRestSiblings dopuszcza idiomatyczne pomijanie kluczy przez
  // destrukturyzacje (`const { tajne: _tajne, ...reszta } = obiekt`).
  "no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
  ],
};

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "supabase/**", "data/**", "state/**"],
  },

  // Frontend: React + TypeScript ze sprawdzaniem typow.
  {
    files: ["web/src/**/*.{ts,tsx}", "vite.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        // projectService sam dobiera wlasciwy tsconfig (app dla web/src,
        // node dla vite.config.ts), wiec nie trzeba ich wymieniac recznie.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...sharedRules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // Bazowa regula nie rozumie sygnatur typow (parametry w typach funkcji
      // wygladaja dla niej jak nieuzywane zmienne), wiec zastepuje ja wersja
      // swiadoma TypeScriptu.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },

  // Backend: Node, zwykly JavaScript bez sprawdzania typow.
  // console.log jest tu dozwolony - to logi startowe i diagnostyka procesu.
  {
    files: ["server.mjs", "src/**/*.mjs", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...sharedRules, "no-console": "off" },
  },

  // Testy backendu.
  {
    files: ["tests/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
    },
    rules: { ...sharedRules, "no-console": "off" },
  },

  // Service worker ma wlasny zestaw globali.
  {
    files: ["web/public/sw.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: sharedRules,
  },
);

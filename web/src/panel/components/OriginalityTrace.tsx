import type { EditorialEvent, Originality } from "../../shared/types";
import { FALLBACK_GENERATION_LABEL, GENERATION_STATUS_LABELS } from "../labels";

/**
 * Progi kontroli skrotu, wprost z validateOriginality w src/generator.mjs.
 * Dluzszy kontekst ma wlasne, luzniejsze progi, ale ten panel pokazuje metryki
 * skrotu, bo to on trafia do feedu jako pierwsza linia.
 */
const SHORT_TEXT_LIMITS = {
  maxCopiedWords: 5,
  maxOverlapPercent: 18,
  minGroundingPercent: 24,
} as const;

interface OriginalityTraceProps {
  event: EditorialEvent;
  /** Aktualny wynik kontroli skrotu, z uwzglednieniem zmian w trakcie edycji. */
  shortCheck: Originality;
}

/** Na czym oparto material i czy tekst przeszedl kontrole wzgledem zrodel. */
export function OriginalityTrace({ event, shortCheck }: OriginalityTraceProps) {
  const essence = event.verification.essenceBasis;

  // Wynik poprawny wygrywa nad statusem z generatora; stany przejsciowe
  // (edycja, sprawdzanie) maja pierwszenstwo nad zapisanym powodem blokady.
  const status = shortCheck.valid
    ? "passed"
    : shortCheck.status === "checking" || shortCheck.status === "dirty"
      ? shortCheck.status
      : event.generation.status || "unverified";

  const reason = shortCheck.valid
    ? "Skrót przeszedł kontrolę długości, kopiowania i pokrycia faktami."
    : shortCheck.reasons.join(" ") || event.generation.reason || "Tekst wymaga kontroli.";

  return (
    <section className="essence-trace edit-only" aria-labelledby="essence-title">
      <div className="trace-label">
        <span id="essence-title">PODSTAWA ESENCJI</span>
        <span>{essence.confidence ? `ZGODNOŚĆ ${essence.confidence}%` : "DO KONTROLI"}</span>
      </div>
      <p>{essence.text}</p>
      <p className="trace-sources">
        {essence.sources.length ? `ŹRÓDŁA: ${essence.sources.join(" + ")}` : "BRAK POTWIERDZENIA"}
      </p>

      <div className="originality-check" aria-live="polite" data-valid={String(shortCheck.valid)}>
        <div className="trace-label">
          <span>ORYGINALNOŚĆ TEKSTU</span>
          <span>{GENERATION_STATUS_LABELS[status] ?? FALLBACK_GENERATION_LABEL}</span>
        </div>
        <p>{reason}</p>
        <dl className="originality-metrics">
          <div>
            <dt>NAJDŁUŻSZY WSPÓLNY FRAGMENT</dt>
            <dd>
              {shortCheck.maxCopiedWords} / LIMIT {SHORT_TEXT_LIMITS.maxCopiedWords} SŁÓW
            </dd>
          </div>
          <div>
            <dt>POKRYCIE 4-WYRAZOWE</dt>
            <dd>
              {shortCheck.ngramOverlap}% / LIMIT {SHORT_TEXT_LIMITS.maxOverlapPercent}%
            </dd>
          </div>
          <div>
            <dt>POKRYCIE FAKTAMI</dt>
            <dd>
              {shortCheck.groundingScore}% / MIN. {SHORT_TEXT_LIMITS.minGroundingPercent}%
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

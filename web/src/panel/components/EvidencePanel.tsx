import { useRef, useState } from "react";
import type { EditorialEvent, EventSource, VerificationClaim } from "../../shared/types";
import { SourceModal } from "./SourceModal";

interface EvidencePanelProps {
  event: EditorialEvent | null;
}

/** Kolumna dowodowa: z czego powstal material i co sie w zrodlach nie zgadza. */
export function EvidencePanel({ event }: EvidencePanelProps) {
  const [activeSource, setActiveSource] = useState<EventSource | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const openSource = (source: EventSource, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setActiveSource(source);
  };

  const closeSource = () => {
    setActiveSource(null);
    // Fokus wraca na przycisk, ktory otworzyl podglad, zeby nie skakal na poczatek strony.
    triggerRef.current?.focus();
    triggerRef.current = null;
  };

  const verification = event?.verification;
  const hasDiscrepancies = Boolean(
    verification && (verification.conflicts.length > 0 || verification.uniqueClaims.length > 0),
  );

  return (
    <aside className="evidence" aria-labelledby="sources-title">
      <section>
        <p className="kicker">03 / MATERIAŁ ŹRÓDŁOWY</p>
        <div className="evidence-heading">
          <h2 id="sources-title">Artykuły i streszczenia</h2>
          <span>{event ? `${event.sources.length} PUBLIKACJE` : "0 publikacji"}</span>
        </div>
        <div className="source-list">
          {event?.sources.map((source) => (
            <article className="source-item" key={source.url}>
              <div className="source-domain">
                <span>{source.domain}</span>
                <time>
                  {[source.time, source.wordCount ? `${source.wordCount} SŁÓW` : ""]
                    .filter(Boolean)
                    .join(" / ")}
                </time>
              </div>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
              <button
                type="button"
                className="source-preview-button"
                aria-haspopup="dialog"
                onClick={(clickEvent) => openSource(source, clickEvent.currentTarget)}
              >
                OTWÓRZ STRESZCZENIE →
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="facts-section" aria-labelledby="facts-title">
        <div className="evidence-heading">
          <h2 id="facts-title">Kontrola materiału</h2>
          <span>AGREGACJA</span>
        </div>
        <ul className="facts-list">
          {event?.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      <section className="verification-section" aria-labelledby="verification-title">
        <div className="evidence-heading">
          <h2 id="verification-title">Potwierdzone między źródłami</h2>
          <span>PORÓWNANIE</span>
        </div>
        <div className="verification-list">
          {verification && verification.sharedClaims.length > 0 ? (
            verification.sharedClaims.map((claim) => <ClaimItem key={claim.text} claim={claim} />)
          ) : (
            <p className="verification-empty">Brak twierdzeń potwierdzonych w dwóch źródłach.</p>
          )}
        </div>
      </section>

      <section className="conflicts-section" aria-labelledby="conflicts-title">
        <div className="evidence-heading">
          <h2 id="conflicts-title">Rozbieżności i wyjątki</h2>
          <span>DO SPRAWDZENIA</span>
        </div>
        <div className="verification-list">
          {verification?.conflicts.map((conflict) => (
            <article className="verification-item is-conflict" key={conflict.text}>
              <p>{conflict.text}</p>
              <div className="verification-meta">{conflict.sources.join(" + ")}</div>
            </article>
          ))}
          {verification?.uniqueClaims.map((claim) => (
            <article className="verification-item" key={claim.text}>
              <p>{claim.text}</p>
              <div className="verification-meta">TYLKO: {claim.source}</div>
            </article>
          ))}
          {!hasDiscrepancies && <p className="verification-empty">Brak wykrytych rozbieżności.</p>}
        </div>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="evidence-heading">
          <h2 id="method-title">Jak to sprawdzamy</h2>
          <span>METODA</span>
        </div>
        <ol className="method-list">
          {verification?.method.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <SourceModal source={activeSource} onClose={closeSource} />
    </aside>
  );
}

function ClaimItem({ claim }: { claim: VerificationClaim }) {
  return (
    <article className="verification-item">
      <p>{claim.text}</p>
      <div className="verification-meta">
        {claim.sources.join(" + ")} / ZGODNOŚĆ {claim.confidence}%
      </div>
    </article>
  );
}

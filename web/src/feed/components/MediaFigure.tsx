import { useState } from "react";
import type { Publication } from "../../shared/types";
import { withImageVariant, type ImageVariant } from "../media";
import { headlineOf } from "../publication";

interface MediaFigureProps {
  item: Publication;
  className: string;
  variant: ImageVariant;
  withCredit?: boolean;
  children?: React.ReactNode;
}

/**
 * Zdjecie materialu z zapasem graficznym. Zapas pojawia sie takze wtedy, gdy
 * zdjecie nie da sie wczytac - kadr nigdy nie zostaje pusty.
 */
export function MediaFigure({
  item,
  className,
  variant,
  withCredit = false,
  children,
}: MediaFigureProps) {
  const [failed, setFailed] = useState(false);
  const showFallback = !item.image || failed;

  return (
    <figure className={className} data-fallback={showFallback ? "true" : "false"}>
      {showFallback ? (
        <div className="media-fallback">
          <span className="media-fallback-category">{item.category}</span>
          <span className="media-fallback-mark">Telegram</span>
        </div>
      ) : (
        <img
          src={withImageVariant(item.image!.url, variant)}
          alt={item.image!.alt || headlineOf(item)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
      {children}
      {withCredit && !showFallback && item.image?.credit && (
        <figcaption>Fot. {item.image.credit}</figcaption>
      )}
    </figure>
  );
}

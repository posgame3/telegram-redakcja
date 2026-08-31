export type ImageVariant = "thumb" | "full";

/**
 * Dobiera wariant zdjecia z proxy. Miniatury na liscie sa wyraznie lzejsze
 * niz wersja pelna uzywana w czytniku i w podgladzie.
 */
export function withImageVariant(url: string, variant: ImageVariant): string {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set("v", variant);
    return `${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return url;
  }
}

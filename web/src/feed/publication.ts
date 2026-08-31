import type { Publication } from "../shared/types";

/**
 * Naglowkiem wiadomosci jest skrot 20-30 slow, a nie osobny tytul - to on
 * jest tresci pierwszego kontaktu czytelnika z materialem.
 */
export function headlineOf(item: Pick<Publication, "level1" | "title">): string {
  return item.level1 || item.title;
}

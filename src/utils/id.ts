import type { Deck } from "@/types/deck";

let slideCounter = 100;
let elementCounter = 100;

/**
 * Advance counters past existing IDs and deduplicate any collisions.
 * Mutates the deck in-place if duplicates are found.
 */
export function syncCounters(deck: Deck): void {
  const seenSlides = new Set<string>();
  const seenElements = new Set<string>();

  for (const slide of deck.slides) {
    // Advance counter
    const sNum = parseIdNum(slide.id, "s");
    if (sNum >= slideCounter) slideCounter = sNum + 1;

    // Deduplicate slide ID
    if (seenSlides.has(slide.id)) {
      slide.id = nextSlideId();
    }
    seenSlides.add(slide.id);

    for (const el of slide.elements) {
      const eNum = parseIdNum(el.id, "e");
      if (eNum >= elementCounter) elementCounter = eNum + 1;

      if (seenElements.has(el.id)) {
        el.id = nextElementId();
      }
      seenElements.add(el.id);
    }
  }
}

function parseIdNum(id: string, prefix: string): number {
  if (!id.startsWith(prefix)) return -1;
  const n = parseInt(id.slice(prefix.length), 10);
  return isNaN(n) ? -1 : n;
}

export function nextSlideId(): string {
  return `s${slideCounter++}`;
}

export function nextElementId(): string {
  return `e${elementCounter++}`;
}

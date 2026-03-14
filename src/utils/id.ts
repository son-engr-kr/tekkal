import type { Deck, Slide } from "@/types/deck";

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

/** Deep-clone a slide with fresh IDs for the slide, all elements, and remapped animation targets. */
export function cloneSlide(source: Slide): Slide {
  const clone: Slide = JSON.parse(JSON.stringify(source));
  clone.id = nextSlideId();
  delete clone._ref;

  // Build old→new element ID map
  const idMap = new Map<string, string>();
  for (const el of clone.elements) {
    const newId = nextElementId();
    idMap.set(el.id, newId);
    el.id = newId;
  }

  // Remap animation targets
  if (clone.animations) {
    for (const anim of clone.animations) {
      anim.target = idMap.get(anim.target) ?? anim.target;
    }
  }

  // Remap comment elementId references
  if (clone.comments) {
    for (const c of clone.comments) {
      if (c.elementId) c.elementId = idMap.get(c.elementId) ?? c.elementId;
      c.id = crypto.randomUUID();
    }
  }

  return clone;
}

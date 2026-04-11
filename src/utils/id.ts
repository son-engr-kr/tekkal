import type { Deck, Slide } from "@/types/deck";

let slideCounter = 100;
let elementCounter = 100;

/**
 * Advance counters past existing IDs and deduplicate any collisions.
 * Mutates the deck in-place if duplicates are found.
 *
 * When a duplicate element ID is renamed, animations and comments in
 * the same slide that reference the old ID are remapped to the new ID
 * — otherwise they silently become orphaned (the renderer would drop
 * the animation and the comment would point at a non-existent element).
 *
 * When a duplicate slide ID is renamed, the slide's `_ref` path is
 * updated to match the new ID so the next save does not write to the
 * wrong file and collide with a different slide.
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
      const newId = nextSlideId();
      slide.id = newId;
      // Keep _ref aligned with the new ID. If the slide had no _ref,
      // leave it undefined (the save logic generates one on write).
      if ((slide as unknown as { _ref?: string })._ref !== undefined) {
        (slide as unknown as { _ref?: string })._ref = `./slides/${newId}.json`;
      }
    }
    seenSlides.add(slide.id);

    // Track old→new element ID renames for this slide so we can
    // remap animation targets and comment anchors after the loop.
    const renamedElements = new Map<string, string>();

    for (const el of slide.elements) {
      const eNum = parseIdNum(el.id, "e");
      if (eNum >= elementCounter) elementCounter = eNum + 1;

      if (seenElements.has(el.id)) {
        const oldId = el.id;
        const newId = nextElementId();
        el.id = newId;
        renamedElements.set(oldId, newId);
      }
      seenElements.add(el.id);
    }

    // Remap animations that targeted renamed elements
    if (renamedElements.size > 0 && slide.animations) {
      for (const anim of slide.animations) {
        const newTarget = renamedElements.get(anim.target);
        if (newTarget) anim.target = newTarget;
      }
    }

    // Remap comment anchors
    if (renamedElements.size > 0 && slide.comments) {
      for (const comment of slide.comments) {
        if (comment.elementId) {
          const newElId = renamedElements.get(comment.elementId);
          if (newElId) comment.elementId = newElId;
        }
      }
    }
  }

  // Also advance counters for elements inside shared components
  if (deck.components) {
    for (const comp of Object.values(deck.components)) {
      for (const el of comp.elements) {
        const eNum = parseIdNum(el.id, "e");
        if (eNum >= elementCounter) elementCounter = eNum + 1;
      }
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
  // ReferenceElements keep their componentId (shared pointer), only the element ID changes
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

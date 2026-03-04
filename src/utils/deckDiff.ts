import type { Deck, Slide, SlideElement } from "@/types/deck";

// ----- Element-level diff types -----

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

export interface ElementDiff {
  elementId: string;
  change: ChangeType;
  changedFields: string[];
  oldElement?: SlideElement;
  newElement?: SlideElement;
}

export interface SlideDiff {
  slideId: string;
  elements: ElementDiff[];
}

export function diffSlides(oldSlide: Slide | null, newSlide: Slide | null): SlideDiff | null {
  if (!newSlide) return null;
  if (!oldSlide) {
    // Entire slide is new
    return {
      slideId: newSlide.id,
      elements: newSlide.elements.map((e) => ({
        elementId: e.id,
        change: "added",
        changedFields: [],
        newElement: e,
      })),
    };
  }

  const oldMap = new Map(oldSlide.elements.map((e) => [e.id, e]));
  const newMap = new Map(newSlide.elements.map((e) => [e.id, e]));
  const elements: ElementDiff[] = [];

  // Check new elements
  for (const [id, newEl] of newMap) {
    const oldEl = oldMap.get(id);
    if (!oldEl) {
      elements.push({ elementId: id, change: "added", changedFields: [], newElement: newEl });
    } else {
      const changed = diffFields(oldEl, newEl);
      elements.push({
        elementId: id,
        change: changed.length > 0 ? "modified" : "unchanged",
        changedFields: changed,
        oldElement: oldEl,
        newElement: newEl,
      });
    }
  }

  // Check removed elements
  for (const [id, oldEl] of oldMap) {
    if (!newMap.has(id)) {
      elements.push({ elementId: id, change: "removed", changedFields: [], oldElement: oldEl });
    }
  }

  return { slideId: newSlide.id, elements };
}

function diffFields(oldEl: SlideElement, newEl: SlideElement): string[] {
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(oldEl), ...Object.keys(newEl)]);
  for (const key of allKeys) {
    const oldVal = JSON.stringify((oldEl as unknown as Record<string, unknown>)[key]);
    const newVal = JSON.stringify((newEl as unknown as Record<string, unknown>)[key]);
    if (oldVal !== newVal) {
      changed.push(key);
    }
  }
  return changed;
}

// ----- Undo change detection -----

export interface UndoChanges {
  slideIndex: number;
  elementIds: string[];
}

export function findUndoChanges(oldDeck: Deck | null, newDeck: Deck | null): UndoChanges {
  const noChange: UndoChanges = { slideIndex: -1, elementIds: [] };

  if (!oldDeck || !newDeck) return noChange;
  if (oldDeck === newDeck) return noChange;

  // Slide count changed — navigate to the end of the shorter deck
  if (oldDeck.slides.length !== newDeck.slides.length) {
    // If slides were removed, navigate to the position where the removal happened
    // If slides were added, navigate to the new slide
    const maxLen = Math.max(oldDeck.slides.length, newDeck.slides.length);
    for (let i = 0; i < maxLen; i++) {
      const oldStr = i < oldDeck.slides.length ? JSON.stringify(oldDeck.slides[i]) : null;
      const newStr = i < newDeck.slides.length ? JSON.stringify(newDeck.slides[i]) : null;
      if (oldStr !== newStr) {
        const targetIndex = Math.min(i, newDeck.slides.length - 1);
        return { slideIndex: targetIndex, elementIds: [] };
      }
    }
    return noChange;
  }

  // Same slide count — find first differing slide
  for (let i = 0; i < oldDeck.slides.length; i++) {
    const oldSlide = oldDeck.slides[i]!;
    const newSlide = newDeck.slides[i]!;

    if (JSON.stringify(oldSlide) === JSON.stringify(newSlide)) continue;

    // Found the changed slide — find changed element IDs
    const changedIds: string[] = [];

    const oldMap = new Map(oldSlide.elements.map((e) => [e.id, JSON.stringify(e)]));
    const newMap = new Map(newSlide.elements.map((e) => [e.id, JSON.stringify(e)]));

    // Elements that were modified (exist in both, but content differs)
    for (const [id, newStr] of newMap) {
      const oldStr = oldMap.get(id);
      if (oldStr !== undefined && oldStr !== newStr) {
        changedIds.push(id);
      }
    }

    return { slideIndex: i, elementIds: changedIds };
  }

  return noChange;
}

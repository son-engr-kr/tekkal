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
    const oldVal = JSON.stringify((oldEl as unknown as unknown as Record<string, unknown>)[key]);
    const newVal = JSON.stringify((newEl as unknown as unknown as Record<string, unknown>)[key]);
    if (oldVal !== newVal) {
      changed.push(key);
    }
  }
  return changed;
}

// ----- Three-way merge -----

export interface MergeResult {
  /** Merged deck (null if conflicts exist and caller should prompt user) */
  merged: Deck | null;
  /** Element IDs that were modified both locally and remotely */
  conflicts: { slideId: string; elementId: string }[];
  /** Whether any non-element slide-level fields conflict (notes, animations, etc.) */
  hasSlideConflicts: boolean;
}

/**
 * Three-way merge: base (last saved) vs local (current store) vs remote (disk).
 * - Elements changed only remotely → accept remote
 * - Elements changed only locally → keep local
 * - Elements changed both sides (same element) → conflict
 * - New/deleted elements only on one side → accept that side's change
 * - Slide-level fields (notes, animations, background, etc.) → remote wins unless locally modified
 */
export function mergeDeck(base: Deck, local: Deck, remote: Deck): MergeResult {
  const conflicts: { slideId: string; elementId: string }[] = [];
  let hasSlideConflicts = false;

  // Build slide maps
  const baseSlides = new Map(base.slides.map((s) => [s.id, s]));
  const localSlides = new Map(local.slides.map((s) => [s.id, s]));
  const remoteSlides = new Map(remote.slides.map((s) => [s.id, s]));

  // If slide structure changed (added/removed/reordered), can't auto-merge
  const localIds = local.slides.map((s) => s.id).join(",");
  const remoteIds = remote.slides.map((s) => s.id).join(",");
  const baseIds = base.slides.map((s) => s.id).join(",");

  if (localIds !== baseIds && remoteIds !== baseIds && localIds !== remoteIds) {
    // Both sides changed slide structure differently
    return { merged: null, conflicts: [], hasSlideConflicts: true };
  }

  // Use remote slide order if it changed, otherwise local
  const slideOrder = remoteIds !== baseIds ? remote.slides.map((s) => s.id) : local.slides.map((s) => s.id);
  const mergedSlides: Slide[] = [];

  for (const slideId of slideOrder) {
    const baseSlide = baseSlides.get(slideId);
    const localSlide = localSlides.get(slideId);
    const remoteSlide = remoteSlides.get(slideId);

    // New slide from remote
    if (!baseSlide && remoteSlide && !localSlide) {
      mergedSlides.push(structuredClone(remoteSlide));
      continue;
    }
    // New slide from local
    if (!baseSlide && localSlide && !remoteSlide) {
      mergedSlides.push(structuredClone(localSlide));
      continue;
    }
    // Slide exists in local but deleted in remote (and unchanged locally)
    if (baseSlide && localSlide && !remoteSlide) {
      if (JSON.stringify(baseSlide) === JSON.stringify(localSlide)) continue; // accept deletion
      // Local modified, remote deleted → keep local
      mergedSlides.push(structuredClone(localSlide));
      continue;
    }

    if (!localSlide || !remoteSlide) continue;

    // Merge slide-level fields (non-elements)
    const mergedSlide: Slide = structuredClone(localSlide);

    // For non-element fields, accept remote if changed from base and local hasn't changed
    const slideFields = ["background", "transition", "notes", "hidden", "hidePageNumber", "layout", "comments"] as const;
    for (const field of slideFields) {
      const baseVal = baseSlide ? JSON.stringify((baseSlide as unknown as Record<string, unknown>)[field]) : undefined;
      const localVal = JSON.stringify((localSlide as unknown as Record<string, unknown>)[field]);
      const remoteVal = JSON.stringify((remoteSlide as unknown as Record<string, unknown>)[field]);

      if (remoteVal !== baseVal && localVal === baseVal) {
        // Remote changed, local didn't → accept remote
        (mergedSlide as unknown as Record<string, unknown>)[field] = structuredClone((remoteSlide as unknown as Record<string, unknown>)[field]);
      } else if (remoteVal !== baseVal && localVal !== baseVal && remoteVal !== localVal) {
        // Both changed differently → report as slide-level conflict so the
        // caller pauses saves. Previously silently kept local, losing the
        // remote edit. We keep local in the merged output so the UI has
        // something to render, but hasSlideConflicts nulls out the return
        // value and the user must manually reconcile.
        hasSlideConflicts = true;
      }
      // else: only local changed, or both same → keep local (already in mergedSlide)
    }

    // Merge animations: accept remote if base→remote changed and base→local didn't.
    // Both-sides-changed is a slide-level conflict (same silent-loss bug as notes/background).
    const baseAnims = baseSlide ? JSON.stringify(baseSlide.animations) : undefined;
    const localAnims = JSON.stringify(localSlide.animations);
    const remoteAnims = JSON.stringify(remoteSlide.animations);
    if (remoteAnims !== baseAnims && localAnims === baseAnims) {
      mergedSlide.animations = structuredClone(remoteSlide.animations);
    } else if (
      remoteAnims !== baseAnims &&
      localAnims !== baseAnims &&
      remoteAnims !== localAnims
    ) {
      hasSlideConflicts = true;
    }

    // Merge elements: three-way per element
    const baseEls = new Map((baseSlide?.elements ?? []).map((e) => [e.id, e]));
    const localEls = new Map(localSlide.elements.map((e) => [e.id, e]));
    const remoteEls = new Map(remoteSlide.elements.map((e) => [e.id, e]));

    const allIds = new Set([...localEls.keys(), ...remoteEls.keys()]);
    const mergedElements: SlideElement[] = [];

    // Preserve remote element order for elements that exist in remote
    const remoteOrder = remoteSlide.elements.map((e) => e.id);

    for (const elId of remoteOrder) {
      if (!allIds.has(elId)) continue;
      allIds.delete(elId);

      const baseEl = baseEls.get(elId);
      const localEl = localEls.get(elId);
      const remoteEl = remoteEls.get(elId);

      const baseStr = baseEl ? JSON.stringify(baseEl) : null;
      const localStr = localEl ? JSON.stringify(localEl) : null;
      const remoteStr = remoteEl ? JSON.stringify(remoteEl) : null;

      if (!localEl && remoteEl) {
        // Element absent locally, present remotely
        if (!baseEl) {
          // Not in base at all → remote added it → accept
          mergedElements.push(structuredClone(remoteEl));
        } else if (baseStr === remoteStr) {
          // Local deleted, remote unchanged → accept deletion
          continue;
        } else {
          // Local deleted, remote modified → conflict.
          // Previously silently kept local's deletion and lost the remote
          // modification. Reporting as a conflict pauses saves so the user
          // can choose: restore the element or confirm the deletion.
          conflicts.push({ slideId, elementId: elId });
        }
      } else if (localEl && !remoteEl) {
        // Exists locally, deleted remotely
        if (baseStr === localStr) continue; // remote deletion, local unchanged → accept deletion
        // Local modified, remote deleted → conflict (same symmetry as above).
        conflicts.push({ slideId, elementId: elId });
        mergedElements.push(structuredClone(localEl));
      } else if (localEl && remoteEl) {
        if (localStr === remoteStr) {
          // Same → keep either
          mergedElements.push(structuredClone(localEl));
        } else if (localStr === baseStr) {
          // Only remote changed → accept remote
          mergedElements.push(structuredClone(remoteEl));
        } else if (remoteStr === baseStr) {
          // Only local changed → keep local
          mergedElements.push(structuredClone(localEl));
        } else {
          // Both changed → report conflict; keep local in merged output so the
          // caller can still show something, but the returned merged is
          // ultimately nulled out below because conflicts.length > 0.
          conflicts.push({ slideId, elementId: elId });
          mergedElements.push(structuredClone(localEl));
        }
      }
    }

    // Remaining IDs: elements present in local but not in remoteOrder.
    // This set is either:
    //   - genuine local additions (not in base, not in remote)
    //   - elements that base+local shared but remote has deleted (not in remote)
    // We must check base to distinguish these, otherwise remote deletions
    // of untouched elements would be silently ignored and remote deletions
    // of locally-modified elements would silently keep local.
    for (const elId of allIds) {
      const localEl = localEls.get(elId);
      if (!localEl) continue;
      const baseEl = baseEls.get(elId);
      if (!baseEl) {
        // Local added it, remote does not have it → keep as a local add
        mergedElements.push(structuredClone(localEl));
        continue;
      }
      // Was in base and local, but not in remote → remote deleted it
      const baseStr = JSON.stringify(baseEl);
      const localStr = JSON.stringify(localEl);
      if (baseStr === localStr) {
        // Local untouched → accept remote's deletion, drop from merged
        continue;
      }
      // Local modified, remote deleted → conflict
      conflicts.push({ slideId, elementId: elId });
      mergedElements.push(structuredClone(localEl));
    }

    mergedSlide.elements = mergedElements;
    mergedSlides.push(mergedSlide);
  }

  const merged: Deck = structuredClone(local);
  merged.slides = mergedSlides;

  // Merge deck-level fields (theme, pageNumbers, components, meta).
  // Both-sides-changed is a conflict — previously silently kept local and
  // lost the remote edit.
  const deckFields = ["theme", "pageNumbers", "meta", "components"] as const;
  for (const field of deckFields) {
    const baseVal = JSON.stringify((base as unknown as Record<string, unknown>)[field]);
    const localVal = JSON.stringify((local as unknown as Record<string, unknown>)[field]);
    const remoteVal = JSON.stringify((remote as unknown as Record<string, unknown>)[field]);
    if (remoteVal !== baseVal && localVal === baseVal) {
      (merged as unknown as Record<string, unknown>)[field] = structuredClone((remote as unknown as Record<string, unknown>)[field]);
    } else if (remoteVal !== baseVal && localVal !== baseVal && remoteVal !== localVal) {
      hasSlideConflicts = true;
    }
  }

  if (conflicts.length > 0 || hasSlideConflicts) {
    return { merged: null, conflicts, hasSlideConflicts };
  }
  return { merged, conflicts: [], hasSlideConflicts: false };
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

/**
 * Three-way merge for individual slide fields.
 * base = last saved by deckode, local = current deckode state, remote = current disk state.
 * Element-level: remote wins for elements only changed remotely, local wins for local-only changes.
 * Both changed same element: local wins (deckode user is actively editing).
 */
export function mergeSlideFields(base: any, local: any, remote: any): any {
  const result = { ...local };

  // Merge elements: three-way per element
  const baseEls = new Map((base.elements ?? []).map((e: any) => [e.id, e]));
  const localEls = new Map((local.elements ?? []).map((e: any) => [e.id, e]));
  const remoteEls = new Map((remote.elements ?? []).map((e: any) => [e.id, e]));

  const mergedElements: any[] = [];
  const allIds = new Set([...localEls.keys(), ...remoteEls.keys()]);

  for (const id of allIds) {
    const baseEl = baseEls.get(id);
    const localEl = localEls.get(id);
    const remoteEl = remoteEls.get(id);
    const baseStr = baseEl ? JSON.stringify(baseEl) : null;
    const localStr = localEl ? JSON.stringify(localEl) : null;
    const remoteStr = remoteEl ? JSON.stringify(remoteEl) : null;

    if (localEl && remoteEl) {
      if (localStr === baseStr && remoteStr !== baseStr) {
        // Only remote changed → accept remote
        mergedElements.push(remoteEl);
      } else {
        // Local changed (or both) → keep local
        mergedElements.push(localEl);
      }
    } else if (localEl && !remoteEl) {
      if (baseStr === localStr) continue; // remote deleted, local unchanged → accept deletion
      mergedElements.push(localEl); // local changed → keep
    } else if (!localEl && remoteEl) {
      if (baseStr === remoteStr) continue; // local deleted, remote unchanged → accept deletion
      mergedElements.push(remoteEl); // remote changed → keep
    }
  }

  result.elements = mergedElements;

  // Non-element fields: accept remote if only remote changed
  const slideFields = ["background", "transition", "notes", "hidden", "hidePageNumber", "layout", "comments", "animations", "bookmark"];
  for (const field of slideFields) {
    const baseVal = JSON.stringify(base[field]);
    const localVal = JSON.stringify(local[field]);
    const remoteVal = JSON.stringify(remote[field]);
    if (remoteVal !== baseVal && localVal === baseVal) {
      result[field] = remote[field];
    }
  }

  return result;
}

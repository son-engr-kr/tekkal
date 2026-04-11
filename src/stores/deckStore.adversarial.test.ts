/**
 * Adversarial tests for deckStore — targets subtle state bugs in the
 * high-traffic actions: slide navigation invariants, save flow edge
 * cases, and merge-and-retry ordering.
 *
 * Every test is written to assert correct behavior. Failures here
 * indicate real bugs a user would hit during normal editing.
 */
// @ts-nocheck — test file accesses .content on SlideElement union type
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDeckStore, setStoreAdapter } from "./deckStore";
import type { Deck, Slide, SlideElement } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";

// ── Fixtures ──

function el(id: string, content = `Element ${id}`): SlideElement {
  return { id, type: "text", content, position: { x: 0, y: 0 }, size: { w: 200, h: 50 } };
}

function slide(id: string, elements: SlideElement[] = [el(`${id}-e0`)]): Slide {
  return { id, elements };
}

function deck(slides: Slide[]): Deck {
  return { version: "0.1.0", meta: { title: "Test", aspectRatio: "16:9" }, slides };
}

// ── Mock adapter (save tracking + controllable behavior) ──

type SaveBehavior =
  | { type: "success" }
  | { type: "error"; error: Error }
  | { type: "conflict"; diskDeck: Deck };

function mockAdapter(initial: Deck): {
  adapter: FileSystemAdapter;
  setSaveBehavior: (b: SaveBehavior) => void;
  saveCallCount: () => number;
} {
  let behavior: SaveBehavior = { type: "success" };
  let count = 0;
  let disk = structuredClone(initial);

  const adapter: FileSystemAdapter = {
    mode: "vite" as const,
    projectName: "adversarial-test",
    lastSaveHash: null,

    async loadDeck() {
      return structuredClone(disk);
    },

    async saveDeck(deckToSave: Deck): Promise<Deck | null> {
      count++;
      if (behavior.type === "error") throw behavior.error;
      if (behavior.type === "conflict") {
        const returned = structuredClone(behavior.diskDeck);
        disk = returned;
        // After one conflict, revert to success so retries can complete
        behavior = { type: "success" };
        return returned;
      }
      disk = structuredClone(deckToSave);
      return null;
    },

    async listProjects() { return []; },
    async createProject() {},
    async deleteProject() {},
    async renameProject() {},
    async projectExists() { return true; },
    async loadAssets() { return {}; },
    async saveAsset() {},
    async deleteAsset() {},
    resolveAssetUrl(path: string) { return path; },
    async copyAssetsFromSource() {},
    async getProjectAbsolutePath() { return "/mock"; },
  } as unknown as FileSystemAdapter;

  return {
    adapter,
    setSaveBehavior: (b) => { behavior = b; },
    saveCallCount: () => count,
  };
}

beforeEach(() => {
  useDeckStore.getState().closeProject();
  setStoreAdapter(null);
});

// ─────────────────────────────────────────────────────────────────────
// deleteSlide — slide navigation invariant
// ─────────────────────────────────────────────────────────────────────

describe("deleteSlide — currentSlideIndex preservation", () => {
  it("keeps the user viewing the same slide when an earlier slide is deleted", () => {
    // Setup: 4 slides, user viewing s2 (index 2)
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"),
    ]));
    useDeckStore.getState().setCurrentSlide(2);
    expect(useDeckStore.getState().currentSlideIndex).toBe(2);
    const currentSlideIdBefore = useDeckStore.getState().deck!.slides[2]!.id;
    expect(currentSlideIdBefore).toBe("s2");

    // Delete s1 (index 1) — before the current slide
    useDeckStore.getState().deleteSlide("s1");

    // The user should still be viewing s2 (now at index 1, not index 2)
    const state = useDeckStore.getState();
    const currentSlideIdAfter = state.deck!.slides[state.currentSlideIndex]!.id;
    expect(currentSlideIdAfter).toBe("s2");
  });

  it("stays on the current slide when a later slide is deleted", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"),
    ]));
    useDeckStore.getState().setCurrentSlide(1);
    useDeckStore.getState().deleteSlide("s3");

    const state = useDeckStore.getState();
    expect(state.currentSlideIndex).toBe(1);
    expect(state.deck!.slides[1]!.id).toBe("s1");
  });

  it("moves to the next slide when the current slide is deleted (not the last)", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"),
    ]));
    useDeckStore.getState().setCurrentSlide(1);
    useDeckStore.getState().deleteSlide("s1");

    const state = useDeckStore.getState();
    // After deleting s1 at index 1, s2 shifts down to index 1. User sees s2.
    expect(state.currentSlideIndex).toBe(1);
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s2");
  });

  it("clamps currentSlideIndex when the last slide is deleted", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"),
    ]));
    useDeckStore.getState().setCurrentSlide(2);
    useDeckStore.getState().deleteSlide("s2");

    const state = useDeckStore.getState();
    expect(state.currentSlideIndex).toBe(1);
    expect(state.deck!.slides[1]!.id).toBe("s1");
  });

  it("goes to index 0 when the only slide is deleted", () => {
    useDeckStore.getState().openProject("test", deck([slide("s0")]));
    useDeckStore.getState().deleteSlide("s0");
    const state = useDeckStore.getState();
    expect(state.deck!.slides).toHaveLength(0);
    expect(state.currentSlideIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// saveToDisk — adversarial edge cases
// ─────────────────────────────────────────────────────────────────────

describe("saveToDisk — adversarial edge cases", () => {
  it("does nothing when savePaused is true", async () => {
    const { adapter, saveCallCount } = mockAdapter(deck([slide("s0")]));
    setStoreAdapter(adapter);
    useDeckStore.getState().openProject("test", deck([slide("s0")]));
    useDeckStore.getState().setSavePaused(true);

    await useDeckStore.getState().saveToDisk();

    expect(saveCallCount()).toBe(0);
  });

  it("does nothing when the adapter is null", async () => {
    // No setStoreAdapter call
    useDeckStore.getState().openProject("test", deck([slide("s0")]));
    // Should not throw
    await expect(useDeckStore.getState().saveToDisk()).resolves.toBeUndefined();
  });

  it("does nothing when no deck is loaded", async () => {
    const { adapter, saveCallCount } = mockAdapter(deck([slide("s0")]));
    setStoreAdapter(adapter);
    // Don't open a project
    await useDeckStore.getState().saveToDisk();
    expect(saveCallCount()).toBe(0);
  });

  it("survives adapter.saveDeck throwing — isSaving is reset", async () => {
    const { adapter, setSaveBehavior } = mockAdapter(deck([slide("s0")]));
    setStoreAdapter(adapter);
    useDeckStore.getState().openProject("test", deck([slide("s0")]));
    useDeckStore.getState().updateElement("s0", "s0-e0", { content: "dirty" });

    setSaveBehavior({ type: "error", error: new Error("disk full") });

    await useDeckStore.getState().saveToDisk();

    // isSaving must be cleared even though saveDeck threw
    expect(useDeckStore.getState().isSaving).toBe(false);
  });

  it("marks the deck dirty after temporal.undo so auto-save fires", () => {
    // Auto-save subscribes to (versionId !== savedVersionId). The
    // temporal middleware restores `deck` via partialize but never
    // touches versionId, so undo back across a save would otherwise
    // leave the in-memory deck out of sync with disk forever — the
    // user sees the undone state, the disk still has the redone
    // edits, and no save is queued.
    vi.useFakeTimers();
    try {
      useDeckStore.getState().openProject("test", deck([slide("s0", [el("s0-e0", "v0")])]));
      const initialVersion = useDeckStore.getState().versionId;
      useDeckStore.setState({ savedVersionId: initialVersion });

      useDeckStore.getState().updateElement("s0", "s0-e0", { content: "v1" });
      // Flush the 300ms temporal debounce so the edit is committed
      // to past states. Without this, undo would be a no-op.
      vi.advanceTimersByTime(400);

      const afterEditVersion = useDeckStore.getState().versionId;
      useDeckStore.setState({ savedVersionId: afterEditVersion });
      expect(useDeckStore.getState().versionId).toBe(useDeckStore.getState().savedVersionId);

      const temporal = useDeckStore.temporal.getState();
      expect(temporal.pastStates.length).toBeGreaterThan(0);

      temporal.undo();

      expect(useDeckStore.getState().versionId).not.toBe(useDeckStore.getState().savedVersionId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT mark the deck as saved when adapter.saveDeck throws", async () => {
    // Regression: the finally block used to run the "success" branch
    // whenever conflictDeck was null, which includes the throw path.
    // That silently advanced savedVersionId and _lastSavedDeck to a
    // deck that never actually reached disk, so the next conflict
    // check would mistake the unwritten state as "already saved" and
    // the user's edits would be lost on the next external edit.
    const { adapter, setSaveBehavior, saveCallCount } = mockAdapter(deck([slide("s0")]));
    setStoreAdapter(adapter);
    useDeckStore.getState().openProject("test", deck([slide("s0")]));
    useDeckStore.getState().updateElement("s0", "s0-e0", { content: "dirty" });

    const dirtyVersion = useDeckStore.getState().versionId;
    setSaveBehavior({ type: "error", error: new Error("disk full") });

    await useDeckStore.getState().saveToDisk();

    // The save failed → the deck must still be dirty so the next
    // save attempt (or a navigation guard) knows there are unsaved edits.
    expect(useDeckStore.getState().savedVersionId).not.toBe(dirtyVersion);

    // And a subsequent successful save should actually write.
    setSaveBehavior({ type: "success" });
    await useDeckStore.getState().saveToDisk();
    expect(saveCallCount()).toBe(2);
    expect(useDeckStore.getState().savedVersionId).toBe(dirtyVersion);
  });

  it("eventually succeeds through a single-round conflict retry", async () => {
    const initial = deck([slide("s0", [el("s0-e0")])]);
    const disk = structuredClone(initial);
    disk.slides[0]!.elements[0]!.content = "external edit";

    const { adapter, setSaveBehavior, saveCallCount } = mockAdapter(initial);
    setStoreAdapter(adapter);
    useDeckStore.getState().openProject("test", initial);

    // Local user edits a different element
    useDeckStore.getState().addElement("s0", el("s0-e1", "local addition"));

    setSaveBehavior({ type: "conflict", diskDeck: disk });
    await useDeckStore.getState().saveToDisk();

    // Both changes should end up in the final local state
    const slides = useDeckStore.getState().deck!.slides;
    const contents = slides[0]!.elements.map((e) => e.id).sort();
    expect(contents).toContain("s0-e0");
    expect(contents).toContain("s0-e1");
    // Two save calls: the initial 409, then the retry after merge
    expect(saveCallCount()).toBe(2);
    // Editor should not be paused
    expect(useDeckStore.getState().savePaused).toBe(false);
  });

  it("pauses saves when the merged deck is null (unresolvable conflict)", async () => {
    const initial = deck([slide("s0", [el("s0-e0", "base")])]);
    const disk = structuredClone(initial);
    disk.slides[0]!.elements[0]!.content = "external edit on same element";

    const { adapter, setSaveBehavior } = mockAdapter(initial);
    setStoreAdapter(adapter);
    useDeckStore.getState().openProject("test", initial);

    // Local edits the SAME element differently
    useDeckStore.getState().updateElement("s0", "s0-e0", { content: "local edit on same element" });

    setSaveBehavior({ type: "conflict", diskDeck: disk });
    await useDeckStore.getState().saveToDisk();

    expect(useDeckStore.getState().savePaused).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// moveSlide — currentSlideIndex invariant under reorder
// ─────────────────────────────────────────────────────────────────────

describe("replaceDeck — currentSlideIndex preservation", () => {
  it("follows the slide the user is viewing when the deck is reordered", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"),
    ]));
    useDeckStore.getState().setCurrentSlide(2); // viewing s2

    // Reorder: [s2, s0, s1] — s2 is now at index 0
    useDeckStore.getState().replaceDeck({
      version: "0.1.0",
      meta: { title: "Test", aspectRatio: "16:9" },
      slides: [slide("s2"), slide("s0"), slide("s1")],
    });

    const state = useDeckStore.getState();
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s2");
  });

  it("drops selectedElementIds that no longer exist in the new deck", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0", [el("s0-e0"), el("s0-e1")]),
    ]));
    useDeckStore.getState().selectElements(["s0-e0", "s0-e1"]);

    // Replace with a deck where s0-e1 was removed
    useDeckStore.getState().replaceDeck(deck([
      slide("s0", [el("s0-e0")]),
    ]));

    const selected = useDeckStore.getState().selectedElementIds;
    // s0-e1 is gone — selection must be pruned, not left as a ghost
    // pointing at a vanished element. Stale selection IDs leak into
    // the inspector and crash on operations like delete or transform.
    expect(selected).not.toContain("s0-e1");
    expect(selected).toEqual(["s0-e0"]);
  });

  it("clears cropElementId when the cropped element is removed by replaceDeck", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0", [el("s0-e0")]),
    ]));
    useDeckStore.getState().setCropElement("s0-e0");

    useDeckStore.getState().replaceDeck(deck([
      slide("s0", [el("s0-e1")]),
    ]));

    expect(useDeckStore.getState().cropElementId).toBe(null);
  });

  it("clamps to the last slide when the current slide is removed", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"),
    ]));
    useDeckStore.getState().setCurrentSlide(2); // viewing s2

    // New deck drops s2
    useDeckStore.getState().replaceDeck({
      version: "0.1.0",
      meta: { title: "Test", aspectRatio: "16:9" },
      slides: [slide("s0"), slide("s1")],
    });

    const state = useDeckStore.getState();
    expect(state.currentSlideIndex).toBe(1);
    expect(state.deck!.slides[1]!.id).toBe("s1");
  });
});

describe("addSlide — currentSlideIndex preservation", () => {
  it("shifts currentSlideIndex right when a slide is inserted before it", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"),
    ]));
    useDeckStore.getState().setCurrentSlide(2); // viewing s2

    // Insert a new slide after s0 (at index 1)
    useDeckStore.getState().addSlide(slide("new"), 0);

    const state = useDeckStore.getState();
    // User should still be viewing s2
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s2");
  });

  it("leaves currentSlideIndex alone when a slide is appended after it", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"),
    ]));
    useDeckStore.getState().setCurrentSlide(0); // viewing s0

    useDeckStore.getState().addSlide(slide("new")); // append

    const state = useDeckStore.getState();
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s0");
  });
});

describe("moveSlide — currentSlideIndex tracking", () => {
  it("follows the slide the user is viewing when that slide is moved", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"),
    ]));
    useDeckStore.getState().setCurrentSlide(1);
    useDeckStore.getState().moveSlide(1, 3);

    const state = useDeckStore.getState();
    // User was viewing s1. After move, s1 should be at index 3.
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s1");
  });

  it("keeps viewing the same slide when a slide is moved from before to after current", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"),
    ]));
    useDeckStore.getState().setCurrentSlide(2); // viewing s2
    useDeckStore.getState().moveSlide(0, 3); // move s0 to end

    const state = useDeckStore.getState();
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s2");
  });

  it("keeps viewing the same slide when a slide is moved from after to before current", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"),
    ]));
    useDeckStore.getState().setCurrentSlide(1); // viewing s1
    useDeckStore.getState().moveSlide(3, 0); // move s3 to start

    const state = useDeckStore.getState();
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s1");
  });

  it("keeps viewing the same slide when unrelated slides shuffle around it", () => {
    useDeckStore.getState().openProject("test", deck([
      slide("s0"), slide("s1"), slide("s2"), slide("s3"), slide("s4"),
    ]));
    useDeckStore.getState().setCurrentSlide(2); // s2
    useDeckStore.getState().moveSlide(0, 1); // move s0 → between s1 and s2... wait

    const state = useDeckStore.getState();
    // Expected behavior: the slide under currentSlideIndex should still be s2
    expect(state.deck!.slides[state.currentSlideIndex]!.id).toBe("s2");
  });
});

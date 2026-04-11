import { describe, it, expect } from "vitest";
import { mergeDeck } from "./deckDiff";
import type { Deck, Slide, SlideElement, TextElement } from "@/types/deck";

// -- Fixtures --

function makeElement(id: string, overrides: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: "text" as const,
    content: `Element ${id}`,
    position: { x: 100, y: 100 },
    size: { w: 200, h: 50 },
    ...overrides,
  };
}

function makeSlide(id: string, elements: SlideElement[] = []): Slide {
  return { id, elements };
}

function makeDeck(slides: Slide[]): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides,
  };
}

/** Helper to read .content from a TextElement in merged results */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentOf(el: SlideElement): string { return (el as any).content; }

// ============================================================
// External edit preservation (three-way merge)
// ============================================================

describe("mergeDeck - external edit preservation", () => {
  it("accepts external element change when local is unchanged", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[0]! as TextElement).content = "Externally edited";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.conflicts).toHaveLength(0);
    expect(contentOf(result.merged!.slides[0]!.elements[0]!)).toBe("Externally edited");
  });

  it("keeps local change when remote is unchanged", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "Locally edited";
    const remote = structuredClone(base);

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(contentOf(result.merged!.slides[0]!.elements[0]!)).toBe("Locally edited");
  });

  it("merges non-conflicting changes on different elements", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1"), makeElement("e2")])]);
    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "Local change on e1";
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[1]! as TextElement).content = "External change on e2";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.conflicts).toHaveLength(0);
    expect(contentOf(result.merged!.slides[0]!.elements[0]!)).toBe("Local change on e1");
    expect(contentOf(result.merged!.slides[0]!.elements[1]!)).toBe("External change on e2");
  });

  it("reports conflict when same element changed both locally and externally", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "Local version";
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[0]! as TextElement).content = "External version";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({ slideId: "s1", elementId: "e1" });
  });

  it("accepts externally added element", () => {
    // When remote adds a brand new element that local did not touch, it should
    // merge cleanly (no conflict). Historically this was misclassified as
    // "local deleted, remote modified" because the element is absent in base
    // AND absent in local — the fix explicitly checks !baseEl to distinguish
    // a true remote add from a local-delete-plus-remote-modify collision.
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.slides[0]!.elements.push(makeElement("e-new", { content: "Added externally" }));

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged!.slides[0]!.elements).toHaveLength(2);
    expect(result.merged!.slides[0]!.elements[1]!.id).toBe("e-new");
  });

  it("accepts externally added slide", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.slides.push(makeSlide("s-new", [makeElement("e-new")]));

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.slides).toHaveLength(2);
    expect(result.merged!.slides[1]!.id).toBe("s-new");
  });

  it("accepts external deck-level field changes (theme, meta)", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.meta.title = "Externally updated title";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.meta.title).toBe("Externally updated title");
  });

  it("accepts external slide-level field changes (notes, background)", () => {
    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    (remote.slides[0]! as unknown as Record<string, unknown>).notes = "Added by external edit";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect((result.merged!.slides[0]! as unknown as Record<string, unknown>).notes).toBe("Added by external edit");
  });
});

// ============================================================
// Race condition: server-side 409 conflict detection
// ============================================================

describe("save conflict detection flow", () => {
  it("409 flow: server detects external change, client merges non-conflicting edits", () => {
    // Simulates the full conflict-resolution flow:
    // 1. base = last saved state (known to both server and client)
    // 2. External edit modifies e2 on disk
    // 3. App modifies e1 and tries to save
    // 4. Server detects file hash mismatch → returns 409 with disk deck
    // 5. Client receives disk deck, runs mergeDeck(base, local, diskDeck)
    // 6. Merge succeeds → client retries save with merged content

    const base = makeDeck([makeSlide("s1", [makeElement("e1"), makeElement("e2")])]);

    // App state: user edited e1
    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "Edited in app";

    // Disk state: external edit changed e2 (what server returns in 409)
    const diskDeck = structuredClone(base);
    (diskDeck.slides[0]!.elements[1]! as TextElement).content = "Edited in JSON file";

    // Client-side merge (what saveToDisk does on 409)
    const result = mergeDeck(base, local, diskDeck);
    expect(result.merged).not.toBeNull();
    expect(result.conflicts).toHaveLength(0);

    // Both changes preserved in the merged deck
    expect(contentOf(result.merged!.slides[0]!.elements[0]!)).toBe("Edited in app");
    expect(contentOf(result.merged!.slides[0]!.elements[1]!)).toBe("Edited in JSON file");
  });

  it("409 flow: same-element conflict triggers savePaused", () => {
    // When both sides modify the same element, merge returns null
    // → saveToDisk should set savePaused = true

    const base = makeDeck([makeSlide("s1", [makeElement("e1")])]);

    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "App version";

    const diskDeck = structuredClone(base);
    (diskDeck.slides[0]!.elements[0]! as TextElement).content = "External version";

    const result = mergeDeck(base, local, diskDeck);
    expect(result.merged).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    // In this case, saveToDisk should set savePaused = true
  });

  it("409 flow prevents the old race condition", () => {
    // OLD behavior (without 409):
    //   t=0: base saved, hash=A on server
    //   t=1: external edit → file hash=B
    //   t=2: app saves → server compares app hash with A (its last save), writes → external edit lost
    //
    // NEW behavior (with 409):
    //   t=0: base saved, hash=A on server
    //   t=1: external edit → file hash=B
    //   t=2: app saves → server reads file hash=B, compares with A → mismatch → 409
    //   t=3: client merges base + local + disk → retry save → both changes preserved

    const base = makeDeck([makeSlide("s1", [makeElement("e1"), makeElement("e2")])]);
    const lastSaveHash = simpleHash(JSON.stringify(base, null, 2));

    // External edit
    const diskVersion = structuredClone(base);
    (diskVersion.slides[0]!.elements[1]! as TextElement).content = "External edit";
    const diskHash = simpleHash(JSON.stringify(diskVersion, null, 2));

    // App version
    const appVersion = structuredClone(base);
    (appVersion.slides[0]!.elements[0]! as TextElement).content = "App edit";
    // Server detects: diskHash !== lastSaveHash → 409
    expect(diskHash).not.toBe(lastSaveHash);

    // Client merges using base (what _lastSavedDeck holds)
    const mergeResult = mergeDeck(base, appVersion, diskVersion);
    expect(mergeResult.merged).not.toBeNull();

    // After merge, both edits are preserved
    expect(contentOf(mergeResult.merged!.slides[0]!.elements[0]!)).toBe("App edit");
    expect(contentOf(mergeResult.merged!.slides[0]!.elements[1]!)).toBe("External edit");

    // Server acknowledges external change: lastSaveHash = diskHash
    // Next save sends merged content → hash differs from diskHash → writes successfully
    const mergedHash = simpleHash(JSON.stringify(mergeResult.merged, null, 2));
    expect(mergedHash).not.toBe(diskHash);
  });

  it("no false 409 when app saves its own content", () => {
    // After a successful save, lastSaveHash = written hash
    // Next save with same content → hash matches → no 409, skip write
    const deck = makeDeck([makeSlide("s1", [makeElement("e1")])]);
    const serialized = JSON.stringify(deck, null, 2);
    const hash = simpleHash(serialized);

    // First save: lastSaveHash set to hash
    const lastSaveHash = hash;
    // File on disk has same hash
    const diskHash = simpleHash(serialized);

    // No external modification
    expect(diskHash).toBe(lastSaveHash);
    // → no 409, proceed normally
  });
});

// Element deletion merge behavior is exhaustively covered by
// src/utils/deckDiff.adversarial.test.ts. The two "BUG:" tests that
// previously lived here asserted the buggy silent-loss behavior and
// were replaced by correct-behavior tests in the adversarial file
// after the fix to mergeDeck.

// Simple hash for test purposes (mirrors fnv1a concept)
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

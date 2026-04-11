/**
 * Adversarial tests for mergeDeck — targets silent data-loss bugs where
 * the current implementation picks "local wins" when both sides modify
 * the same piece of state, instead of reporting a conflict.
 *
 * Philosophy (decided earlier this session): same-element / same-field
 * conflicts must report conflict so the editor can pause saves and ask
 * the user. Silent overwrites lose work.
 *
 * Every test in this file is written to assert the CORRECT behavior.
 * Tests that fail against current mergeDeck code pinpoint a real bug
 * that needs fixing.
 */
import { describe, it, expect } from "vitest";
import { mergeDeck } from "./deckDiff";
import type { Deck, Slide, SlideElement, TextElement } from "@/types/deck";

// ── Fixtures ──

function el(id: string, content = `content-${id}`): SlideElement {
  return {
    id,
    type: "text",
    content,
    position: { x: 0, y: 0 },
    size: { w: 200, h: 50 },
  } as TextElement;
}

function slide(id: string, elements: SlideElement[] = [el(`${id}-e0`)], overrides: Partial<Slide> = {}): Slide {
  return { id, elements, ...overrides };
}

function deck(slides: Slide[] = [slide("s1")], overrides: Partial<Deck> = {}): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides,
    ...overrides,
  };
}

function contentOf(e: SlideElement): string {
  return (e as TextElement).content;
}

// ─────────────────────────────────────────────────────────────────────
// Element-level merge — deletion bugs
// ─────────────────────────────────────────────────────────────────────

describe("mergeDeck adversarial — element deletion", () => {
  it("respects remote deletion of an untouched element", () => {
    // Both have [e1, e2] initially.
    // Remote deletes e2. Local did not touch anything.
    // Expected: merged deck has [e1] only. (Currently buggy — leftover-IDs
    // loop re-adds local e2 without checking base.)
    const base = deck([slide("s1", [el("e1"), el("e2")])]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.slides[0]!.elements = [remote.slides[0]!.elements[0]!];

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.slides[0]!.elements).toHaveLength(1);
    expect(result.merged!.slides[0]!.elements[0]!.id).toBe("e1");
    expect(result.conflicts).toHaveLength(0);
  });

  it("reports conflict when local modifies an element and remote deletes it", () => {
    // Both have [e1, e2].
    // Local modifies e2's content.
    // Remote deletes e2.
    // Expected: conflict reported, merged === null.
    const base = deck([slide("s1", [el("e1"), el("e2")])]);
    const local = structuredClone(base);
    (local.slides[0]!.elements[1]! as TextElement).content = "modified locally";
    const remote = structuredClone(base);
    remote.slides[0]!.elements = [remote.slides[0]!.elements[0]!];

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]!.elementId).toBe("e2");
  });

  it("reports conflict when local deletes an element and remote modifies it", () => {
    // Symmetric: local deletes e2, remote modifies e2.
    // Expected: conflict reported, merged === null.
    const base = deck([slide("s1", [el("e1"), el("e2")])]);
    const local = structuredClone(base);
    local.slides[0]!.elements = [local.slides[0]!.elements[0]!];
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[1]! as TextElement).content = "modified remotely";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]!.elementId).toBe("e2");
  });

  it("accepts local deletion when remote is untouched", () => {
    const base = deck([slide("s1", [el("e1"), el("e2")])]);
    const local = structuredClone(base);
    local.slides[0]!.elements = [local.slides[0]!.elements[0]!];
    const remote = structuredClone(base);

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.slides[0]!.elements).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slide-level field merge — silent conflict bugs
// ─────────────────────────────────────────────────────────────────────

describe("mergeDeck adversarial — slide-level field conflicts", () => {
  it("reports conflict when both sides modify slide.notes differently", () => {
    const base = deck([slide("s1", [el("e1")], { notes: "base notes" })]);
    const local = structuredClone(base);
    local.slides[0]!.notes = "local notes";
    const remote = structuredClone(base);
    remote.slides[0]!.notes = "remote notes";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    // Either hasSlideConflicts or an explicit conflict entry is acceptable
    expect(result.hasSlideConflicts || result.conflicts.length > 0).toBe(true);
  });

  it("reports conflict when both sides modify slide.background differently", () => {
    const base = deck([slide("s1", [el("e1")], { background: { color: "#000" } })]);
    const local = structuredClone(base);
    local.slides[0]!.background = { color: "#ff0000" };
    const remote = structuredClone(base);
    remote.slides[0]!.background = { color: "#00ff00" };

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.hasSlideConflicts || result.conflicts.length > 0).toBe(true);
  });

  it("reports conflict when both sides modify slide.animations differently", () => {
    const base = deck([slide("s1", [el("e1")], {
      animations: [{ target: "e1", effect: "fadeIn", trigger: "onEnter" }],
    })]);
    const local = structuredClone(base);
    local.slides[0]!.animations = [
      { target: "e1", effect: "fadeIn", trigger: "onClick" },
    ];
    const remote = structuredClone(base);
    remote.slides[0]!.animations = [
      { target: "e1", effect: "slideInLeft", trigger: "onEnter" },
    ];

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.hasSlideConflicts || result.conflicts.length > 0).toBe(true);
  });

  it("still accepts external slide-level change when local is unchanged", () => {
    // Regression guard: the fix should not break existing behavior.
    const base = deck([slide("s1", [el("e1")], { notes: "base notes" })]);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.slides[0]!.notes = "external edit";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.slides[0]!.notes).toBe("external edit");
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deck-level field merge — silent conflict bugs
// ─────────────────────────────────────────────────────────────────────

describe("mergeDeck adversarial — deck-level field conflicts", () => {
  it("reports conflict when both sides modify meta.title differently", () => {
    const base = deck([slide("s1")]);
    base.meta.title = "Base Title";
    const local = structuredClone(base);
    local.meta.title = "Local Title";
    const remote = structuredClone(base);
    remote.meta.title = "Remote Title";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.hasSlideConflicts || result.conflicts.length > 0).toBe(true);
  });

  it("reports conflict when both sides modify theme differently", () => {
    const base = deck([slide("s1")]);
    base.theme = { slide: { background: { color: "#000" } } };
    const local = structuredClone(base);
    local.theme = { slide: { background: { color: "#111" } } };
    const remote = structuredClone(base);
    remote.theme = { slide: { background: { color: "#222" } } };

    const result = mergeDeck(base, local, remote);
    expect(result.merged).toBeNull();
    expect(result.hasSlideConflicts || result.conflicts.length > 0).toBe(true);
  });

  it("still accepts external deck-level change when local is unchanged", () => {
    // Regression guard: the fix should not break existing behavior.
    const base = deck([slide("s1")]);
    base.meta.title = "Base Title";
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.meta.title = "External Title";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.meta.title).toBe("External Title");
    expect(result.conflicts).toHaveLength(0);
  });

  it("accepts non-conflicting deck-level changes (different fields)", () => {
    // Regression guard: local changed meta, remote changed theme → merge both.
    const base = deck([slide("s1")]);
    base.meta.title = "Base Title";
    const local = structuredClone(base);
    local.meta.title = "Local Title";
    const remote = structuredClone(base);
    remote.theme = { slide: { background: { color: "#abc" } } };

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.meta.title).toBe("Local Title");
    expect(result.merged!.theme).toEqual({ slide: { background: { color: "#abc" } } });
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Regression guard: non-conflicting element changes still merge cleanly
// ─────────────────────────────────────────────────────────────────────

describe("mergeDeck adversarial — regression guards", () => {
  it("merges different-element edits on the same slide without conflict", () => {
    const base = deck([slide("s1", [el("e1", "original"), el("e2", "original")])]);
    const local = structuredClone(base);
    (local.slides[0]!.elements[0]! as TextElement).content = "local edit on e1";
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[1]! as TextElement).content = "remote edit on e2";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(contentOf(result.merged!.slides[0]!.elements[0]!)).toBe("local edit on e1");
    expect(contentOf(result.merged!.slides[0]!.elements[1]!)).toBe("remote edit on e2");
    expect(result.conflicts).toHaveLength(0);
  });

  it("accepts mixed scenario: local adds, remote modifies unrelated", () => {
    const base = deck([slide("s1", [el("e1")])]);
    const local = structuredClone(base);
    local.slides[0]!.elements.push(el("e2", "new local element"));
    const remote = structuredClone(base);
    (remote.slides[0]!.elements[0]! as TextElement).content = "remote edit on e1";

    const result = mergeDeck(base, local, remote);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.slides[0]!.elements).toHaveLength(2);
    expect(contentOf(result.merged!.slides[0]!.elements.find((e) => e.id === "e1")!))
      .toBe("remote edit on e1");
    expect(result.conflicts).toHaveLength(0);
  });
});

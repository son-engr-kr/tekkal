/**
 * Adversarial tests for src/utils/id.ts — specifically syncCounters,
 * which walks the deck and assigns fresh IDs to any duplicates. The
 * dedup path has several places where it can leave dangling references
 * (animation targets, $ref file paths) if it renames an ID in place
 * without updating the sites that point to it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { syncCounters, cloneSlide } from "./id";
import type { Deck, Slide, SlideElement, TextElement, Animation } from "@/types/deck";

function el(id: string, content = `content-${id}`): TextElement {
  return {
    id,
    type: "text",
    content,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
  } as TextElement;
}

function slide(
  id: string,
  elements: SlideElement[] = [],
  overrides: Partial<Slide> = {},
): Slide {
  return { id, elements, ...overrides };
}

function deck(slides: Slide[]): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides,
  };
}

beforeEach(() => {
  // Ensure every test sees a fresh duplicate to rename — syncCounters
  // uses module-level counters that only advance, never reset. Tests
  // that rely on "renamed ID is e101" would be flaky because the
  // counter accumulates across the suite. Instead we assert structural
  // invariants that do not depend on the exact new ID.
});

// ─────────────────────────────────────────────────────────────────────
// Duplicate element ID dedup — animation target remap
// ─────────────────────────────────────────────────────────────────────

describe("syncCounters — duplicate element ID dedup", () => {
  it("renames duplicate element IDs across slides so they are unique", () => {
    // Both slides have an element with ID "e1". syncCounters should
    // rename the second one to something else.
    const d = deck([
      slide("s1", [el("e1")]),
      slide("s2", [el("e1")]),
    ]);
    syncCounters(d);
    const allIds = d.slides.flatMap((s) => s.elements.map((e) => e.id));
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates
    expect(allIds).toContain("e1"); // first occurrence preserved
  });

  it("remaps slide animations when the targeted element is renamed", () => {
    // This is the real bug: if syncCounters renames an element that an
    // animation targets, the animation still points at the old ID. The
    // renderer then silently drops the animation (orphaned target).
    const d = deck([
      slide("s1", [el("e1", "first slide e1")]),
      slide("s2", [el("e1", "second slide e1")], {
        animations: [
          { target: "e1", effect: "fadeIn", trigger: "onEnter" } as Animation,
        ],
      }),
    ]);

    syncCounters(d);

    // After dedup, the second slide's element got a new ID
    const secondSlideEl = d.slides[1]!.elements[0]!;
    expect(secondSlideEl.id).not.toBe("e1");

    // The animation target should now point to that new ID
    const anim = d.slides[1]!.animations![0]!;
    expect(anim.target).toBe(secondSlideEl.id);
  });

  it("remaps comment elementId references when the element is renamed", () => {
    const d = deck([
      slide("s1", [el("e1")]),
      slide("s2", [el("e1")], {
        comments: [
          { id: "c1", elementId: "e1", text: "review this", createdAt: 1 },
        ],
      }),
    ]);

    syncCounters(d);

    const newElId = d.slides[1]!.elements[0]!.id;
    expect(newElId).not.toBe("e1");
    const comment = d.slides[1]!.comments![0]!;
    expect(comment.elementId).toBe(newElId);
  });
});

describe("syncCounters — duplicate slide ID dedup", () => {
  it("renames duplicate slide IDs", () => {
    const d = deck([slide("s1"), slide("s1")]);
    syncCounters(d);
    const ids = d.slides.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("s1");
  });

  it("updates the _ref path of a renamed slide to match its new ID", () => {
    // A slide's _ref is "./slides/${slide.id}.json" — when we rename
    // the slide's ID, the _ref should either be cleared (so a fresh
    // write creates a new file) or updated to the new name. Leaving it
    // stale means the next save writes to the wrong path, leaking data
    // or colliding with a different slide's file.
    const d = deck([
      slide("s1", [], { _ref: "./slides/s1.json" } as unknown as Partial<Slide>),
      slide("s1", [], { _ref: "./slides/s1.json" } as unknown as Partial<Slide>),
    ]);
    syncCounters(d);

    const first = d.slides[0]!;
    const second = d.slides[1]!;
    // First slide keeps its original _ref (matches its preserved ID)
    expect((first as unknown as { _ref?: string })._ref).toBe("./slides/s1.json");
    // Second slide's ref must match its new ID, not the old "s1"
    const secondRef = (second as unknown as { _ref?: string })._ref;
    if (secondRef !== undefined) {
      expect(secondRef).toBe(`./slides/${second.id}.json`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// cloneSlide — regression guard (this one is correct already, ensure
// it stays correct)
// ─────────────────────────────────────────────────────────────────────

describe("cloneSlide — regression guards", () => {
  it("gives the clone a fresh slide ID and fresh element IDs", () => {
    const source = slide("s1", [el("e1"), el("e2")]);
    const clone = cloneSlide(source);
    expect(clone.id).not.toBe("s1");
    expect(clone.elements.map((e) => e.id)).not.toEqual(["e1", "e2"]);
    expect(new Set(clone.elements.map((e) => e.id)).size).toBe(2);
  });

  it("remaps animation targets to the new element IDs", () => {
    const source = slide("s1", [el("e1"), el("e2")], {
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onEnter" } as Animation,
        { target: "e2", effect: "slideInLeft", trigger: "onClick" } as Animation,
      ],
    });
    const clone = cloneSlide(source);
    const idMap = new Map<string, string>();
    idMap.set("e1", clone.elements[0]!.id);
    idMap.set("e2", clone.elements[1]!.id);
    expect(clone.animations![0]!.target).toBe(clone.elements[0]!.id);
    expect(clone.animations![1]!.target).toBe(clone.elements[1]!.id);
  });

  it("remaps comment elementId references to the new element IDs", () => {
    const source = slide("s1", [el("e1")], {
      comments: [
        { id: "c1", elementId: "e1", text: "check", createdAt: 1 },
      ],
    });
    const clone = cloneSlide(source);
    expect(clone.comments![0]!.elementId).toBe(clone.elements[0]!.id);
  });

  it("strips the _ref field on the clone (clone belongs to a new file)", () => {
    const source = slide(
      "s1",
      [el("e1")],
      { _ref: "./slides/s1.json" } as unknown as Partial<Slide>,
    );
    const clone = cloneSlide(source);
    expect((clone as unknown as { _ref?: string })._ref).toBeUndefined();
  });
});

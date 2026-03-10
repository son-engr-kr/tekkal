import { describe, it, expect, beforeEach } from "vitest";
import { useDeckStore } from "./deckStore";
import type { Animation, Deck, Slide, SlideElement } from "@/types/deck";

// -- Test fixtures --

function makeElement(id: string, x = 100, y = 100): SlideElement {
  return {
    id,
    type: "text",
    content: `Element ${id}`,
    position: { x, y },
    size: { w: 200, h: 50 },
  };
}

function makeSlide(id: string, elements: SlideElement[] = []): Slide {
  return { id, elements };
}

function makeDeck(slideCount = 3): Deck {
  const slides = Array.from({ length: slideCount }, (_, i) =>
    makeSlide(`s${i}`, [makeElement(`e${i}-0`)])
  );
  return {
    deckode: "0.1.0",
    meta: { title: "Test Deck", aspectRatio: "16:9" },
    slides,
  };
}

// Reset store before each test
beforeEach(() => {
  useDeckStore.setState({
    currentProject: null,
    deck: null,
    currentSlideIndex: 0,
    selectedElementIds: [],
    isDirty: false,
    isSaving: false,
  });
});

// ============================================================
// openProject / closeProject
// ============================================================

describe("deckStore - openProject / closeProject", () => {
  it("openProject sets currentProject and loads deck", () => {
    const deck = makeDeck();
    useDeckStore.getState().openProject("my-slides", deck);

    const state = useDeckStore.getState();
    expect(state.currentProject).toBe("my-slides");
    assert(state.deck !== null, "deck should be loaded");
    expect(state.deck.slides).toHaveLength(3);
    expect(state.currentSlideIndex).toBe(0);
    expect(state.selectedElementIds).toEqual([]);
    expect(state.isDirty).toBe(false);
  });

  it("closeProject clears all state", () => {
    useDeckStore.getState().openProject("my-slides", makeDeck());
    useDeckStore.getState().setCurrentSlide(2);
    useDeckStore.getState().selectElement("e2-0");

    useDeckStore.getState().closeProject();

    const state = useDeckStore.getState();
    expect(state.currentProject).toBeNull();
    expect(state.deck).toBeNull();
    expect(state.currentSlideIndex).toBe(0);
    expect(state.selectedElementIds).toEqual([]);
    expect(state.isDirty).toBe(false);
  });
});

// ============================================================
// Basic CRUD actions
// ============================================================

describe("deckStore - basic actions", () => {
  it("loadDeck sets deck and resets state", () => {
    const deck = makeDeck();
    useDeckStore.getState().loadDeck(deck);

    const state = useDeckStore.getState();
    assert(state.deck !== null, "deck should be loaded");
    expect(state.deck.slides).toHaveLength(3);
    expect(state.currentSlideIndex).toBe(0);
    expect(state.selectedElementIds).toEqual([]);
    expect(state.isDirty).toBe(false);
  });

  it("setCurrentSlide changes slide index and clears selection", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().selectElement("e0-0");
    useDeckStore.getState().setCurrentSlide(2);

    expect(useDeckStore.getState().currentSlideIndex).toBe(2);
    expect(useDeckStore.getState().selectedElementIds).toEqual([]);
  });

  it("setCurrentSlide throws on out-of-bounds index", () => {
    useDeckStore.getState().loadDeck(makeDeck(2));
    expect(() => useDeckStore.getState().setCurrentSlide(5)).toThrow();
    expect(() => useDeckStore.getState().setCurrentSlide(-1)).toThrow();
  });

  it("nextSlide / prevSlide navigates correctly", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));

    useDeckStore.getState().nextSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);

    useDeckStore.getState().nextSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(2);

    // Should not go past the last slide
    useDeckStore.getState().nextSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(2);

    useDeckStore.getState().prevSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);

    useDeckStore.getState().prevSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(0);

    // Should not go below 0
    useDeckStore.getState().prevSlide();
    expect(useDeckStore.getState().currentSlideIndex).toBe(0);
  });

  it("addSlide appends to end by default", () => {
    useDeckStore.getState().loadDeck(makeDeck(2));
    useDeckStore.getState().addSlide(makeSlide("new-slide"));

    const slides = useDeckStore.getState().deck!.slides;
    expect(slides).toHaveLength(3);
    expect(slides[2]!.id).toBe("new-slide");
  });

  it("deleteSlide clamps currentSlideIndex", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));
    useDeckStore.getState().setCurrentSlide(2); // last slide

    useDeckStore.getState().deleteSlide("s2");

    expect(useDeckStore.getState().deck!.slides).toHaveLength(2);
    // Index should be clamped to 1 (new last slide)
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);
  });

  it("addElement / deleteElement work correctly", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    const newEl = makeElement("new-el");
    useDeckStore.getState().addElement("s0", newEl);

    const slide = useDeckStore.getState().deck!.slides[0]!;
    expect(slide.elements).toHaveLength(2);
    expect(slide.elements[1]!.id).toBe("new-el");

    useDeckStore.getState().deleteElement("s0", "new-el");
    expect(useDeckStore.getState().deck!.slides[0]!.elements).toHaveLength(1);
  });

  it("deleteElement removes deleted element from selectedElementIds", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().selectElement("e0-0");
    expect(useDeckStore.getState().selectedElementIds).toEqual(["e0-0"]);

    useDeckStore.getState().deleteElement("s0", "e0-0");
    expect(useDeckStore.getState().selectedElementIds).toEqual([]);
  });
});

// ============================================================
// BUG REGRESSION: Dragging element resets view to slide 1
// Root cause: updateElement (or any store mutation) must NOT
// change currentSlideIndex.
// ============================================================

describe("deckStore - BUG: drag element must not reset slide index", () => {
  it("updateElement preserves currentSlideIndex", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));
    useDeckStore.getState().setCurrentSlide(2);

    // Simulate dragging an element on slide 2
    useDeckStore.getState().updateElement("s2", "e2-0", {
      position: { x: 300, y: 200 },
    });

    // CRITICAL: index must still be 2
    expect(useDeckStore.getState().currentSlideIndex).toBe(2);
  });

  it("updateElement preserves selectedElementIds", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));
    useDeckStore.getState().setCurrentSlide(1);
    useDeckStore.getState().selectElement("e1-0");

    useDeckStore.getState().updateElement("s1", "e1-0", {
      position: { x: 500, y: 300 },
    });

    expect(useDeckStore.getState().selectedElementIds).toEqual(["e1-0"]);
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);
  });

  it("multiple rapid updateElement calls preserve slide index", () => {
    useDeckStore.getState().loadDeck(makeDeck(5));
    useDeckStore.getState().setCurrentSlide(4);

    // Simulate rapid drag (many mousemove events)
    for (let i = 0; i < 20; i++) {
      useDeckStore.getState().updateElement("s4", "e4-0", {
        position: { x: 100 + i * 5, y: 100 + i * 3 },
      });
    }

    expect(useDeckStore.getState().currentSlideIndex).toBe(4);
  });
});

// ============================================================
// BUG REGRESSION: replaceDeck must NOT reset slide index
// (CodePanel bidirectional sync uses replaceDeck)
// ============================================================

describe("deckStore - replaceDeck vs loadDeck", () => {
  it("loadDeck preserves currentSlideIndex", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));
    useDeckStore.getState().setCurrentSlide(2);

    // loadDeck should preserve current position
    useDeckStore.getState().loadDeck(makeDeck(3));
    expect(useDeckStore.getState().currentSlideIndex).toBe(2);
  });

  it("loadDeck clamps index when slides are removed", () => {
    useDeckStore.getState().loadDeck(makeDeck(5));
    useDeckStore.getState().setCurrentSlide(4);

    // Reload with fewer slides — index should clamp
    useDeckStore.getState().loadDeck(makeDeck(2));
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);
  });

  it("replaceDeck preserves currentSlideIndex", () => {
    useDeckStore.getState().loadDeck(makeDeck(5));
    useDeckStore.getState().setCurrentSlide(3);
    useDeckStore.getState().selectElement("e3-0");

    // Simulate CodePanel editing JSON and calling replaceDeck
    const modifiedDeck = makeDeck(5);
    modifiedDeck.slides[3]!.elements[0]!.position = { x: 999, y: 999 };
    useDeckStore.getState().replaceDeck(modifiedDeck);

    // CRITICAL: replaceDeck must NOT reset index
    expect(useDeckStore.getState().currentSlideIndex).toBe(3);
  });

  it("replaceDeck clamps index when slides are removed", () => {
    useDeckStore.getState().loadDeck(makeDeck(5));
    useDeckStore.getState().setCurrentSlide(4); // last slide

    // Replace with fewer slides
    const smallerDeck = makeDeck(2);
    useDeckStore.getState().replaceDeck(smallerDeck);

    // Index should be clamped, not left at 4
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);
  });

  it("replaceDeck sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck(3));
    expect(useDeckStore.getState().isDirty).toBe(false);

    useDeckStore.getState().replaceDeck(makeDeck(3));
    expect(useDeckStore.getState().isDirty).toBe(true);
  });
});

// ============================================================
// isDirty flag correctness
// ============================================================

describe("deckStore - isDirty tracking", () => {
  it("loadDeck sets isDirty to false", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    expect(useDeckStore.getState().isDirty).toBe(false);
  });

  it("updateElement sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().updateElement("s0", "e0-0", {
      position: { x: 1, y: 1 },
    });
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("addSlide sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().addSlide(makeSlide("new"));
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("deleteSlide sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().deleteSlide("s0");
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("addElement sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().addElement("s0", makeElement("new"));
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("deleteElement sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck());
    useDeckStore.getState().deleteElement("s0", "e0-0");
    expect(useDeckStore.getState().isDirty).toBe(true);
  });
});

// ============================================================
// duplicateElement
// ============================================================

describe("deckStore - duplicateElement", () => {
  it("creates a copy with new id and offset position", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().duplicateElement("s0", "e0-0");

    const elements = useDeckStore.getState().deck!.slides[0]!.elements;
    expect(elements).toHaveLength(2);
    const clone = elements[1]!;
    expect(clone.id).not.toBe("e0-0");
    expect(clone.position.x).toBe(120); // original 100 + 20 offset
    expect(clone.position.y).toBe(120);
  });

  it("selects the duplicated element", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().duplicateElement("s0", "e0-0");

    const elements = useDeckStore.getState().deck!.slides[0]!.elements;
    expect(useDeckStore.getState().selectedElementIds).toEqual([elements[1]!.id]);
  });
});

// ============================================================
// moveSlide
// ============================================================

describe("deckStore - moveSlide", () => {
  it("reorders slides correctly", () => {
    useDeckStore.getState().loadDeck(makeDeck(4));
    useDeckStore.getState().moveSlide(0, 2);

    const ids = useDeckStore.getState().deck!.slides.map((s) => s.id);
    expect(ids).toEqual(["s1", "s2", "s0", "s3"]);
  });

  it("updates currentSlideIndex when the viewed slide is moved", () => {
    useDeckStore.getState().loadDeck(makeDeck(4));
    useDeckStore.getState().setCurrentSlide(0);

    useDeckStore.getState().moveSlide(0, 3);
    expect(useDeckStore.getState().currentSlideIndex).toBe(3);
  });

  it("adjusts currentSlideIndex when a slide moves past the current", () => {
    useDeckStore.getState().loadDeck(makeDeck(4));
    useDeckStore.getState().setCurrentSlide(2);

    // Move slide 0 to index 3 (past current)
    useDeckStore.getState().moveSlide(0, 3);
    // Current was at 2, a slide before it moved away → index decrements
    expect(useDeckStore.getState().currentSlideIndex).toBe(1);
  });
});

// ============================================================
// Animation CRUD
// ============================================================

describe("deckStore - animation CRUD", () => {
  it("addAnimation creates animations array if undefined and pushes", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    const slide = useDeckStore.getState().deck!.slides[0]!;
    expect(slide.animations).toBeUndefined();

    const anim: Animation = { target: "e0-0", trigger: "onEnter", effect: "fadeIn", duration: 500 };
    useDeckStore.getState().addAnimation("s0", anim);

    const updated = useDeckStore.getState().deck!.slides[0]!;
    expect(updated.animations).toHaveLength(1);
    expect(updated.animations![0]!.effect).toBe("fadeIn");
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("addAnimation appends to existing animations", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "scaleIn" });

    expect(useDeckStore.getState().deck!.slides[0]!.animations).toHaveLength(2);
  });

  it("updateAnimation patches the animation at given index", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn", duration: 500 });
    useDeckStore.getState().updateAnimation("s0", 0, { effect: "slideInLeft", delay: 200 });

    const anim = useDeckStore.getState().deck!.slides[0]!.animations![0]!;
    expect(anim.effect).toBe("slideInLeft");
    expect(anim.delay).toBe(200);
    expect(anim.trigger).toBe("onEnter"); // unchanged
  });

  it("updateAnimation throws on out-of-bounds index", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    expect(() => useDeckStore.getState().updateAnimation("s0", 0, { effect: "fadeOut" })).toThrow();
  });

  it("deleteAnimation removes the animation at given index", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "scaleIn" });

    useDeckStore.getState().deleteAnimation("s0", 0);

    const anims = useDeckStore.getState().deck!.slides[0]!.animations!;
    expect(anims).toHaveLength(1);
    expect(anims[0]!.effect).toBe("scaleIn");
  });

  it("deleteAnimation throws on out-of-bounds index", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    expect(() => useDeckStore.getState().deleteAnimation("s0", 0)).toThrow();
  });
});

// ============================================================
// moveAnimation
// ============================================================

describe("deckStore - moveAnimation", () => {
  it("moves animation from one position to another", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "scaleIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "slideInLeft" });

    useDeckStore.getState().moveAnimation("s0", 0, 2);

    const anims = useDeckStore.getState().deck!.slides[0]!.animations!;
    expect(anims[0]!.effect).toBe("scaleIn");
    expect(anims[1]!.effect).toBe("slideInLeft");
    expect(anims[2]!.effect).toBe("fadeIn");
  });

  it("sets isDirty to true", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "scaleIn" });

    // Reset isDirty
    useDeckStore.setState({ isDirty: false });

    useDeckStore.getState().moveAnimation("s0", 0, 1);
    expect(useDeckStore.getState().isDirty).toBe(true);
  });

  it("throws on out-of-bounds indices", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });

    expect(() => useDeckStore.getState().moveAnimation("s0", -1, 0)).toThrow();
    expect(() => useDeckStore.getState().moveAnimation("s0", 0, 5)).toThrow();
  });

  it("throws when slide has no animations", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    expect(() => useDeckStore.getState().moveAnimation("s0", 0, 0)).toThrow();
  });
});

// ============================================================
// deleteElement cleans up animations
// ============================================================

describe("deckStore - deleteElement cleans up animations", () => {
  it("removes animations targeting the deleted element", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    // Add a second element so the slide isn't empty after deletion
    useDeckStore.getState().addElement("s0", makeElement("other"));
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onEnter", effect: "fadeIn" });
    useDeckStore.getState().addAnimation("s0", { target: "other", trigger: "onEnter", effect: "scaleIn" });
    useDeckStore.getState().addAnimation("s0", { target: "e0-0", trigger: "onClick", effect: "slideInLeft" });

    useDeckStore.getState().deleteElement("s0", "e0-0");

    const anims = useDeckStore.getState().deck!.slides[0]!.animations!;
    expect(anims).toHaveLength(1);
    expect(anims[0]!.target).toBe("other");
  });

  it("handles deletion when no animations exist", () => {
    useDeckStore.getState().loadDeck(makeDeck(1));
    // No animations on this slide — should not throw
    useDeckStore.getState().deleteElement("s0", "e0-0");
    expect(useDeckStore.getState().deck!.slides[0]!.elements).toHaveLength(0);
  });
});

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

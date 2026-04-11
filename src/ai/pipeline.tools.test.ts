/**
 * Tests for every tool branch of executeTool in pipeline.ts.
 *
 * Strategy: load a fixture deck via useDeckStore.openProject, call
 * executeTool(...), assert on the resulting store state or returned string.
 * The store is a plain Zustand state container with no I/O, so this runs fast
 * in the default node environment without mocking.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeTool } from "./pipeline";
import { useDeckStore } from "@/stores/deckStore";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  ImageElement,
  ShapeElement,
} from "@/types/deck";

// ── Fixtures ──

function text(id: string, content = "", overrides: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: "text",
    content,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    ...overrides,
  } as TextElement;
}

function image(id: string, src = "./img.png", overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id,
    type: "image",
    src,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    ...overrides,
  } as ImageElement;
}

function shape(
  id: string,
  shapeKind: "rectangle" | "ellipse" | "arrow" | "line" = "rectangle",
  overrides: Partial<ShapeElement> = {},
): ShapeElement {
  return {
    id,
    type: "shape",
    shape: shapeKind,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    ...overrides,
  } as ShapeElement;
}

function slide(id: string, elements: SlideElement[] = [], overrides: Partial<Slide> = {}): Slide {
  return { id, elements, ...overrides };
}

function testDeck(slides: Slide[] = [], overrides: Partial<Deck> = {}): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test Deck", aspectRatio: "16:9" },
    slides,
    ...overrides,
  };
}

function loadDeck(deck: Deck): void {
  useDeckStore.getState().openProject("test-project", deck);
}

function getDeck(): Deck {
  const d = useDeckStore.getState().deck;
  if (!d) throw new Error("No deck loaded in test");
  return d;
}

beforeEach(() => {
  useDeckStore.getState().closeProject();
});

// ─────────────────────────────────────────────────────────────────────
// No deck loaded — top-level guard paths
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — no deck loaded", () => {
  // Tools that require a loaded deck to operate on. Not every tool does:
  // restore, list_snapshots, and undo/redo can run without a deck loaded
  // because they inspect their own state (snapshots map / temporal history).
  const tools = [
    "read_deck",
    "read_slide",
    "read_element",
    "get_slide_outline",
    "find_elements",
    "list_slide_titles",
    "search_text",
    "count_elements",
    "move_element",
    "resize_element",
    "align_elements",
    "distribute_elements",
    "apply_style_to_all",
    "set_image_alt",
    "crop_image",
    "diff_against_snapshot",
    "merge_slides",
    "split_slide",
    "duplicate_slide",
    "reorder_slides",
    "move_slide",
    "check_overlaps",
    "check_contrast",
    "lint_slide",
    "list_animations",
    "add_comment",
    "change_z_order",
  ];

  for (const name of tools) {
    it(`${name} returns "No deck loaded." when deck is null`, async () => {
      const result = await executeTool(name, { slideId: "s1", elementId: "e1" });
      expect(result).toMatch(/No deck loaded/);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Read tools
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — read_deck", () => {
  it("returns summary JSON with title, slideCount, and per-slide metadata", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "# Intro")]),
      slide("s2", [text("e2", "# Body"), image("e3", "./foo.png", { alt: "diagram" })]),
    ]));
    const result = await executeTool("read_deck", {});
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe("Test Deck");
    expect(parsed.slideCount).toBe(2);
    expect(parsed.slides).toHaveLength(2);
    expect(parsed.slides[0].id).toBe("s1");
    expect(parsed.slides[0].title).toBe("Intro");
    expect(parsed.slides[1].elementCount).toBe(2);
    expect(parsed.slides[1].elementTypes).toContain("text");
    expect(parsed.slides[1].elementTypes).toContain("image");
  });
});

describe("executeTool — read_slide", () => {
  it("returns full slide JSON for an existing slide", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "hello")])]));
    const result = await executeTool("read_slide", { slideId: "s1" });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("s1");
    expect(parsed.elements).toHaveLength(1);
  });

  it("returns not-found message for unknown slide", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("read_slide", { slideId: "s99" });
    expect(result).toMatch(/not found/);
  });
});

describe("executeTool — read_element", () => {
  it("returns full element JSON", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "hello"), text("e2", "world")])]));
    const result = await executeTool("read_element", { slideId: "s1", elementId: "e2" });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("e2");
    expect(parsed.content).toBe("world");
  });

  it("errors on unknown slide", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("read_element", { slideId: "s99", elementId: "e1" });
    expect(result).toMatch(/not found/);
  });

  it("errors on unknown element", async () => {
    loadDeck(testDeck([slide("s1", [text("e1")])]));
    const result = await executeTool("read_element", { slideId: "s1", elementId: "e99" });
    expect(result).toMatch(/not found/);
  });
});

describe("executeTool — get_slide_outline", () => {
  it("returns one line per element with id, type, and coordinates", async () => {
    loadDeck(testDeck([
      slide("s1", [
        text("e1", "Title text", { position: { x: 10, y: 20 } }),
        shape("e2", "rectangle", { position: { x: 30, y: 40 } }),
      ]),
    ]));
    const result = await executeTool("get_slide_outline", { slideId: "s1" });
    expect(result).toMatch(/e1 text pos=\(10,20\)/);
    expect(result).toMatch(/e2 shape pos=\(30,40\)/);
  });

  it("errors on unknown slide", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("get_slide_outline", { slideId: "s99" });
    expect(result).toMatch(/not found/);
  });
});

describe("executeTool — find_elements", () => {
  it("filters by type across slides", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "alpha"), image("e2")]),
      slide("s2", [text("e3", "beta"), image("e4", "./bar.png", { alt: "bar" })]),
    ]));
    const result = await executeTool("find_elements", { type: "image" });
    const parsed = JSON.parse(result);
    expect(parsed.matchCount).toBe(2);
    expect(parsed.matches.map((m: { elementId: string }) => m.elementId)).toEqual(["e2", "e4"]);
  });

  it("filters by textContains case-insensitively", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "Alpha Beta Gamma")]),
      slide("s2", [text("e2", "delta epsilon")]),
    ]));
    const result = await executeTool("find_elements", { textContains: "BETA" });
    const parsed = JSON.parse(result);
    expect(parsed.matchCount).toBe(1);
    expect(parsed.matches[0].elementId).toBe("e1");
  });

  it("honors slideRange 1-indexed inclusive", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "one")]),
      slide("s2", [text("e2", "two")]),
      slide("s3", [text("e3", "three")]),
      slide("s4", [text("e4", "four")]),
    ]));
    const result = await executeTool("find_elements", { slideRange: [2, 3] });
    const parsed = JSON.parse(result);
    expect(parsed.matchCount).toBe(2);
    expect(parsed.matches.map((m: { slideId: string }) => m.slideId)).toEqual(["s2", "s3"]);
  });
});

describe("executeTool — list_slide_titles", () => {
  it("returns one line per slide with extracted title", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "# Intro")]),
      slide("s2", [text("e2", "# Body")]),
    ]));
    const result = await executeTool("list_slide_titles", {});
    expect(result).toMatch(/1\. \[s1\] Intro/);
    expect(result).toMatch(/2\. \[s2\] Body/);
  });

  it("labels slides with no title", async () => {
    loadDeck(testDeck([slide("s1", [])]));
    const result = await executeTool("list_slide_titles", {});
    expect(result).toMatch(/\[s1\] <no title>/);
  });
});

describe("executeTool — search_text", () => {
  it("finds matches in text element content", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "The fox jumps over")])]));
    const result = await executeTool("search_text", { query: "fox" });
    expect(result).toMatch(/1 match/);
    expect(result).toMatch(/s1.*text/);
  });

  it("finds matches in image alt/caption when enabled", async () => {
    loadDeck(testDeck([
      slide("s1", [image("img1", "./a.png", { alt: "the quick brown fox" })]),
    ]));
    const result = await executeTool("search_text", { query: "fox" });
    expect(result).toMatch(/img1/);
  });

  it("searches notes when includeNotes is true", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "body")], { notes: "speaker says fox runs" }),
    ]));
    const withNotes = await executeTool("search_text", { query: "fox", includeNotes: true });
    expect(withNotes).toMatch(/notes/);
    const withoutNotes = await executeTool("search_text", { query: "fox" });
    expect(withoutNotes).toMatch(/No matches/);
  });

  it("returns 'No matches' message when nothing matches", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "alpha")])]));
    const result = await executeTool("search_text", { query: "zebra" });
    expect(result).toMatch(/No matches/);
  });

  it("rejects empty query", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("search_text", { query: "" });
    expect(result).toMatch(/empty query/);
  });
});

describe("executeTool — count_elements", () => {
  it("counts by type across the whole deck", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1"), text("e2"), image("e3")]),
      slide("s2", [text("e4"), shape("e5"), shape("e6")]),
    ]));
    const result = await executeTool("count_elements", {});
    expect(result).toMatch(/6 elements/);
    expect(result).toMatch(/text: 3/);
    expect(result).toMatch(/shape: 2/);
    expect(result).toMatch(/image: 1/);
  });

  it("honors slideRange", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1"), text("e2")]),
      slide("s2", [shape("e3")]),
      slide("s3", [image("e4")]),
    ]));
    const result = await executeTool("count_elements", { slideRange: [2, 2] });
    expect(result).toMatch(/1 elements/);
    expect(result).toMatch(/shape: 1/);
    expect(result).not.toMatch(/text:/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Element CRUD and layout
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — add_element / update_element / delete_element", () => {
  it("add_element appends and reports success", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("add_element", {
      slideId: "s1",
      element: { id: "new", type: "text", content: "hi", position: { x: 0, y: 0 }, size: { w: 10, h: 10 } },
    });
    expect(getDeck().slides[0]!.elements).toHaveLength(1);
    expect(getDeck().slides[0]!.elements[0]!.id).toBe("new");
  });

  it("update_element patches fields", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "old")])]));
    await executeTool("update_element", {
      slideId: "s1",
      elementId: "e1",
      patch: { content: "new" },
    });
    const el = getDeck().slides[0]!.elements[0] as TextElement;
    expect(el.content).toBe("new");
  });

  it("delete_element removes the element", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    await executeTool("delete_element", { slideId: "s1", elementId: "e1" });
    expect(getDeck().slides[0]!.elements).toHaveLength(1);
    expect(getDeck().slides[0]!.elements[0]!.id).toBe("e2");
  });
});

describe("executeTool — move_element", () => {
  it("updates x and y", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "", { position: { x: 0, y: 0 } })])]));
    await executeTool("move_element", { slideId: "s1", elementId: "e1", x: 100, y: 200 });
    const el = getDeck().slides[0]!.elements[0]!;
    expect(el.position).toEqual({ x: 100, y: 200 });
  });

  it("allows partial updates (only x)", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "", { position: { x: 50, y: 50 } })])]));
    await executeTool("move_element", { slideId: "s1", elementId: "e1", x: 100 });
    const el = getDeck().slides[0]!.elements[0]!;
    expect(el.position).toEqual({ x: 100, y: 50 });
  });

  it("errors on missing element", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("move_element", { slideId: "s1", elementId: "ghost", x: 0 });
    expect(result).toMatch(/not found/);
  });
});

describe("executeTool — resize_element", () => {
  it("updates w and h with default top-left anchor", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "", { position: { x: 100, y: 100 }, size: { w: 50, h: 50 } })])]));
    await executeTool("resize_element", { slideId: "s1", elementId: "e1", w: 200, h: 100 });
    const el = getDeck().slides[0]!.elements[0]!;
    expect(el.size.w).toBe(200);
    expect(el.size.h).toBe(100);
    // top-left anchor: position unchanged
    expect(el.position).toEqual({ x: 100, y: 100 });
  });

  it("center anchor shifts position so center stays fixed", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "", { position: { x: 100, y: 100 }, size: { w: 100, h: 100 } })])]));
    await executeTool("resize_element", {
      slideId: "s1", elementId: "e1", w: 200, h: 200, anchor: "center",
    });
    const el = getDeck().slides[0]!.elements[0]!;
    // dw=100, dh=100 → shift by -50, -50
    expect(el.position).toEqual({ x: 50, y: 50 });
  });

  it("bottom-right anchor shifts by full delta", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "", { position: { x: 100, y: 100 }, size: { w: 100, h: 100 } })])]));
    await executeTool("resize_element", {
      slideId: "s1", elementId: "e1", w: 150, h: 150, anchor: "bottom-right",
    });
    const el = getDeck().slides[0]!.elements[0]!;
    // dw=50, dh=50 → shift by -50, -50
    expect(el.position).toEqual({ x: 50, y: 50 });
  });
});

describe("executeTool — align_elements", () => {
  it("aligns three elements to the left edge of the bounding box", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 50, y: 0 }, size: { w: 100, h: 50 } }),
      text("e2", "", { position: { x: 100, y: 60 }, size: { w: 100, h: 50 } }),
      text("e3", "", { position: { x: 150, y: 120 }, size: { w: 100, h: 50 } }),
    ])]));
    await executeTool("align_elements", {
      slideId: "s1",
      elementIds: ["e1", "e2", "e3"],
      alignment: "left",
    });
    const s = getDeck().slides[0]!;
    expect(s.elements[0]!.position.x).toBe(50);
    expect(s.elements[1]!.position.x).toBe(50);
    expect(s.elements[2]!.position.x).toBe(50);
  });

  it("aligns to horizontal center of bounding box", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      text("e2", "", { position: { x: 200, y: 60 }, size: { w: 200, h: 50 } }),
    ])]));
    await executeTool("align_elements", {
      slideId: "s1",
      elementIds: ["e1", "e2"],
      alignment: "center",
    });
    const s = getDeck().slides[0]!;
    // bounding box: minX=0 to maxX=400, center=200
    // e1 (w=100) → x = 200 - 50 = 150
    // e2 (w=200) → x = 200 - 100 = 100
    expect(s.elements[0]!.position.x).toBe(150);
    expect(s.elements[1]!.position.x).toBe(100);
  });

  it("rejects fewer than 2 elements", async () => {
    loadDeck(testDeck([slide("s1", [text("e1")])]));
    const result = await executeTool("align_elements", {
      slideId: "s1", elementIds: ["e1"], alignment: "left",
    });
    expect(result).toMatch(/ERROR.*needs at least 2/);
  });

  it("rejects unknown alignment", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    const result = await executeTool("align_elements", {
      slideId: "s1", elementIds: ["e1", "e2"], alignment: "diagonal",
    });
    expect(result).toMatch(/Unknown alignment/);
  });
});

describe("executeTool — distribute_elements", () => {
  it("distributes horizontally with even gaps", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      text("e2", "", { position: { x: 200, y: 0 }, size: { w: 100, h: 50 } }),
      text("e3", "", { position: { x: 800, y: 0 }, size: { w: 100, h: 50 } }),
    ])]));
    await executeTool("distribute_elements", {
      slideId: "s1",
      elementIds: ["e1", "e2", "e3"],
      axis: "horizontal",
    });
    const s = getDeck().slides[0]!;
    // first at 0, last at 800 → total width 100+100+100=300, span 900-0=900, gap = (900-300)/2 = 300
    // e1: 0, e2: 0+100+300=400, e3: 400+100+300=800
    expect(s.elements[0]!.position.x).toBe(0);
    expect(s.elements[1]!.position.x).toBe(400);
    expect(s.elements[2]!.position.x).toBe(800);
  });

  it("rejects fewer than 3 elements", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    const result = await executeTool("distribute_elements", {
      slideId: "s1", elementIds: ["e1", "e2"], axis: "horizontal",
    });
    expect(result).toMatch(/ERROR.*needs at least 3/);
  });
});

describe("executeTool — bring_to_front / send_to_back / change_z_order", () => {
  it("bring_to_front moves element to the last position in the order", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2"), text("e3")])]));
    await executeTool("bring_to_front", { slideId: "s1", elementId: "e1" });
    const ids = getDeck().slides[0]!.elements.map((e) => e.id);
    expect(ids[ids.length - 1]).toBe("e1");
  });

  it("send_to_back moves element to the first position", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2"), text("e3")])]));
    await executeTool("send_to_back", { slideId: "s1", elementId: "e3" });
    const ids = getDeck().slides[0]!.elements.map((e) => e.id);
    expect(ids[0]).toBe("e3");
  });

  it("change_z_order shifts by positive delta", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2"), text("e3")])]));
    await executeTool("change_z_order", { slideId: "s1", elementId: "e1", delta: 1 });
    const ids = getDeck().slides[0]!.elements.map((e) => e.id);
    expect(ids).toEqual(["e2", "e1", "e3"]);
  });

  it("change_z_order clamps at boundaries", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    const result = await executeTool("change_z_order", { slideId: "s1", elementId: "e1", delta: -5 });
    expect(result).toMatch(/already at/);
  });
});

describe("executeTool — duplicate_element", () => {
  it("creates a new element via store.duplicateElement", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "hello")])]));
    await executeTool("duplicate_element", { slideId: "s1", elementId: "e1" });
    expect(getDeck().slides[0]!.elements.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slide structure
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — add_slide / update_slide / delete_slide", () => {
  it("add_slide rejects duplicate ID", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("add_slide", {
      slide: { id: "s1", elements: [] },
    });
    expect(result).toMatch(/ERROR.*already exists/);
  });

  it("add_slide with afterSlideId inserts after the named slide", async () => {
    loadDeck(testDeck([slide("s1"), slide("s3")]));
    await executeTool("add_slide", {
      slide: { id: "s2", elements: [] },
      afterSlideId: "s1",
    });
    const ids = getDeck().slides.map((s) => s.id);
    expect(ids).toEqual(["s1", "s2", "s3"]);
  });

  it("update_slide patches fields", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("update_slide", { slideId: "s1", patch: { notes: "new notes" } });
    expect(getDeck().slides[0]!.notes).toBe("new notes");
  });

  it("delete_slide removes the slide", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2")]));
    await executeTool("delete_slide", { slideId: "s1" });
    expect(getDeck().slides).toHaveLength(1);
    expect(getDeck().slides[0]!.id).toBe("s2");
  });
});

describe("executeTool — duplicate_slide", () => {
  it("creates a new slide with disambiguated element IDs", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    await executeTool("duplicate_slide", { slideId: "s1", newSlideId: "s1-copy" });
    const slides = getDeck().slides;
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => s.id)).toContain("s1-copy");
    const copySlide = slides.find((s) => s.id === "s1-copy")!;
    expect(copySlide.elements).toHaveLength(2);
    // Element IDs should be different from originals
    const origIds = new Set(slides[0]!.elements.map((e) => e.id));
    for (const e of copySlide.elements) {
      expect(origIds.has(e.id)).toBe(false);
    }
  });

  it("rejects duplicate newSlideId", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2")]));
    const result = await executeTool("duplicate_slide", { slideId: "s1", newSlideId: "s2" });
    expect(result).toMatch(/already exists/);
  });

  it("errors on unknown source slide", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("duplicate_slide", { slideId: "s99", newSlideId: "new" });
    expect(result).toMatch(/not found/);
  });
});

describe("executeTool — reorder_slides / move_slide", () => {
  it("reorder_slides applies a full permutation", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2"), slide("s3")]));
    await executeTool("reorder_slides", { order: ["s3", "s1", "s2"] });
    expect(getDeck().slides.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("reorder_slides rejects missing slides", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2"), slide("s3")]));
    const result = await executeTool("reorder_slides", { order: ["s1", "s2"] });
    expect(result).toMatch(/expected 3 IDs/);
  });

  it("reorder_slides rejects unknown slide ID", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2")]));
    const result = await executeTool("reorder_slides", { order: ["s1", "s99"] });
    expect(result).toMatch(/unknown slide ID/);
  });

  it("reorder_slides rejects duplicates", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2")]));
    const result = await executeTool("reorder_slides", { order: ["s1", "s1"] });
    expect(result).toMatch(/duplicate/);
  });

  it("move_slide shifts one slide", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2"), slide("s3")]));
    await executeTool("move_slide", { slideId: "s1", toIndex: 2 });
    expect(getDeck().slides.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });
});

describe("executeTool — merge_slides", () => {
  it("merges sources into target and deletes sources", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } })]),
      slide("s2", [text("e2", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } })]),
      slide("s3", [text("e3", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } })]),
    ]));
    await executeTool("merge_slides", {
      targetSlideId: "s1",
      sourceSlideIds: ["s2", "s3"],
    });
    const deck = getDeck();
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0]!.id).toBe("s1");
    expect(deck.slides[0]!.elements).toHaveLength(3);
  });

  it("disambiguates element IDs across merged slides", async () => {
    loadDeck(testDeck([
      slide("s1", [text("conflict")]),
      slide("s2", [text("conflict")]),
    ]));
    await executeTool("merge_slides", {
      targetSlideId: "s1",
      sourceSlideIds: ["s2"],
    });
    const ids = getDeck().slides[0]!.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("errors on missing target", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("merge_slides", {
      targetSlideId: "s99",
      sourceSlideIds: ["s1"],
    });
    expect(result).toMatch(/target slide.*not found/);
  });
});

describe("executeTool — split_slide", () => {
  it("splits at the pivot element", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2"), text("e3"), text("e4")])]));
    await executeTool("split_slide", {
      slideId: "s1",
      pivotElementId: "e3",
      newSlideId: "s1-b",
    });
    const slides = getDeck().slides;
    expect(slides).toHaveLength(2);
    expect(slides[0]!.id).toBe("s1");
    expect(slides[0]!.elements.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(slides[1]!.id).toBe("s1-b");
    // Moved elements get disambiguated IDs
    expect(slides[1]!.elements).toHaveLength(2);
  });

  it("rejects split that would leave one side empty (pivot at start)", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")])]));
    const result = await executeTool("split_slide", {
      slideId: "s1",
      pivotElementId: "e1",
      newSlideId: "new",
    });
    expect(result).toMatch(/empty/);
  });

  it("rejects duplicate newSlideId", async () => {
    loadDeck(testDeck([slide("s1", [text("e1"), text("e2")]), slide("existing")]));
    const result = await executeTool("split_slide", {
      slideId: "s1",
      pivotElementId: "e2",
      newSlideId: "existing",
    });
    expect(result).toMatch(/already exists/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deck-wide style
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — apply_style_to_all", () => {
  it("applies stylePatch to all elements of the filtered type", async () => {
    loadDeck(testDeck([
      slide("s1", [
        text("e1", "h1", { style: { fontSize: 48 } }),
        text("e2", "body", { style: { fontSize: 16 } }),
      ]),
      slide("s2", [text("e3", "h2", { style: { fontSize: 48 } })]),
    ]));
    await executeTool("apply_style_to_all", {
      filter: { type: "text", minFontSize: 32 },
      stylePatch: { color: "#ff0000" },
    });
    const e1 = getDeck().slides[0]!.elements[0] as TextElement;
    const e2 = getDeck().slides[0]!.elements[1] as TextElement;
    const e3 = getDeck().slides[1]!.elements[0] as TextElement;
    expect(e1.style!.color).toBe("#ff0000");
    expect(e2.style!.color).toBeUndefined();
    expect(e3.style!.color).toBe("#ff0000");
  });

  it("honors slideRange filter", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "", { style: { fontSize: 24 } })]),
      slide("s2", [text("e2", "", { style: { fontSize: 24 } })]),
      slide("s3", [text("e3", "", { style: { fontSize: 24 } })]),
    ]));
    await executeTool("apply_style_to_all", {
      filter: { type: "text", slideRange: [2, 2] },
      stylePatch: { color: "#00ff00" },
    });
    expect((getDeck().slides[0]!.elements[0] as TextElement).style!.color).toBeUndefined();
    expect((getDeck().slides[1]!.elements[0] as TextElement).style!.color).toBe("#00ff00");
    expect((getDeck().slides[2]!.elements[0] as TextElement).style!.color).toBeUndefined();
  });
});

describe("executeTool — apply_theme", () => {
  it("shallow-merges allowed theme buckets", async () => {
    loadDeck(testDeck([]));
    await executeTool("apply_theme", {
      themePatch: { text: { color: "#abc" }, code: { fontSize: 20 } },
    });
    const theme = getDeck().theme!;
    expect(theme.text!.color).toBe("#abc");
    expect(theme.code!.fontSize).toBe(20);
  });

  it("rejects unknown theme buckets", async () => {
    loadDeck(testDeck([]));
    const result = await executeTool("apply_theme", {
      themePatch: { unknownBucket: { foo: "bar" } },
    });
    expect(result).toMatch(/no valid theme buckets|rejected/);
  });

  it("errors on non-object themePatch", async () => {
    loadDeck(testDeck([]));
    const result = await executeTool("apply_theme", { themePatch: "not an object" });
    expect(result).toMatch(/must be an object/);
  });
});

describe("executeTool — set_slide_background / set_deck_meta", () => {
  it("set_slide_background updates background color", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("set_slide_background", { slideId: "s1", color: "#000000" });
    expect((getDeck().slides[0]!.background as { color?: string }).color).toBe("#000000");
  });

  it("set_slide_background rejects missing fields", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("set_slide_background", { slideId: "s1" });
    expect(result).toMatch(/needs at least color or image/);
  });

  it("set_deck_meta updates title", async () => {
    loadDeck(testDeck([]));
    await executeTool("set_deck_meta", { title: "New Title" });
    expect(getDeck().meta.title).toBe("New Title");
  });

  it("set_deck_meta rejects invalid aspectRatio", async () => {
    loadDeck(testDeck([]));
    const result = await executeTool("set_deck_meta", { aspectRatio: "21:9" });
    expect(result).toMatch(/no recognized fields/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Image tools
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — set_image_alt", () => {
  it("updates alt text", async () => {
    loadDeck(testDeck([slide("s1", [image("e1")])]));
    await executeTool("set_image_alt", { slideId: "s1", elementId: "e1", alt: "a bar chart" });
    const el = getDeck().slides[0]!.elements[0] as ImageElement;
    expect(el.alt).toBe("a bar chart");
  });

  it("errors when element is not an image", async () => {
    loadDeck(testDeck([slide("s1", [text("e1")])]));
    const result = await executeTool("set_image_alt", { slideId: "s1", elementId: "e1", alt: "x" });
    expect(result).toMatch(/not an image/);
  });
});

describe("executeTool — crop_image", () => {
  it("sets the style.crop fractions", async () => {
    loadDeck(testDeck([slide("s1", [image("e1", "./foo.png", { style: { borderRadius: 4 } })])]));
    await executeTool("crop_image", { slideId: "s1", elementId: "e1", top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 });
    const el = getDeck().slides[0]!.elements[0] as ImageElement;
    expect(el.style!.crop).toEqual({ top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 });
    // Preserves other style fields
    expect(el.style!.borderRadius).toBe(4);
  });

  it("clamps values to 0-0.95 range", async () => {
    loadDeck(testDeck([slide("s1", [image("e1")])]));
    await executeTool("crop_image", { slideId: "s1", elementId: "e1", top: 1.5, left: -0.2 });
    const el = getDeck().slides[0]!.elements[0] as ImageElement;
    expect(el.style!.crop!.top).toBe(0.95);
    expect(el.style!.crop!.left).toBe(0);
  });

  it("rejects crop that would leave zero visible area", async () => {
    loadDeck(testDeck([slide("s1", [image("e1")])]));
    const result = await executeTool("crop_image", { slideId: "s1", elementId: "e1", top: 0.5, bottom: 0.5 });
    expect(result).toMatch(/zero visible/);
  });

  it("errors when element is not an image", async () => {
    loadDeck(testDeck([slide("s1", [text("e1")])]));
    const result = await executeTool("crop_image", { slideId: "s1", elementId: "e1", top: 0.1 });
    expect(result).toMatch(/not an image/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Animation tools
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — animations", () => {
  beforeEach(() => {
    loadDeck(testDeck([slide("s1", [text("e1")])]));
  });

  it("add_animation validates effect enum", async () => {
    const result = await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "invalid", trigger: "onClick",
    });
    expect(result).toMatch(/unknown effect/);
  });

  it("add_animation validates trigger enum", async () => {
    const result = await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "fadeIn", trigger: "bogus",
    });
    expect(result).toMatch(/unknown trigger/);
  });

  it("add_animation appends to slide.animations", async () => {
    await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "fadeIn", trigger: "onClick", duration: 500,
    });
    const anims = getDeck().slides[0]!.animations ?? [];
    expect(anims).toHaveLength(1);
    expect(anims[0]!.effect).toBe("fadeIn");
    expect(anims[0]!.trigger).toBe("onClick");
  });

  it("list_animations returns empty message when none", async () => {
    const result = await executeTool("list_animations", { slideId: "s1" });
    expect(result).toMatch(/No animations/);
  });

  it("list_animations enumerates existing animations", async () => {
    await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "fadeIn", trigger: "onClick",
    });
    const result = await executeTool("list_animations", { slideId: "s1" });
    expect(result).toMatch(/\[0\] onClick fadeIn -> e1/);
  });

  it("delete_animation removes by index", async () => {
    await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "fadeIn", trigger: "onClick",
    });
    await executeTool("add_animation", {
      slideId: "s1", target: "e1", effect: "fadeOut", trigger: "onClick",
    });
    await executeTool("delete_animation", { slideId: "s1", index: 0 });
    const anims = getDeck().slides[0]!.animations ?? [];
    expect(anims).toHaveLength(1);
    expect(anims[0]!.effect).toBe("fadeOut");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Comments
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — add_comment / resolve_comment", () => {
  it("adds a comment with valid category", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("add_comment", {
      slideId: "s1", text: "this needs work", category: "design",
    });
    expect(result).toMatch(/Comment.*added/);
    const comments = getDeck().slides[0]!.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe("this needs work");
    expect(comments[0]!.category).toBe("design");
  });

  it("falls back to undefined category for invalid value", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("add_comment", {
      slideId: "s1", text: "note", category: "bogus",
    });
    const comments = getDeck().slides[0]!.comments ?? [];
    expect(comments[0]!.category).toBeUndefined();
  });

  it("resolve_comment flips category to done", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("add_comment", { slideId: "s1", text: "todo", category: "todo" });
    const cid = getDeck().slides[0]!.comments![0]!.id;
    await executeTool("resolve_comment", { slideId: "s1", commentId: cid });
    const c = getDeck().slides[0]!.comments![0]!;
    expect(c.category).toBe("done");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Speaker notes
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — set_speaker_notes", () => {
  it("sets notes on a slide", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("set_speaker_notes", { slideId: "s1", notes: "hello from presenter" });
    expect(getDeck().slides[0]!.notes).toBe("hello from presenter");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Quality lint
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — check_overlaps", () => {
  it("returns OK when no overlaps", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      text("e2", "", { position: { x: 200, y: 200 }, size: { w: 100, h: 50 } }),
    ])]));
    const result = await executeTool("check_overlaps", { slideId: "s1" });
    expect(result).toMatch(/No overlaps/);
  });

  it("detects intersecting bounding boxes", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }),
      text("e2", "", { position: { x: 50, y: 50 }, size: { w: 100, h: 100 } }),
    ])]));
    const result = await executeTool("check_overlaps", { slideId: "s1" });
    expect(result).toMatch(/Found 1 overlap/);
    expect(result).toMatch(/e1.*e2/);
  });

  it("ignores overlaps within the same groupId", async () => {
    loadDeck(testDeck([slide("s1", [
      text("e1", "", { position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, groupId: "g1" }),
      text("e2", "", { position: { x: 50, y: 50 }, size: { w: 100, h: 100 }, groupId: "g1" }),
    ])]));
    const result = await executeTool("check_overlaps", { slideId: "s1" });
    expect(result).toMatch(/No overlaps/);
  });
});

describe("executeTool — check_contrast", () => {
  it("passes when text on dark bg has enough contrast", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "hi", { style: { color: "#ffffff" } })], { background: { color: "#000000" } }),
    ]));
    const result = await executeTool("check_contrast", { slideId: "s1" });
    expect(result).toMatch(/passes WCAG AA/);
  });

  it("flags low-contrast text", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "hi", { style: { color: "#777777" } })], { background: { color: "#888888" } }),
    ]));
    const result = await executeTool("check_contrast", { slideId: "s1" });
    expect(result).toMatch(/Low-contrast/);
    expect(result).toMatch(/e1/);
  });
});

describe("executeTool — lint_slide", () => {
  it("reports OK on a clean slide", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "# Title", { style: { color: "#ffffff", fontSize: 36 }, position: { x: 0, y: 0 }, size: { w: 400, h: 60 } })], { background: { color: "#000000" } }),
    ]));
    const result = await executeTool("lint_slide", { slideId: "s1" });
    expect(result).toMatch(/OK/);
  });

  it("reports missing title", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "just body, no heading", { style: { color: "#fff" } })], { background: { color: "#000" } }),
    ]));
    const result = await executeTool("lint_slide", { slideId: "s1" });
    expect(result).toMatch(/no '#'-prefixed title/);
  });

  it("reports empty text element", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "# heading"), text("e2", "   ")], { background: { color: "#000" } }),
    ]));
    const result = await executeTool("lint_slide", { slideId: "s1" });
    expect(result).toMatch(/empty text element/);
  });

  it("reports out-of-bounds element", async () => {
    loadDeck(testDeck([
      slide("s1", [text("e1", "# h", { position: { x: 950, y: 0 }, size: { w: 100, h: 50 } })], { background: { color: "#000" } }),
    ]));
    const result = await executeTool("lint_slide", { slideId: "s1" });
    expect(result).toMatch(/out of 960x540 bounds/);
  });
});

describe("executeTool — validate_deck", () => {
  it("returns OK on a valid deck", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "# title", { style: { fontSize: 24 } })])]));
    const result = await executeTool("validate_deck", {});
    expect(result).toMatch(/OK|passes/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Safety net: snapshot / restore / list / diff / undo / redo
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — snapshot / restore / list_snapshots / diff_against_snapshot", () => {
  it("snapshot + restore round-trips the deck state", async () => {
    loadDeck(testDeck([slide("s1", [text("e1", "original")])]));
    await executeTool("snapshot", { label: "before" });
    await executeTool("update_element", { slideId: "s1", elementId: "e1", patch: { content: "modified" } });
    expect((getDeck().slides[0]!.elements[0] as TextElement).content).toBe("modified");
    await executeTool("restore", { label: "before" });
    expect((getDeck().slides[0]!.elements[0] as TextElement).content).toBe("original");
  });

  it("restore errors on unknown label", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("restore", { label: "nonexistent" });
    expect(result).toMatch(/not found/);
  });

  it("list_snapshots returns labels", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("snapshot", { label: "checkpoint-1" });
    await executeTool("snapshot", { label: "checkpoint-2" });
    const result = await executeTool("list_snapshots", {});
    expect(result).toMatch(/checkpoint-1/);
    expect(result).toMatch(/checkpoint-2/);
  });

  it("diff_against_snapshot reports added slides", async () => {
    loadDeck(testDeck([slide("s1")]));
    await executeTool("snapshot", { label: "base" });
    await executeTool("add_slide", { slide: { id: "s2", elements: [] } });
    const result = await executeTool("diff_against_snapshot", { label: "base" });
    expect(result).toMatch(/added slides: s2/);
  });

  it("diff_against_snapshot reports removed slides", async () => {
    loadDeck(testDeck([slide("s1"), slide("s2")]));
    await executeTool("snapshot", { label: "base" });
    await executeTool("delete_slide", { slideId: "s2" });
    const result = await executeTool("diff_against_snapshot", { label: "base" });
    expect(result).toMatch(/removed slides: s2/);
  });

  it("diff_against_snapshot errors on unknown label", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("diff_against_snapshot", { label: "ghost" });
    expect(result).toMatch(/not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// import_outline
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — import_outline", () => {
  it("appends new slides by default", async () => {
    loadDeck(testDeck([slide("existing")]));
    const md = "# Imported One\nbody one\n# Imported Two\nbody two";
    await executeTool("import_outline", { markdown: md });
    const slides = getDeck().slides;
    expect(slides).toHaveLength(3);
    expect(slides[0]!.id).toBe("existing");
  });

  it("replace mode clears existing slides", async () => {
    loadDeck(testDeck([slide("existing"), slide("another")]));
    const md = "# Fresh slide\nbody";
    await executeTool("import_outline", { markdown: md, mode: "replace" });
    const slides = getDeck().slides;
    expect(slides).toHaveLength(1);
    expect(slides[0]!.id).not.toBe("existing");
  });

  it("errors on markdown with no top-level headings", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("import_outline", { markdown: "just body, no heading" });
    expect(result).toMatch(/no top-level/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Unknown tool
// ─────────────────────────────────────────────────────────────────────

describe("executeTool — unknown tool", () => {
  it("returns error for unrecognized tool name", async () => {
    loadDeck(testDeck([slide("s1")]));
    const result = await executeTool("frobnicate", {});
    expect(result).toMatch(/Unknown tool/);
  });
});

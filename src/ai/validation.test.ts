/**
 * Tests for src/ai/validation.ts: validateDeck, buildFixInstructions,
 * resolveOverlaps. These are pure functions (no I/O, no DOM) so they
 * test cleanly in the node environment.
 */
import { describe, it, expect } from "vitest";
import { validateDeck, buildFixInstructions, resolveOverlaps } from "./validation";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  ImageElement,
  ShapeElement,
  TikZElement,
  CodeElement,
  TableElement,
} from "@/types/deck";

// ── Fixtures ──

function text(id: string, content = "hi", overrides: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: "text",
    content,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    ...overrides,
  } as TextElement;
}

function image(id: string, overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id,
    type: "image",
    // Default fixture uses a valid asset path so tests that don't
    // care about src format are unaffected by the path-format check.
    src: "./assets/img.png",
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

function tikz(id: string, content: string): TikZElement {
  return {
    id,
    type: "tikz",
    content,
    position: { x: 0, y: 0 },
    size: { w: 200, h: 200 },
  } as TikZElement;
}

function slide(id: string, elements: SlideElement[] = [], overrides: Partial<Slide> = {}): Slide {
  return { id, elements, ...overrides };
}

function deck(slides: Slide[]): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides,
  };
}

function findIssue(result: ReturnType<typeof validateDeck>, pattern: RegExp): boolean {
  return result.issues.some((i) => pattern.test(i.message));
}

// ─────────────────────────────────────────────────────────────────────
// validateDeck — structural rules
// ─────────────────────────────────────────────────────────────────────

describe("validateDeck — duplicate IDs", () => {
  it("flags duplicate slide IDs", () => {
    const d = deck([slide("s1"), slide("s1")]);
    const result = validateDeck(d);
    expect(findIssue(result, /Duplicate slide ID/)).toBe(true);
  });

  it("flags duplicate element IDs across slides", () => {
    const d = deck([
      slide("s1", [text("dup", "a")]),
      slide("s2", [text("dup", "b")]),
    ]);
    const result = validateDeck(d);
    expect(findIssue(result, /Duplicate element ID/)).toBe(true);
  });

  it("flags duplicate element IDs within one slide", () => {
    const d = deck([slide("s1", [text("e1"), text("e1")])]);
    const result = validateDeck(d);
    expect(findIssue(result, /Duplicate element ID/)).toBe(true);
  });

  it("accepts unique IDs", () => {
    const d = deck([slide("s1", [text("e1")]), slide("s2", [text("e2")])]);
    const result = validateDeck(d);
    expect(findIssue(result, /Duplicate/)).toBe(false);
  });
});

describe("validateDeck — forbidden element types", () => {
  const forbidden = ["mermaid", "iframe", "audio", "animation"];
  for (const type of forbidden) {
    it(`flags ${type} as forbidden`, () => {
      const badElement = {
        id: "bad",
        type,
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      } as unknown as SlideElement;
      const d = deck([slide("s1", [badElement])]);
      const result = validateDeck(d);
      expect(findIssue(result, new RegExp(`Forbidden element type "${type}"`))).toBe(true);
    });
  }

  it("accepts all allowed element types", () => {
    const d = deck([slide("s1", [
      text("t1"),
      image("i1", { alt: "x" }),
      shape("sh1"),
    ])]);
    const result = validateDeck(d);
    expect(findIssue(result, /Forbidden/)).toBe(false);
  });
});

describe("validateDeck — missing required fields", () => {
  it("flags element missing position", () => {
    const d = deck([slide("s1", [
      { id: "e1", type: "text", content: "hi", size: { w: 100, h: 50 } } as unknown as SlideElement,
    ])]);
    const result = validateDeck(d);
    expect(findIssue(result, /missing position/)).toBe(true);
  });

  it("flags element with zero or missing size", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { size: { w: 0, h: 0 } }),
    ])]);
    const result = validateDeck(d);
    expect(findIssue(result, /zero or missing size/)).toBe(true);
  });
});

describe("validateDeck — bounds and overflow", () => {
  it("flags negative x", () => {
    const d = deck([slide("s1", [text("e1", "hi", { position: { x: -10, y: 0 } })])]);
    expect(findIssue(validateDeck(d), /position negative/)).toBe(true);
  });

  it("flags negative y", () => {
    const d = deck([slide("s1", [text("e1", "hi", { position: { x: 0, y: -5 } })])]);
    expect(findIssue(validateDeck(d), /position negative/)).toBe(true);
  });

  it("flags right-edge overflow (x + w > 960)", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { position: { x: 900, y: 0 }, size: { w: 100, h: 50 } }),
    ])]);
    expect(findIssue(validateDeck(d), /overflows right edge/)).toBe(true);
  });

  it("flags bottom-edge overflow (y + h > 540)", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { position: { x: 0, y: 500 }, size: { w: 100, h: 100 } }),
    ])]);
    expect(findIssue(validateDeck(d), /overflows bottom edge/)).toBe(true);
  });

  it("accepts exactly on boundary", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { position: { x: 0, y: 0 }, size: { w: 960, h: 540 } }),
    ])]);
    expect(findIssue(validateDeck(d), /overflows/)).toBe(false);
  });
});

describe("validateDeck — shape rules", () => {
  it("flags arrow shape with rotation field", () => {
    const d = deck([slide("s1", [
      { ...shape("e1", "arrow"), rotation: 45 } as unknown as SlideElement,
    ])]);
    expect(findIssue(validateDeck(d), /rotation field/)).toBe(true);
  });

  it("flags line shape with rotation field", () => {
    const d = deck([slide("s1", [
      { ...shape("e1", "line"), rotation: 90 } as unknown as SlideElement,
    ])]);
    expect(findIssue(validateDeck(d), /rotation field/)).toBe(true);
  });

  it("accepts arrow without rotation", () => {
    const d = deck([slide("s1", [shape("e1", "arrow")])]);
    expect(findIssue(validateDeck(d), /rotation field/)).toBe(false);
  });
});

describe("validateDeck — TikZ bounding box", () => {
  it("flags TikZ content without bounding box", () => {
    const d = deck([slide("s1", [tikz("t1", "\\node at (0,0) {hi};")])]);
    expect(findIssue(validateDeck(d), /missing bounding box/)).toBe(true);
  });

  it("accepts TikZ with \\path...rectangle", () => {
    const d = deck([slide("s1", [tikz("t1", "\\path (0,0) rectangle (10,10); \\node at (0,0) {hi};")])]);
    expect(findIssue(validateDeck(d), /missing bounding box/)).toBe(false);
  });
});

describe("validateDeck — text content rules", () => {
  it("flags double backslash outside LaTeX environment", () => {
    const d = deck([slide("s1", [text("e1", "line one \\\\ line two")])]);
    expect(findIssue(validateDeck(d), /\\\\ outside a LaTeX environment/)).toBe(true);
  });

  it("allows double backslash inside aligned environment", () => {
    const d = deck([slide("s1", [text("e1", "\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}")])]);
    expect(findIssue(validateDeck(d), /\\\\ outside/)).toBe(false);
  });

  it("flags bold markers inside math delimiters", () => {
    const d = deck([slide("s1", [text("e1", "inline math: $x = **bold** + 1$")])]);
    expect(findIssue(validateDeck(d), /bold.*inside.*math/)).toBe(true);
  });

  it("flags empty text content", () => {
    const d = deck([slide("s1", [text("e1", "   ")])]);
    expect(findIssue(validateDeck(d), /empty content/)).toBe(true);
  });

  it("accepts normal text content", () => {
    const d = deck([slide("s1", [text("e1", "hello world")])]);
    expect(findIssue(validateDeck(d), /empty content|\\\\ outside|bold.*inside/)).toBe(false);
  });
});

describe("validateDeck — font size bounds", () => {
  it("flags fontSize < 10", () => {
    const d = deck([slide("s1", [text("e1", "hi", { style: { fontSize: 8 } })])]);
    expect(findIssue(validateDeck(d), /too small/)).toBe(true);
  });

  it("flags fontSize > 72", () => {
    const d = deck([slide("s1", [text("e1", "hi", { style: { fontSize: 80 } })])]);
    expect(findIssue(validateDeck(d), /too large/)).toBe(true);
  });

  it("accepts fontSize in 10-72 range", () => {
    const d = deck([slide("s1", [text("e1", "hi", { style: { fontSize: 24 } })])]);
    expect(findIssue(validateDeck(d), /too (small|large)/)).toBe(false);
  });

  it("does not flag text without explicit fontSize", () => {
    const d = deck([slide("s1", [text("e1", "hi")])]);
    expect(findIssue(validateDeck(d), /too (small|large)/)).toBe(false);
  });
});

describe("validateDeck — code element length", () => {
  it("flags code with more than 25 lines", () => {
    const longCode = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const d = deck([slide("s1", [{
      id: "c1",
      type: "code",
      language: "typescript",
      content: longCode,
      position: { x: 0, y: 0 },
      size: { w: 400, h: 200 },
    } as CodeElement])]);
    expect(findIssue(validateDeck(d), /30 lines/)).toBe(true);
  });

  it("accepts code under 25 lines", () => {
    const codeContent = "line 1\nline 2\nline 3";
    const d = deck([slide("s1", [{
      id: "c1",
      type: "code",
      language: "typescript",
      content: codeContent,
      position: { x: 0, y: 0 },
      size: { w: 400, h: 200 },
    } as CodeElement])]);
    expect(findIssue(validateDeck(d), /lines \(max/)).toBe(false);
  });
});

describe("validateDeck — table rules", () => {
  function tbl(id: string, columns: unknown, rows: unknown): TableElement {
    return {
      id,
      type: "table",
      columns,
      rows,
      position: { x: 0, y: 0 },
      size: { w: 400, h: 200 },
    } as unknown as TableElement;
  }

  it("flags table missing columns", () => {
    const d = deck([slide("s1", [tbl("t1", undefined, [["a"]])])]);
    expect(findIssue(validateDeck(d), /missing or empty columns/)).toBe(true);
  });

  it("flags table with empty columns array", () => {
    const d = deck([slide("s1", [tbl("t1", [], [["a"]])])]);
    expect(findIssue(validateDeck(d), /missing or empty columns/)).toBe(true);
  });

  it("flags table missing rows", () => {
    const d = deck([slide("s1", [tbl("t1", ["col1"], undefined)])]);
    expect(findIssue(validateDeck(d), /missing or empty rows/)).toBe(true);
  });

  it("flags table with empty rows array", () => {
    const d = deck([slide("s1", [tbl("t1", ["col1"], [])])]);
    expect(findIssue(validateDeck(d), /missing or empty rows/)).toBe(true);
  });

  it("accepts well-formed table", () => {
    const d = deck([slide("s1", [tbl("t1", ["A", "B"], [["1", "2"]])])]);
    expect(findIssue(validateDeck(d), /columns|rows/)).toBe(false);
  });
});

describe("validateDeck — step marker vs onClick animation count", () => {
  it("flags mismatched step markers", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "[step:1]first[/step] [step:2]second[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    expect(findIssue(validateDeck(d), /Step marker count/)).toBe(true);
  });

  it("accepts matching step markers", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "[step:1]first[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    expect(findIssue(validateDeck(d), /Step marker count/)).toBe(false);
  });

  it("does not flag notes without step markers", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "plain notes no markers",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    expect(findIssue(validateDeck(d), /Step marker count/)).toBe(false);
  });

  it("flags [step:0] as 1-indexed violation", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "[step:0]pre-click[/step] [step:1]first[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /1-indexed/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toMatch(/\[step:0\]/);
  });

  it("flags step index exceeding onClick count", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "[step:1]a[/step] [step:2]b[/step] [step:3]c[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /\[step:3\].*never fire|only 2 onClick/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("flags sparse step numbering where max step exceeds onClick count", () => {
    // [1][2][5] with 3 onClicks — count-equality check does not
    // catch it (3 === 3) but step 5 never fires.
    const d = deck([slide("s1", [text("e1")], {
      notes: "[step:1]a[/step] [step:2]b[/step] [step:5]c[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    const result = validateDeck(d);
    expect(findIssue(result, /\[step:5\]/)).toBe(true);
    expect(findIssue(result, /only 3 onClick/)).toBe(true);
  });

  it("accepts well-formed 1-indexed step markers", () => {
    const d = deck([slide("s1", [text("e1")], {
      notes: "Welcome. [step:1]first[/step] [step:2]second[/step]",
      animations: [
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
        { target: "e1", effect: "fadeIn", trigger: "onClick" },
      ],
    })]);
    const result = validateDeck(d);
    expect(findIssue(result, /1-indexed|never fire/)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Overlap detection
// ─────────────────────────────────────────────────────────────────────

describe("validateDeck — overlap detection", () => {
  it("flags heavily overlapping text elements as error", () => {
    const d = deck([slide("s1", [
      text("e1", "aaa", { position: { x: 0, y: 0 }, size: { w: 200, h: 100 } }),
      text("e2", "bbb", { position: { x: 10, y: 10 }, size: { w: 200, h: 100 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.some(
      (i) => i.severity === "error" && /overlap/.test(i.message),
    )).toBe(true);
  });

  it("exempts elements sharing a groupId", () => {
    const d = deck([slide("s1", [
      text("e1", "a", { position: { x: 0, y: 0 }, size: { w: 200, h: 200 }, groupId: "g1" }),
      text("e2", "b", { position: { x: 10, y: 10 }, size: { w: 200, h: 200 }, groupId: "g1" }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("exempts shape-on-content overlaps (shape is decorative)", () => {
    const d = deck([slide("s1", [
      shape("sh1", "rectangle", { position: { x: 0, y: 0 }, size: { w: 400, h: 200 } }),
      text("t1", "label", { position: { x: 50, y: 50 }, size: { w: 200, h: 100 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("exempts annotation (small element much inside larger)", () => {
    const d = deck([slide("s1", [
      text("big", "box", { position: { x: 0, y: 0 }, size: { w: 400, h: 400 } }),
      text("small", "label", { position: { x: 50, y: 50 }, size: { w: 80, h: 40 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("ignores overlap smaller than 20px on either axis", () => {
    const d = deck([slide("s1", [
      text("e1", "a", { position: { x: 0, y: 0 }, size: { w: 200, h: 200 } }),
      text("e2", "b", { position: { x: 195, y: 0 }, size: { w: 200, h: 200 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  // ── B1: relaxed overlap rules ─────────────────────────────────────

  it("excludes line/arrow shapes from overlap entirely (fan-out diagrams)", () => {
    const d = deck([slide("s1", [
      shape("a1", "arrow", {
        position: { x: 100, y: 100 },
        size: { w: 200, h: 0 },
        style: { waypoints: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
      } as Partial<ShapeElement>),
      shape("a2", "arrow", {
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        style: { waypoints: [{ x: 0, y: 0 }, { x: 200, y: 100 }] },
      } as Partial<ShapeElement>),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("exempts rectangle fully enclosing another element (frame/container pattern)", () => {
    const d = deck([slide("s1", [
      shape("frame", "rectangle", { position: { x: 100, y: 100 }, size: { w: 400, h: 300 } }),
      image("img", { position: { x: 120, y: 120 }, size: { w: 360, h: 260 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("caps image-overlay overlap at warning severity (never error)", () => {
    const d = deck([slide("s1", [
      image("img", { position: { x: 100, y: 100 }, size: { w: 400, h: 300 } }),
      text("label", "Caption", { position: { x: 200, y: 200 }, size: { w: 200, h: 80 } }),
    ])]);
    const result = validateDeck(d);
    const overlapIssues = result.issues.filter((i) => /overlap/.test(i.message));
    // May be silenced by shape-on-content exemption or label-on-box — but
    // whatever is emitted must NOT be an error.
    expect(overlapIssues.every((i) => i.severity !== "error")).toBe(true);
  });

  it("respects allowOverlap: true opt-out on either element", () => {
    const d = deck([slide("s1", [
      text("e1", "a", {
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        allowOverlap: true,
      } as Partial<TextElement>),
      text("e2", "b", { position: { x: 10, y: 10 }, size: { w: 200, h: 100 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.filter((i) => /overlap/.test(i.message))).toHaveLength(0);
  });

  it("still flags two overlapping text elements (regression)", () => {
    const d = deck([slide("s1", [
      text("e1", "aaa", { position: { x: 0, y: 0 }, size: { w: 200, h: 100 } }),
      text("e2", "bbb", { position: { x: 10, y: 10 }, size: { w: 200, h: 100 } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.some(
      (i) => i.severity === "error" && /overlap/.test(i.message),
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// B2 — Image alt missing warning
// ─────────────────────────────────────────────────────────────────────

describe("validateDeck — image alt lint", () => {
  it("warns when an image has no alt", () => {
    const d = deck([slide("s1", [image("img1")])]);
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /missing `alt`/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not warn when alt is present and non-empty", () => {
    const d = deck([slide("s1", [image("img1", { alt: "A diagram" })])]);
    const result = validateDeck(d);
    expect(result.issues.some((i) => /missing `alt`/.test(i.message))).toBe(false);
  });

  it("warns when alt is only whitespace", () => {
    const d = deck([slide("s1", [image("img1", { alt: "   " })])]);
    const result = validateDeck(d);
    expect(result.issues.some((i) => /missing `alt`/.test(i.message))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// B5 — Off-palette color warning (opt-in)
// ─────────────────────────────────────────────────────────────────────

describe("validateDeck — palette lint", () => {
  it("does not check colors when deck.theme.palette is unset", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { style: { color: "#ff0000" } }),
    ])]);
    const result = validateDeck(d);
    expect(result.issues.some((i) => /palette/.test(i.message))).toBe(false);
  });

  it("warns on colors outside the allow-list when palette is set", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { style: { color: "#ff0000" } }),
    ])]);
    d.theme = { palette: ["#1A2B48", "#5B9BD5"] };
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /palette/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("#ff0000");
  });

  it("does not warn on colors that match the palette (case-insensitive)", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { style: { color: "#1a2b48" } }),
    ])]);
    d.theme = { palette: ["#1A2B48", "#5B9BD5"] };
    const result = validateDeck(d);
    expect(result.issues.some((i) => /palette/.test(i.message))).toBe(false);
  });

  it("expands 3-digit hex shorthand when matching", () => {
    const d = deck([slide("s1", [
      text("e1", "hi", { style: { color: "#abc" } }),
    ])]);
    d.theme = { palette: ["#AABBCC"] };
    const result = validateDeck(d);
    expect(result.issues.some((i) => /palette/.test(i.message))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildFixInstructions
// ─────────────────────────────────────────────────────────────────────

describe("buildFixInstructions", () => {
  it("returns empty string when there are no issues", () => {
    expect(buildFixInstructions({ issues: [], fixed: 0 })).toBe("");
  });

  it("builds FIX lines for autoFixable issues", () => {
    const output = buildFixInstructions({
      fixed: 0,
      issues: [{
        severity: "warning",
        slideId: "s1",
        elementId: "e1",
        message: "Element overflows right edge: x(900) + w(100) = 1000 > 960",
        autoFixable: true,
      }],
    });
    expect(output).toMatch(/FIX.*\[s1\/e1\]/);
    expect(output).toMatch(/Reduce width/);
  });

  it("builds CRITICAL lines for non-fixable errors", () => {
    const output = buildFixInstructions({
      fixed: 0,
      issues: [{
        severity: "error",
        slideId: "s1",
        elementId: "e1",
        message: "Duplicate element ID: e1",
        autoFixable: false,
      }],
    });
    expect(output).toMatch(/CRITICAL.*\[s1\/e1\]/);
  });

  it("builds slide-only loc when elementId is missing", () => {
    const output = buildFixInstructions({
      fixed: 0,
      issues: [{
        severity: "error",
        slideId: "s1",
        message: "Step marker count mismatch",
        autoFixable: false,
      }],
    });
    expect(output).toMatch(/\[s1\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveOverlaps
// ─────────────────────────────────────────────────────────────────────

describe("resolveOverlaps", () => {
  it("moves the smaller element when two text elements overlap heavily", () => {
    // Dimensions chosen so the size ratio stays under 3x (no label-on-box
    // exemption) and under 4x (no annotation exemption), so resolveOverlaps
    // actually reaches the move logic.
    const updated = new Map<string, { x: number; y: number }>();
    const s = slide("s1", [
      text("big", "aaa", { position: { x: 0, y: 0 }, size: { w: 400, h: 300 } }),
      text("small", "bbb", { position: { x: 10, y: 10 }, size: { w: 300, h: 200 } }),
    ]);
    const moved = resolveOverlaps("s1", s, (id, patch) => {
      updated.set(id, patch.position);
    });
    expect(moved).toBeGreaterThan(0);
    expect(updated.has("small")).toBe(true);
  });

  it("returns 0 when no overlaps exist", () => {
    const updated = new Map<string, { x: number; y: number }>();
    const s = slide("s1", [
      text("e1", "a", { position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }),
      text("e2", "b", { position: { x: 500, y: 300 }, size: { w: 100, h: 100 } }),
    ]);
    const moved = resolveOverlaps("s1", s, (id, patch) => {
      updated.set(id, patch.position);
    });
    expect(moved).toBe(0);
    expect(updated.size).toBe(0);
  });

  it("skips shape-on-content overlap", () => {
    const updated = new Map<string, { x: number; y: number }>();
    const s = slide("s1", [
      shape("sh1", "rectangle", { position: { x: 0, y: 0 }, size: { w: 400, h: 200 } }),
      text("t1", "label", { position: { x: 50, y: 50 }, size: { w: 200, h: 100 } }),
    ]);
    const moved = resolveOverlaps("s1", s, (id, patch) => {
      updated.set(id, patch.position);
    });
    expect(moved).toBe(0);
  });

  it("skips elements sharing groupId", () => {
    const updated = new Map<string, { x: number; y: number }>();
    const s = slide("s1", [
      text("e1", "a", { position: { x: 0, y: 0 }, size: { w: 200, h: 200 }, groupId: "g" }),
      text("e2", "b", { position: { x: 10, y: 10 }, size: { w: 200, h: 200 }, groupId: "g" }),
    ]);
    const moved = resolveOverlaps("s1", s, (id, patch) => {
      updated.set(id, patch.position);
    });
    expect(moved).toBe(0);
  });

  it("places the smaller element inside canvas bounds", () => {
    const updated = new Map<string, { x: number; y: number }>();
    const s = slide("s1", [
      text("big", "aaa", { position: { x: 0, y: 0 }, size: { w: 400, h: 300 } }),
      text("small", "bbb", { position: { x: 10, y: 10 }, size: { w: 300, h: 200 } }),
    ]);
    resolveOverlaps("s1", s, (id, patch) => {
      updated.set(id, patch.position);
    });
    const p = updated.get("small")!;
    expect(p).toBeDefined();
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + 300).toBeLessThanOrEqual(960);
    expect(p.y + 200).toBeLessThanOrEqual(540);
  });
});

// ─────────────────────────────────────────────────────────────────
// Asset path format — image, video, slide.background.image
// ─────────────────────────────────────────────────────────────────

describe("validateDeck — asset path format", () => {
  it("flags image element with bare filename src", () => {
    const d = deck([
      slide("s1", [text("t1", "anchor"), image("img", { src: "interference.png" })]),
    ]);
    const result = validateDeck(d);
    expect(findIssue(result, /must start with \.\/assets\//)).toBe(true);
    expect(findIssue(result, /interference\.png/)).toBe(true);
  });

  it("flags image src missing the assets directory", () => {
    const d = deck([
      slide("s1", [text("t1", "anchor"), image("img", { src: "/images/foo.png" })]),
    ]);
    const result = validateDeck(d);
    expect(findIssue(result, /must start with \.\/assets\//)).toBe(true);
  });

  it("flags video element with bare filename src", () => {
    const d = deck([
      slide("s1", [
        text("t1", "anchor"),
        {
          id: "v1",
          type: "video",
          src: "clip.mp4",
          position: { x: 0, y: 0 },
          size: { w: 200, h: 150 },
        } as unknown as SlideElement,
      ]),
    ]);
    const result = validateDeck(d);
    expect(findIssue(result, /video element src "clip\.mp4"/)).toBe(true);
  });

  it("flags slide background image with bare filename", () => {
    const d = deck([slide("s1", [text("t1", "anchor")], { background: { image: "background.png" } })]);
    const result = validateDeck(d);
    expect(findIssue(result, /Slide background image "background\.png"/)).toBe(true);
  });

  it("accepts the four legal prefixes for image src", () => {
    for (const src of [
      "./assets/foo.png",
      "/assets/proj/foo.png",
      "https://example.com/foo.png",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      const d = deck([slide("s1", [text("t1", "anchor"), image("img", { src })])]);
      const result = validateDeck(d);
      const offending = result.issues.filter((i) => /must start with \.\/assets\//.test(i.message));
      expect(offending, `should accept ${src}`).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Empty slide / interrupted generation (api3_1 benchmark failure)
// ─────────────────────────────────────────────────────────────────

describe("validateDeck — empty slide detection", () => {
  it("flags slide with zero elements as an error", () => {
    const d = deck([slide("s1", [])]);
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /zero elements/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toMatch(/Slide "s1"/);
  });

  it("flags slide with notes but no elements with a distinct interrupted-generation message", () => {
    // The api3_1 benchmark failure shape exactly: presenter notes
    // present, elements left as []. The model walked away thinking
    // s1 was complete because the validator never spoke up.
    const d = deck([
      slide("s1", [], {
        notes: "Welcome to the presentation. This deck covers the basics.",
      }),
    ]);
    const result = validateDeck(d);
    const issue = result.issues.find((i) => /notes but no visible elements/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toMatch(/interrupted/);
    // Distinct from the bare-empty case so the AI's mental model
    // can branch on the right corrective action.
    const bareEmpty = result.issues.filter((i) => /zero elements/.test(i.message));
    expect(bareEmpty).toHaveLength(0);
  });

  it("ignores notes that are only whitespace (treats as no notes)", () => {
    const d = deck([slide("s1", [], { notes: "   \n  " })]);
    const result = validateDeck(d);
    expect(findIssue(result, /zero elements/)).toBe(true);
    expect(findIssue(result, /interrupted/)).toBe(false);
  });

  it("accepts a slide with at least one element", () => {
    const d = deck([slide("s1", [text("t1", "hello")])]);
    const result = validateDeck(d);
    expect(findIssue(result, /zero elements|interrupted/)).toBe(false);
  });
});

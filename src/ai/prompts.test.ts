import { describe, it, expect } from "vitest";
import { extractSlideTitle, formatDeckState } from "./prompts";
import type { Deck, Slide, SlideElement, TextElement } from "@/types/deck";

// ── Small factories so each test states only what matters ──

function text(
  id: string,
  content: string,
  overrides: Partial<Omit<TextElement, "id" | "type" | "content">> = {},
): TextElement {
  return {
    id,
    type: "text",
    content,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    ...overrides,
  };
}

function slide(id: string, elements: SlideElement[] = []): Slide {
  return { id, elements };
}

function deck(slides: Slide[], meta: Partial<Deck["meta"]> = {}): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9", ...meta },
    slides,
  };
}

// ── extractSlideTitle ──

describe("extractSlideTitle", () => {
  it("returns null for a slide with no text elements", () => {
    const s = slide("s1", []);
    expect(extractSlideTitle(s)).toBeNull();
  });

  it("returns null for a slide with only non-text elements", () => {
    const s = slide("s1", [
      { id: "e1", type: "shape", shape: "rectangle", position: { x: 0, y: 0 }, size: { w: 10, h: 10 } } as unknown as SlideElement,
    ]);
    expect(extractSlideTitle(s)).toBeNull();
  });

  it("prefers a # heading even when other texts are larger or higher", () => {
    const s = slide("s1", [
      text("e1", "Big non-title", { style: { fontSize: 48 }, position: { x: 0, y: 10 } }),
      text("e2", "# The actual title", { style: { fontSize: 24 }, position: { x: 0, y: 100 } }),
      text("e3", "## A subheading", { style: { fontSize: 32 }, position: { x: 0, y: 50 } }),
    ]);
    expect(extractSlideTitle(s)).toBe("The actual title");
  });

  it("strips the leading # and whitespace", () => {
    const s = slide("s1", [text("e1", "#   Spaced title")]);
    expect(extractSlideTitle(s)).toBe("Spaced title");
  });

  it("matches only column-0 # (a line starting with #), not mid-line #", () => {
    const s = slide("s1", [
      text("e1", "Not a heading # because mid-line", { style: { fontSize: 24 } }),
      text("e2", "# Real heading", { style: { fontSize: 20 } }),
    ]);
    expect(extractSlideTitle(s)).toBe("Real heading");
  });

  it("falls back to largest fontSize when no # heading is present", () => {
    const s = slide("s1", [
      text("e1", "Small", { style: { fontSize: 14 }, position: { x: 0, y: 5 } }),
      text("e2", "Biggest", { style: { fontSize: 48 }, position: { x: 0, y: 100 } }),
      text("e3", "Medium", { style: { fontSize: 24 }, position: { x: 0, y: 10 } }),
    ]);
    expect(extractSlideTitle(s)).toBe("Biggest");
  });

  it("falls back to topmost y when no # heading and all texts are same size", () => {
    const s = slide("s1", [
      text("e1", "Bottom", { style: { fontSize: 24 }, position: { x: 0, y: 500 } }),
      text("e2", "Top", { style: { fontSize: 24 }, position: { x: 0, y: 30 } }),
      text("e3", "Middle", { style: { fontSize: 24 }, position: { x: 0, y: 250 } }),
    ]);
    expect(extractSlideTitle(s)).toBe("Top");
  });

  it("truncates long titles to a preview length", () => {
    const longTitle = "# " + "A".repeat(200);
    const s = slide("s1", [text("e1", longTitle)]);
    const result = extractSlideTitle(s);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(80);
    expect(result!.startsWith("A")).toBe(true);
  });

  it("uses only the first line of a multi-line heading", () => {
    const s = slide("s1", [text("e1", "# First line\nSecond line\nThird line")]);
    expect(extractSlideTitle(s)).toBe("First line");
  });

  it("treats missing fontSize as 0 so explicit sizes always beat defaults", () => {
    const s = slide("s1", [
      text("e1", "No size at all"),
      text("e2", "Explicit small", { style: { fontSize: 10 } }),
    ]);
    expect(extractSlideTitle(s)).toBe("Explicit small");
  });
});

// ── formatDeckState ──

describe("formatDeckState", () => {
  it("includes deck meta in the header", () => {
    const d = deck([], { title: "My Talk", author: "Son" });
    const out = formatDeckState(d);
    expect(out).toMatch(/Title: "My Talk"/);
    expect(out).toMatch(/Author: Son/);
    expect(out).toMatch(/Slides \(0\)/);
  });

  it("shows N/A when author is absent", () => {
    const d = deck([]);
    expect(formatDeckState(d)).toMatch(/Author: N\/A/);
  });

  it("emits one expanded line per slide when below the window threshold", () => {
    const d = deck([
      slide("s1", [text("e1", "# Intro")]),
      slide("s2", [text("e2", "# Body")]),
    ]);
    const out = formatDeckState(d);
    expect(out).toMatch(/\[s1\].*"Intro".*1 elements/);
    expect(out).toMatch(/\[s2\].*"Body".*1 elements/);
    expect(out).toMatch(/elements: e1=/);
  });

  it("marks slides that have no extractable title with <no title>", () => {
    const d = deck([slide("s1", [])]);
    const out = formatDeckState(d);
    expect(out).toMatch(/\[s1\] <no title>/);
  });

  it("renders per-element hints with type and preview", () => {
    const d = deck([
      slide("s1", [
        text("e1", "# Hello world"),
        text("e2", "Body paragraph goes here"),
      ]),
    ]);
    const out = formatDeckState(d);
    expect(out).toMatch(/e1=text: "# Hello world"/);
    expect(out).toMatch(/e2=text: "Body paragraph goes here"/);
  });

  it("flags an image with no descriptive fields as UNDESCRIBED", () => {
    const d = deck([
      slide("s1", [
        {
          id: "img1",
          type: "image",
          src: "./foo.png",
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
        } as SlideElement,
      ]),
    ]);
    const out = formatDeckState(d);
    expect(out).toMatch(/img1=image\[no alt — UNDESCRIBED\]/);
  });

  it("prefers aiSummary over caption over description over alt for image hints", () => {
    const d = deck([
      slide("s1", [
        {
          id: "img1",
          type: "image",
          src: "./foo.png",
          alt: "from-alt",
          caption: "from-caption",
          description: "from-description",
          aiSummary: "from-aiSummary",
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
        } as SlideElement,
      ]),
    ]);
    const out = formatDeckState(d);
    expect(out).toMatch(/img1=image\[from-aiSummary\]/);
    expect(out).not.toMatch(/from-alt/);
    expect(out).not.toMatch(/from-caption/);
  });

  it("collapses distant slides in sliding-window mode", () => {
    // 10 slides, anchor at s5, default radius 2 → s3..s7 expanded, others collapsed
    const slides: Slide[] = [];
    for (let i = 1; i <= 10; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# Slide ${i}`)]));
    }
    const d = deck(slides);

    const out = formatDeckState(d, { anchorSlideId: "s5" });
    expect(out).toMatch(/sliding-window mode/);
    // Expanded slides should have the "elements:" line
    expect(out).toMatch(/\[s3\].*"Slide 3"[\s\S]*?elements: e3=/);
    expect(out).toMatch(/\[s5\].*"Slide 5"[\s\S]*?elements: e5=/);
    expect(out).toMatch(/\[s7\].*"Slide 7"[\s\S]*?elements: e7=/);
    // Collapsed slides: title-only line, no elements hint
    expect(out).toMatch(/\[s1\] "Slide 1" \(1 el\)/);
    expect(out).toMatch(/\[s10\] "Slide 10" \(1 el\)/);
  });

  it("does not activate sliding-window mode below the threshold", () => {
    const slides: Slide[] = [];
    for (let i = 1; i <= 5; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# S${i}`)]));
    }
    const d = deck(slides);
    const out = formatDeckState(d, { anchorSlideId: "s3" });
    expect(out).not.toMatch(/sliding-window mode/);
    // All slides should get expanded hints
    for (let i = 1; i <= 5; i++) {
      expect(out).toMatch(new RegExp(`elements: e${i}=`));
    }
  });

  it("does not activate sliding-window mode when no anchor is provided", () => {
    const slides: Slide[] = [];
    for (let i = 1; i <= 20; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# S${i}`)]));
    }
    const d = deck(slides);
    const out = formatDeckState(d);
    expect(out).not.toMatch(/sliding-window mode/);
    expect(out).toMatch(/elements: e1=/);
    expect(out).toMatch(/elements: e20=/);
  });

  it("respects custom windowRadius and windowThreshold", () => {
    const slides: Slide[] = [];
    for (let i = 1; i <= 10; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# S${i}`)]));
    }
    const d = deck(slides);

    // radius 1 → only s4, s5, s6 expanded
    const out = formatDeckState(d, { anchorSlideId: "s5", windowRadius: 1 });
    expect(out).toMatch(/elements: e4=/);
    expect(out).toMatch(/elements: e5=/);
    expect(out).toMatch(/elements: e6=/);
    expect(out).not.toMatch(/elements: e3=/);
    expect(out).not.toMatch(/elements: e7=/);
  });

  it("clamps the window at deck boundaries", () => {
    const slides: Slide[] = [];
    for (let i = 1; i <= 10; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# S${i}`)]));
    }
    const d = deck(slides);

    // Anchor at first slide with radius 2 → s1, s2, s3 expanded
    const out = formatDeckState(d, { anchorSlideId: "s1" });
    expect(out).toMatch(/elements: e1=/);
    expect(out).toMatch(/elements: e2=/);
    expect(out).toMatch(/elements: e3=/);
    expect(out).not.toMatch(/elements: e4=/);
  });

  it("falls back to full detail when anchor ID is not found", () => {
    const slides: Slide[] = [];
    for (let i = 1; i <= 10; i++) {
      slides.push(slide(`s${i}`, [text(`e${i}`, `# S${i}`)]));
    }
    const d = deck(slides);
    const out = formatDeckState(d, { anchorSlideId: "nonexistent" });
    expect(out).not.toMatch(/sliding-window mode/);
  });
});

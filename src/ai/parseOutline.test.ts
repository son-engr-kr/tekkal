import { describe, it, expect } from "vitest";
import { parseOutline } from "./pipeline";

describe("parseOutline", () => {
  it("returns an empty array for empty input", () => {
    expect(parseOutline("")).toEqual([]);
  });

  it("returns an empty array when the markdown has no top-level headings", () => {
    const md = "Some body text\n## only-sub-headings\nMore body";
    expect(parseOutline(md)).toEqual([]);
  });

  it("splits a single slide with heading and body", () => {
    const md = "# My Title\nSome body text\nMore text";
    const result = parseOutline(md);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      title: "My Title",
      body: "Some body text\nMore text",
    });
  });

  it("splits multiple slides at each top-level heading", () => {
    const md = "# First\nBody one\n# Second\nBody two\n# Third\nBody three";
    const result = parseOutline(md);
    expect(result).toHaveLength(3);
    expect(result[0]!.title).toBe("First");
    expect(result[0]!.body).toBe("Body one");
    expect(result[1]!.title).toBe("Second");
    expect(result[1]!.body).toBe("Body two");
    expect(result[2]!.title).toBe("Third");
    expect(result[2]!.body).toBe("Body three");
  });

  it("keeps ## and ### headings inside the body of the parent slide", () => {
    const md = "# Outer\nintro\n## sub-heading\npara\n### deeper\npara 2";
    const result = parseOutline(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Outer");
    expect(result[0]!.body).toContain("## sub-heading");
    expect(result[0]!.body).toContain("### deeper");
  });

  it("trims whitespace from the title", () => {
    const md = "#    Padded Title   \nbody";
    expect(parseOutline(md)[0]!.title).toBe("Padded Title");
  });

  it("requires the heading to be at column 0 (not indented)", () => {
    const md = " # Indented heading\nbody";
    expect(parseOutline(md)).toEqual([]);
  });

  it("requires a space after # (rejects #title with no space)", () => {
    const md = "#NoSpace\nbody";
    expect(parseOutline(md)).toEqual([]);
  });

  it("accepts an empty body", () => {
    const md = "# Only title";
    const result = parseOutline(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Only title");
    expect(result[0]!.body).toBe("");
  });

  it("preserves blank lines and inline markdown inside body", () => {
    const md = "# Title\n\nFirst paragraph.\n\n- list item 1\n- list item 2\n\n**bold** and *italic*";
    const result = parseOutline(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toContain("- list item 1");
    expect(result[0]!.body).toContain("**bold**");
    expect(result[0]!.body).toContain("*italic*");
  });

  it("handles content before the first heading by dropping it", () => {
    const md = "orphan body\nno heading yet\n# Real slide\nactual body";
    const result = parseOutline(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Real slide");
    expect(result[0]!.body).toBe("actual body");
  });

  it("handles trailing heading with no body", () => {
    const md = "# First\nbody\n# Second";
    const result = parseOutline(md);
    expect(result).toHaveLength(2);
    expect(result[1]!.title).toBe("Second");
    expect(result[1]!.body).toBe("");
  });
});

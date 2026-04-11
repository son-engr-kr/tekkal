import { describe, it, expect } from "vitest";
import { normalizeDeckLegacyFields } from "./deck";

describe("normalizeDeckLegacyFields", () => {
  const validMeta = { title: "Test", aspectRatio: "16:9" as const };

  it("accepts a deck that already has the canonical version field", () => {
    const input = { version: "0.1.0", meta: validMeta, slides: [] };
    const result = normalizeDeckLegacyFields(input);
    expect(result.version).toBe("0.1.0");
    expect((result as unknown as Record<string, unknown>).deckode).toBeUndefined();
  });

  it("promotes legacy deckode field to version", () => {
    const input = { deckode: "0.1.0", meta: validMeta, slides: [] };
    const result = normalizeDeckLegacyFields(input);
    expect(result.version).toBe("0.1.0");
    expect((result as unknown as Record<string, unknown>).deckode).toBeUndefined();
  });

  it("prefers version over legacy deckode when both are present", () => {
    const input = {
      version: "1.0.0",
      deckode: "0.1.0",
      meta: validMeta,
      slides: [],
    };
    const result = normalizeDeckLegacyFields(input);
    expect(result.version).toBe("1.0.0");
    expect((result as unknown as Record<string, unknown>).deckode).toBeUndefined();
  });

  it("preserves all other deck fields unchanged", () => {
    const input = {
      deckode: "0.1.0",
      meta: validMeta,
      theme: { slide: { background: { color: "#000" } } },
      pageNumbers: { enabled: true },
      components: { c1: { id: "c1", name: "test", elements: [] } },
      slides: [{ id: "s1", elements: [] }],
    };
    const result = normalizeDeckLegacyFields(input);
    expect(result.meta).toEqual(validMeta);
    expect(result.theme).toEqual({ slide: { background: { color: "#000" } } });
    expect(result.pageNumbers).toEqual({ enabled: true });
    expect(result.components).toEqual({ c1: { id: "c1", name: "test", elements: [] } });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]!.id).toBe("s1");
  });

  it("throws when neither version nor deckode is present", () => {
    const input = { meta: validMeta, slides: [] };
    expect(() => normalizeDeckLegacyFields(input)).toThrow(/missing version field/);
  });

  it("throws when both version and deckode are non-strings", () => {
    const input = { version: 1, deckode: null, meta: validMeta, slides: [] };
    expect(() => normalizeDeckLegacyFields(input)).toThrow(/missing version field/);
  });

  it("throws on null input", () => {
    expect(() => normalizeDeckLegacyFields(null)).toThrow(/must be an object/);
  });

  it("throws on undefined input", () => {
    expect(() => normalizeDeckLegacyFields(undefined)).toThrow(/must be an object/);
  });

  it("throws on primitive input", () => {
    expect(() => normalizeDeckLegacyFields("not a deck")).toThrow(/must be an object/);
    expect(() => normalizeDeckLegacyFields(42)).toThrow(/must be an object/);
  });

  it("accepts empty slides array", () => {
    const input = { version: "0.1.0", meta: validMeta, slides: [] };
    const result = normalizeDeckLegacyFields(input);
    expect(result.slides).toEqual([]);
  });

  it("mutates the input object in place (by design — caller owns the value)", () => {
    // This documents the current behavior: the helper mutates rather than clones.
    // If this ever changes, the loaders calling it should be audited for assumptions.
    const input: Record<string, unknown> = { deckode: "0.1.0", meta: validMeta, slides: [] };
    const result = normalizeDeckLegacyFields(input);
    expect(result).toBe(input as unknown);
    expect(input.deckode).toBeUndefined();
    expect(input.version).toBe("0.1.0");
  });
});

/**
 * Regression tests for sanitizeToolArgs — the AI tool entrypoint
 * fixup that runs before every executeTool call.
 *
 * Line and arrow shapes both carry direction via style.waypoints
 * (the store assertion forbids rotation on them, and every export
 * backend — PDF, PPTX, native — routes through the waypoint path).
 * When the agent emits a line/arrow without waypoints, the renderer
 * silently drops the shape. The sanitizer used to auto-heal only
 * arrows, so lines created via add_element would render as nothing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeTool } from "./pipeline";
import { useDeckStore } from "@/stores/deckStore";
import type { Deck, ShapeElement } from "@/types/deck";

function deck(): Deck {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides: [{ id: "s1", elements: [] }],
  };
}

beforeEach(() => {
  useDeckStore.getState().closeProject();
});

describe("sanitizeToolArgs — line/arrow waypoint auto-heal", () => {
  it("auto-adds horizontal waypoints to an arrow missing style.waypoints", async () => {
    useDeckStore.getState().openProject("test", deck());
    await executeTool("add_element", {
      slideId: "s1",
      element: {
        id: "a1",
        type: "shape",
        shape: "arrow",
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        style: {},
      },
    });
    const el = useDeckStore.getState().deck!.slides[0]!.elements[0] as ShapeElement;
    expect(el.style?.waypoints).toBeDefined();
    expect(el.style!.waypoints).toHaveLength(2);
  });

  it("auto-adds waypoints to a line shape missing style.waypoints", async () => {
    useDeckStore.getState().openProject("test", deck());
    await executeTool("add_element", {
      slideId: "s1",
      element: {
        id: "l1",
        type: "shape",
        shape: "line",
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        style: {},
      },
    });
    const el = useDeckStore.getState().deck!.slides[0]!.elements[0] as ShapeElement;
    // Every export backend (pdfExport, pdfNativeExport, pptxExport)
    // treats a line/arrow with fewer than 2 waypoints as
    // non-renderable. The sanitizer must fill in a default.
    expect(el.style?.waypoints).toBeDefined();
    expect(el.style!.waypoints!.length).toBeGreaterThanOrEqual(2);
  });

  it("creates vertical waypoints for a tall line (h > w)", async () => {
    useDeckStore.getState().openProject("test", deck());
    await executeTool("add_element", {
      slideId: "s1",
      element: {
        id: "l2",
        type: "shape",
        shape: "line",
        position: { x: 0, y: 0 },
        size: { w: 10, h: 300 },
        style: {},
      },
    });
    const el = useDeckStore.getState().deck!.slides[0]!.elements[0] as ShapeElement;
    const wp = el.style!.waypoints!;
    // For a tall shape, the two waypoints should differ in y, not x.
    expect(wp[0]!.x).toBe(wp[1]!.x);
    expect(wp[1]!.y).toBeGreaterThan(wp[0]!.y);
  });

  it("rejects add_animation targeting a nonexistent element", async () => {
    // Orphan animations pass through the store today — the renderer
    // then silently drops them, so the user sees "nothing happens"
    // with no feedback. The tool should refuse up-front.
    useDeckStore.getState().openProject("test", {
      version: "0.1.0",
      meta: { title: "Test", aspectRatio: "16:9" },
      slides: [{ id: "s1", elements: [{
        id: "e1",
        type: "text",
        content: "hi",
        position: { x: 0, y: 0 },
        size: { w: 100, h: 50 },
      }] }],
    } as Deck);
    const result = await executeTool("add_animation", {
      slideId: "s1",
      target: "eDOES_NOT_EXIST",
      effect: "fadeIn",
      trigger: "onEnter",
    });
    expect(result).toMatch(/ERROR/i);
    expect(useDeckStore.getState().deck!.slides[0]!.animations ?? []).toHaveLength(0);
  });

  it("rejects update_animation that retargets to a nonexistent element", async () => {
    useDeckStore.getState().openProject("test", {
      version: "0.1.0",
      meta: { title: "Test", aspectRatio: "16:9" },
      slides: [{
        id: "s1",
        elements: [{
          id: "e1",
          type: "text",
          content: "hi",
          position: { x: 0, y: 0 },
          size: { w: 100, h: 50 },
        }],
        animations: [{ target: "e1", effect: "fadeIn", trigger: "onEnter" }],
      }],
    } as Deck);
    const result = await executeTool("update_animation", {
      slideId: "s1",
      index: 0,
      patch: { target: "eMISSING" },
    });
    expect(result).toMatch(/ERROR/i);
    expect(useDeckStore.getState().deck!.slides[0]!.animations![0]!.target).toBe("e1");
  });

  it("does not clobber existing waypoints on a line", async () => {
    useDeckStore.getState().openProject("test", deck());
    const custom = [
      { x: 10, y: 10 },
      { x: 50, y: 20 },
      { x: 150, y: 10 },
    ];
    await executeTool("add_element", {
      slideId: "s1",
      element: {
        id: "l3",
        type: "shape",
        shape: "line",
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        style: { waypoints: custom },
      },
    });
    const el = useDeckStore.getState().deck!.slides[0]!.elements[0] as ShapeElement;
    expect(el.style!.waypoints).toEqual(custom);
  });
});

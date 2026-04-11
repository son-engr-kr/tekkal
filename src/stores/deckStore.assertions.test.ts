/**
 * Regression tests for deckStore's invariant assertions. These used
 * to fail silently because the check was written against the wrong
 * type discriminator, so addElement / updateElement accepted input
 * the renderer would later assert-fail on.
 */
// @ts-nocheck — intentional invalid shape element for the test
import { describe, it, expect, beforeEach } from "vitest";
import { useDeckStore } from "./deckStore";
import type { Deck } from "@/types/deck";

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

describe("assertNoLineRotation — guards against arrow/line with rotation", () => {
  it("rejects add_element for a line shape that carries a rotation field", () => {
    useDeckStore.getState().openProject("test", deck());
    expect(() => {
      useDeckStore.getState().addElement("s1", {
        id: "bad",
        type: "shape",
        shape: "line",
        rotation: 45,
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
    }).toThrow(/waypoints.*not rotation/);
  });

  it("rejects add_element for an arrow shape with a rotation field", () => {
    useDeckStore.getState().openProject("test", deck());
    expect(() => {
      useDeckStore.getState().addElement("s1", {
        id: "bad",
        type: "shape",
        shape: "arrow",
        rotation: 90,
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
    }).toThrow(/waypoints.*not rotation/);
  });

  it("allows rectangle shapes to have rotation", () => {
    useDeckStore.getState().openProject("test", deck());
    expect(() => {
      useDeckStore.getState().addElement("s1", {
        id: "ok",
        type: "shape",
        shape: "rectangle",
        rotation: 45,
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
    }).not.toThrow();
  });

  it("allows text elements to have rotation", () => {
    useDeckStore.getState().openProject("test", deck());
    expect(() => {
      useDeckStore.getState().addElement("s1", {
        id: "ok",
        type: "text",
        content: "hi",
        rotation: 15,
        position: { x: 0, y: 0 },
        size: { w: 100, h: 50 },
      });
    }).not.toThrow();
  });

  it("rejects add_element when the element ID already exists on the same slide", () => {
    useDeckStore.getState().openProject("test", deck());
    useDeckStore.getState().addElement("s1", {
      id: "dup",
      type: "text",
      content: "first",
      position: { x: 0, y: 0 },
      size: { w: 100, h: 50 },
    });
    expect(() => {
      useDeckStore.getState().addElement("s1", {
        id: "dup",
        type: "text",
        content: "second",
        position: { x: 0, y: 0 },
        size: { w: 100, h: 50 },
      });
    }).toThrow(/already exists|duplicate/i);
  });

  it("rejects add_element when the element ID exists on any other slide", () => {
    // Element IDs are deck-global per syncCounters / cloneSlide
    // assumptions. A duplicate across slides would be silently
    // renamed by the next save, and any in-session animations or
    // comments referencing it would resolve to the wrong element.
    const d = deck();
    d.slides.push({ id: "s2", elements: [] });
    useDeckStore.getState().openProject("test", d);
    useDeckStore.getState().addElement("s1", {
      id: "shared",
      type: "text",
      content: "on s1",
      position: { x: 0, y: 0 },
      size: { w: 100, h: 50 },
    });
    expect(() => {
      useDeckStore.getState().addElement("s2", {
        id: "shared",
        type: "text",
        content: "on s2",
        position: { x: 0, y: 0 },
        size: { w: 100, h: 50 },
      });
    }).toThrow(/already exists|duplicate/i);
  });

  it("rejects update_element that adds rotation to an existing line shape", () => {
    useDeckStore.getState().openProject("test", deck());
    useDeckStore.getState().addElement("s1", {
      id: "line1",
      type: "shape",
      shape: "line",
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
    });
    expect(() => {
      useDeckStore.getState().updateElement("s1", "line1", { rotation: 30 });
    }).toThrow(/waypoints.*not rotation/);
  });
});

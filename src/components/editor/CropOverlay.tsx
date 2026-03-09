import { useCallback } from "react";
import { useDeckStore, setDeckDragging } from "@/stores/deckStore";
import type { SlideElement, CropRect } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";

type Corner = "nw" | "ne" | "sw" | "se";
type Edge = "n" | "e" | "s" | "w";

const MIN_VISIBLE = 0.05;

interface Props {
  element: SlideElement;
  slideId: string;
  scale: number;
}

export function CropOverlay({ element, slideId, scale }: Props) {
  const updateElement = useDeckStore((s) => s.updateElement);
  const style = (element as { style?: { crop?: CropRect } }).style;
  const crop = style?.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };

  const { w, h } = element.size;
  const ex = element.position.x;
  const ey = element.position.y;

  // Visible crop region in canvas coordinates
  const visX = ex + crop.left * w;
  const visY = ey + crop.top * h;
  const visW = w * (1 - crop.left - crop.right);
  const visH = h * (1 - crop.top - crop.bottom);

  const applyCrop = useCallback(
    (newCrop: CropRect) => {
      updateElement(slideId, element.id, {
        style: { ...style, crop: newCrop },
      } as Partial<SlideElement>);
    },
    [slideId, element.id, style, updateElement],
  );

  const handleCornerMouseDown = useCallback(
    (e: React.MouseEvent, corner: Corner) => {
      e.stopPropagation();
      e.preventDefault();
      setDeckDragging(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { ...crop };

      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        const dx = (me.clientX - startX) / scale;
        const dy = (me.clientY - startY) / scale;
        const next = { ...orig };

        if (corner === "nw" || corner === "ne") {
          next.top = clamp(orig.top + dy / h, 0, 1 - orig.bottom - MIN_VISIBLE);
        }
        if (corner === "sw" || corner === "se") {
          next.bottom = clamp(orig.bottom - dy / h, 0, 1 - orig.top - MIN_VISIBLE);
        }
        if (corner === "nw" || corner === "sw") {
          next.left = clamp(orig.left + dx / w, 0, 1 - orig.right - MIN_VISIBLE);
        }
        if (corner === "ne" || corner === "se") {
          next.right = clamp(orig.right - dx / w, 0, 1 - orig.left - MIN_VISIBLE);
        }

        applyCrop(next);
      };

      const handleMouseUp = () => {
        setDeckDragging(false);
        document.removeEventListener("selectstart", prevent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [crop, w, h, scale, applyCrop],
  );

  const handleEdgeMouseDown = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.stopPropagation();
      e.preventDefault();
      setDeckDragging(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { ...crop };

      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        const dx = (me.clientX - startX) / scale;
        const dy = (me.clientY - startY) / scale;
        const next = { ...orig };

        switch (edge) {
          case "n":
            next.top = clamp(orig.top + dy / h, 0, 1 - orig.bottom - MIN_VISIBLE);
            break;
          case "s":
            next.bottom = clamp(orig.bottom - dy / h, 0, 1 - orig.top - MIN_VISIBLE);
            break;
          case "w":
            next.left = clamp(orig.left + dx / w, 0, 1 - orig.right - MIN_VISIBLE);
            break;
          case "e":
            next.right = clamp(orig.right - dx / w, 0, 1 - orig.left - MIN_VISIBLE);
            break;
        }

        applyCrop(next);
      };

      const handleMouseUp = () => {
        setDeckDragging(false);
        document.removeEventListener("selectstart", prevent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [crop, w, h, scale, applyCrop],
  );

  // L-handle arm length
  const L = 16;
  const T = 2; // thickness

  return (
    <>
      {/* Full-canvas dim with cutout for the visible crop region */}
      <div
        className="absolute"
        style={{
          top: 0,
          left: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          background: "rgba(0,0,0,0.55)",
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${visX}px ${visY}px,
            ${visX}px ${visY + visH}px,
            ${visX + visW}px ${visY + visH}px,
            ${visX + visW}px ${visY}px,
            ${visX}px ${visY}px
          )`,
          pointerEvents: "auto",
          zIndex: 40,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* Crop border — thin white line around visible region */}
      <div
        className="absolute"
        style={{
          left: visX,
          top: visY,
          width: visW,
          height: visH,
          border: "1px solid rgba(255,255,255,0.7)",
          pointerEvents: "none",
          zIndex: 41,
        }}
      />

      {/* L-shaped corner handles */}
      <LCorner corner="nw" x={visX} y={visY} L={L} T={T} onMouseDown={handleCornerMouseDown} />
      <LCorner corner="ne" x={visX + visW} y={visY} L={L} T={T} onMouseDown={handleCornerMouseDown} />
      <LCorner corner="sw" x={visX} y={visY + visH} L={L} T={T} onMouseDown={handleCornerMouseDown} />
      <LCorner corner="se" x={visX + visW} y={visY + visH} L={L} T={T} onMouseDown={handleCornerMouseDown} />

      {/* Edge handles — short lines at the midpoint of each edge */}
      <EdgeLine edge="n" x={visX + visW / 2} y={visY} T={T} onMouseDown={handleEdgeMouseDown} />
      <EdgeLine edge="s" x={visX + visW / 2} y={visY + visH} T={T} onMouseDown={handleEdgeMouseDown} />
      <EdgeLine edge="w" x={visX} y={visY + visH / 2} T={T} onMouseDown={handleEdgeMouseDown} />
      <EdgeLine edge="e" x={visX + visW} y={visY + visH / 2} T={T} onMouseDown={handleEdgeMouseDown} />
    </>
  );
}

// ── L-shaped corner handle ────────────────────────────────────────

function LCorner({
  corner,
  x,
  y,
  L,
  T,
  onMouseDown,
}: {
  corner: Corner;
  x: number;
  y: number;
  L: number;
  T: number;
  onMouseDown: (e: React.MouseEvent, corner: Corner) => void;
}) {
  const cursors: Record<Corner, string> = {
    nw: "nw-resize",
    ne: "ne-resize",
    sw: "sw-resize",
    se: "se-resize",
  };

  // Compute the two arms of the L relative to the corner point
  // Each arm is a thin rectangle extending outward from the corner
  let hBar: React.CSSProperties;
  let vBar: React.CSSProperties;

  switch (corner) {
    case "nw":
      hBar = { left: x, top: y - T / 2, width: L, height: T };
      vBar = { left: x - T / 2, top: y, width: T, height: L };
      break;
    case "ne":
      hBar = { left: x - L, top: y - T / 2, width: L, height: T };
      vBar = { left: x - T / 2, top: y, width: T, height: L };
      break;
    case "sw":
      hBar = { left: x, top: y - T / 2, width: L, height: T };
      vBar = { left: x - T / 2, top: y - L, width: T, height: L };
      break;
    case "se":
      hBar = { left: x - L, top: y - T / 2, width: L, height: T };
      vBar = { left: x - T / 2, top: y - L, width: T, height: L };
      break;
  }

  // Hit area: generous invisible square around the corner
  const hitSize = L + 4;
  const hitStyle: React.CSSProperties = {
    position: "absolute",
    left: corner.includes("w") ? x - 4 : x - hitSize + 4,
    top: corner.includes("n") ? y - 4 : y - hitSize + 4,
    width: hitSize,
    height: hitSize,
    cursor: cursors[corner],
    pointerEvents: "auto",
    zIndex: 42,
  };

  return (
    <>
      {/* Visible L arms */}
      <div className="absolute bg-white" style={{ ...hBar, pointerEvents: "none", zIndex: 42 }} />
      <div className="absolute bg-white" style={{ ...vBar, pointerEvents: "none", zIndex: 42 }} />
      {/* Invisible hit area */}
      <div style={hitStyle} onMouseDown={(e) => onMouseDown(e, corner)} />
    </>
  );
}

// ── Edge handle — short line at midpoint ──────────────────────────

function EdgeLine({
  edge,
  x,
  y,
  T,
  onMouseDown,
}: {
  edge: Edge;
  x: number;
  y: number;
  T: number;
  onMouseDown: (e: React.MouseEvent, edge: Edge) => void;
}) {
  const horizontal = edge === "n" || edge === "s";
  const barLen = 24;

  const barStyle: React.CSSProperties = horizontal
    ? { left: x - barLen / 2, top: y - T / 2, width: barLen, height: T }
    : { left: x - T / 2, top: y - barLen / 2, width: T, height: barLen };

  const hitPad = 6;
  const hitStyle: React.CSSProperties = horizontal
    ? {
        position: "absolute" as const,
        left: x - barLen / 2 - hitPad,
        top: y - hitPad,
        width: barLen + hitPad * 2,
        height: hitPad * 2,
        cursor: "ns-resize",
        pointerEvents: "auto" as const,
        zIndex: 42,
      }
    : {
        position: "absolute" as const,
        left: x - hitPad,
        top: y - barLen / 2 - hitPad,
        width: hitPad * 2,
        height: barLen + hitPad * 2,
        cursor: "ew-resize",
        pointerEvents: "auto" as const,
        zIndex: 42,
      };

  return (
    <>
      <div className="absolute bg-white" style={{ ...barStyle, pointerEvents: "none", zIndex: 42 }} />
      <div style={hitStyle} onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onMouseDown(e, edge); }} />
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

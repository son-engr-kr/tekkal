import { useRef, useCallback, useState, useEffect, useMemo, memo } from "react";
import { motion } from "framer-motion";
import { useDeckStore, setDeckDragging } from "@/stores/deckStore";
import type { Slide, SlideElement, VideoElement as VideoElementType, ImageElement as ImageElementType, CropRect, ReferenceElement as ReferenceElementType } from "@/types/deck";
import { CANVAS_HEIGHT } from "@/types/deck";
import { getElementPositionStyle } from "@/utils/elementStyle";
import { CropOverlay } from "./CropOverlay";
import { WaypointOverlay } from "./WaypointOverlay";
import type { ShapeElement as ShapeElementType } from "@/types/deck";

import { setComponentClipboard } from "./clipboard";
import { computeBounds } from "@/utils/bounds";

function getGroupBounds(elements: SlideElement[]) {
  return computeBounds(elements);
}

interface Props {
  slide: Slide;
  scale: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  slideId: string;
  elementId: string;
}

export function SelectionOverlay({ slide, scale }: Props) {
  const selectedElementIds = useDeckStore((s) => s.selectedElementIds);
  const highlightedElementIds = useDeckStore((s) => s.highlightedElementIds);
  const cropElementId = useDeckStore((s) => s.cropElementId);
  const setCropElement = useDeckStore((s) => s.setCropElement);
  const trimElementId = useDeckStore((s) => s.trimElementId);
  const selectElement = useDeckStore((s) => s.selectElement);
  const selectElements = useDeckStore((s) => s.selectElements);
  const updateElement = useDeckStore((s) => s.updateElement);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Elements that have comments attached
  const commentedElementIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of slide.comments ?? []) {
      if (c.elementId && c.category !== "done") ids.add(c.elementId);
    }
    return ids;
  }, [slide.comments]);

  // Active group IDs: groups where any member is selected
  const activeGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selectedElementIds) {
      const el = slide.elements.find((e) => e.id === id);
      if (el?.groupId) ids.add(el.groupId);
    }
    return ids;
  }, [selectedElementIds, slide.elements]);

  // Expanded selection: selected elements + all their group members
  const moveTargetIds = useMemo(() => {
    const ids = new Set(selectedElementIds);
    for (const groupId of activeGroupIds) {
      for (const el of slide.elements) {
        if (el.groupId === groupId) ids.add(el.id);
      }
    }
    return ids;
  }, [selectedElementIds, activeGroupIds, slide.elements]);

  // Only show individual resize handles for ungrouped single selection (not during crop)
  const singleSelectedId = selectedElementIds.length === 1 ? selectedElementIds[0] : null;
  const isCropping = cropElementId !== null;
  const isTrimming = trimElementId !== null;

  // Stable callbacks: read latest state from store to avoid closure staleness
  const handleElementSelect = useCallback(
    (elementId: string, e: React.MouseEvent) => {
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[state.currentSlideIndex];
      if (!currentSlide) return;
      const element = currentSlide.elements.find((el) => el.id === elementId);
      if (!element) return;
      const sel = state.selectedElementIds;

      if (e.shiftKey) {
        if (element.groupId) {
          const groupMembers = currentSlide.elements
            .filter((el) => el.groupId === element.groupId)
            .map((el) => el.id);
          const merged = [...new Set([...sel, ...groupMembers])];
          selectElements(merged);
        } else {
          selectElement(element.id, "add");
        }
      } else if (e.ctrlKey || e.metaKey) {
        selectElement(element.id, "toggle");
      } else if (element.groupId) {
        const groupMembers = currentSlide.elements
          .filter((el) => el.groupId === element.groupId)
          .map((el) => el.id);
        selectElements(groupMembers);
      } else if (!sel.includes(element.id)) {
        selectElement(element.id);
      }
    },
    [selectElement, selectElements],
  );

  const handleElementDoubleClick = useCallback(
    (elementId: string) => {
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[state.currentSlideIndex];
      if (!currentSlide) return;
      const element = currentSlide.elements.find((el) => el.id === elementId);
      if (!element) return;

      if (element.type === "reference") {
        useDeckStore.getState().enterComponentEditMode((element as ReferenceElementType).componentId);
      } else if (element.groupId) {
        selectElement(element.id);
      } else if ((element.type === "image" || element.type === "video") && !state.cropElementId) {
        setCropElement(element.id);
      }
    },
    [selectElement, setCropElement],
  );

  const handleElementMove = useCallback(
    (elementId: string, targetX: number, targetY: number) => {
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[state.currentSlideIndex];
      if (!currentSlide) return;
      const draggedEl = currentSlide.elements.find((e) => e.id === elementId);
      if (!draggedEl) return;
      // Compute delta from current position to absolute target
      const dx = targetX - draggedEl.position.x;
      const dy = targetY - draggedEl.position.y;
      if (dx === 0 && dy === 0) return;

      const latestSelected = state.selectedElementIds;
      const allIds = new Set(latestSelected);
      if (latestSelected.length > 1) {
        for (const id of latestSelected) {
          const el = currentSlide.elements.find((e) => e.id === id);
          if (el?.groupId) {
            for (const m of currentSlide.elements) {
              if (m.groupId === el.groupId) allIds.add(m.id);
            }
          }
        }
      }
      const idsToMove = allIds.has(elementId) ? [...allIds] : [elementId];
      for (const elId of idsToMove) {
        const el = currentSlide.elements.find((e) => e.id === elId);
        if (el) {
          updateElement(currentSlide.id, elId, {
            position: { x: el.position.x + dx, y: el.position.y + dy },
          } as Partial<SlideElement>);
        }
      }
    },
    [updateElement],
  );

  const handleElementResize = useCallback(
    (elementId: string, targetX: number, targetY: number, targetW: number, targetH: number) => {
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[state.currentSlideIndex];
      if (!currentSlide) return;
      const el = currentSlide.elements.find((e) => e.id === elementId);
      if (!el) return;
      updateElement(currentSlide.id, elementId, {
        position: { x: targetX, y: targetY },
        size: { w: targetW, h: targetH },
      } as Partial<SlideElement>);
    },
    [updateElement],
  );

  const handleElementContextMenu = useCallback(
    (elementId: string, x: number, y: number) => {
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[state.currentSlideIndex];
      if (!currentSlide) return;
      setContextMenu({ x, y, slideId: currentSlide.id, elementId });
    },
    [],
  );

  // Group data for rendering bounding boxes with resize handles
  const activeGroups = useMemo(() => {
    return [...activeGroupIds].map((groupId) => {
      const members = slide.elements.filter((e) => e.groupId === groupId);
      return { groupId, members };
    }).filter((g) => g.members.length >= 2);
  }, [activeGroupIds, slide.elements]);

  return (
    <div
      className="absolute inset-0"
      style={{ transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}
    >
      {slide.elements.map((element) => (
        <InteractiveElement
          key={element.id + (highlightedElementIds.includes(element.id) ? "-hl" : "")}
          isHighlighted={highlightedElementIds.includes(element.id)}
          hasComment={commentedElementIds.has(element.id)}
          element={element}
          slideId={slide.id}
          isSelected={selectedElementIds.includes(element.id) || moveTargetIds.has(element.id)}
          showResizeHandles={element.id === singleSelectedId && !isCropping}
          onSelect={handleElementSelect}
          onDoubleClick={handleElementDoubleClick}
          onMove={handleElementMove}
          onResize={handleElementResize}
          onContextMenu={handleElementContextMenu}
          scale={scale}
        />
      ))}
      {/* Play/pause button for selected videos */}
      {slide.elements.map((element) => {
        if (element.type !== "video") return null;
        if (!selectedElementIds.includes(element.id)) return null;
        if (isCropping || isTrimming) return null;
        return <VideoControls key={`vc-${element.id}`} element={element} />;
      })}
      {/* Group bounding boxes with resize handles */}
      {activeGroups.map((group) => (
        <GroupBox
          key={group.groupId}
          members={group.members}
          slideId={slide.id}
          scale={scale}
          updateElement={updateElement}
        />
      ))}
      {/* Crop overlay — rendered at canvas level for full-canvas dimming */}
      {cropElementId && (() => {
        const cropEl = slide.elements.find((e) => e.id === cropElementId);
        if (!cropEl) return null;
        return <CropOverlay element={cropEl} slideId={slide.id} scale={scale} />;
      })()}
      {/* Waypoint overlay for selected line/arrow with waypoints */}
      {singleSelectedId && !isCropping && (() => {
        const el = slide.elements.find((e) => e.id === singleSelectedId);
        if (!el || el.type !== "shape") return null;
        const shapeEl = el as ShapeElementType;
        if (shapeEl.shape !== "line" && shapeEl.shape !== "arrow") return null;
        if (!shapeEl.style?.waypoints || shapeEl.style.waypoints.length < 2) return null;
        return <WaypointOverlay element={shapeEl} slideId={slide.id} scale={scale} />;
      })()}
      {contextMenu && (
        <ElementContextMenu
          {...contextMenu}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

type Corner = "nw" | "ne" | "sw" | "se";

interface InteractiveProps {
  element: SlideElement;
  slideId: string;
  isSelected: boolean;
  showResizeHandles: boolean;
  isHighlighted: boolean;
  hasComment: boolean;
  onSelect: (elementId: string, e: React.MouseEvent) => void;
  onDoubleClick: (elementId: string) => void;
  onMove: (elementId: string, targetX: number, targetY: number) => void;
  onResize: (elementId: string, targetX: number, targetY: number, targetW: number, targetH: number) => void;
  onContextMenu: (elementId: string, x: number, y: number) => void;
  scale: number;
}

const InteractiveElement = memo(function InteractiveElement({ element, isSelected, showResizeHandles, isHighlighted, hasComment, onSelect, onDoubleClick, onMove, onResize, onContextMenu, scale }: InteractiveProps) {
  const dragStart = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null);

  // Compute line/arrow hit area — use polyline-based hit test for all lines (with or without waypoints)
  const waypointInfo = useMemo(() => {
    if (element.type !== "shape") return null;
    const shape = element as ShapeElementType;
    if (shape.shape !== "line" && shape.shape !== "arrow") return null;
    const sw = shape.style?.strokeWidth ?? 2;
    const pad = Math.max(sw / 2 + 8, 10);
    const wps = shape.style?.waypoints;
    // Use waypoints if available, otherwise default straight line
    const pts = wps && wps.length >= 2
      ? wps
      : [{ x: 0, y: shape.size.h / 2 }, { x: shape.size.w, y: shape.size.h / 2 }];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      left: element.position.x + minX - pad,
      top: element.position.y + minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      points: pts.map(p => ({ x: p.x - minX + pad, y: p.y - minY + pad })),
      hasWaypoints: !!(wps && wps.length >= 2),
    };
  }, [element]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) {
        // Right-click: open context menu directly from mousedown
        // (contextmenu event may not fire reliably through motion.div)
        // Only change selection if the element isn't already selected
        // — preserves multi-selection when right-clicking a member
        e.stopPropagation();
        if (!useDeckStore.getState().selectedElementIds.includes(element.id)) {
          onSelect(element.id, e);
        }
        if (waypointInfo) {
          onContextMenu(element.id,
            waypointInfo.left + e.nativeEvent.offsetX,
            waypointInfo.top + e.nativeEvent.offsetY,
          );
        } else {
          onContextMenu(element.id,
            element.position.x + e.nativeEvent.offsetX,
            element.position.y + e.nativeEvent.offsetY,
          );
        }
        return;
      }
      if (e.button === 1) return; // middle-click: let it bubble for pan
      if (e.button !== 0) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // Read fresh from store to avoid stale closure issues.
      // Skip re-selection on plain click if already selected — preserves multi-select for drag.
      const alreadySelected = useDeckStore.getState().selectedElementIds.includes(element.id);
      if (!alreadySelected || e.shiftKey || e.ctrlKey || e.metaKey) {
        onSelect(element.id, e);
      }
      setDeckDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ex: element.position.x,
        ey: element.position.y,
      };

      // Block native text-selection & HTML drag during the entire gesture
      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);
      document.addEventListener("dragstart", prevent);

      const DRAG_THRESHOLD = 8; // px in screen space
      let dragStarted = false;
      let rafId = 0;

      const handleMouseUp = () => {
        cancelAnimationFrame(rafId);
        setDeckDragging(false);
        dragStart.current = null;
        document.removeEventListener("selectstart", prevent);
        document.removeEventListener("dragstart", prevent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragStart.current) return;
        // Safety: button already released but mouseup was swallowed (e.g. by <video> controls)
        if (me.buttons === 0) { handleMouseUp(); return; }
        // Threshold: ignore movement until exceeding minimum distance
        if (!dragStarted) {
          const rawDx = me.clientX - dragStart.current.x;
          const rawDy = me.clientY - dragStart.current.y;
          if (rawDx * rawDx + rawDy * rawDy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          dragStarted = true;
        }
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (!dragStart.current) return;
          const dx = (me.clientX - dragStart.current.x) / scale;
          const dy = (me.clientY - dragStart.current.y) / scale;
          onMove(element.id,
            Math.round(dragStart.current.ex + dx),
            Math.round(dragStart.current.ey + dy),
          );
        });
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [element.position.x, element.position.y, scale, onSelect, onMove, onContextMenu, waypointInfo],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  // Crop data for image/video elements
  const crop: CropRect | undefined =
    (element.type === "image" ? (element as ImageElementType).style?.crop
    : element.type === "video" ? (element as VideoElementType).style?.crop
    : undefined);
  const hasCrop = crop && (crop.top || crop.right || crop.bottom || crop.left);

  const cl = crop?.left ?? 0;
  const cr = crop?.right ?? 0;
  const ct = crop?.top ?? 0;
  const cb = crop?.bottom ?? 0;
  const visScaleX = (1 - cl - cr) || 1;
  const visScaleY = (1 - ct - cb) || 1;

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, corner: Corner) => {
      if (e.button === 1) return; // middle-click: let it bubble for pan
      e.stopPropagation();
      setDeckDragging(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = element.position.x;
      const origY = element.position.y;
      const origW = element.size.w;
      const origH = element.size.h;
      let rafId = 0;

      // No forced ratio lock — Shift key enables ratio lock for all types

      const handleMouseUp = () => {
        cancelAnimationFrame(rafId);
        setDeckDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const rawDx = (me.clientX - startX) / scale;
          const rawDy = (me.clientY - startY) / scale;

          const isLeft = corner === "nw" || corner === "sw";
          const isTop = corner === "nw" || corner === "ne";

          // Shift = lock aspect ratio
          const lockRatio = me.shiftKey;
          const aspectRatio = lockRatio ? origW / origH : null;
          // Ctrl = resize from center
          const fromCenter = me.ctrlKey || me.metaKey;

          // Step 1: compute raw dw/dh from mouse delta
          let dw = isLeft
            ? Math.round(-rawDx / visScaleX)
            : Math.round(rawDx / visScaleX);
          let dh = isTop
            ? Math.round(-rawDy / visScaleY)
            : Math.round(rawDy / visScaleY);

          // Step 2: enforce aspect ratio
          if (aspectRatio !== null) {
            const relW = Math.abs(dw) / (origW || 1);
            const relH = Math.abs(dh) / (origH || 1);
            if (relW >= relH) {
              dh = Math.round((origW + dw) / aspectRatio) - origH;
            } else {
              dw = Math.round((origH + dh) * aspectRatio) - origW;
            }
          }

          // Step 3: minimum size constraints
          if (origW + dw < 20) {
            dw = 20 - origW;
            if (aspectRatio !== null) dh = Math.round((origW + dw) / aspectRatio) - origH;
          }
          if (origH + dh < 20) {
            dh = 20 - origH;
            if (aspectRatio !== null) dw = Math.round((origH + dh) * aspectRatio) - origW;
          }

          // Step 4: compute position offsets
          let dx: number, dy: number;
          if (fromCenter) {
            // Resize from center: position shifts by half the size change
            dx = Math.round(-dw / 2);
            dy = Math.round(-dh / 2);
          } else {
            dx = isLeft ? Math.round(-(1 - cr) * dw) : Math.round(-cl * dw);
            dy = isTop ? Math.round(-(1 - cb) * dh) : Math.round(-ct * dh);
          }

          onResize(element.id,
            origX + dx,
            origY + dy,
            Math.max(20, origW + dw),
            Math.max(20, origH + dh),
          );
        });
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [element.position.x, element.position.y, element.size.w, element.size.h, element.type, element.id, scale, onResize, cl, cr, ct, cb, visScaleX, visScaleY],
  );

  return (
    <>
      <motion.div
        className="absolute cursor-move select-none"
        style={{
          ...(waypointInfo
            ? { left: waypointInfo.left, top: waypointInfo.top, width: waypointInfo.width, height: waypointInfo.height }
            : getElementPositionStyle(element)),
          pointerEvents: "none",
        }}
        draggable={false}
        initial={isHighlighted ? { boxShadow: "0 0 0 3px rgba(34,197,94,0.7)" } : false}
        animate={{ boxShadow: "0 0 0 0px rgba(34,197,94,0)" }}
        transition={{ duration: 0.8 }}
        onContextMenu={handleContextMenu}
      >
        {/* Hit-test area */}
        {waypointInfo ? (
          <svg
            className="absolute inset-0"
            style={{ width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
          >
            <polyline
              points={waypointInfo.points.map(p => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              style={{ pointerEvents: "stroke", cursor: "move" }}
              onMouseDown={handleMouseDown}
            />
          </svg>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              pointerEvents: "auto",
              clipPath: hasCrop
                ? `inset(${ct * 100}% ${cr * 100}% ${cb * 100}% ${cl * 100}%)`
                : undefined,
            }}
            onMouseDown={handleMouseDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onDoubleClick(element.id);
            }}
          />
        )}

        {/* Outline + handles */}
        <div
          className="absolute"
          style={{
            ...(waypointInfo
              ? { inset: 0 }
              : { top: `${ct * 100}%`, left: `${cl * 100}%`, right: `${cr * 100}%`, bottom: `${cb * 100}%` }),
            outline: isSelected ? "2px solid rgb(59,130,246)" : "none",
            pointerEvents: "none",
          }}
        >
          {showResizeHandles && !waypointInfo && (
            <>
              <ResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
              <ResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
              <ResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
              <ResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
            </>
          )}
          {hasComment && (
            <div
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-400"
              style={{ pointerEvents: "none" }}
            />
          )}
        </div>

      {/* Selected video: drag handle on the side closer to canvas center */}
      {element.type === "video" && isSelected && (
        <VideoDragHandle element={element} onMouseDown={handleMouseDown} />
      )}

    </motion.div>
    </>
  );
});

// ── Context Menu ──────────────────────────────────────────────────

function ElementContextMenu({
  x,
  y,
  slideId,
  elementId,
  onClose,
}: ContextMenuState & { onClose: () => void }) {
  const deck = useDeckStore((s) => s.deck);
  const selectedElementIds = useDeckStore((s) => s.selectedElementIds);
  const bringToFront = useDeckStore((s) => s.bringToFront);
  const sendToBack = useDeckStore((s) => s.sendToBack);
  const duplicateElement = useDeckStore((s) => s.duplicateElement);
  const deleteElement = useDeckStore((s) => s.deleteElement);
  const groupElements = useDeckStore((s) => s.groupElements);
  const ungroupElements = useDeckStore((s) => s.ungroupElements);
  const setCropElement = useDeckStore((s) => s.setCropElement);
  const createComponent = useDeckStore((s) => s.createComponent);
  const detachReference = useDeckStore((s) => s.detachReference);
  const enterComponentEditMode = useDeckStore((s) => s.enterComponentEditMode);

  const handleAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  // Determine crop eligibility
  const canCrop = (() => {
    const el = deck?.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === elementId);
    return el?.type === "image" || el?.type === "video";
  })();

  // Determine group context
  const slide = deck?.slides.find((s) => s.id === slideId);
  const clickedElement = slide?.elements.find((e) => e.id === elementId);
  const isReference = clickedElement?.type === "reference";
  // Can group: 2+ elements selected, not all in the same single group already
  const canGroup = !isReference && selectedElementIds.length >= 2 && (() => {
    const groupIds = new Set<string>();
    let allGrouped = true;
    for (const id of selectedElementIds) {
      const el = slide?.elements.find((e) => e.id === id);
      if (el?.groupId) groupIds.add(el.groupId);
      else allGrouped = false;
    }
    // Skip if all selected are already in exactly one group
    return !(allGrouped && groupIds.size === 1);
  })();
  const clickedGroupId = clickedElement?.groupId;
  // Can create component: element is in a group (and not already a reference)
  const canCreateComponent = !isReference && !!clickedGroupId;

  return (
    <>
      {/* Backdrop to close menu */}
      <div
        className="fixed inset-0"
        style={{ pointerEvents: "auto" }}
        onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        className="absolute bg-zinc-800 border border-zinc-700 rounded-md shadow-xl py-1 min-w-[160px] text-xs"
        style={{ left: x, top: y, pointerEvents: "auto", zIndex: 50 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ContextMenuItem
          label="Bring to Front"
          onClick={() => handleAction(() => bringToFront(slideId, elementId))}
        />
        <ContextMenuItem
          label="Send to Back"
          onClick={() => handleAction(() => sendToBack(slideId, elementId))}
        />
        {canCrop && (
          <>
            <div className="h-px bg-zinc-700 my-1" />
            <ContextMenuItem
              label="Crop"
              onClick={() => handleAction(() => setCropElement(elementId))}
            />
          </>
        )}
        <div className="h-px bg-zinc-700 my-1" />
        {/* Component actions for reference elements */}
        {isReference && (
          <>
            <ContextMenuItem
              label="Edit Component"
              onClick={() => handleAction(() => enterComponentEditMode((clickedElement as ReferenceElementType).componentId))}
            />
            <ContextMenuItem
              label="Copy Reference"
              onClick={() => handleAction(() => {
                const compId = (clickedElement as ReferenceElementType).componentId;
                setComponentClipboard(compId);
                navigator.clipboard.writeText(JSON.stringify({ __deckode: true, componentRef: compId })).catch(() => {});
              })}
            />
            <ContextMenuItem
              label="Detach (Inline)"
              onClick={() => handleAction(() => detachReference(slideId, elementId))}
            />
            <div className="h-px bg-zinc-700 my-1" />
          </>
        )}
        {/* Create Component from group */}
        {canCreateComponent && (
          <>
            <ContextMenuItem
              label="Create Component"
              onClick={() => handleAction(() => createComponent(slideId, clickedGroupId!))}
            />
            <div className="h-px bg-zinc-700 my-1" />
          </>
        )}
        {canGroup && (
          <ContextMenuItem
            label="Group"
            shortcut="Ctrl+G"
            onClick={() => handleAction(() => {
              // Read latest selection from store (not stale closure)
              const ids = useDeckStore.getState().selectedElementIds;
              groupElements(slideId, ids);
            })}
          />
        )}
        {clickedGroupId && !isReference && (
          <ContextMenuItem
            label="Ungroup"
            shortcut="Ctrl+Shift+G"
            onClick={() => handleAction(() => ungroupElements(slideId, clickedGroupId))}
          />
        )}
        {(canGroup || (clickedGroupId && !isReference)) && <div className="h-px bg-zinc-700 my-1" />}
        <ContextMenuItem
          label="Duplicate"
          shortcut="Ctrl+D"
          onClick={() => handleAction(() => duplicateElement(slideId, elementId))}
        />
        <ContextMenuItem
          label="Delete"
          shortcut="Del"
          danger
          onClick={() => handleAction(() => deleteElement(slideId, elementId))}
        />
      </div>
    </>
  );
}

function ContextMenuItem({
  label,
  shortcut,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-4 transition-colors ${
        danger
          ? "text-red-400 hover:bg-red-900/30"
          : "text-zinc-300 hover:bg-zinc-700"
      }`}
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && <span className="text-zinc-500">{shortcut}</span>}
    </button>
  );
}

// ── Group Box with Resize ─────────────────────────────────────────

function GroupBox({
  members,
  slideId,
  scale,
  updateElement,
}: {
  members: SlideElement[];
  slideId: string;
  scale: number;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const bounds = getGroupBounds(members);
  const pad = 4;

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, corner: Corner) => {
      e.stopPropagation();
      e.preventDefault();
      setDeckDragging(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const ob = { ...bounds };
      const origMembers = members.map((m) => ({
        id: m.id,
        x: m.position.x,
        y: m.position.y,
        w: m.size.w,
        h: m.size.h,
        waypoints: (m.type === "shape" && (m as ShapeElementType).style?.waypoints) || null,
        style: (m as ShapeElementType).style,
      }));

      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);
      let rafId = 0;

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const dx = (me.clientX - startX) / scale;
          const dy = (me.clientY - startY) / scale;

          const fromCenter = me.ctrlKey || me.metaKey;
          const lockRatio = me.shiftKey;

          let newW: number, newH: number;
          switch (corner) {
            case "se": newW = ob.w + dx; newH = ob.h + dy; break;
            case "sw": newW = ob.w - dx; newH = ob.h + dy; break;
            case "ne": newW = ob.w + dx; newH = ob.h - dy; break;
            case "nw": default: newW = ob.w - dx; newH = ob.h - dy; break;
          }

          // Shift: lock aspect ratio
          if (lockRatio) {
            const ratio = ob.w / ob.h;
            const relW = Math.abs(newW - ob.w) / ob.w;
            const relH = Math.abs(newH - ob.h) / ob.h;
            if (relW >= relH) {
              newH = newW / ratio;
            } else {
              newW = newH * ratio;
            }
          }

          newW = Math.max(20, newW);
          newH = Math.max(20, newH);
          const sx = newW / ob.w;
          const sy = newH / ob.h;

          // Ctrl: resize from center, otherwise from opposite corner
          let anchorX: number, anchorY: number;
          if (fromCenter) {
            anchorX = ob.x + ob.w / 2;
            anchorY = ob.y + ob.h / 2;
          } else {
            switch (corner) {
              case "se": anchorX = ob.x; anchorY = ob.y; break;
              case "sw": anchorX = ob.x + ob.w; anchorY = ob.y; break;
              case "ne": anchorX = ob.x; anchorY = ob.y + ob.h; break;
              case "nw": default: anchorX = ob.x + ob.w; anchorY = ob.y + ob.h; break;
            }
          }

          for (const orig of origMembers) {
            const patch: Partial<SlideElement> = {
              position: {
                x: Math.round(anchorX + (orig.x - anchorX) * sx),
                y: Math.round(anchorY + (orig.y - anchorY) * sy),
              },
              size: {
                w: Math.max(20, Math.round(orig.w * sx)),
                h: Math.max(20, Math.round(orig.h * sy)),
              },
            };
            if (orig.waypoints) {
              (patch as any).style = {
                ...orig.style,
                waypoints: orig.waypoints.map((p) => ({
                  x: Math.round(p.x * sx),
                  y: Math.round(p.y * sy),
                })),
              };
            }
            updateElement(slideId, orig.id, patch);
          }
        });
      };

      const handleMouseUp = () => {
        cancelAnimationFrame(rafId);
        setDeckDragging(false);
        document.removeEventListener("selectstart", prevent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [bounds, members, slideId, scale, updateElement],
  );

  return (
    <div
      className="absolute"
      style={{
        left: bounds.x - pad,
        top: bounds.y - pad,
        width: bounds.w + pad * 2,
        height: bounds.h + pad * 2,
        border: "2px dashed rgba(168, 85, 247, 0.6)",
        borderRadius: 4,
        pointerEvents: "none",
      }}
    >
      <ResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
      <ResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
      <ResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
      <ResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function VideoControls({ element }: { element: SlideElement }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  const videoEl = element as VideoElementType;
  const crop = videoEl.style?.crop;
  const { x, y } = element.position;
  const { w, h } = element.size;

  const cl = crop?.left ?? 0;
  const cr = crop?.right ?? 0;
  const cb = crop?.bottom ?? 0;

  const visLeft = x + w * cl;
  const visW = w * (1 - cl - cr);
  const visBottom = y + h * (1 - cb);

  const trimStart = videoEl.trimStart ?? 0;
  const trimEnd = videoEl.trimEnd;

  const getVideo = useCallback(() => {
    return document.querySelector(
      `[data-element-id="${element.id}"] video`,
    ) as HTMLVideoElement | null;
  }, [element.id]);

  useEffect(() => {
    const vid = getVideo();
    if (!vid) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(vid.currentTime);
    const onDur = () => setDuration(vid.duration || 0);

    vid.addEventListener("play", onPlay);
    vid.addEventListener("pause", onPause);
    vid.addEventListener("timeupdate", onTime);
    vid.addEventListener("loadedmetadata", onDur);
    vid.addEventListener("durationchange", onDur);

    setIsPlaying(!vid.paused);
    setCurrentTime(vid.currentTime);
    if (vid.duration) setDuration(vid.duration);

    return () => {
      vid.removeEventListener("play", onPlay);
      vid.removeEventListener("pause", onPause);
      vid.removeEventListener("timeupdate", onTime);
      vid.removeEventListener("loadedmetadata", onDur);
      vid.removeEventListener("durationchange", onDur);
    };
  }, [getVideo]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = getVideo();
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {});
    else vid.pause();
  };

  const effectiveTrimEnd = trimEnd ?? duration;

  const handleSeekDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bar = progressRef.current;
    const vid = getVideo();
    if (!bar || !vid || !duration) return;

    const seek = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratio * duration;
      vid.currentTime = Math.max(trimStart, Math.min(effectiveTrimEnd, time));
    };
    seek(e.clientX);

    const onMove = (me: MouseEvent) => seek(me.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };

  const hasTrim = videoEl.trimStart !== undefined || videoEl.trimEnd !== undefined;
  const trimStartPct = duration > 0 ? trimStart / duration : 0;
  const trimEndPct = duration > 0 ? effectiveTrimEnd / duration : 1;
  const pct = duration > 0 ? currentTime / duration : 0;
  const barH = 28;

  return (
    <div
      style={{
        position: "absolute",
        left: visLeft,
        top: visBottom - barH,
        width: visW,
        height: barH,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={togglePlay}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        )}
      </button>
      <div
        ref={progressRef}
        onMouseDown={handleSeekDown}
        style={{ flex: 1, height: 4, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2, cursor: "pointer", position: "relative" }}
      >
        {/* Gray-out regions outside trim range */}
        {hasTrim && trimStartPct > 0 && (
          <div style={{ position: "absolute", left: 0, top: 0, width: `${trimStartPct * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: "2px 0 0 2px" }} />
        )}
        {hasTrim && trimEndPct < 1 && (
          <div style={{ position: "absolute", right: 0, top: 0, width: `${(1 - trimEndPct) * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: "0 2px 2px 0" }} />
        )}
        <div style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: "#3b82f6", borderRadius: 2 }} />
      </div>
      <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {fmt(currentTime)}/{fmt(duration)}
      </span>
    </div>
  );
}

// ── Trim Overlay (rendered outside canvas in EditorCanvas) ──────────

export function TrimOverlay({ element, slideId }: { element: SlideElement; slideId: string }) {
  const updateElement = useDeckStore((s) => s.updateElement);
  const setTrimElement = useDeckStore((s) => s.setTrimElement);
  const [duration, setDuration] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const videoEl = element as VideoElementType;
  const trimStart = videoEl.trimStart ?? 0;
  const trimEnd = videoEl.trimEnd;

  const getVideo = useCallback(() => {
    return document.querySelector(
      `[data-element-id="${element.id}"] video`,
    ) as HTMLVideoElement | null;
  }, [element.id]);

  useEffect(() => {
    const vid = getVideo();
    if (!vid) return;
    const onDur = () => setDuration(vid.duration || 0);
    vid.addEventListener("loadedmetadata", onDur);
    vid.addEventListener("durationchange", onDur);
    if (vid.duration) setDuration(vid.duration);
    vid.pause();
    return () => {
      vid.removeEventListener("loadedmetadata", onDur);
      vid.removeEventListener("durationchange", onDur);
    };
  }, [getVideo]);

  const effectiveTrimEnd = trimEnd ?? duration;
  const trimStartPct = duration > 0 ? trimStart / duration : 0;
  const trimEndPct = duration > 0 ? effectiveTrimEnd / duration : 1;
  const trimDuration = Math.max(0, effectiveTrimEnd - trimStart);

  const handleDrag = useCallback((e: React.MouseEvent, which: "start" | "end") => {
    e.stopPropagation();
    e.preventDefault();
    const bar = barRef.current;
    const vid = getVideo();
    if (!bar || !vid || !duration) return;

    const doSeek = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = Math.round(ratio * duration * 10) / 10;

      if (which === "start") {
        const maxStart = (trimEnd ?? duration) - 0.1;
        const clamped = Math.max(0, Math.min(maxStart, time));
        vid.currentTime = clamped;
        updateElement(slideId, element.id, {
          trimStart: clamped <= 0 ? undefined : clamped,
        } as Partial<SlideElement>);
      } else {
        const minEnd = trimStart + 0.1;
        const clamped = Math.max(minEnd, Math.min(duration, time));
        vid.currentTime = clamped;
        updateElement(slideId, element.id, {
          trimEnd: clamped >= duration ? undefined : clamped,
        } as Partial<SlideElement>);
      }
    };
    doSeek(e.clientX);

    const onMove = (me: MouseEvent) => doSeek(me.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getVideo, duration, trimStart, trimEnd, slideId, element.id, updateElement]);

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0.0s";
    return `${s.toFixed(1)}s`;
  };

  return (
    <div
      style={{
          backgroundColor: "rgba(24,24,27,0.95)",
          borderRadius: 8,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          border: "1px solid rgba(245,158,11,0.3)",
        }}
      >
        {/* Trim bar */}
        <div
          ref={barRef}
          style={{ flex: 1, height: 12, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 6, position: "relative", cursor: "default" }}
        >
          {/* Active trim region */}
          <div style={{
            position: "absolute",
            left: `${trimStartPct * 100}%`,
            width: `${(trimEndPct - trimStartPct) * 100}%`,
            height: "100%",
            backgroundColor: "rgba(59,130,246,0.4)",
            borderRadius: 6,
          }} />
          {/* Dimmed outside regions */}
          {trimStartPct > 0 && (
            <div style={{ position: "absolute", left: 0, top: 0, width: `${trimStartPct * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: "6px 0 0 6px" }} />
          )}
          {trimEndPct < 1 && (
            <div style={{ position: "absolute", right: 0, top: 0, width: `${(1 - trimEndPct) * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: "0 6px 6px 0" }} />
          )}
          {/* Start handle */}
          <div
            onMouseDown={(e) => handleDrag(e, "start")}
            style={{
              position: "absolute",
              left: `${trimStartPct * 100}%`,
              top: -3,
              width: 8,
              height: 18,
              backgroundColor: "#f59e0b",
              borderRadius: 3,
              cursor: "ew-resize",
              transform: "translateX(-4px)",
              zIndex: 2,
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }}
          />
          {/* End handle */}
          <div
            onMouseDown={(e) => handleDrag(e, "end")}
            style={{
              position: "absolute",
              left: `${trimEndPct * 100}%`,
              top: -3,
              width: 8,
              height: 18,
              backgroundColor: "#f59e0b",
              borderRadius: 3,
              cursor: "ew-resize",
              transform: "translateX(-4px)",
              zIndex: 2,
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }}
          />
        </div>
        {/* Time info */}
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap" }}>
          {fmt(trimStart)} ~ {fmt(effectiveTrimEnd)} / {fmt(duration)} ({fmt(trimDuration)})
        </span>
        {/* Done button */}
        <button
          onClick={() => setTrimElement(null)}
          style={{
            background: "#f59e0b",
            border: "none",
            borderRadius: 4,
            color: "#18181b",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Done
        </button>
    </div>
  );
}

const HANDLE_POSITIONS: Record<Corner, string> = {
  nw: "-top-1 -left-1 cursor-nw-resize",
  ne: "-top-1 -right-1 cursor-ne-resize",
  sw: "-bottom-1 -left-1 cursor-sw-resize",
  se: "-bottom-1 -right-1 cursor-se-resize",
};

function VideoDragHandle({
  element,
  onMouseDown,
}: {
  element: SlideElement;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  // Place handle on whichever side (top/bottom) is closer to the canvas center
  const centerY = element.position.y + element.size.h / 2;
  const handleOnTop = centerY > CANVAS_HEIGHT / 2;

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 flex items-center justify-center
        w-16 h-5 rounded-full bg-zinc-700/80 cursor-move hover:bg-zinc-600/90 z-10`}
      style={{
        pointerEvents: "auto",
        ...(handleOnTop ? { top: -28 } : { bottom: -28 }),
      }}
      onMouseDown={onMouseDown}
    >
      {/* Grip dots */}
      <svg width="20" height="6" viewBox="0 0 20 6" fill="currentColor" className="text-zinc-300">
        <circle cx="4" cy="1.5" r="1.5" />
        <circle cx="10" cy="1.5" r="1.5" />
        <circle cx="16" cy="1.5" r="1.5" />
        <circle cx="4" cy="4.5" r="1.5" />
        <circle cx="10" cy="4.5" r="1.5" />
        <circle cx="16" cy="4.5" r="1.5" />
      </svg>
    </div>
  );
}

function ResizeHandle({
  corner,
  onMouseDown,
}: {
  corner: Corner;
  onMouseDown: (e: React.MouseEvent, corner: Corner) => void;
}) {
  return (
    <div
      className={`absolute w-2.5 h-2.5 bg-blue-500 rounded-full ${HANDLE_POSITIONS[corner]}`}
      style={{ pointerEvents: "auto" }}
      onMouseDown={(e) => onMouseDown(e, corner)}
    />
  );
}


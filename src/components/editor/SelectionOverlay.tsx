import { useRef, useCallback, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useDeckStore, setDeckDragging } from "@/stores/deckStore";
import type { Slide, SlideElement } from "@/types/deck";
import { CANVAS_HEIGHT } from "@/types/deck";
import { getElementPositionStyle } from "@/utils/elementStyle";
import { CropOverlay } from "./CropOverlay";

function getGroupBounds(elements: SlideElement[]) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of elements) {
    x1 = Math.min(x1, el.position.x);
    y1 = Math.min(y1, el.position.y);
    x2 = Math.max(x2, el.position.x + el.size.w);
    y2 = Math.max(y2, el.position.y + el.size.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
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
  const selectElement = useDeckStore((s) => s.selectElement);
  const selectElements = useDeckStore((s) => s.selectElements);
  const updateElement = useDeckStore((s) => s.updateElement);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Elements that have comments attached
  const commentedElementIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of slide.comments ?? []) {
      if (c.elementId) ids.add(c.elementId);
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

  // Group-aware select: clicking a grouped element always selects the whole group
  const handleSelect = useCallback(
    (element: SlideElement, e: React.MouseEvent) => {
      if (e.shiftKey) {
        if (element.groupId) {
          // Add all group members
          const groupMembers = slide.elements
            .filter((el) => el.groupId === element.groupId)
            .map((el) => el.id);
          const merged = [...new Set([...selectedElementIds, ...groupMembers])];
          selectElements(merged);
        } else {
          selectElement(element.id, "add");
        }
      } else if (e.ctrlKey || e.metaKey) {
        selectElement(element.id, "toggle");
      } else if (element.groupId) {
        // Always select entire group
        const groupMembers = slide.elements
          .filter((el) => el.groupId === element.groupId)
          .map((el) => el.id);
        selectElements(groupMembers);
      } else if (!selectedElementIds.includes(element.id)) {
        selectElement(element.id);
      }
      // If already selected with no modifier, keep current selection (enables multi-drag)
    },
    [slide.elements, selectedElementIds, selectElement, selectElements],
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
          isPassthrough={element.type === "video" && selectedElementIds.includes(element.id) && !isCropping}
          showResizeHandles={element.id === singleSelectedId && !element.groupId && !isCropping}
          onSelect={(e: React.MouseEvent) => handleSelect(element, e)}
          onDoubleClick={() => {
            if ((element.type === "image" || element.type === "video") && !isCropping) {
              setCropElement(element.id);
            }
          }}
          onMove={(dx, dy) => {
            // Read latest selection from store (not stale closure)
            // so first click-drag on a group member works immediately.
            const latestSelected = useDeckStore.getState().selectedElementIds;
            const allIds = new Set(latestSelected);
            for (const id of latestSelected) {
              const el = slide.elements.find((e) => e.id === id);
              if (el?.groupId) {
                for (const m of slide.elements) {
                  if (m.groupId === el.groupId) allIds.add(m.id);
                }
              }
            }
            const idsToMove = allIds.has(element.id) ? [...allIds] : [element.id];
            for (const elId of idsToMove) {
              const el = slide.elements.find((e) => e.id === elId);
              if (el) {
                updateElement(slide.id, elId, {
                  position: {
                    x: el.position.x + dx,
                    y: el.position.y + dy,
                  },
                } as Partial<SlideElement>);
              }
            }
          }}
          onResize={(dx, dy, dw, dh) => {
            updateElement(slide.id, element.id, {
              position: {
                x: element.position.x + dx,
                y: element.position.y + dy,
              },
              size: {
                w: Math.max(20, element.size.w + dw),
                h: Math.max(20, element.size.h + dh),
              },
            } as Partial<SlideElement>);
          }}
          onContextMenu={(x, y) => {
            setContextMenu({ x, y, slideId: slide.id, elementId: element.id });
          }}
          scale={scale}
        />
      ))}
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
  /** Let clicks pass through to the rendered element below (e.g. video controls),
   *  but render a click shield behind to prevent selecting elements underneath. */
  isPassthrough: boolean;
  showResizeHandles: boolean;
  isHighlighted: boolean;
  hasComment: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (dx: number, dy: number, dw: number, dh: number) => void;
  onContextMenu: (x: number, y: number) => void;
  scale: number;
}

function InteractiveElement({ element, isSelected, isPassthrough, showResizeHandles, isHighlighted, hasComment, onSelect, onDoubleClick, onMove, onResize, onContextMenu, scale }: InteractiveProps) {
  const dragStart = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) {
        // Right-click: open context menu directly from mousedown
        // (contextmenu event may not fire reliably through motion.div)
        // Only change selection if the element isn't already selected
        // — preserves multi-selection when right-clicking a member
        e.stopPropagation();
        if (!useDeckStore.getState().selectedElementIds.includes(element.id)) {
          onSelect(e);
        }
        onContextMenu(
          element.position.x + e.nativeEvent.offsetX,
          element.position.y + e.nativeEvent.offsetY,
        );
        return;
      }
      if (e.button !== 0) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onSelect(e);
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

      const handleMouseUp = () => {
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
        const dx = (me.clientX - dragStart.current.x) / scale;
        const dy = (me.clientY - dragStart.current.y) / scale;
        onMove(
          Math.round(dragStart.current.ex + dx - element.position.x),
          Math.round(dragStart.current.ey + dy - element.position.y),
        );
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [element.position.x, element.position.y, scale, onSelect, onMove, onContextMenu],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, corner: Corner) => {
      e.stopPropagation();
      setDeckDragging(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = element.position.x;
      const origY = element.position.y;
      const origW = element.size.w;
      const origH = element.size.h;

      const handleMouseUp = () => {
        setDeckDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        const rawDx = (me.clientX - startX) / scale;
        const rawDy = (me.clientY - startY) / scale;

        let dx = 0, dy = 0, dw = 0, dh = 0;
        switch (corner) {
          case "se":
            dw = Math.round(rawDx);
            dh = Math.round(rawDy);
            break;
          case "sw":
            dx = Math.round(rawDx);
            dw = -Math.round(rawDx);
            dh = Math.round(rawDy);
            break;
          case "ne":
            dy = Math.round(rawDy);
            dw = Math.round(rawDx);
            dh = -Math.round(rawDy);
            break;
          case "nw":
            dx = Math.round(rawDx);
            dy = Math.round(rawDy);
            dw = -Math.round(rawDx);
            dh = -Math.round(rawDy);
            break;
        }

        // Enforce minimum size
        const newW = origW + dw;
        const newH = origH + dh;
        if (newW < 20) { dw = 20 - origW; if (corner === "sw" || corner === "nw") dx = origW - 20; }
        if (newH < 20) { dh = 20 - origH; if (corner === "nw" || corner === "ne") dy = origH - 20; }

        onResize(
          (origX + dx) - element.position.x,
          (origY + dy) - element.position.y,
          (origW + dw) - element.size.w,
          (origH + dh) - element.size.h,
        );
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [element.position.x, element.position.y, element.size.w, element.size.h, scale, onResize],
  );

  return (
    <>
      {/* Click shield: when passthrough is active (e.g. selected video), this sits behind
          the element to catch clicks that fall through, preventing elements underneath
          from being accidentally selected. */}
      {isPassthrough && (
        <div
          className="absolute"
          style={{
            ...getElementPositionStyle(element),
            pointerEvents: "auto",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      <motion.div
        className="absolute cursor-move select-none"
        style={{
          ...getElementPositionStyle(element),
          outline: isSelected ? "2px solid rgb(59,130,246)" : "none",
          // auto: re-enable events (parent is pointer-events:none)
          // Passthrough: let clicks reach rendered element below (e.g. video controls)
          pointerEvents: isPassthrough ? "none" : "auto",
        }}
        draggable={false}
        initial={isHighlighted ? { boxShadow: "0 0 0 3px rgba(34,197,94,0.7)" } : false}
        animate={{ boxShadow: "0 0 0 0px rgba(34,197,94,0)" }}
        transition={{ duration: 0.8 }}
        onMouseDown={handleMouseDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick();
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Transparent overlay to capture mouse events */}
        <div className="absolute inset-0" />

      {/* Selected video: drag handle on the side closer to canvas center */}
      {element.type === "video" && isSelected && (
        <VideoDragHandle element={element} onMouseDown={handleMouseDown} />
      )}

      {/* Resize handles (only for single selection) */}
      {showResizeHandles && (
        <>
          <ResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
          <ResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
          <ResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
          <ResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
        </>
      )}

      {/* Comment badge */}
      {hasComment && (
        <div
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-400"
          style={{ pointerEvents: "none" }}
        />
      )}

    </motion.div>
    </>
  );
}

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
  // Can group: 2+ elements selected, not all in the same single group already
  const canGroup = selectedElementIds.length >= 2 && (() => {
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
        {clickedGroupId && (
          <ContextMenuItem
            label="Ungroup"
            shortcut="Ctrl+Shift+G"
            onClick={() => handleAction(() => ungroupElements(slideId, clickedGroupId))}
          />
        )}
        {(canGroup || clickedGroupId) && <div className="h-px bg-zinc-700 my-1" />}
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
      }));

      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);

      const handleMouseMove = (me: MouseEvent) => {
        if (me.buttons === 0) { handleMouseUp(); return; }
        const dx = (me.clientX - startX) / scale;
        const dy = (me.clientY - startY) / scale;

        let anchorX: number, anchorY: number, newW: number, newH: number;
        switch (corner) {
          case "se":
            anchorX = ob.x; anchorY = ob.y;
            newW = ob.w + dx; newH = ob.h + dy;
            break;
          case "sw":
            anchorX = ob.x + ob.w; anchorY = ob.y;
            newW = ob.w - dx; newH = ob.h + dy;
            break;
          case "ne":
            anchorX = ob.x; anchorY = ob.y + ob.h;
            newW = ob.w + dx; newH = ob.h - dy;
            break;
          case "nw":
          default:
            anchorX = ob.x + ob.w; anchorY = ob.y + ob.h;
            newW = ob.w - dx; newH = ob.h - dy;
            break;
        }

        newW = Math.max(20, newW);
        newH = Math.max(20, newH);
        const sx = newW / ob.w;
        const sy = newH / ob.h;

        for (const orig of origMembers) {
          updateElement(slideId, orig.id, {
            position: {
              x: Math.round(anchorX + (orig.x - anchorX) * sx),
              y: Math.round(anchorY + (orig.y - anchorY) * sy),
            },
            size: {
              w: Math.max(20, Math.round(orig.w * sx)),
              h: Math.max(20, Math.round(orig.h * sy)),
            },
          } as Partial<SlideElement>);
        }
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

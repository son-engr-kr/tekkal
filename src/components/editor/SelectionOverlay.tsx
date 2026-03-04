import { useRef, useCallback, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useDeckStore, setDeckDragging } from "@/stores/deckStore";
import type { Slide, SlideElement } from "@/types/deck";
import { CANVAS_HEIGHT } from "@/types/deck";

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
  const selectElement = useDeckStore((s) => s.selectElement);
  const selectElements = useDeckStore((s) => s.selectElements);
  const updateElement = useDeckStore((s) => s.updateElement);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const singleSelectedId = selectedElementIds.length === 1 ? selectedElementIds[0] : null;

  // Group-aware select: clicking a grouped element selects the whole group
  const handleSelect = useCallback(
    (element: SlideElement, e: React.MouseEvent) => {
      if (e.shiftKey) {
        selectElement(element.id, "add");
      } else if (e.ctrlKey || e.metaKey) {
        selectElement(element.id, "toggle");
      } else if (element.groupId) {
        // Grouped element: select entire group unless group is already fully selected
        const groupMembers = slide.elements
          .filter((el) => el.groupId === element.groupId)
          .map((el) => el.id);
        const allSelected = groupMembers.every((id) => selectedElementIds.includes(id));
        if (allSelected) {
          // Group already selected — narrow to single element
          selectElement(element.id);
        } else {
          selectElements(groupMembers);
        }
      } else if (!selectedElementIds.includes(element.id)) {
        selectElement(element.id);
      }
      // If already selected with no modifier, keep current selection (enables multi-drag)
    },
    [slide.elements, selectedElementIds, selectElement, selectElements],
  );

  // Compute visible group bounding boxes for selected groups
  const groupBoxes = useMemo(() => {
    const seenGroups = new Set<string>();
    const boxes: { groupId: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of selectedElementIds) {
      const el = slide.elements.find((e) => e.id === id);
      if (!el?.groupId || seenGroups.has(el.groupId)) continue;
      seenGroups.add(el.groupId);
      const members = slide.elements.filter((e) => e.groupId === el.groupId);
      if (members.length >= 2) {
        boxes.push({ groupId: el.groupId, ...getGroupBounds(members) });
      }
    }
    return boxes;
  }, [selectedElementIds, slide.elements]);

  return (
    <div
      className="absolute inset-0"
      style={{ transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}
    >
      {/* Group bounding boxes */}
      {groupBoxes.map((box) => (
        <div
          key={box.groupId}
          className="absolute pointer-events-none"
          style={{
            left: box.x - 4,
            top: box.y - 4,
            width: box.w + 8,
            height: box.h + 8,
            border: "2px dashed rgba(168, 85, 247, 0.6)",
            borderRadius: 4,
          }}
        />
      ))}
      {slide.elements.map((element) => (
        <InteractiveElement
          key={element.id + (highlightedElementIds.includes(element.id) ? "-hl" : "")}
          isHighlighted={highlightedElementIds.includes(element.id)}
          element={element}
          slideId={slide.id}
          isSelected={selectedElementIds.includes(element.id)}
          showResizeHandles={element.id === singleSelectedId}
          onSelect={(e: React.MouseEvent) => handleSelect(element, e)}
          onMove={(dx, dy) => {
            const idsToMove = selectedElementIds.includes(element.id)
              ? selectedElementIds
              : [element.id];
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
            if (!selectedElementIds.includes(element.id)) {
              handleSelect(element, { shiftKey: false, ctrlKey: false, metaKey: false } as React.MouseEvent);
            }
            setContextMenu({ x, y, slideId: slide.id, elementId: element.id });
          }}
          scale={scale}
        />
      ))}
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
  onSelect: (e: React.MouseEvent) => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (dx: number, dy: number, dw: number, dh: number) => void;
  onContextMenu: (x: number, y: number) => void;
  scale: number;
}

function InteractiveElement({ element, isSelected, showResizeHandles, isHighlighted, onSelect, onMove, onResize, onContextMenu, scale }: InteractiveProps) {
  const dragStart = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    [element.position.x, element.position.y, scale, onSelect, onMove],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(element.position.x + e.nativeEvent.offsetX, element.position.y + e.nativeEvent.offsetY);
    },
    [element.position.x, element.position.y, onContextMenu],
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
    <motion.div
      className="absolute cursor-move select-none"
      style={{
        left: element.position.x,
        top: element.position.y,
        width: element.size.w,
        height: element.size.h,
        // outline instead of ring: framer-motion's boxShadow animate overrides Tailwind ring (both use box-shadow)
        outline: isSelected ? "2px solid rgb(59,130,246)" : "none",
        // auto: re-enable events (parent is pointer-events:none)
        // Selected video: let clicks pass through to native <video> controls
        pointerEvents: element.type === "video" && isSelected ? "none" : "auto",
      }}
      draggable={false}
      initial={isHighlighted ? { boxShadow: "0 0 0 3px rgba(34,197,94,0.7)" } : false}
      animate={{ boxShadow: "0 0 0 0px rgba(34,197,94,0)" }}
      transition={{ duration: 0.8 }}
      onMouseDown={handleMouseDown}
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
    </motion.div>
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

  const handleAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  // Determine group context
  const slide = deck?.slides.find((s) => s.id === slideId);
  const clickedElement = slide?.elements.find((e) => e.id === elementId);
  const canGroup = selectedElementIds.length >= 2 && selectedElementIds.every((id) => {
    const el = slide?.elements.find((e) => e.id === id);
    return el && !el.groupId;
  });
  const clickedGroupId = clickedElement?.groupId;

  return (
    <>
      {/* Backdrop to close menu */}
      <div
        className="fixed inset-0"
        style={{ pointerEvents: "auto" }}
        onMouseDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="absolute bg-zinc-800 border border-zinc-700 rounded-md shadow-xl py-1 min-w-[160px] text-xs"
        style={{ left: x, top: y, pointerEvents: "auto", zIndex: 50 }}
      >
        <ContextMenuItem
          label="Bring to Front"
          onClick={() => handleAction(() => bringToFront(slideId, elementId))}
        />
        <ContextMenuItem
          label="Send to Back"
          onClick={() => handleAction(() => sendToBack(slideId, elementId))}
        />
        <div className="h-px bg-zinc-700 my-1" />
        {canGroup && (
          <ContextMenuItem
            label="Group"
            shortcut="Ctrl+G"
            onClick={() => handleAction(() => groupElements(slideId, selectedElementIds))}
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

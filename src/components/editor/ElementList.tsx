import { useRef, useState, memo } from "react";
import { useDeckStore } from "@/stores/deckStore";
import type { SlideElement } from "@/types/deck";

/** Human-readable label for an element. */
function elementLabel(el: SlideElement): string {
  switch (el.type) {
    case "text": {
      const raw = el.content.replace(/[#*_`>\-\[\]()!]/g, "").trim();
      return raw.length > 24 ? raw.slice(0, 24) + "…" : raw || "Text";
    }
    case "image":
      return el.src.split("/").pop()?.split("?")[0] || "Image";
    case "video":
      return el.src.split("/").pop()?.split("?")[0] || "Video";
    case "code":
      return el.language ? `Code (${el.language})` : "Code";
    case "shape":
      return el.shape.charAt(0).toUpperCase() + el.shape.slice(1);
    case "tikz":
      return "TikZ";
    case "table":
      return "Table";
    case "mermaid":
      return "Mermaid";
    case "scene3d":
      return "3D Scene";
    case "custom":
      return el.component || "Custom";
    case "reference":
      return `Ref: ${el.componentId}`;
  }
}

const TYPE_ICONS: Record<string, string> = {
  text: "T",
  image: "🖼",
  video: "▶",
  code: "</>",
  shape: "◇",
  tikz: "∮",
  table: "⊞",
  mermaid: "⑆",
  scene3d: "3D",
  custom: "✦",
  reference: "↗",
};

interface Props {
  onSelectElement: (elementId: string) => void;
}

export const ElementList = memo(function ElementList({ onSelectElement }: Props) {
  const slide = useDeckStore((s) => s.deck?.slides[s.currentSlideIndex]);
  const selectedElementIds = useDeckStore((s) => s.selectedElementIds);
  const moveElementOrder = useDeckStore((s) => s.moveElementOrder);
  const deleteElement = useDeckStore((s) => s.deleteElement);
  const selectElement = useDeckStore((s) => s.selectElement);

  const dragIndexRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  if (!slide) return null;

  // Display in reverse: top layer (last in array) first
  const elements = [...slide.elements].reverse();

  const handleDragStart = (arrayIndex: number) => {
    dragIndexRef.current = arrayIndex;
  };

  const handleDragOver = (e: React.DragEvent, arrayIndex: number) => {
    e.preventDefault();
    if (dragIndexRef.current !== null && dragIndexRef.current !== arrayIndex) {
      setDropTarget(arrayIndex);
    }
  };

  const handleDrop = (arrayIndex: number) => {
    if (dragIndexRef.current !== null && dragIndexRef.current !== arrayIndex) {
      // Convert reversed display indices back to real array indices
      const realFrom = elements.length - 1 - dragIndexRef.current;
      const realTo = elements.length - 1 - arrayIndex;
      moveElementOrder(slide.id, realFrom, realTo);
    }
    dragIndexRef.current = null;
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDropTarget(null);
  };

  const handleClick = (elementId: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      selectElement(elementId, "toggle");
    } else if (e.shiftKey) {
      selectElement(elementId, "add");
    } else {
      onSelectElement(elementId);
    }
  };

  const handleDelete = (elementId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElement(slide.id, elementId);
  };

  // Group tracking for visual grouping
  const groupColors = new Map<string, string>();
  const GROUP_PALETTE = [
    "border-l-blue-500",
    "border-l-emerald-500",
    "border-l-amber-500",
    "border-l-purple-500",
    "border-l-rose-500",
    "border-l-cyan-500",
  ];
  let groupIdx = 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Elements
        </span>
        <span className="text-[10px] text-zinc-600">{elements.length}</span>
      </div>

      {elements.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 px-4 text-center">
          No elements on this slide
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {elements.map((el, displayIdx) => {
            const isSelected = selectedElementIds.includes(el.id);
            const isDropTarget = dropTarget === displayIdx;

            // Group color
            let groupClass = "";
            if (el.groupId) {
              if (!groupColors.has(el.groupId)) {
                groupColors.set(el.groupId, GROUP_PALETTE[groupIdx % GROUP_PALETTE.length]!);
                groupIdx++;
              }
              groupClass = `border-l-2 ${groupColors.get(el.groupId)}`;
            }

            return (
              <div
                key={el.id}
                draggable
                onDragStart={() => handleDragStart(displayIdx)}
                onDragOver={(e) => handleDragOver(e, displayIdx)}
                onDrop={() => handleDrop(displayIdx)}
                onDragEnd={handleDragEnd}
                onClick={(e) => handleClick(el.id, e)}
                className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-[11px] transition-colors ${
                  isSelected
                    ? "bg-blue-500/20 text-zinc-200"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300"
                } ${isDropTarget ? "border-t border-blue-500" : ""} ${groupClass}`}
              >
                {/* Drag handle */}
                <span className="text-zinc-600 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity select-none text-[9px]">
                  ⠿
                </span>
                {/* Type icon */}
                <span className="w-5 text-center text-[10px] text-zinc-500 shrink-0 select-none">
                  {TYPE_ICONS[el.type] ?? "?"}
                </span>
                {/* Label */}
                <span className="flex-1 truncate select-none">
                  {elementLabel(el)}
                </span>
                {/* ID badge */}
                <span className="text-[9px] text-zinc-600 font-mono shrink-0 select-none">
                  {el.id}
                </span>
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(el.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all text-xs leading-none ml-0.5"
                  title="Delete element"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

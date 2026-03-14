import { useRef, useEffect, useState, useCallback, memo } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { nextSlideId, cloneSlide } from "@/utils/id";
import { useAdapter } from "@/contexts/AdapterContext";
import type { Slide, DeckTheme } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { LayoutInfo } from "@/adapters/types";

interface SlideContextMenuState {
  x: number;
  y: number;
  slideId: string;
  slideIndex: number;
}
// Restrict drag movement to vertical axis only (prevents horizontal viewport scroll)
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

// Chrome around each thumbnail: button border-2 (4px) + p-0.5 (4px)
const THUMB_CHROME = 8;
const DEFAULT_THUMB_SCALE = 0.15;
const MIN_THUMB_SCALE = 0.1;

function createBlankSlide(): Slide {
  return {
    id: nextSlideId(),
    background: { color: "#ffffff" },
    elements: [],
  };
}

export function SlideList() {
  const slides = useDeckStore((s) => s.deck?.slides);
  const theme = useDeckStore((s) => s.deck?.theme);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const selectedSlideIds = useDeckStore((s) => s.selectedSlideIds);
  const setCurrentSlide = useDeckStore((s) => s.setCurrentSlide);
  const setSelectedSlides = useDeckStore((s) => s.setSelectedSlides);
  const addSlide = useDeckStore((s) => s.addSlide);
  const deleteSlide = useDeckStore((s) => s.deleteSlide);
  const toggleSlideHidden = useDeckStore((s) => s.toggleSlideHidden);
  const moveSlide = useDeckStore((s) => s.moveSlide);
  const adapter = useAdapter();
  const listRef = useRef<HTMLDivElement>(null);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<SlideContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [layouts, setLayouts] = useState<LayoutInfo[]>([]);
  const [thumbScale, setThumbScale] = useState(DEFAULT_THUMB_SCALE);

  // Require 5px movement before drag starts (so clicks still work)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Responsive thumbnail scale: observe container width
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) {
        setThumbScale(Math.max(MIN_THUMB_SCALE, (w - THUMB_CHROME) / CANVAS_WIDTH));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const thumbH = Math.round(CANVAS_HEIGHT * thumbScale);

  // Load layouts when picker opens
  useEffect(() => {
    if (!showLayoutPicker) return;
    adapter.listLayouts().then(setLayouts);
  }, [showLayoutPicker, adapter]);

  // Auto-scroll to current slide
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const child = container.children[currentSlideIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentSlideIndex]);

  if (!slides) return null;

  const handleAddSlide = () => {
    const slide = createBlankSlide();
    const lastIndex = slides.length - 1;
    addSlide(slide, lastIndex);
    setCurrentSlide(lastIndex + 1);
  };

  const handleAddFromLayout = async (layoutName: string) => {
    const templateSlide = await adapter.loadLayout(layoutName);
    // Assign fresh IDs so multiple slides from the same layout don't collide
    const slideId = nextSlideId();
    const slide: Slide = {
      ...templateSlide,
      id: slideId,
      layout: layoutName,
      elements: templateSlide.elements.map((el: any) => ({
        ...el,
        id: `${slideId}-${el.id}`,
      })),
    };
    const lastIndex = slides.length - 1;
    addSlide(slide, lastIndex);
    setCurrentSlide(lastIndex + 1);
    setShowLayoutPicker(false);
  };

  const handleDeleteSlide = (slideId: string, index: number) => {
    if (slides.length <= 1) return;
    deleteSlide(slideId);
    if (index > 0) setCurrentSlide(index - 1);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = slides.findIndex((s) => s.id === active.id);
    const toIndex = slides.findIndex((s) => s.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      moveSlide(fromIndex, toIndex);
    }
  };

  const slideIds = slides.map((s) => s.id);

  return (
    <div ref={listRef} className="flex flex-col gap-1.5 p-2 overflow-y-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={slideIds} strategy={verticalListSortingStrategy}>
          {slides.map((slide, index) => (
            <SortableSlideItem
              key={slide.id}
              slide={slide}
              index={index}
              scale={thumbScale}
              isCurrent={index === currentSlideIndex}
              isSelected={selectedSlideIds.includes(slide.id)}
              hasComments={!!slide.comments?.length}
              onSelect={(e: React.MouseEvent) => {
                if (e.ctrlKey || e.metaKey) {
                  // Toggle in/out of selection
                  const newIds = selectedSlideIds.includes(slide.id)
                    ? selectedSlideIds.filter((id) => id !== slide.id)
                    : [...selectedSlideIds, slide.id];
                  setSelectedSlides(newIds.length > 0 ? newIds : [slide.id]);
                  useDeckStore.setState({ currentSlideIndex: index, selectedElementIds: [] });
                } else if (e.shiftKey) {
                  // Range select from currentSlideIndex to clicked index
                  const start = Math.min(currentSlideIndex, index);
                  const end = Math.max(currentSlideIndex, index);
                  const rangeIds = slides.slice(start, end + 1).map((s) => s.id);
                  setSelectedSlides(rangeIds);
                  useDeckStore.setState({ currentSlideIndex: index, selectedElementIds: [] });
                } else {
                  setCurrentSlide(index);
                }
              }}
              onContextMenu={(x, y) => setContextMenu({ x, y, slideId: slide.id, slideIndex: index })}
              theme={theme}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Slide context menu */}
      {contextMenu && (
        <SlideContextMenu
          {...contextMenu}
          canDelete={slides.length > 1}
          isHidden={!!slides[contextMenu.slideIndex]?.hidden}
          onNewSlide={() => {
            const slide = createBlankSlide();
            addSlide(slide, contextMenu.slideIndex);
            setCurrentSlide(contextMenu.slideIndex + 1);
            closeContextMenu();
          }}
          onDuplicate={() => {
            const source = slides[contextMenu.slideIndex];
            if (source) {
              const clone = cloneSlide(source);
              addSlide(clone, contextMenu.slideIndex);
              setCurrentSlide(contextMenu.slideIndex + 1);
            }
            closeContextMenu();
          }}
          onToggleHidden={() => { toggleSlideHidden(contextMenu.slideId); closeContextMenu(); }}
          onDelete={() => { handleDeleteSlide(contextMenu.slideId, contextMenu.slideIndex); closeContextMenu(); }}
          onClose={closeContextMenu}
        />
      )}

      {/* Add slide buttons */}
      <div className="flex gap-1 shrink-0">
        <button
          onClick={handleAddSlide}
          className="flex-1 rounded border-2 border-dashed border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center text-lg"
          style={{ height: thumbH + 6 }}
          title="Add blank slide"
        >
          +
        </button>
        <button
          onClick={() => setShowLayoutPicker(!showLayoutPicker)}
          className={`w-8 rounded border-2 transition-colors flex items-center justify-center text-[10px] ${
            showLayoutPicker
              ? "border-blue-500 text-blue-400"
              : "border-dashed border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-300"
          }`}
          style={{ height: thumbH + 6 }}
          title="Add from layout"
        >
          L
        </button>
      </div>

      {/* Layout picker dropdown */}
      {showLayoutPicker && (
        <div className="shrink-0 rounded bg-zinc-900 border border-zinc-700 p-1.5">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 px-1">Layouts</div>
          {layouts.length === 0 && (
            <div className="text-[10px] text-zinc-600 px-1">No layouts found</div>
          )}
          {layouts.map((layout) => (
            <button
              key={layout.name}
              onClick={() => handleAddFromLayout(layout.name)}
              className="w-full text-left text-[11px] px-1.5 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              {layout.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SortableSlideItem = memo(function SortableSlideItem({
  slide,
  index,
  scale,
  isCurrent,
  isSelected,
  hasComments,
  onSelect,
  onContextMenu,
  theme,
}: {
  slide: Slide;
  index: number;
  scale: number;
  isCurrent: boolean;
  isSelected: boolean;
  hasComments: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number) => void;
  theme?: DeckTheme;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative group shrink-0" onContextMenu={handleContextMenu}>
      <button
        onClick={onSelect}
        className={`rounded border-2 transition-colors p-0.5 ${
          isCurrent
            ? "border-blue-500"
            : isSelected
              ? "border-blue-400/60"
              : "border-zinc-700 hover:border-zinc-500"
        }`}
      >
        <div className="relative rounded-sm overflow-hidden pointer-events-none">
          <SlideRenderer slide={slide} scale={scale} thumbnail theme={theme} />
          {slide.hidden && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Hidden</span>
            </div>
          )}
        </div>
        <span className="absolute bottom-1 right-2 text-xs text-zinc-400 font-mono font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {index + 1}
        </span>
      </button>

      {/* Comment badge */}
      {hasComments && (
        <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-amber-400" />
      )}
    </div>
  );
});

// ── Slide Context Menu ────────────────────────────────────────────

function SlideContextMenu({
  x,
  y,
  isHidden,
  canDelete,
  onNewSlide,
  onDuplicate,
  onToggleHidden,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  slideId: string;
  slideIndex: number;
  isHidden: boolean;
  canDelete: boolean;
  onNewSlide: () => void;
  onDuplicate: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0"
        style={{ pointerEvents: "auto", zIndex: 40 }}
        onMouseDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed bg-zinc-800 border border-zinc-700 rounded-md shadow-xl py-1 min-w-[160px] text-xs"
        style={{ left: x, top: y, pointerEvents: "auto", zIndex: 50 }}
      >
        <ContextMenuItem label="New Slide" onClick={onNewSlide} />
        <ContextMenuItem label="Duplicate Slide" onClick={onDuplicate} />
        <div className="h-px bg-zinc-700 my-1" />
        <ContextMenuItem
          label={isHidden ? "Show Slide" : "Hide Slide"}
          onClick={onToggleHidden}
        />
        {canDelete && (
          <>
            <div className="h-px bg-zinc-700 my-1" />
            <ContextMenuItem label="Delete" danger onClick={onDelete} />
          </>
        )}
      </div>
    </>
  );
}

function ContextMenuItem({
  label,
  danger,
  onClick,
}: {
  label: string;
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
      {label}
    </button>
  );
}

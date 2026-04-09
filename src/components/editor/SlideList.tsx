import { useRef, useEffect, useState, useCallback, memo, useMemo } from "react";
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
import type { Slide, DeckTheme, ReferenceElement, SharedComponent } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import { setSlideClipboard, setElementClipboard } from "./clipboard";
import { restoreSlideAssets, restoreElementAssets, collectAssetDataUrls } from "@/utils/crossInstanceAssets";
import type { LayoutInfo } from "@/adapters/types";
import { useGitDiff } from "@/contexts/GitDiffContext";

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

/**
 * Track which slide IDs are near the viewport using IntersectionObserver.
 * Returns a Set of slide IDs that should render their full thumbnail.
 */
function useVisibleThumbnails(slideIds: string[], currentIndex: number) {
  // Seed with a window around the current slide so it's never a placeholder on first render
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => {
    const start = Math.max(0, currentIndex - 10);
    const end = Math.min(slideIds.length, currentIndex + 10);
    return new Set(slideIds.slice(start, end));
  });
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef<Map<string, Element>>(new Map());

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.slideThumbId;
            if (!id) continue;
            if (entry.isIntersecting && !next.has(id)) {
              next.add(id);
              changed = true;
            } else if (!entry.isIntersecting && next.has(id)) {
              next.delete(id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { rootMargin: "200px 0px" },
    );

    // Observe all currently registered elements
    for (const el of elementsRef.current.values()) {
      observerRef.current.observe(el);
    }

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const observe = useCallback((id: string, el: Element | null) => {
    const observer = observerRef.current;
    const prev = elementsRef.current.get(id);
    if (prev && prev !== el) {
      observer?.unobserve(prev);
      elementsRef.current.delete(id);
    }
    if (el) {
      elementsRef.current.set(id, el);
      observer?.observe(el);
    }
  }, []);

  return { visibleIds, observe };
}

function createBlankSlide(): Slide {
  return {
    id: nextSlideId(),
    background: { color: "#ffffff" },
    elements: [],
  };
}

const THUMB_DEBOUNCE_MS = 300;

export function SlideList({ showDiff = false }: { showDiff?: boolean }) {
  const liveSlides = useDeckStore((s) => s.deck?.slides);
  const theme = useDeckStore((s) => s.deck?.theme);

  // Debounce slides for thumbnails: prevents re-rendering during drag/typing
  // But update immediately when slide count/order changes
  const [slides, setSlides] = useState(liveSlides);
  const liveIds = useMemo(() => liveSlides?.map((s) => s.id).join(","), [liveSlides]);
  const slidesIds = useMemo(() => slides?.map((s) => s.id).join(","), [slides]);
  useEffect(() => {
    if (liveIds !== slidesIds) {
      // Structural change (add/remove/reorder) → update immediately
      setSlides(liveSlides);
      return;
    }
    const timer = setTimeout(() => setSlides(liveSlides), THUMB_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [liveSlides, liveIds, slidesIds]);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const selectedSlideIds = useDeckStore((s) => s.selectedSlideIds);
  const setCurrentSlide = useDeckStore((s) => s.setCurrentSlide);
  const setSelectedSlides = useDeckStore((s) => s.setSelectedSlides);
  const addSlide = useDeckStore((s) => s.addSlide);
  const deleteSlide = useDeckStore((s) => s.deleteSlide);
  const toggleSlideHidden = useDeckStore((s) => s.toggleSlideHidden);
  const updateSlide = useDeckStore((s) => s.updateSlide);
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
  const { visibleIds, observe } = useVisibleThumbnails(slideIds, currentSlideIndex);
  const gitDiff = useGitDiff();
  const effectiveGitChangedIds = showDiff && gitDiff.available ? gitDiff.changedSlideIds : null;

  const handleSlideSelect = useCallback(
    (index: number, e: React.MouseEvent) => {
      const state = useDeckStore.getState();
      const allSlides = state.deck?.slides;
      if (!allSlides) return;
      const slideId = allSlides[index]?.id;
      if (!slideId) return;
      const sel = state.selectedSlideIds;

      if (e.ctrlKey || e.metaKey) {
        const newIds = sel.includes(slideId)
          ? sel.filter((id) => id !== slideId)
          : [...sel, slideId];
        setSelectedSlides(newIds.length > 0 ? newIds : [slideId]);
        useDeckStore.setState({ currentSlideIndex: index, selectedElementIds: [] });
      } else if (e.shiftKey) {
        const ci = state.currentSlideIndex;
        const start = Math.min(ci, index);
        const end = Math.max(ci, index);
        const rangeIds = allSlides.slice(start, end + 1).map((s) => s.id);
        setSelectedSlides(rangeIds);
        useDeckStore.setState({ currentSlideIndex: index, selectedElementIds: [] });
      } else {
        setCurrentSlide(index);
      }
    },
    [setSelectedSlides, setCurrentSlide],
  );

  const handleSlideContextMenu = useCallback(
    (index: number, x: number, y: number) => {
      const state = useDeckStore.getState();
      const slideId = state.deck?.slides[index]?.id;
      if (!slideId) return;
      setContextMenu({ x, y, slideId, slideIndex: index });
    },
    [],
  );

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
              isVisible={index === currentSlideIndex || visibleIds.has(slide.id)}
              observeRef={observe}
              hasComments={!!slide.comments?.some((c) => c.category !== "done")}
              gitChanged={!!effectiveGitChangedIds?.has(slide.id)}
              onSelect={handleSlideSelect}
              onContextMenu={handleSlideContextMenu}
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
          hidePageNumber={!!slides[contextMenu.slideIndex]?.hidePageNumber}
          pageNumbersEnabled={!!useDeckStore.getState().deck?.pageNumbers?.enabled}
          onNewSlide={() => {
            const slide = createBlankSlide();
            addSlide(slide, contextMenu.slideIndex);
            setCurrentSlide(contextMenu.slideIndex + 1);
            closeContextMenu();
          }}
          onCopy={() => {
            const state = useDeckStore.getState();
            const deck = state.deck;
            if (!deck) { closeContextMenu(); return; }
            const sel = state.selectedSlideIds;
            const slidesToCopy = sel.length > 1
              ? sel.map(id => deck.slides.find(s => s.id === id)).filter((s): s is Slide => !!s)
              : [slides[contextMenu.slideIndex]].filter((s): s is Slide => !!s);
            if (slidesToCopy.length === 0) { closeContextMenu(); return; }
            const slidesData: Slide[] = JSON.parse(JSON.stringify(slidesToCopy));
            const components: Record<string, SharedComponent> = {};
            for (const s of slidesData) {
              for (const el of s.elements) {
                if (el.type === "reference" && deck.components) {
                  const compId = (el as ReferenceElement).componentId;
                  const comp = deck.components[compId];
                  if (comp) components[compId] = comp;
                }
              }
            }
            setSlideClipboard(slidesData);
            setElementClipboard(null);
            const clipData: Record<string, unknown> = { __deckode: true, origin: window.location.origin, project: adapter.projectName, slides: slidesData };
            if (Object.keys(components).length > 0) clipData.components = components;
            const allEls = slidesData.flatMap(s => s.elements);
            const bgImages = slidesData.map(s => s.background?.image).filter((v): v is string => !!v);
            collectAssetDataUrls(allEls, adapter, bgImages).then((assetData) => {
              if (Object.keys(assetData).length > 0) clipData.assetData = assetData;
              navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
            }).catch(() => {
              navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
            });
            closeContextMenu();
          }}
          onPaste={async () => {
            try {
              const text = await navigator.clipboard.readText();
              const parsed = JSON.parse(text);
              if (!parsed?.__deckode) { closeContextMenu(); return; }
              const isCrossInstance = (parsed.origin && parsed.origin !== window.location.origin)
                || (parsed.project && parsed.project !== adapter.projectName);
              const assetData = parsed.assetData as Record<string, string> | undefined;
              const slidesToPaste: Slide[] | undefined =
                Array.isArray(parsed.slides) ? parsed.slides
                : parsed.slide ? [parsed.slide]
                : undefined;
              if (!slidesToPaste || slidesToPaste.length === 0) { closeContextMenu(); return; }
              const state = useDeckStore.getState();
              // Merge components
              if (parsed.components && typeof parsed.components === "object" && state.deck) {
                if (!state.deck.components) state.deck.components = {};
                for (const [compId, comp] of Object.entries(parsed.components)) {
                  if (!state.deck.components[compId]) {
                    const c = comp as SharedComponent;
                    if (isCrossInstance) {
                      for (const el of c.elements) await restoreElementAssets(el, assetData, parsed.origin, parsed.project, adapter);
                    }
                    state.deck.components[compId] = c;
                  }
                }
              }
              let insertIndex = contextMenu.slideIndex;
              const newIds: string[] = [];
              for (const src of slidesToPaste) {
                const clone = cloneSlide(src);
                if (isCrossInstance) {
                  await restoreSlideAssets(clone, assetData, parsed.origin, parsed.project, adapter);
                }
                state.addSlide(clone, insertIndex);
                insertIndex++;
                newIds.push(clone.id);
              }
              state.setCurrentSlide(contextMenu.slideIndex + 1);
              if (newIds.length > 1) state.setSelectedSlides(newIds);
            } catch {
              // Clipboard not available or not deckode data
            }
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
          onTogglePageNumber={() => {
            const slide = slides[contextMenu.slideIndex];
            if (slide) updateSlide(contextMenu.slideId, { hidePageNumber: !slide.hidePageNumber });
            closeContextMenu();
          }}
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
  isVisible,
  observeRef,
  hasComments,
  gitChanged,
  onSelect,
  onContextMenu,
  theme,
}: {
  slide: Slide;
  index: number;
  scale: number;
  isCurrent: boolean;
  isSelected: boolean;
  isVisible: boolean;
  observeRef: (id: string, el: Element | null) => void;
  hasComments: boolean;
  gitChanged: boolean;
  onSelect: (index: number, e: React.MouseEvent) => void;
  onContextMenu: (index: number, x: number, y: number) => void;
  theme?: DeckTheme;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  // Merge sortable ref with intersection observer ref
  const thumbRef = useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      observeRef(slide.id, el);
    },
    [setNodeRef, observeRef, slide.id],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const thumbH = Math.round(CANVAS_HEIGHT * scale);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu(index, e.clientX, e.clientY);
    },
    [onContextMenu, index],
  );

  return (
    <div ref={thumbRef} style={style} {...attributes} {...listeners} className="relative group shrink-0" onContextMenu={handleContextMenu} data-slide-thumb-id={slide.id}>
      <button
        onClick={(e) => onSelect(index, e)}
        className={`rounded border-2 transition-colors p-0.5 ${
          isCurrent
            ? "border-blue-500"
            : isSelected
              ? "border-blue-400/60"
              : "border-zinc-700 hover:border-zinc-500"
        }`}
      >
        {isVisible ? (
          <div className="relative rounded-sm overflow-hidden pointer-events-none">
            <SlideRenderer slide={slide} scale={scale} thumbnail theme={theme} />
            {slide.hidden && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Hidden</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="rounded-sm bg-zinc-900"
            style={{ width: Math.round(CANVAS_WIDTH * scale), height: thumbH }}
          />
        )}
        <span className="absolute bottom-1 right-2 text-xs text-zinc-400 font-mono font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {index + 1}
        </span>
      </button>

      {/* Comment badge */}
      {hasComments && (
        <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-amber-400" />
      )}
      {/* Bookmark badge — ribbon shape to distinguish from comment dot */}
      {slide.bookmark && (
        <svg
          className="absolute top-0 left-0.5 w-2.5 h-3.5 drop-shadow-sm"
          viewBox="0 0 10 14"
          aria-label={slide.bookmark}
        >
          <path d="M1 0h8v14l-4-3-4 3z" fill="#3b82f6" />
        </svg>
      )}
      {/* Git change indicator — green left bar */}
      {gitChanged && (
        <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-green-500" />
      )}
    </div>
  );
});

// ── Slide Context Menu ────────────────────────────────────────────

function SlideContextMenu({
  x,
  y,
  isHidden,
  hidePageNumber,
  pageNumbersEnabled,
  canDelete,
  onNewSlide,
  onCopy,
  onPaste,
  onDuplicate,
  onToggleHidden,
  onTogglePageNumber,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  slideId: string;
  slideIndex: number;
  isHidden: boolean;
  hidePageNumber: boolean;
  pageNumbersEnabled: boolean;
  canDelete: boolean;
  onNewSlide: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onToggleHidden: () => void;
  onTogglePageNumber: () => void;
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
        <ContextMenuItem label="Copy Slide" shortcut="Ctrl+C" onClick={onCopy} />
        <ContextMenuItem label="Paste Slide" shortcut="Ctrl+V" onClick={onPaste} />
        <div className="h-px bg-zinc-700 my-1" />
        <ContextMenuItem
          label={isHidden ? "Show Slide" : "Hide Slide"}
          onClick={onToggleHidden}
        />
        {pageNumbersEnabled && (
          <ContextMenuItem
            label={hidePageNumber ? "Show Page Number" : "Hide Page Number"}
            onClick={onTogglePageNumber}
          />
        )}
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
      {label}
      {shortcut && <span className="text-zinc-500 text-[10px]">{shortcut}</span>}
    </button>
  );
}

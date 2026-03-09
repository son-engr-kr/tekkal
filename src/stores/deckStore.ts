import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { subscribeWithSelector } from "zustand/middleware";
import { temporal } from "zundo";
import type { Animation, Comment, Deck, DeckTheme, Slide, SlideElement } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import { nextElementId } from "@/utils/id";
import { assert } from "@/utils/assert";

// Module-level adapter reference, set by App when adapter is created
let _adapter: FileSystemAdapter | null = null;
export function setStoreAdapter(adapter: FileSystemAdapter | null) {
  _adapter = adapter;
}

// Serialize disk writes: at most one in-flight, one queued.
let _activeSave: Promise<void> | null = null;
let _pendingSave = false;

interface DeckState {
  currentProject: string | null;
  deck: Deck | null;
  currentSlideIndex: number;
  selectedSlideIds: string[];
  selectedElementIds: string[];
  highlightedElementIds: string[];
  cropElementId: string | null;
  isDirty: boolean;
  isSaving: boolean;

  openProject: (project: string, deck: Deck) => void;
  closeProject: () => void;
  loadDeck: (deck: Deck) => void;
  replaceDeck: (deck: Deck) => void;
  saveToDisk: () => Promise<void>;
  setCurrentSlide: (index: number) => void;
  setSelectedSlides: (ids: string[]) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  selectElement: (id: string | null, mode?: "replace" | "add" | "toggle") => void;
  selectElements: (ids: string[]) => void;
  groupElements: (slideId: string, elementIds: string[]) => void;
  ungroupElements: (slideId: string, groupId: string) => void;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
  updateSlide: (slideId: string, patch: Partial<Slide>) => void;
  addSlide: (slide: Slide, afterIndex?: number) => void;
  deleteSlide: (slideId: string) => void;
  moveSlide: (fromIndex: number, toIndex: number) => void;
  addElement: (slideId: string, element: SlideElement) => void;
  deleteElement: (slideId: string, elementId: string) => void;
  duplicateElement: (slideId: string, elementId: string) => void;
  addAnimation: (slideId: string, animation: Animation) => void;
  updateAnimation: (slideId: string, index: number, patch: Partial<Animation>) => void;
  deleteAnimation: (slideId: string, index: number) => void;
  moveAnimation: (slideId: string, fromIndex: number, toIndex: number) => void;
  addComment: (slideId: string, comment: Comment) => void;
  updateComment: (slideId: string, commentId: string, text: string) => void;
  deleteComment: (slideId: string, commentId: string) => void;
  updateTheme: (patch: Partial<DeckTheme>) => void;
  toggleSlideHidden: (slideId: string) => void;
  highlightElements: (ids: string[]) => void;
  setCropElement: (id: string | null) => void;
  patchElementById: (elementId: string, patch: Partial<SlideElement>) => void;
  bringToFront: (slideId: string, elementId: string) => void;
  sendToBack: (slideId: string, elementId: string) => void;
}

let highlightTimer: ReturnType<typeof setTimeout> | null = null;
let isDragging = false;

// Hoisted so we can cancel the pending batch on project switch
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let batchStartState: any = null;

export function setDeckDragging(active: boolean) {
  isDragging = active;
}

function getSlide<T extends { id: string }>(slides: T[], slideId: string): T {
  const slide = slides.find((s) => s.id === slideId);
  assert(slide !== undefined, `Slide ${slideId} not found`);
  return slide;
}

export const useDeckStore = create<DeckState>()(
  subscribeWithSelector(
    temporal(
      immer((set, get) => ({
        currentProject: null,
        deck: null,
        currentSlideIndex: 0,
        selectedSlideIds: [],
        selectedElementIds: [],
        highlightedElementIds: [],
        cropElementId: null,
        isDirty: false,
        isSaving: false,

        openProject: (project, deck) =>
          set((state) => {
            state.currentProject = project;
            state.deck = deck;
            state.currentSlideIndex = 0;
            state.selectedSlideIds = deck.slides.length > 0 ? [deck.slides[0]!.id] : [];
            state.selectedElementIds = [];
            state.isDirty = false;
          }),

        closeProject: () =>
          set((state) => {
            state.currentProject = null;
            state.deck = null;
            state.currentSlideIndex = 0;
            state.selectedSlideIds = [];
            state.selectedElementIds = [];
            state.isDirty = false;
          }),

        loadDeck: (deck) =>
          set((state) => {
            state.deck = deck;
            state.currentSlideIndex = 0;
            state.selectedSlideIds = deck.slides.length > 0 ? [deck.slides[0]!.id] : [];
            state.selectedElementIds = [];
            state.isDirty = false;
          }),

        replaceDeck: (deck) =>
          set((state) => {
            state.deck = deck;
            // Clamp slide index if slides were removed
            if (state.currentSlideIndex >= deck.slides.length) {
              state.currentSlideIndex = Math.max(0, deck.slides.length - 1);
            }
            state.isDirty = true;
          }),

        saveToDisk: async () => {
          const { deck, currentProject } = get();
          if (!deck || !currentProject || !_adapter) return;
          if (_adapter.mode === "readonly") return;

          // If a save is already in-flight, mark pending and let it chain.
          if (_activeSave) {
            _pendingSave = true;
            return;
          }

          set((state) => { state.isSaving = true; });
          _activeSave = _adapter.saveDeck(get().deck!);
          try {
            await _activeSave;
          } catch (err) {
            console.error("[deckStore] saveToDisk failed:", err);
          } finally {
            _activeSave = null;
            set((state) => { state.isSaving = false; state.isDirty = false; });
          }

          // A mutation happened while we were writing — save once more.
          if (_pendingSave) {
            _pendingSave = false;
            return get().saveToDisk();
          }
        },

        setCurrentSlide: (index) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            assert(index >= 0 && index < state.deck.slides.length, `Slide index ${index} out of bounds`);
            state.currentSlideIndex = index;
            state.selectedSlideIds = [state.deck.slides[index]!.id];
            state.selectedElementIds = [];
          }),

        setSelectedSlides: (ids) =>
          set((state) => {
            state.selectedSlideIds = ids;
          }),

        nextSlide: () =>
          set((state) => {
            if (!state.deck) return;
            if (state.currentSlideIndex < state.deck.slides.length - 1) {
              state.currentSlideIndex += 1;
              state.selectedSlideIds = [state.deck.slides[state.currentSlideIndex]!.id];
              state.selectedElementIds = [];
            }
          }),

        prevSlide: () =>
          set((state) => {
            if (!state.deck) return;
            if (state.currentSlideIndex > 0) {
              state.currentSlideIndex -= 1;
              state.selectedSlideIds = [state.deck.slides[state.currentSlideIndex]!.id];
              state.selectedElementIds = [];
            }
          }),

        selectElement: (id, mode = "replace") =>
          set((state) => {
            if (mode === "replace") {
              state.selectedElementIds = id ? [id] : [];
            } else if (mode === "add") {
              if (id && !state.selectedElementIds.includes(id)) {
                state.selectedElementIds.push(id);
              }
            } else {
              // toggle
              if (!id) return;
              const idx = state.selectedElementIds.indexOf(id);
              if (idx === -1) {
                state.selectedElementIds.push(id);
              } else {
                state.selectedElementIds.splice(idx, 1);
              }
            }
          }),

        selectElements: (ids) =>
          set((state) => {
            state.selectedElementIds = ids;
          }),

        groupElements: (slideId, elementIds) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            // Expand to include all members of any partially-selected group
            const expandedIds = new Set(elementIds);
            for (const elId of elementIds) {
              const el = slide.elements.find((e) => e.id === elId);
              if (el?.groupId) {
                for (const member of slide.elements) {
                  if (member.groupId === el.groupId) expandedIds.add(member.id);
                }
              }
            }
            assert(expandedIds.size >= 2, "Need at least 2 elements to group");
            const groupId = `group-${crypto.randomUUID().slice(0, 8)}`;
            for (const elId of expandedIds) {
              const el = slide.elements.find((e) => e.id === elId);
              if (el) el.groupId = groupId;
            }
            state.isDirty = true;
          }),

        ungroupElements: (slideId, groupId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            for (const el of slide.elements) {
              if (el.groupId === groupId) delete el.groupId;
            }
            state.isDirty = true;
          }),

        updateElement: (slideId, elementId, patch) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            const element = slide.elements.find((e) => e.id === elementId);
            assert(element !== undefined, `Element ${elementId} not found in slide ${slideId}`);
            Object.assign(element, patch);
            state.isDirty = true;
          }),

        patchElementById: (elementId, patch) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            for (const slide of state.deck.slides) {
              const element = slide.elements.find((e) => e.id === elementId);
              if (element) {
                Object.assign(element, patch);
                state.isDirty = true;
                return;
              }
            }
          }),

        updateSlide: (slideId, patch) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            Object.assign(slide, patch);
            state.isDirty = true;
          }),

        addSlide: (slide, afterIndex) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const idx = afterIndex ?? state.deck.slides.length;
            state.deck.slides.splice(idx + 1, 0, slide);
            state.isDirty = true;
          }),

        deleteSlide: (slideId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const idx = state.deck.slides.findIndex((s) => s.id === slideId);
            assert(idx !== -1, `Slide ${slideId} not found`);
            state.deck.slides.splice(idx, 1);
            state.selectedSlideIds = state.selectedSlideIds.filter((id) => id !== slideId);
            if (state.currentSlideIndex >= state.deck.slides.length) {
              state.currentSlideIndex = Math.max(0, state.deck.slides.length - 1);
            }
            state.isDirty = true;
          }),

        moveSlide: (fromIndex, toIndex) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slides = state.deck.slides;
            assert(fromIndex >= 0 && fromIndex < slides.length, `fromIndex ${fromIndex} out of bounds`);
            assert(toIndex >= 0 && toIndex < slides.length, `toIndex ${toIndex} out of bounds`);
            const [moved] = slides.splice(fromIndex, 1);
            slides.splice(toIndex, 0, moved!);
            // Keep viewing the same slide that was moved
            if (state.currentSlideIndex === fromIndex) {
              state.currentSlideIndex = toIndex;
            } else if (fromIndex < state.currentSlideIndex && toIndex >= state.currentSlideIndex) {
              state.currentSlideIndex -= 1;
            } else if (fromIndex > state.currentSlideIndex && toIndex <= state.currentSlideIndex) {
              state.currentSlideIndex += 1;
            }
            state.isDirty = true;
          }),

        addElement: (slideId, element) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            slide.elements.push(element);
            state.isDirty = true;
          }),

        deleteElement: (slideId, elementId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            const idx = slide.elements.findIndex((e) => e.id === elementId);
            assert(idx !== -1, `Element ${elementId} not found in slide ${slideId}`);
            const removedGroupId = slide.elements[idx]!.groupId;
            slide.elements.splice(idx, 1);
            if (slide.animations) {
              slide.animations = slide.animations.filter(a => a.target !== elementId);
            }
            if (slide.comments) {
              slide.comments = slide.comments.filter(c => c.elementId !== elementId);
              if (slide.comments.length === 0) delete slide.comments;
            }
            state.selectedElementIds = state.selectedElementIds.filter(id => id !== elementId);
            // Auto-ungroup if group has 0-1 members remaining
            if (removedGroupId) {
              const remaining = slide.elements.filter((e) => e.groupId === removedGroupId);
              if (remaining.length <= 1) {
                for (const el of remaining) delete el.groupId;
              }
            }
            state.isDirty = true;
          }),

        duplicateElement: (slideId, elementId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            const element = slide.elements.find((e) => e.id === elementId);
            assert(element !== undefined, `Element ${elementId} not found in slide ${slideId}`);
            const clone = JSON.parse(JSON.stringify(element)) as SlideElement;
            clone.id = nextElementId();
            clone.position = { x: element.position.x + 20, y: element.position.y + 20 };
            slide.elements.push(clone);
            state.selectedElementIds = [clone.id];
            state.isDirty = true;
          }),

        addAnimation: (slideId, animation) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            if (!slide.animations) slide.animations = [];
            slide.animations.push(animation);
            state.isDirty = true;
          }),

        updateAnimation: (slideId, index, patch) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            assert(slide.animations !== undefined && index >= 0 && index < slide.animations.length, `Animation index ${index} out of bounds`);
            Object.assign(slide.animations[index]!, patch);
            state.isDirty = true;
          }),

        deleteAnimation: (slideId, index) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            assert(slide.animations !== undefined && index >= 0 && index < slide.animations.length, `Animation index ${index} out of bounds`);
            slide.animations.splice(index, 1);
            state.isDirty = true;
          }),

        moveAnimation: (slideId, fromIndex, toIndex) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            assert(slide.animations !== undefined, `Slide ${slideId} has no animations`);
            const anims = slide.animations;
            assert(fromIndex >= 0 && fromIndex < anims.length, `fromIndex ${fromIndex} out of bounds`);
            assert(toIndex >= 0 && toIndex < anims.length, `toIndex ${toIndex} out of bounds`);
            const [moved] = anims.splice(fromIndex, 1);
            anims.splice(toIndex, 0, moved!);
            state.isDirty = true;
          }),

        addComment: (slideId, comment) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            if (!slide.comments) slide.comments = [];
            slide.comments.push(comment);
            state.isDirty = true;
          }),

        updateComment: (slideId, commentId, text) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            assert(slide.comments !== undefined, `Slide ${slideId} has no comments`);
            const comment = slide.comments.find(c => c.id === commentId);
            assert(comment !== undefined, `Comment ${commentId} not found`);
            comment.text = text;
            state.isDirty = true;
          }),

        deleteComment: (slideId, commentId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            assert(slide.comments !== undefined, `Slide ${slideId} has no comments`);
            const idx = slide.comments.findIndex(c => c.id === commentId);
            assert(idx !== -1, `Comment ${commentId} not found`);
            slide.comments.splice(idx, 1);
            if (slide.comments.length === 0) delete slide.comments;
            state.isDirty = true;
          }),

        updateTheme: (patch) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const prev = state.deck.theme ?? {};
            const merged: DeckTheme = { ...prev };
            for (const key of Object.keys(patch) as (keyof DeckTheme)[]) {
              merged[key] = { ...prev[key], ...patch[key] } as never;
            }
            state.deck.theme = merged;
            state.isDirty = true;
          }),

        toggleSlideHidden: (slideId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            slide.hidden = !slide.hidden;
            state.isDirty = true;
          }),

        highlightElements: (ids) => {
          if (highlightTimer) clearTimeout(highlightTimer);
          set((state) => { state.highlightedElementIds = ids; });
          highlightTimer = setTimeout(() => {
            set((state) => { state.highlightedElementIds = []; });
            highlightTimer = null;
          }, 800);
        },

        setCropElement: (id) =>
          set((state) => { state.cropElementId = id; }),

        bringToFront: (slideId, elementId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            const idx = slide.elements.findIndex((e) => e.id === elementId);
            assert(idx !== -1, `Element ${elementId} not found`);
            if (idx === slide.elements.length - 1) return; // already front
            const [el] = slide.elements.splice(idx, 1);
            slide.elements.push(el!);
            state.isDirty = true;
          }),

        sendToBack: (slideId, elementId) =>
          set((state) => {
            assert(state.deck !== null, "No deck loaded");
            const slide = getSlide(state.deck.slides, slideId);
            const idx = slide.elements.findIndex((e) => e.id === elementId);
            assert(idx !== -1, `Element ${elementId} not found`);
            if (idx === 0) return; // already back
            const [el] = slide.elements.splice(idx, 1);
            slide.elements.unshift(el!);
            state.isDirty = true;
          }),
      })),
      {
        // Only track deck for undo/redo (selectedSlideIds is UI-only state)
        partialize: (state) => ({ deck: state.deck }),
        limit: 50,
        // Skip recording when deck didn't change, OR when either side is null
        // (null↔deck transitions are project lifecycle, not undoable edits)
        equality: (pastState, currentState) =>
          pastState.deck === currentState.deck ||
          pastState.deck === null ||
          currentState.deck === null,
        // Debounce: batch rapid changes (drag, typing) into one undo checkpoint.
        // Captures the state BEFORE the first change in a batch.
        handleSet: (handleSetImpl) => {
          const tryFlush = () => {
            if (isDragging) {
              batchTimeout = setTimeout(tryFlush, 300);
              return;
            }
            handleSetImpl(batchStartState!);
            batchStartState = null;
            batchTimeout = null;
          };
          return (state: Parameters<typeof handleSetImpl>[0]) => {
            if (batchStartState === null) {
              batchStartState = state;
            }
            if (batchTimeout) clearTimeout(batchTimeout);
            batchTimeout = setTimeout(tryFlush, 300);
          };
        },
      },
    ),
  ),
);

// Clear undo history on project switch (open/close are not undoable)
useDeckStore.subscribe(
  (s) => s.currentProject,
  () => {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
      batchStartState = null;
    }
    useDeckStore.temporal.getState().clear();
  },
);

// Auto-clear crop mode when selection or slide changes
useDeckStore.subscribe(
  (s) => s.selectedElementIds,
  () => {
    if (useDeckStore.getState().cropElementId) {
      useDeckStore.getState().setCropElement(null);
    }
  },
);
useDeckStore.subscribe(
  (s) => s.currentSlideIndex,
  () => {
    if (useDeckStore.getState().cropElementId) {
      useDeckStore.getState().setCropElement(null);
    }
  },
);

// Auto-save: debounce 1s after any mutation
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

useDeckStore.subscribe(
  (s) => s.isDirty,
  (isDirty) => {
    if (!isDirty) return;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      useDeckStore.getState().saveToDisk();
    }, 1000);
  },
);


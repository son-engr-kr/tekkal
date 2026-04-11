import { create } from "zustand";
import { useDeckStore } from "./deckStore";

export interface SlideRef {
  slideId: string;
  slideIndex: number;
  slideTitle: string;
}

export interface ElementRef {
  elementId: string;
  slideId: string;
  type: string;
  label: string;
}

export interface ProjectRef {
  name: string;
  handle: FileSystemDirectoryHandle;
}

interface ContextBarState {
  slideRef: SlideRef | null;
  slideRefDismissed: boolean;
  elementRefs: ElementRef[];
  projectRefs: ProjectRef[];

  dismissSlideRef: () => void;
  addElementRef: (ref: ElementRef) => void;
  removeElementRef: (elementId: string) => void;
  addProjectRef: (ref: ProjectRef) => void;
  removeProjectRef: (name: string) => void;
  clearElementRefs: () => void;
}

/**
 * Extract a short title from a slide's text elements.
 * Priority: markdown `# heading` (whitespace required, matches the
 * editor's renderer) > first text whose content is not a bare hex
 * color > slide number. Hex-only content gets filtered because the
 * user perceives it as a stray color value, not a title.
 */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

function getSlideTitle(slideIndex: number): string {
  const deck = useDeckStore.getState().deck;
  if (!deck) return `Slide ${slideIndex + 1}`;
  const slide = deck.slides[slideIndex];
  if (!slide) return `Slide ${slideIndex + 1}`;
  const textEls = slide.elements.filter(
    (e): e is typeof e & { content: string } =>
      e.type === "text" && "content" in e && typeof (e as { content: unknown }).content === "string",
  );
  if (textEls.length === 0) return `Slide ${slideIndex + 1}`;

  // Prefer a markdown `# heading` (with whitespace) when present.
  for (const t of textEls) {
    const m = t.content.match(/^\s*#+\s+(.+)/);
    if (m) {
      return m[1]!.split("\n", 1)[0]!.trim().slice(0, 40);
    }
  }

  // Skip text whose entire content is a bare hex color — that's the
  // user's reported #FFFFFF / #ffffff case, where a color value got
  // pasted or auto-injected and was being shown as the slide title.
  for (const t of textEls) {
    const trimmed = t.content.trim();
    if (HEX_COLOR_RE.test(trimmed)) continue;
    const preview = t.content.replace(/\n/g, " ").slice(0, 40);
    if (preview) return preview;
  }

  return `Slide ${slideIndex + 1}`;
}

export const useContextBarStore = create<ContextBarState>((set, get) => ({
  slideRef: null,
  slideRefDismissed: false,
  elementRefs: [],
  projectRefs: [],

  dismissSlideRef: () => set({ slideRefDismissed: true }),

  addElementRef: (ref) => {
    const existing = get().elementRefs;
    if (existing.some((r) => r.elementId === ref.elementId)) return;
    set({ elementRefs: [...existing, ref] });
  },

  removeElementRef: (elementId) =>
    set({ elementRefs: get().elementRefs.filter((r) => r.elementId !== elementId) }),

  addProjectRef: (ref) => {
    const existing = get().projectRefs;
    if (existing.some((r) => r.name === ref.name)) return;
    set({ projectRefs: [...existing, ref] });
  },

  removeProjectRef: (name) =>
    set({ projectRefs: get().projectRefs.filter((r) => r.name !== name) }),

  clearElementRefs: () => set({ elementRefs: [] }),
}));

// Subscribe to deckStore slide changes → auto-update slideRef
let prevSlideIndex = -1;
useDeckStore.subscribe((state) => {
  const { currentSlideIndex, deck } = state;
  if (currentSlideIndex === prevSlideIndex) return;
  prevSlideIndex = currentSlideIndex;

  if (!deck || currentSlideIndex < 0 || currentSlideIndex >= deck.slides.length) {
    useContextBarStore.setState({ slideRef: null, slideRefDismissed: false });
    return;
  }

  const slide = deck.slides[currentSlideIndex]!;
  useContextBarStore.setState({
    slideRef: {
      slideId: slide.id,
      slideIndex: currentSlideIndex,
      slideTitle: getSlideTitle(currentSlideIndex),
    },
    slideRefDismissed: false, // reset on navigation
  });
});

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { usePresentationChannel } from "@/hooks/usePresentationChannel";
import { useAdapter } from "@/contexts/AdapterContext";
import { computeSteps } from "@/utils/animationSteps";
import { useTtsAutoPlay, getTextForStep } from "@/hooks/useTtsAutoPlay";
import type { AnimationStep } from "@/utils/animationSteps";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { Deck, Slide, SlideElement, SlideTransition, DeckTheme, PageNumberConfig } from "@/types/deck";
import { getPageNumberInfo } from "@/utils/pageNumbers";
import { FsAccessAdapter } from "@/adapters/fsAccess";
import { ReadOnlyAdapter } from "@/adapters/readOnly";
import { AnimatePresence, motion } from "framer-motion";
import { MorphTransition } from "@/components/renderer/MorphTransition";

/** Collect all local asset paths (./assets/...) from every element in a deck. */
function collectAssetPaths(deck: Deck): string[] {
  const paths = new Set<string>();
  const addFromElement = (el: SlideElement) => {
    if ((el.type === "image" || el.type === "video") && el.src?.startsWith("./")) {
      paths.add(el.src);
    }
  };
  for (const slide of deck.slides) {
    for (const el of slide.elements) addFromElement(el);
  }
  if (deck.components) {
    for (const comp of Object.values(deck.components)) {
      for (const el of comp.elements) addFromElement(el);
    }
  }
  return [...paths];
}

/** Resolve all asset paths via FsAccessAdapter, returning the complete blob URL map. */
async function resolveAllAssets(
  adapter: FsAccessAdapter,
  paths: string[],
): Promise<Record<string, string>> {
  await Promise.allSettled(paths.map((p) => adapter.resolveAssetUrl(p)));
  const map: Record<string, string> = {};
  for (const [k, v] of adapter.blobUrlCache) {
    map[k] = v;
  }
  return map;
}

function useVisibleSlides(deck: Deck | null) {
  return useMemo(() => {
    if (!deck) return [];
    return deck.slides
      .map((slide, index) => ({ slide, originalIndex: index }))
      .filter(({ slide }) => !slide.hidden);
  }, [deck]);
}

// ── Notes parsing ─────────────────────────────────────────────────

interface NoteSegment {
  text: string;
  step: number | null; // null = always visible, number = highlighted at that step
}

/** Strip lines starting with `// ` (presenter note comments) */
function stripCommentedLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("// "))
    .join("\n");
}

function parseNotes(notes: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  const regex = /\[step:(\d+)\]([\s\S]*?)\[\/step\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Strip commented lines before parsing
  const cleaned = stripCommentedLines(notes);

  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index), step: null });
    }
    segments.push({ text: match[2]!, step: parseInt(match[1]!, 10) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex), step: null });
  }
  return segments;
}

/** Toggle `// ` comment prefix on selected lines in a textarea */
function toggleNoteComment(textarea: HTMLTextAreaElement): string {
  const { value, selectionStart, selectionEnd } = textarea;
  const lines = value.split("\n");

  // Find which lines are covered by the selection
  let charCount = 0;
  let startLine = 0;
  let endLine = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = charCount + lines[i]!.length;
    if (charCount <= selectionStart && selectionStart <= lineEnd + 1) startLine = i;
    if (charCount <= selectionEnd && selectionEnd <= lineEnd + 1) endLine = i;
    charCount = lineEnd + 1; // +1 for \n
  }

  // Check if all selected lines are already commented
  const selectedLines = lines.slice(startLine, endLine + 1);
  const allCommented = selectedLines.every((l) => l.trimStart().startsWith("// "));

  for (let i = startLine; i <= endLine; i++) {
    if (allCommented) {
      // Uncomment: remove first `// `
      lines[i] = lines[i]!.replace(/^(\s*)\/\/ /, "$1");
    } else {
      // Comment: add `// ` after leading whitespace
      lines[i] = lines[i]!.replace(/^(\s*)/, "$1// ");
    }
  }

  return lines.join("\n");
}

// ── Transition variants ───────────────────────────────────────────

const transitionVariants = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    initial: { opacity: 0, x: 80 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -80 },
  },
  none: { initial: {}, animate: {}, exit: {} },
  morph: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
};

// ── Main PresentationMode ─────────────────────────────────────────

type ViewMode = "presenter" | "audience";

interface PresentationModeProps {
  onExit: () => void;
}

export function PresentationMode({ onExit }: PresentationModeProps) {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const setCurrentSlide = useDeckStore((s) => s.setCurrentSlide);
  const setSavePaused = useDeckStore((s) => s.setSavePaused);
  const adapter = useAdapter();

  // Pause auto-save in presenter mode; watcher still reloads external changes
  useEffect(() => {
    setSavePaused(true);
    return () => setSavePaused(false);
  }, [setSavePaused]);

  const [viewMode, setViewMode] = useState<ViewMode>("presenter");
  const [activeStep, setActiveStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pointerActive, setPointerActive] = useState(false);
  const [localPointer, setLocalPointer] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const audienceWindowRef = useRef<Window | null>(null);

  const visibleSlides = useVisibleSlides(deck);
  const visiblePosition = useMemo(
    () => visibleSlides.findIndex((v) => v.originalIndex === currentSlideIndex),
    [visibleSlides, currentSlideIndex],
  );

  // On entering presentation, if current slide is hidden, jump to nearest visible
  const initialJumpDone = useRef(false);
  useEffect(() => {
    if (initialJumpDone.current || visibleSlides.length === 0) return;
    initialJumpDone.current = true;
    if (visiblePosition === -1) {
      setCurrentSlide(visibleSlides[0]!.originalIndex);
    }
  }, [visibleSlides, visiblePosition, setCurrentSlide]);

  const slide = deck?.slides[currentSlideIndex];
  const nextVisibleSlide = visiblePosition !== -1 && visiblePosition + 1 < visibleSlides.length
    ? visibleSlides[visiblePosition + 1]!.slide
    : null;
  const totalSlides = visibleSlides.length;

  const steps = useMemo(
    () => computeSteps(slide?.animations ?? []),
    [slide?.animations],
  );

  const noteSegments = useMemo(
    () => parseNotes(slide?.notes ?? ""),
    [slide?.notes],
  );

  // Synchronous reset during render to prevent stale activeStep flash.
  // skipStepReset: BroadcastChannel explicitly sets both slide + step.
  const [prevSlideIdx, setPrevSlideIdx] = useState(currentSlideIndex);
  // When set to a number, the render-time reset uses this exact value.
  // When null, it falls back to the default (forward→0, backward→steps.length).
  const pendingStepRef = useRef<number | null>(null);
  const [skipAnim, setSkipAnim] = useState(false);
  const skipAnimRef = useRef(false);
  skipAnimRef.current = skipAnim;
  if (currentSlideIndex !== prevSlideIdx) {
    if (pendingStepRef.current !== null) {
      setActiveStep(pendingStepRef.current);
      pendingStepRef.current = null;
    } else {
      const goingBack = currentSlideIndex < prevSlideIdx;
      setActiveStep(goingBack ? steps.length : 0);
    }
    setPrevSlideIdx(currentSlideIndex);
  }

  // ── TTS Auto-play ──
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);

  const ttsText = useMemo(
    () => getTextForStep(noteSegments, activeStep),
    [noteSegments, activeStep, steps.length],
  );

  const ttsAdvance = useCallback(() => {
    if (activeStepRef.current < stepsRef.current.length) {
      setActiveStep((prev) => prev + 1);
    } else {
      // Move to next slide
      const vs = visibleSlidesRef.current;
      const pos = visiblePositionRef.current;
      if (pos !== -1 && pos + 1 < vs.length) {
        pendingStepRef.current = 0;
        setCurrentSlide(vs[pos + 1]!.originalIndex);
      } else {
        // End of presentation
        setTtsPlaying(false);
      }
    }
  }, [setCurrentSlide]);

  useTtsAutoPlay({
    text: ttsText,
    onStepDone: ttsAdvance,
    playing: ttsPlaying,
    rate: ttsRate,
  });

  // Timer
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Stable refs for keyboard handler
  const activeStepRef = useRef(activeStep);
  activeStepRef.current = activeStep;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // ── Navigation ──

  const visibleSlidesRef = useRef(visibleSlides);
  visibleSlidesRef.current = visibleSlides;
  const visiblePositionRef = useRef(visiblePosition);
  visiblePositionRef.current = visiblePosition;

  const advance = useCallback(() => {
    if (activeStepRef.current < stepsRef.current.length) {
      setActiveStep((prev) => prev + 1);
    } else {
      const vs = visibleSlidesRef.current;
      const pos = visiblePositionRef.current;
      if (pos !== -1 && pos + 1 < vs.length) {
        setCurrentSlide(vs[pos + 1]!.originalIndex);
      }
    }
  }, [setCurrentSlide]);

  const goBack = useCallback(() => {
    if (activeStepRef.current > 0) {
      setActiveStep((prev) => prev - 1);
    } else {
      const vs = visibleSlidesRef.current;
      const pos = visiblePositionRef.current;
      if (pos > 0) {
        setCurrentSlide(vs[pos - 1]!.originalIndex);
      }
    }
  }, [setCurrentSlide]);

  /** Jump to next/prev slide, skipping all animations when skipAnim is on. */
  const jumpSlide = useCallback((direction: 1 | -1) => {
    const vs = visibleSlidesRef.current;
    const pos = visiblePositionRef.current;
    const target = pos + direction;
    if (target < 0 || target >= vs.length) return;
    if (skipAnimRef.current) {
      const targetSteps = computeSteps(vs[target]!.slide.animations ?? []);
      pendingStepRef.current = targetSteps.length;
    } else {
      pendingStepRef.current = 0;
    }
    setCurrentSlide(vs[target]!.originalIndex);
  }, [setCurrentSlide]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const jumpSlideRef = useRef(jumpSlide);
  jumpSlideRef.current = jumpSlide;

  // ── BroadcastChannel ──

  const skipNextBroadcast = useRef(false);

  const { postNavigate, postExit, postPointer, postSyncDeck, postAssetUpdate, postVideoControl } =
    usePresentationChannel({
      onNavigate: (slideIndex, step) => {
        skipNextBroadcast.current = true;
        pendingStepRef.current = step;
        setCurrentSlide(slideIndex);
      },
      onExit: () => {
        audienceWindowRef.current = null;
        onExit();
      },
      onSyncRequest: () => {
        const state = useDeckStore.getState();
        if (state.deck && state.currentProject) {
          let assetBaseUrl = "";
          if (adapter.mode === "fs-access") {
            // Pre-resolve ALL asset paths in the deck, then send
            const fsAdapter = adapter as FsAccessAdapter;
            const paths = collectAssetPaths(state.deck);
            resolveAllAssets(fsAdapter, paths).then((assetMap) => {
              postSyncDeck(
                state.deck!,
                state.currentProject!,
                state.currentSlideIndex,
                activeStepRef.current,
                assetMap,
                "",
              );
            });
            return;
          } else if (adapter.mode === "vite") {
            assetBaseUrl = `/assets/${adapter.projectName}`;
          } else if (adapter.mode === "readonly") {
            assetBaseUrl = (adapter as ReadOnlyAdapter).assetBaseUrl;
          }
          postSyncDeck(
            state.deck,
            state.currentProject,
            state.currentSlideIndex,
            activeStepRef.current,
            {},
            assetBaseUrl,
          );
        }
      },
    });

  // Broadcast navigation changes
  const prevSlideIndex = useRef(currentSlideIndex);
  const prevActiveStep = useRef(activeStep);
  useEffect(() => {
    if (
      prevSlideIndex.current === currentSlideIndex &&
      prevActiveStep.current === activeStep
    )
      return;
    prevSlideIndex.current = currentSlideIndex;
    prevActiveStep.current = activeStep;
    if (skipNextBroadcast.current) {
      skipNextBroadcast.current = false;
      return;
    }
    postNavigate(currentSlideIndex, activeStep);

    // After navigating, send any newly resolved assets to the popup (fs-access only)
    if (adapter.mode === "fs-access") {
      const fsAdapter = adapter as FsAccessAdapter;
      const state = useDeckStore.getState();
      const currentSlide = state.deck?.slides[currentSlideIndex];
      if (currentSlide) {
        const paths: string[] = [];
        for (const el of currentSlide.elements) {
          if ((el.type === "image" || el.type === "video") && el.src?.startsWith("./")) {
            paths.push(el.src);
          }
        }
        if (paths.length > 0) {
          resolveAllAssets(fsAdapter, paths).then((assetMap) => {
            if (Object.keys(assetMap).length > 0) postAssetUpdate(assetMap);
          });
        }
      }
    }
  }, [currentSlideIndex, activeStep, postNavigate, adapter, postAssetUpdate]);

  // Forward video play/pause from presenter to pop-out
  useEffect(() => {
    const handler = (e: Event) => {
      const { elementId, action, currentTime } = (e as CustomEvent).detail;
      postVideoControl(elementId, action, currentTime);
    };
    window.addEventListener("tekkal:video-control", handler);
    return () => window.removeEventListener("tekkal:video-control", handler);
  }, [postVideoControl]);

  // ── Audience popup ──

  const openAudienceWindow = useCallback(() => {
    if (audienceWindowRef.current && !audienceWindowRef.current.closed) {
      audienceWindowRef.current.focus();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("mode", "audience");
    const url = `?${params.toString()}`;
    audienceWindowRef.current = window.open(
      url,
      "tekkal-audience",
      "width=960,height=540,menubar=no,toolbar=no,location=no,status=no",
    );
  }, []);

  // Cleanup audience window
  useEffect(() => {
    return () => {
      audienceWindowRef.current?.close();
      audienceWindowRef.current = null;
    };
  }, []);

  // Exit fullscreen on unmount
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      }
    };
  }, []);

  const handleExit = useCallback(() => {
    postExit();
    audienceWindowRef.current?.close();
    audienceWindowRef.current = null;
    onExit();
  }, [postExit, onExit]);

  /** Save notes while auto-save is paused: temporarily unpause → save → re-pause */
  const saveNotes = useCallback((slideId: string, notes: string) => {
    useDeckStore.getState().updateSlide(slideId, { notes });
    setSavePaused(false);
    useDeckStore.getState().saveToDisk().finally(() => setSavePaused(true));
  }, [setSavePaused]);

  // ── Laser pointer ──

  const handlePointerMove = useCallback(
    (x: number, y: number) => {
      if (!pointerActive) return;
      setLocalPointer({ x, y, visible: true });
      postPointer(x, y, true);
    },
    [pointerActive, postPointer],
  );

  const handlePointerLeave = useCallback(() => {
    if (pointerActive) {
      setLocalPointer({ x: 0, y: 0, visible: false });
      postPointer(0, 0, false);
    }
  }, [pointerActive, postPointer]);

  // ── Keyboard ──

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't intercept keys when typing in a text field
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        // Still allow Escape to exit note editing
        if (e.key !== "Escape") return;
      }
      if (e.key === "Escape") {
        handleExit();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setTtsPlaying(false);
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTtsPlaying(false);
        goBack();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setTtsPlaying(false);
        jumpSlideRef.current(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setTtsPlaying(false);
        jumpSlideRef.current(-1);
      } else if (e.code === "KeyP") {
        setViewMode((m) => (m === "presenter" ? "audience" : "presenter"));
      } else if (e.code === "KeyW") {
        openAudienceWindow();
      } else if (e.code === "KeyL") {
        setPointerActive((p) => !p);
      } else if (e.code === "KeyF") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen?.();
        }
      } else {
        const currentStep = stepsRef.current[activeStepRef.current];
        if (currentStep?.trigger === "onKey" && currentStep.key === e.key) {
          e.preventDefault();
          advanceRef.current();
        }
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [handleExit, goBack, openAudienceWindow]);

  if (!deck || !slide) return null;

  if (viewMode === "audience") {
    return (
      <div className="h-screen w-screen bg-black">
        <AudienceSlideViewer
          activeStep={activeStep}
          steps={steps}
          onAdvance={advance}
          pointer={localPointer}
        />
      </div>
    );
  }

  const jumpToVisibleSlide = useCallback((visibleIdx: number, skipAnim?: boolean) => {
    const vs = visibleSlidesRef.current;
    if (visibleIdx >= 0 && visibleIdx < vs.length) {
      if (skipAnim) {
        const targetSlide = vs[visibleIdx]!.slide;
        const targetSteps = computeSteps(targetSlide.animations ?? []);
        pendingStepRef.current = targetSteps.length;
      } else {
        pendingStepRef.current = 0;
      }
      setCurrentSlide(vs[visibleIdx]!.originalIndex);
    }
  }, [setCurrentSlide]);

  return (
    <PresenterConsole
      slide={slide}
      nextSlide={nextVisibleSlide}
      deck={deck}
      visibleSlides={visibleSlides}
      activeStep={activeStep}
      steps={steps}
      noteSegments={noteSegments}
      currentSlideIndex={visiblePosition !== -1 ? visiblePosition : 0}
      rawSlideIndex={currentSlideIndex}
      totalSlides={totalSlides}
      elapsed={elapsed}
      pointerActive={pointerActive}
      localPointer={localPointer}
      onPointerToggle={() => setPointerActive((p) => !p)}
      onAdvance={advance}
      onGoBack={goBack}
      onJumpTo={jumpToVisibleSlide}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onOpenAudienceWindow={openAudienceWindow}
      onToggleViewMode={() =>
        setViewMode((m) => (m === "presenter" ? "audience" : "presenter"))
      }
      skipAnim={skipAnim}
      onToggleSkipAnim={() => setSkipAnim((s) => !s)}
      ttsPlaying={ttsPlaying}
      onToggleTts={() => setTtsPlaying((p) => !p)}
      ttsRate={ttsRate}
      onTtsRateChange={setTtsRate}
      onSaveNotes={saveNotes}
    />
  );
}

// ── Presenter Console ─────────────────────────────────────────────

function PresenterConsole({
  slide,
  nextSlide,
  deck,
  visibleSlides,
  activeStep,
  steps,
  noteSegments,
  currentSlideIndex,
  rawSlideIndex,
  totalSlides,
  elapsed,
  pointerActive,
  localPointer,
  onPointerToggle,
  onAdvance,
  onGoBack,
  onJumpTo,
  onPointerMove,
  onPointerLeave,
  onOpenAudienceWindow,
  onToggleViewMode,
  skipAnim,
  onToggleSkipAnim,
  ttsPlaying,
  onToggleTts,
  ttsRate,
  onTtsRateChange,
  onSaveNotes,
}: {
  slide: Slide;
  nextSlide: Slide | null;
  deck: Deck;
  visibleSlides: { slide: Slide; originalIndex: number }[];
  activeStep: number;
  steps: AnimationStep[];
  noteSegments: NoteSegment[];
  currentSlideIndex: number;
  rawSlideIndex: number;
  totalSlides: number;
  elapsed: number;
  pointerActive: boolean;
  localPointer: { x: number; y: number; visible: boolean };
  onPointerToggle: () => void;
  onAdvance: () => void;
  onGoBack: () => void;
  onJumpTo: (visibleIdx: number, skipAnim?: boolean) => void;
  onPointerMove: (x: number, y: number) => void;
  onPointerLeave: () => void;
  onOpenAudienceWindow: () => void;
  onToggleViewMode: () => void;
  skipAnim: boolean;
  onToggleSkipAnim: () => void;
  ttsPlaying: boolean;
  onToggleTts: () => void;
  ttsRate: number;
  onTtsRateChange: (rate: number) => void;
  onSaveNotes: (slideId: string, notes: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideAreaRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const [currentScale, setCurrentScale] = useState(0.5);
  const [nextScale, setNextScale] = useState(0.2);
  const [notesFontSize, setNotesFontSize] = useState(18);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);


  // Bookmarked visible slides
  const bookmarks = useMemo(() => {
    return visibleSlides
      .map((v, visibleIdx) => ({ visibleIdx, slide: v.slide }))
      .filter((b) => !!b.slide.bookmark);
  }, [visibleSlides]);

  // Resizable layout: slide area fraction (0.5–0.85)
  const [slideFraction, setSlideFraction] = useState(0.65);
  const dividerDragRef = useRef<{ startX: number; startFrac: number } | null>(null);

  const handleEditNotes = useCallback(() => {
    setNoteDraft(slide.notes ?? "");
    setEditingNotes(true);
    requestAnimationFrame(() => noteTextareaRef.current?.focus());
  }, [slide.notes]);

  const handleSaveNotes = useCallback(() => {
    onSaveNotes(slide.id, noteDraft);
    setEditingNotes(false);
  }, [slide.id, noteDraft, onSaveNotes]);

  // Close editor on slide change, saving any pending edits
  const prevSlideIdRef = useRef(slide.id);
  useEffect(() => {
    if (slide.id !== prevSlideIdRef.current) {
      if (editingNotes) {
        onSaveNotes(prevSlideIdRef.current, noteDraft);
        setEditingNotes(false);
      }
      prevSlideIdRef.current = slide.id;
    }
  }, [slide.id, editingNotes, noteDraft, onSaveNotes]);

  const updateScales = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const frac = slideFraction;
    const mainW = rect.width * (frac - 0.03);
    const mainH = rect.height - 44 - 32;
    setCurrentScale(Math.min(mainW / CANVAS_WIDTH, mainH / CANVAS_HEIGHT));
    const sideW = sidebarRef.current
      ? sidebarRef.current.getBoundingClientRect().width - 24
      : rect.width * (1 - frac - 0.03);
    const sideH = (rect.height - 44) * 0.32;
    setNextScale(Math.min(sideW / CANVAS_WIDTH, sideH / CANVAS_HEIGHT));
  }, [slideFraction]);

  useEffect(() => {
    updateScales();
    window.addEventListener("resize", updateScales);
    return () => window.removeEventListener("resize", updateScales);
  }, [updateScales]);

  // Divider drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dividerDragRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const delta = (e.clientX - dividerDragRef.current.startX) / rect.width;
      setSlideFraction(Math.max(0.4, Math.min(0.85, dividerDragRef.current.startFrac + delta)));
    };
    const onMouseUp = () => {
      if (!dividerDragRef.current) return;
      dividerDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleSlideMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!slideAreaRef.current) return;
      const rect = slideAreaRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      onPointerMove(x, y);
    },
    [onPointerMove],
  );

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  // Morph detection for presenter console main slide
  const pcTransition = slide.transition ?? { type: "fade" as const, duration: 300 };
  const pcIsMorph = pcTransition.type === "morph";

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen bg-zinc-950 text-white flex flex-col select-none"
    >
      {/* Main area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Bookmarks panel (left) */}
        {bookmarks.length > 0 && (
          <div className="flex flex-col border-r border-zinc-800 shrink-0" style={{ width: 160 }}>
            <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-800 shrink-0">
              Bookmarks ({bookmarks.length})
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5 min-h-0">
              {bookmarks.map((b) => {
                const isCurrent = b.visibleIdx === currentSlideIndex;
                return (
                  <button
                    key={b.slide.id}
                    onClick={() => onJumpTo(b.visibleIdx, skipAnim)}
                    className={`w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
                      isCurrent
                        ? "bg-blue-600/20 text-blue-300"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    <span className="text-zinc-600 font-mono w-4 text-right shrink-0">{b.visibleIdx + 1}</span>
                    <span className="truncate">{b.slide.bookmark}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Current slide */}
        <div className="flex items-center justify-center p-4" style={{ width: `${slideFraction * 100}%` }}>
          <div
            ref={slideAreaRef}
            className={`relative ${pointerActive ? "cursor-crosshair" : ""}`}
            onMouseMove={handleSlideMouseMove}
            onMouseLeave={onPointerLeave}
          >
            {pcIsMorph ? (
              <MorphTransition
                slide={slide}
                scale={currentScale}
                duration={pcTransition.duration ?? 300}
                theme={deck.theme}
                activeStep={activeStep}
                steps={steps}
                onAdvance={onAdvance}
                pageNumberInfo={getPageNumberInfo(deck, rawSlideIndex)}
              />
            ) : (
              <SlideRenderer
                key={slide.id}
                slide={slide}
                scale={currentScale}
                animate
                activeStep={activeStep}
                steps={steps}
                onAdvance={onAdvance}
                theme={deck.theme}
                pageNumberInfo={getPageNumberInfo(deck, rawSlideIndex)}
              />
            )}
            {/* Local laser pointer dot */}
            {pointerActive && localPointer.visible && (
              <div
                className="absolute w-3 h-3 rounded-full bg-red-500 pointer-events-none"
                style={{
                  left: `${localPointer.x * 100}%`,
                  top: `${localPointer.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 0 12px 4px rgba(239, 68, 68, 0.6)",
                }}
              />
            )}
          </div>
        </div>

        {/* Resize divider */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/40 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            dividerDragRef.current = { startX: e.clientX, startFrac: slideFraction };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        {/* Right sidebar: next slide + notes */}
        <div ref={sidebarRef} className="flex flex-col border-l border-zinc-800 min-w-0" style={{ width: `${(1 - slideFraction) * 100}%` }}>
          {/* Next preview: next animation step or next slide */}
          <div className="flex flex-col items-center justify-center p-3 border-b border-zinc-800 shrink-0 overflow-hidden">
            <div className="text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">
              {activeStep < steps.length
                ? `Next Step (${activeStep + 1}/${steps.length})`
                : "Next Slide"}
            </div>
            {activeStep < steps.length ? (
              <SlideRenderer
                key={slide.id}
                slide={slide}
                scale={nextScale}
                animate
                activeStep={activeStep + 1}
                steps={steps}
                theme={deck.theme}
              />
            ) : nextSlide ? (
              <SlideRenderer
                slide={nextSlide}
                scale={nextScale}
                thumbnail
                theme={deck.theme}
              />
            ) : (
              <div
                className="flex items-center justify-center bg-zinc-900 text-zinc-600 text-sm rounded"
                style={{
                  width: CANVAS_WIDTH * nextScale,
                  height: CANVAS_HEIGHT * nextScale,
                }}
              >
                End of presentation
              </div>
            )}
          </div>

          {/* Speaker notes with animation-aware highlighting */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Notes
              </div>
              <div className="flex items-center gap-1">
                {editingNotes ? (
                  <button
                    onClick={handleSaveNotes}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <button
                    onClick={handleEditNotes}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setNotesFontSize((s) => Math.max(10, s - 2))}
                  className="w-5 h-5 flex items-center justify-center rounded text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  title="Decrease font size"
                >
                  -
                </button>
                <span className="text-[10px] text-zinc-500 w-6 text-center">{notesFontSize}</span>
                <button
                  onClick={() => setNotesFontSize((s) => Math.min(40, s + 2))}
                  className="w-5 h-5 flex items-center justify-center rounded text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  title="Increase font size"
                >
                  +
                </button>
              </div>
            </div>
            {editingNotes ? (
              <textarea
                ref={noteTextareaRef}
                className="flex-1 w-full bg-zinc-900 text-zinc-300 rounded px-3 py-2 resize-none border border-zinc-700 focus:border-blue-500 focus:outline-none font-mono"
                style={{ fontSize: notesFontSize }}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleSaveNotes();
                  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                    e.preventDefault();
                    handleSaveNotes();
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
                    e.preventDefault();
                    const ta = e.currentTarget;
                    const newValue = toggleNoteComment(ta);
                    setNoteDraft(newValue);
                  }
                  // Let ArrowUp/Down propagate to window handler for slide navigation
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                    e.stopPropagation();
                  }
                }}
              />
            ) : (
              <div
                className="leading-relaxed whitespace-pre-wrap cursor-text"
                style={{ fontSize: notesFontSize }}
                onDoubleClick={handleEditNotes}
              >
                {noteSegments.length === 0 ? (
                  <span className="text-zinc-600 italic">
                    No notes for this slide (double-click to add)
                  </span>
                ) : (
                  noteSegments.map((seg, i) => {
                    if (seg.step === null) {
                      return (
                        <span key={i} className="text-zinc-300">
                          {seg.text}
                        </span>
                      );
                    }
                    const isActive = activeStep >= seg.step;
                    return (
                      <span
                        key={i}
                        className={
                          isActive
                            ? "text-yellow-300 bg-yellow-900/30 rounded px-0.5"
                            : "text-zinc-500"
                        }
                      >
                        {seg.text}
                      </span>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="h-11 border-t border-zinc-800 flex items-center gap-3 px-4 shrink-0 text-sm">
        {/* Nav buttons + counter */}
        <button
          onClick={onGoBack}
          className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors shrink-0"
          title="Previous (←)"
        >
          ‹
        </button>
        <div className="text-zinc-400 shrink-0 w-16 text-center tabular-nums">
          <span className="text-white font-semibold">{currentSlideIndex + 1}</span>
          <span className="text-zinc-600"> / {totalSlides}</span>
        </div>
        <button
          onClick={onAdvance}
          className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors shrink-0"
          title="Next (→)"
        >
          ›
        </button>

        {/* Slider with bookmark markers */}
        <div className="flex-1 relative h-7 flex items-center">
          <input
            type="range"
            min={0}
            max={totalSlides - 1}
            value={currentSlideIndex}
            onChange={(e) => onJumpTo(parseInt(e.target.value, 10), skipAnim)}
            className="w-full h-1 accent-blue-500 cursor-pointer"
            title={`Slide ${currentSlideIndex + 1} of ${totalSlides}`}
          />
          {/* Bookmark markers on slider */}
          {totalSlides > 1 && bookmarks.map((b) => {
            const pct = (b.visibleIdx / (totalSlides - 1)) * 100;
            return (
              <div
                key={b.slide.id}
                className="absolute top-0 group"
                style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
              >
                <div className="w-2 h-2 bg-blue-400 cursor-pointer rotate-45"
                  onClick={() => onJumpTo(b.visibleIdx, skipAnim)}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-700 text-[10px] text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {b.visibleIdx + 1}. {b.slide.bookmark}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="text-zinc-500 text-xs tabular-nums">
            {steps.length > 0 && (
              <>Step <span className="text-zinc-300">{activeStep}</span>/{steps.length}</>
            )}
          </div>
          <button
            onClick={onToggleSkipAnim}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              skipAnim
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Skip animations when jumping via Up/Down arrow, slider, or bookmark"
          >
            Skip Anim
          </button>
        </div>

        <span className="text-zinc-800 shrink-0">|</span>

        {/* Playback */}
        <div className="flex items-center gap-1 shrink-0 bg-zinc-900/50 rounded px-1.5 py-0.5">
          <button
            onClick={onToggleTts}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              ttsPlaying
                ? "bg-green-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Auto-play: read notes aloud and advance animations"
          >
            {ttsPlaying ? "Stop" : "Play"}
          </button>
          <select
            value={ttsRate}
            onChange={(e) => onTtsRateChange(parseFloat(e.target.value))}
            className="text-[10px] bg-zinc-800 text-zinc-400 rounded px-1 py-0.5 border-none outline-none"
            title="Speech rate"
          >
            <option value={0.5}>0.5x</option>
            <option value={0.75}>0.75x</option>
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </div>

        <span className="text-zinc-800 shrink-0">|</span>

        {/* Tools */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onPointerToggle}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              pointerActive
                ? "bg-red-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Toggle laser pointer (L)"
          >
            Pointer
          </button>
          <button
            onClick={onToggleViewMode}
            className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Switch to slide-only view (P)"
          >
            Slide Only
          </button>
          <button
            onClick={onOpenAudienceWindow}
            className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Open audience window (W)"
          >
            Pop Out
          </button>
        </div>

        {/* Timer */}
        <div className="font-mono text-zinc-300 text-sm shrink-0 ml-auto tabular-nums">{mm}:{ss}</div>
      </div>
    </div>
  );
}

// ── Audience Slide Viewer (slides-only, used in toggle mode) ──────

function AudienceSlideViewer({
  activeStep,
  steps,
  onAdvance,
  pointer,
}: {
  activeStep: number;
  steps: AnimationStep[];
  onAdvance: () => void;
  pointer: { x: number; y: number; visible: boolean };
}) {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const scaleX = window.innerWidth / CANVAS_WIDTH;
      const scaleY = window.innerHeight / CANVAS_HEIGHT;
      setScale(Math.min(scaleX, scaleY));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!deck) return null;
  const slide = deck.slides[currentSlideIndex]!;
  const transition: SlideTransition = slide.transition ?? {
    type: "fade",
    duration: 300,
  };
  const isMorph = transition.type === "morph";
  const variant = isMorph
    ? transitionVariants.fade
    : transitionVariants[transition.type] ?? transitionVariants.fade;


  return (
    <div className="h-full w-full flex items-center justify-center bg-black cursor-default">
      <div className="relative">
        {isMorph ? (
          <MorphTransition
            slide={slide}
            scale={scale}
            duration={transition.duration ?? 300}
            theme={deck?.theme}
            activeStep={activeStep}
            steps={steps}
            onAdvance={onAdvance}
            pageNumberInfo={getPageNumberInfo(deck, currentSlideIndex)}
          />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={variant.initial}
              animate={variant.animate}
              exit={variant.exit}
              transition={{ duration: (transition.duration ?? 300) / 1000 }}
            >
              <StableSlideContent
                slide={slide}
                scale={scale}
                activeStep={activeStep}
                steps={steps}
                onAdvance={onAdvance}
                theme={deck?.theme}
                pageNumberInfo={getPageNumberInfo(deck, currentSlideIndex)}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {pointer.visible && (
          <div
            className="absolute w-3 h-3 rounded-full bg-red-500 pointer-events-none"
            style={{
              left: `${pointer.x * 100}%`,
              top: `${pointer.y * 100}%`,
              transform: "translate(-50%, -50%)",
              boxShadow: "0 0 12px 4px rgba(239, 68, 68, 0.6)",
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Stabilizes activeStep for use inside AnimatePresence.
 * During exit, the parent's activeStep resets to 0, but this component
 * guards against that by only syncing when the slide hasn't changed.
 */
function StableSlideContent({
  slide,
  scale,
  activeStep,
  steps,
  onAdvance,
  theme,
  pageNumberInfo,
}: {
  slide: Slide;
  scale: number;
  activeStep: number;
  steps: AnimationStep[];
  onAdvance: () => void;
  theme?: DeckTheme;
  pageNumberInfo?: { pageNumber: number; totalPages: number; config: PageNumberConfig };
}) {
  const mountSlideId = useRef(slide.id);
  const cachedStep = useRef(activeStep);

  // Only update step if we're still the same slide (not exiting with stale props)
  if (slide.id === mountSlideId.current) {
    cachedStep.current = activeStep;
  }

  return (
    <SlideRenderer
      slide={slide}
      scale={scale}
      animate
      activeStep={cachedStep.current}
      steps={steps}
      onAdvance={onAdvance}
      theme={theme}
      pageNumberInfo={pageNumberInfo}
    />
  );
}

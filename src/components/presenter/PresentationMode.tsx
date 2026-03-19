import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { usePresentationChannel } from "@/hooks/usePresentationChannel";
import { useAdapter } from "@/contexts/AdapterContext";
import { computeSteps } from "@/utils/animationSteps";
import type { AnimationStep } from "@/utils/animationSteps";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { Deck, Slide, SlideTransition, DeckTheme, PageNumberConfig } from "@/types/deck";
import { getPageNumberInfo } from "@/utils/pageNumbers";
import type { FsAccessAdapter } from "@/adapters/fsAccess";
import { AnimatePresence, motion } from "framer-motion";
import { MorphTransition } from "@/components/renderer/MorphTransition";

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
  const adapter = useAdapter();

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
  const skipStepResetRef = useRef(false);
  if (currentSlideIndex !== prevSlideIdx) {
    if (skipStepResetRef.current) {
      skipStepResetRef.current = false;
    } else {
      const goingBack = currentSlideIndex < prevSlideIdx;
      setActiveStep(goingBack ? steps.length : 0);
    }
    setPrevSlideIdx(currentSlideIndex);
  }

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

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // ── BroadcastChannel ──

  const skipNextBroadcast = useRef(false);

  const { postNavigate, postExit, postPointer, postSyncDeck } =
    usePresentationChannel({
      onNavigate: (slideIndex, step) => {
        skipNextBroadcast.current = true;
        skipStepResetRef.current = true;
        setCurrentSlide(slideIndex);
        setActiveStep(step);
      },
      onExit: () => {
        audienceWindowRef.current = null;
        onExit();
      },
      onSyncRequest: () => {
        const state = useDeckStore.getState();
        if (state.deck && state.currentProject) {
          const assetMap: Record<string, string> = {};
          if (adapter.mode === "fs-access") {
            for (const [k, v] of (adapter as FsAccessAdapter).blobUrlCache) {
              assetMap[k] = v;
            }
          }
          postSyncDeck(
            state.deck,
            state.currentProject,
            state.currentSlideIndex,
            activeStepRef.current,
            assetMap,
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
  }, [currentSlideIndex, activeStep, postNavigate]);

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
      "deckode-audience",
      "width=960,height=540",
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
      if (e.key === "Escape") {
        handleExit();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
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
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
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
        // Compute steps for the target slide and jump to the end
        const targetSlide = vs[visibleIdx]!.slide;
        const targetSteps = computeSteps(targetSlide.animations ?? []);
        skipStepResetRef.current = true;
        setCurrentSlide(vs[visibleIdx]!.originalIndex);
        setActiveStep(targetSteps.length);
      } else {
        setCurrentSlide(vs[visibleIdx]!.originalIndex);
      }
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
}: {
  slide: Slide;
  nextSlide: Slide | null;
  deck: Deck;
  visibleSlides: { slide: Slide; originalIndex: number }[];
  activeStep: number;
  steps: AnimationStep[];
  noteSegments: NoteSegment[];
  currentSlideIndex: number;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideAreaRef = useRef<HTMLDivElement>(null);

  const [currentScale, setCurrentScale] = useState(0.5);
  const [nextScale, setNextScale] = useState(0.2);
  const [notesFontSize, setNotesFontSize] = useState(18);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [skipAnim, setSkipAnim] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(true);

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
    useDeckStore.getState().updateSlide(slide.id, { notes: noteDraft });
    setEditingNotes(false);
  }, [slide.id, noteDraft]);

  // Close editor on slide change, saving any pending edits
  const prevSlideIdRef = useRef(slide.id);
  useEffect(() => {
    if (slide.id !== prevSlideIdRef.current) {
      if (editingNotes) {
        useDeckStore.getState().updateSlide(prevSlideIdRef.current, { notes: noteDraft });
        setEditingNotes(false);
      }
      prevSlideIdRef.current = slide.id;
    }
  }, [slide.id, editingNotes, noteDraft]);

  const updateScales = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const frac = slideFraction;
    const mainW = rect.width * (frac - 0.03);
    const mainH = rect.height - 44 - 32;
    setCurrentScale(Math.min(mainW / CANVAS_WIDTH, mainH / CANVAS_HEIGHT));
    const sideW = rect.width * (1 - frac - 0.03);
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
                pageNumberInfo={getPageNumberInfo(deck, currentSlideIndex)}
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
                pageNumberInfo={getPageNumberInfo(deck, currentSlideIndex)}
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
        <div className="flex flex-col border-l border-zinc-800 min-w-0" style={{ width: `${(1 - slideFraction) * 100}%` }}>
          {/* Next preview: next animation step or next slide */}
          <div className="flex flex-col items-center justify-center p-3 border-b border-zinc-800 shrink-0">
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

          {/* Bookmarks */}
          {bookmarks.length > 0 && (
            <div className="border-b border-zinc-800 shrink-0">
              <button
                onClick={() => setBookmarksOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider hover:bg-zinc-800/50 transition-colors"
              >
                <span>Bookmarks ({bookmarks.length})</span>
                <span className="text-zinc-600">{bookmarksOpen ? "\u2212" : "+"}</span>
              </button>
              {bookmarksOpen && (
                <div className="px-2 pb-2 space-y-0.5">
                  {bookmarks.map((b) => {
                    const isCurrent = b.visibleIdx === currentSlideIndex;
                    return (
                      <button
                        key={b.slide.id}
                        onClick={() => onJumpTo(b.visibleIdx, skipAnim)}
                        className={`w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-2 ${
                          isCurrent
                            ? "bg-blue-600/20 text-blue-300"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        <span className="text-zinc-600 font-mono w-5 text-right shrink-0">{b.visibleIdx + 1}</span>
                        <span className="truncate">{b.slide.bookmark}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

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
                  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
                    e.preventDefault();
                    const ta = e.currentTarget;
                    const newValue = toggleNoteComment(ta);
                    setNoteDraft(newValue);
                  }
                  e.stopPropagation();
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
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full cursor-pointer"
                  onClick={() => onJumpTo(b.visibleIdx, skipAnim)}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-700 text-[10px] text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {b.visibleIdx + 1}. {b.slide.bookmark}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-zinc-500 text-xs shrink-0 tabular-nums w-20 text-center">
          {steps.length > 0 && (
            <>Step <span className="text-zinc-300">{activeStep}</span>/{steps.length}</>
          )}
        </div>

        <span className="text-zinc-800 shrink-0">|</span>

        {/* Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setSkipAnim((s) => !s)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              skipAnim
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Skip animations when jumping via slider or bookmark"
          >
            Skip Anim
          </button>
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

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { usePresentationChannel } from "@/hooks/usePresentationChannel";
import { AdapterProvider } from "@/contexts/AdapterContext";
import { ReadOnlyAdapter } from "@/adapters/readOnly";
import { computeSteps } from "@/utils/animationSteps";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { SlideTransition } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import { AnimatePresence, motion } from "framer-motion";
import { MorphTransition } from "@/components/renderer/MorphTransition";

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

/**
 * Audience-only popup view: slides + transitions + laser pointer.
 * Receives navigation from the presenter console via BroadcastChannel.
 * Opened when the presenter presses W in presentation mode.
 */
export function PresenterView() {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const setCurrentSlide = useDeckStore((s) => s.setCurrentSlide);

  const [activeStep, setActiveStep] = useState(0);
  const [popoutAdapter, setPopoutAdapter] = useState<FileSystemAdapter | null>(
    null,
  );
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef(0);
  const slide = deck?.slides[currentSlideIndex];
  const steps = useMemo(
    () => computeSteps(slide?.animations ?? []),
    [slide?.animations],
  );

  // Scale to fill window
  useEffect(() => {
    const update = () => {
      setScale(
        Math.min(
          window.innerWidth / CANVAS_WIDTH,
          window.innerHeight / CANVAS_HEIGHT,
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // BroadcastChannel: receive navigation + pointer + deck sync from presenter
  const { postSyncRequest } = usePresentationChannel({
    onNavigate: (slideIndex, step) => {
      setCurrentSlide(slideIndex);
      setActiveStep(step);
    },
    onSyncDeck: (syncDeck, project, slideIndex, step, assetMap) => {
      const state = useDeckStore.getState();
      if (!state.currentProject) {
        state.openProject(project, syncDeck);
      }
      if (Object.keys(assetMap).length > 0) {
        setPopoutAdapter(
          ReadOnlyAdapter.fromAssetMap(project, syncDeck, assetMap),
        );
      }
      setCurrentSlide(slideIndex);
      setActiveStep(step);
    },
    onExit: () => {
      window.close();
    },
    onPointer: (x, y, visible) => {
      setPointer({ x, y, visible });
    },
  });

  // Request sync on mount to get current state from presenter
  useEffect(() => {
    postSyncRequest();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track fullscreen changes
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Auto-hide fullscreen button after 3s of inactivity
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(
      () => setShowControls(false),
      3000,
    );
  }, []);

  useEffect(() => {
    resetHideTimer();
    window.addEventListener("mousemove", resetHideTimer);
    return () => {
      window.removeEventListener("mousemove", resetHideTimer);
      window.clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  // Keyboard: Escape to close, F to toggle fullscreen
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          window.close();
        }
      } else if (e.code === "KeyF") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen?.();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (!deck || !slide) return null;

  const transition: SlideTransition = slide.transition ?? {
    type: "fade",
    duration: 300,
  };
  const isMorph = transition.type === "morph";
  const variant = isMorph
    ? transitionVariants.fade
    : transitionVariants[transition.type] ?? transitionVariants.fade;

  const content = (
    <div className="h-screen w-screen bg-black flex items-center justify-center relative">
      <div className="relative">
        {isMorph ? (
          <MorphTransition
            slide={slide}
            scale={scale}
            duration={transition.duration ?? 300}
            theme={deck.theme}
            activeStep={activeStep}
            steps={steps}
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
              <SlideRenderer
                slide={slide}
                scale={scale}
                animate
                activeStep={activeStep}
                steps={steps}
                theme={deck.theme}
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
      {/* Fullscreen control — auto-hides after 3s, reappears on mouse move */}
      {!isFullscreen && showControls && (
        <button
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="absolute top-3 right-3 text-xs px-3 py-1.5 rounded bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors backdrop-blur-sm animate-fade-in"
          title="Fullscreen (F)"
        >
          Fullscreen (F)
        </button>
      )}
    </div>
  );

  // Wrap with AdapterProvider when we have a popout adapter (for asset resolution)
  if (popoutAdapter) {
    return <AdapterProvider adapter={popoutAdapter}>{content}</AdapterProvider>;
  }
  return content;
}

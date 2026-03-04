import { useState, useEffect, useMemo } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { usePresentationChannel } from "@/hooks/usePresentationChannel";
import { computeSteps } from "@/utils/animationSteps";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { SlideTransition } from "@/types/deck";
import { AnimatePresence, motion } from "framer-motion";

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
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // BroadcastChannel: receive navigation + pointer from presenter
  const { postSyncRequest } = usePresentationChannel({
    onNavigate: (slideIndex, step) => {
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

  // Keyboard: Escape to close, F to toggle fullscreen
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          window.close();
        }
      } else if (e.key === "f" || e.key === "F") {
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
  const variant =
    transitionVariants[transition.type] ?? transitionVariants.fade;

  return (
    <div className="h-screen w-screen bg-black flex items-center justify-center relative">
      <div className="relative">
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
      {/* Fullscreen control — fades out after a moment */}
      {!isFullscreen && (
        <button
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="absolute top-3 right-3 text-xs px-3 py-1.5 rounded bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors backdrop-blur-sm"
          title="Fullscreen (F)"
        >
          Fullscreen (F)
        </button>
      )}
    </div>
  );
}

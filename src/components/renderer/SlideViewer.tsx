import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "./SlideRenderer";
import { MorphTransition } from "./MorphTransition";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { Slide, SlideTransition, DeckTheme } from "@/types/deck";
import { computeSteps } from "@/utils/animationSteps";
import { assert } from "@/utils/assert";

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
  none: {
    initial: {},
    animate: {},
    exit: {},
  },
  morph: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
};

export function SlideViewer() {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const nextSlide = useDeckStore((s) => s.nextSlide);
  const prevSlide = useDeckStore((s) => s.prevSlide);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const slide = deck?.slides[currentSlideIndex];

  // Track navigation direction via ref (no extra render)
  const prevSlideIdxRef = useRef(currentSlideIndex);
  const goingBackRef = useRef(false);
  if (currentSlideIndex !== prevSlideIdxRef.current) {
    goingBackRef.current = currentSlideIndex < prevSlideIdxRef.current;
    prevSlideIdxRef.current = currentSlideIndex;
  }

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    const scaleX = clientWidth / CANVAS_WIDTH;
    const scaleY = clientHeight / CANVAS_HEIGHT;
    setScale(Math.min(scaleX, scaleY));
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [updateScale]);

  if (!deck) {
    return (
      <div className="h-full w-full flex items-center justify-center text-zinc-500">
        No deck loaded
      </div>
    );
  }

  assert(slide !== undefined, `Slide at index ${currentSlideIndex} not found`);

  const transition: SlideTransition = slide.transition ?? { type: "fade", duration: 300 };
  const duration = transition.duration ?? 300;
  const isMorph = transition.type === "morph";

  return (
    <div ref={containerRef} className="h-full w-full flex items-center justify-center bg-zinc-950 overflow-hidden">
      <div className="relative">
        {isMorph ? (
          <MorphSlideWithSteps
            slide={slide}
            scale={scale}
            duration={duration}
            goingBack={goingBackRef.current}
            onNextSlide={nextSlide}
            onPrevSlide={prevSlide}
            theme={deck.theme}
          />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={transitionVariants[transition.type]?.initial ?? transitionVariants.fade.initial}
              animate={transitionVariants[transition.type]?.animate ?? transitionVariants.fade.animate}
              exit={transitionVariants[transition.type]?.exit ?? transitionVariants.fade.exit}
              transition={{ duration: duration / 1000 }}
            >
              <SlideWithSteps
                slide={slide}
                scale={scale}
                goingBack={goingBackRef.current}
                onNextSlide={nextSlide}
                onPrevSlide={prevSlide}
                theme={deck.theme}
              />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <div className="absolute bottom-4 right-4 text-zinc-500 text-sm font-mono">
        {currentSlideIndex + 1} / {deck.slides.length}
      </div>
    </div>
  );
}

/**
 * Per-slide step controller. Lives inside motion.div keyed by slide.id,
 * so each instance owns its activeStep state independently.
 * During AnimatePresence exit, the old instance retains its step state
 * — no reverse animation from activeStep resetting.
 */
function SlideWithSteps({
  slide,
  scale,
  goingBack,
  onNextSlide,
  onPrevSlide,
  theme,
}: {
  slide: Slide;
  scale: number;
  goingBack: boolean;
  onNextSlide: () => void;
  onPrevSlide: () => void;
  theme?: DeckTheme;
}) {
  const steps = useMemo(
    () => computeSteps(slide.animations ?? []),
    [slide.animations],
  );
  const [activeStep, setActiveStep] = useState(
    () => (goingBack ? steps.length : 0),
  );
  const isPresent = useIsPresent();

  const activeStepRef = useRef(activeStep);
  activeStepRef.current = activeStep;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const advance = useCallback(() => {
    if (activeStepRef.current < stepsRef.current.length) {
      setActiveStep((prev) => prev + 1);
    } else {
      onNextSlide();
    }
  }, [onNextSlide]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Keyboard: ArrowRight/Space = advance step or next slide,
  // ArrowLeft = previous slide (no step-back in SlideViewer).
  // Disabled during AnimatePresence exit via isPresent guard.
  useEffect(() => {
    if (!isPresent) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrevSlide();
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
  }, [isPresent, onPrevSlide]);

  return (
    <SlideRenderer
      slide={slide}
      scale={scale}
      animate
      activeStep={activeStep}
      steps={steps}
      onAdvance={advance}
      theme={theme}
    />
  );
}

function MorphSlideWithSteps({
  slide,
  scale,
  duration,
  goingBack,
  onNextSlide,
  onPrevSlide,
  theme,
}: {
  slide: Slide;
  scale: number;
  duration: number;
  goingBack: boolean;
  onNextSlide: () => void;
  onPrevSlide: () => void;
  theme?: DeckTheme;
}) {
  const steps = useMemo(
    () => computeSteps(slide.animations ?? []),
    [slide.animations],
  );
  const [activeStep, setActiveStep] = useState(
    () => (goingBack ? steps.length : 0),
  );

  // Reset activeStep on slide change
  const prevSlideIdRef = useRef(slide.id);
  if (slide.id !== prevSlideIdRef.current) {
    setActiveStep(goingBack ? steps.length : 0);
    prevSlideIdRef.current = slide.id;
  }

  const activeStepRef = useRef(activeStep);
  activeStepRef.current = activeStep;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const advance = useCallback(() => {
    if (activeStepRef.current < stepsRef.current.length) {
      setActiveStep((prev) => prev + 1);
    } else {
      onNextSlide();
    }
  }, [onNextSlide]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrevSlide();
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
  }, [onPrevSlide]);

  return (
    <MorphTransition
      slide={slide}
      scale={scale}
      duration={duration}
      theme={theme}
      activeStep={activeStep}
      steps={steps}
      onAdvance={advance}
    />
  );
}

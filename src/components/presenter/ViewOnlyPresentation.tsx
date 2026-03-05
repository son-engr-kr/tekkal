import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { computeSteps } from "@/utils/animationSteps";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { Slide, SlideTransition, DeckTheme } from "@/types/deck";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
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

interface ViewOnlyPresentationProps {
  onExit: () => void;
}

export function ViewOnlyPresentation({ onExit }: ViewOnlyPresentationProps) {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const setCurrentSlide = useDeckStore((s) => s.setCurrentSlide);

  const [scale, setScale] = useState(1);

  const visibleSlides = useMemo(() => {
    if (!deck) return [];
    return deck.slides
      .map((slide, index) => ({ slide, originalIndex: index }))
      .filter(({ slide }) => !slide.hidden);
  }, [deck]);

  const visiblePosition = useMemo(
    () => visibleSlides.findIndex((v) => v.originalIndex === currentSlideIndex),
    [visibleSlides, currentSlideIndex],
  );

  const slide = deck?.slides[currentSlideIndex];
  const totalSlides = visibleSlides.length;

  // Track navigation direction via ref
  const prevSlideIdxRef = useRef(currentSlideIndex);
  const goingBackRef = useRef(false);
  if (currentSlideIndex !== prevSlideIdxRef.current) {
    goingBackRef.current = currentSlideIndex < prevSlideIdxRef.current;
    prevSlideIdxRef.current = currentSlideIndex;
  }

  // Fit to viewport
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

  // On entering, if current slide is hidden, jump to nearest visible
  const initialJumpDone = useRef(false);
  useEffect(() => {
    if (initialJumpDone.current || visibleSlides.length === 0) return;
    initialJumpDone.current = true;
    if (visiblePosition === -1) {
      setCurrentSlide(visibleSlides[0]!.originalIndex);
    }
  }, [visibleSlides, visiblePosition, setCurrentSlide]);

  // Stable refs for navigation callbacks
  const visibleSlidesRef = useRef(visibleSlides);
  visibleSlidesRef.current = visibleSlides;
  const visiblePositionRef = useRef(visiblePosition);
  visiblePositionRef.current = visiblePosition;

  const nextVisibleSlide = useCallback(() => {
    const vs = visibleSlidesRef.current;
    const pos = visiblePositionRef.current;
    if (pos !== -1 && pos + 1 < vs.length) {
      setCurrentSlide(vs[pos + 1]!.originalIndex);
    }
  }, [setCurrentSlide]);

  const prevVisibleSlide = useCallback(() => {
    const vs = visibleSlidesRef.current;
    const pos = visiblePositionRef.current;
    if (pos > 0) {
      setCurrentSlide(vs[pos - 1]!.originalIndex);
    }
  }, [setCurrentSlide]);

  // Escape stays in parent (no activeStep dependency)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onExit]);

  if (!deck || !slide) return null;

  const transition: SlideTransition = slide.transition ?? {
    type: "fade",
    duration: 300,
  };
  const isMorph = transition.type === "morph";
  const variant = isMorph
    ? transitionVariants.fade
    : transitionVariants[transition.type] ?? transitionVariants.fade;

  const displayPosition = visiblePosition !== -1 ? visiblePosition + 1 : 0;

  return (
    <div className="h-screen w-screen bg-black flex items-center justify-center cursor-default select-none">
      <div className="relative">
        {isMorph ? (
          <ViewOnlyMorphSlideWithSteps
            slide={slide}
            scale={scale}
            duration={transition.duration ?? 300}
            goingBack={goingBackRef.current}
            onNextSlide={nextVisibleSlide}
            onPrevSlide={prevVisibleSlide}
            theme={deck.theme}
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
              <ViewOnlySlideWithSteps
                slide={slide}
                scale={scale}
                goingBack={goingBackRef.current}
                onNextSlide={nextVisibleSlide}
                onPrevSlide={prevVisibleSlide}
                theme={deck.theme}
              />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Slide counter overlay */}
      <div className="fixed bottom-4 right-4 text-white/40 text-sm font-mono pointer-events-none">
        {displayPosition}/{totalSlides}
      </div>
    </div>
  );
}

/**
 * Per-slide step controller inside AnimatePresence.
 * Each instance owns its own activeStep — old instances keep their state
 * during exit, preventing reverse animation.
 */
function ViewOnlySlideWithSteps({
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

  const goBackStep = useCallback(() => {
    if (activeStepRef.current > 0) {
      setActiveStep((prev) => prev - 1);
    } else {
      onPrevSlide();
    }
  }, [onPrevSlide]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Keyboard navigation — disabled during AnimatePresence exit
  useEffect(() => {
    if (!isPresent) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBackStep();
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
  }, [isPresent, goBackStep]);

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

function ViewOnlyMorphSlideWithSteps({
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

  const goBackStep = useCallback(() => {
    if (activeStepRef.current > 0) {
      setActiveStep((prev) => prev - 1);
    } else {
      onPrevSlide();
    }
  }, [onPrevSlide]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advanceRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBackStep();
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
  }, [goBackStep]);

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

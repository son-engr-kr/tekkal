import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Slide, DeckTheme, Animation } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { useDeckStore } from "@/stores/deckStore";
import { ElementRenderer } from "./ElementRenderer";
import type { AnimationStep } from "@/utils/animationSteps";

interface MorphTransitionProps {
  slide: Slide;
  scale: number;
  duration: number;
  theme?: DeckTheme;
  activeStep?: number;
  steps?: AnimationStep[];
  onAdvance?: () => void;
}

interface MorphState {
  oldSlide: Slide;
}

/**
 * Look up the slide that appears before `slide` in the deck.
 * Used as the morph "from" state on initial mount.
 */
function getAdjacentPrevSlide(slide: Slide): Slide | null {
  const deck = useDeckStore.getState().deck;
  if (!deck) return null;
  const idx = deck.slides.findIndex((s) => s.id === slide.id);
  return idx > 0 ? deck.slides[idx - 1]! : null;
}

export function MorphTransition({
  slide,
  scale,
  duration,
  theme,
  activeStep,
  steps,
  onAdvance,
}: MorphTransitionProps) {
  const targetSlideRef = useRef<Slide>(slide);
  const prevSlideIdRef = useRef(slide.id);

  // On mount: morph from the adjacent previous slide in the deck
  const [morph, setMorph] = useState<MorphState | null>(() => {
    const prev = getAdjacentPrevSlide(slide);
    return prev ? { oldSlide: prev } : null;
  });

  // Subsequent slide changes (when MorphTransition stays mounted)
  if (slide.id !== prevSlideIdRef.current) {
    setMorph({ oldSlide: targetSlideRef.current });
    prevSlideIdRef.current = slide.id;
  }
  targetSlideRef.current = slide;

  // Schedule morph end
  useEffect(() => {
    if (!morph) return;
    const timer = setTimeout(() => setMorph(null), duration);
    return () => clearTimeout(timer);
  }, [morph, duration]);

  const animationMap = useMemo(() => {
    const anims = slide.animations;
    if (!anims || anims.length === 0) return null;
    const map = new Map<string, Animation[]>();
    for (const anim of anims) {
      const list = map.get(anim.target);
      if (list) list.push(anim);
      else map.set(anim.target, [anim]);
    }
    return map;
  }, [slide.animations]);

  const { activeAnimations, delayOverrides } = useMemo(() => {
    if (activeStep === undefined || !steps) {
      return { activeAnimations: undefined, delayOverrides: undefined };
    }
    const set = new Set<Animation>();
    const delays = new Map<Animation, number>();
    for (let i = 0; i < activeStep && i < steps.length; i++) {
      const step = steps[i]!;
      for (const anim of step.animations) {
        set.add(anim);
        const override = step.delayOverrides.get(anim);
        if (override !== undefined) delays.set(anim, override);
      }
    }
    return { activeAnimations: set, delayOverrides: delays };
  }, [activeStep, steps]);

  const oldElementMap = useMemo(() => {
    if (!morph) return new Map<string, Slide["elements"][number]>();
    return new Map(morph.oldSlide.elements.map((e) => [e.id, e]));
  }, [morph]);

  const removedElements = useMemo(() => {
    if (!morph) return [];
    const newIds = new Set(slide.elements.map((e) => e.id));
    return morph.oldSlide.elements.filter((e) => !newIds.has(e.id));
  }, [morph, slide.elements]);

  const morphActive = morph !== null;
  const durationSec = duration / 1000;

  const bg = slide.background;
  const themeBgColor = theme?.slide?.background?.color;
  const resolvedBgImage = useAssetUrl(bg?.image);
  const bgColor = bg?.color ?? themeBgColor ?? "#ffffff";

  const content = (
    <div
      style={{
        width: CANVAS_WIDTH * scale,
        height: CANVAS_HEIGHT * scale,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <motion.div
        onClick={onAdvance}
        animate={{ backgroundColor: bgColor }}
        transition={{ duration: morphActive ? durationSec : 0 }}
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
          backgroundImage: resolvedBgImage ? `url(${resolvedBgImage})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          cursor: onAdvance ? "default" : undefined,
        }}
      >
        {slide.elements.map((element) => {
          const oldEl = morphActive ? oldElementMap.get(element.id) : undefined;
          const isShared = oldEl !== undefined;
          const isNew = morphActive && !isShared;

          // Outer div: position + rotation (default transformOrigin = center).
          // Size is set statically to the NEW element's dimensions.
          // Inner div: scaleX/scaleY from top-left to visually morph size
          // (GPU-accelerated transform, no layout thrashing).
          const outerAnimate = isShared
            ? {
                opacity: 1,
                x: [oldEl.position.x, element.position.x],
                y: [oldEl.position.y, element.position.y],
                rotate: [oldEl.rotation ?? 0, element.rotation ?? 0],
              }
            : {
                opacity: 1,
                x: element.position.x,
                y: element.position.y,
                rotate: element.rotation ?? 0,
              };

          const innerAnimate = isShared
            ? {
                scaleX: [oldEl.size.w / element.size.w, 1],
                scaleY: [oldEl.size.h / element.size.h, 1],
              }
            : { scaleX: 1, scaleY: 1 };

          return (
            <motion.div
              key={element.id}
              initial={isNew ? { opacity: 0, x: element.position.x, y: element.position.y } : false}
              animate={outerAnimate}
              transition={{
                duration: morphActive ? durationSec : 0,
                ease: [0.4, 0, 0.2, 1],
                ...(isNew
                  ? { opacity: { duration: durationSec * 0.7, delay: durationSec * 0.3 } }
                  : {}),
              }}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: element.size.w,
                height: element.size.h,
              }}
            >
              <motion.div
                animate={innerAnimate}
                transition={{
                  duration: morphActive ? durationSec : 0,
                  ease: [0.4, 0, 0.2, 1],
                }}
                style={{ width: "100%", height: "100%", transformOrigin: "0 0" }}
              >
                <ElementRenderer
                  element={element}
                  noPosition
                  animations={animationMap?.get(element.id)}
                  activeAnimations={activeAnimations}
                  delayOverrides={delayOverrides}
                />
              </motion.div>
            </motion.div>
          );
        })}

        <AnimatePresence>
          {morphActive &&
            removedElements.map((element) => (
              <motion.div
                key={`removed-${element.id}`}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: durationSec * 0.7 }}
                style={{
                  position: "absolute",
                  left: element.position.x,
                  top: element.position.y,
                  width: element.size.w,
                  height: element.size.h,
                  transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                }}
              >
                <ElementRenderer element={element} noPosition />
              </motion.div>
            ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );

  if (theme) {
    return <ThemeProvider theme={theme}>{content}</ThemeProvider>;
  }
  return content;
}

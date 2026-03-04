import { useState, useEffect, useRef, useMemo } from "react";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";
import type { Slide, DeckTheme } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { ElementRenderer } from "./ElementRenderer";
import type { Animation } from "@/types/deck";
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

export function MorphTransition({
  slide,
  scale,
  duration,
  theme,
  activeStep,
  steps,
  onAdvance,
}: MorphTransitionProps) {
  const [prevSlide, setPrevSlide] = useState<Slide | null>(null);
  const [morphing, setMorphing] = useState(false);
  const prevSlideIdRef = useRef(slide.id);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (slide.id !== prevSlideIdRef.current) {
      // Slide changed — start morph
      setPrevSlide(prevSlideDataRef.current);
      setMorphing(true);
      prevSlideIdRef.current = slide.id;

      // End morph after duration
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setPrevSlide(null);
        setMorphing(false);
      }, duration);
    }
  }, [slide.id, duration]);

  // Store previous slide data for when we need it
  const prevSlideDataRef = useRef<Slide>(slide);
  useEffect(() => {
    // After morph is done, update the ref
    if (!morphing) {
      prevSlideDataRef.current = slide;
    }
  });
  // Always update if slide data changes (in-place edits)
  if (!morphing) {
    prevSlideDataRef.current = slide;
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Build animation maps for the current slide
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

  // Compute element sets
  const newElementIds = new Set(slide.elements.map((e) => e.id));
  const oldElementIds = prevSlide ? new Set(prevSlide.elements.map((e) => e.id)) : new Set<string>();

  // Elements that exist in both slides (shared — will morph)
  const sharedIds = new Set([...newElementIds].filter((id) => oldElementIds.has(id)));
  // Elements only in old slide (will fade out)
  const removedElements = prevSlide
    ? prevSlide.elements.filter((e) => !newElementIds.has(e.id))
    : [];
  // Elements only in new slide (will fade in)
  const addedElements = slide.elements.filter((e) => !oldElementIds.has(e.id));
  // Elements in both slides — render from new slide's data
  const sharedElements = slide.elements.filter((e) => sharedIds.has(e.id));

  const durationSec = duration / 1000;

  const bg = slide.background;
  const themeBgColor = theme?.slide?.background?.color;
  const resolvedBgImage = useAssetUrl(bg?.image);

  // Previous slide background for interpolation
  const prevBg = prevSlide?.background;
  const prevBgColor = prevBg?.color ?? themeBgColor ?? "#ffffff";
  const newBgColor = bg?.color ?? themeBgColor ?? "#ffffff";

  const content = (
    <div
      style={{
        width: CANVAS_WIDTH * scale,
        height: CANVAS_HEIGHT * scale,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <LayoutGroup>
        <motion.div
          onClick={onAdvance}
          animate={{ backgroundColor: newBgColor }}
          transition={{ duration: durationSec }}
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            backgroundColor: morphing ? prevBgColor : newBgColor,
            backgroundImage: resolvedBgImage ? `url(${resolvedBgImage})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "absolute",
            top: 0,
            left: 0,
            cursor: onAdvance ? "default" : undefined,
          }}
        >
          {/* Shared elements — morph via layoutId */}
          {sharedElements.map((element) => (
            <MorphElement
              key={element.id}
              layoutId={element.id}
              element={element}
              duration={durationSec}
              animations={animationMap?.get(element.id)}
              activeAnimations={activeAnimations}
              delayOverrides={delayOverrides}
            />
          ))}

          {/* Added elements — fade in */}
          <AnimatePresence>
            {addedElements.map((element) => (
              <motion.div
                key={element.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: durationSec, delay: durationSec * 0.3 }}
                className="absolute"
                style={{
                  left: element.position.x,
                  top: element.position.y,
                  width: element.size.w,
                  height: element.size.h,
                  transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                }}
              >
                <ElementRenderer
                  element={element}
                  animations={animationMap?.get(element.id)}
                  activeAnimations={activeAnimations}
                  delayOverrides={delayOverrides}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Removed elements — fade out */}
          <AnimatePresence>
            {morphing &&
              removedElements.map((element) => (
                <motion.div
                  key={`removed-${element.id}`}
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: durationSec * 0.7 }}
                  className="absolute"
                  style={{
                    left: element.position.x,
                    top: element.position.y,
                    width: element.size.w,
                    height: element.size.h,
                    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                  }}
                >
                  <ElementRenderer element={element} />
                </motion.div>
              ))}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
    </div>
  );

  if (theme) {
    return <ThemeProvider theme={theme}>{content}</ThemeProvider>;
  }
  return content;
}

function MorphElement({
  layoutId,
  element,
  duration,
  animations,
  activeAnimations,
  delayOverrides,
}: {
  layoutId: string;
  element: import("@/types/deck").SlideElement;
  duration: number;
  animations?: Animation[];
  activeAnimations?: Set<Animation>;
  delayOverrides?: Map<Animation, number>;
}) {
  return (
    <motion.div
      layoutId={layoutId}
      layout
      transition={{ duration, ease: [0.4, 0, 0.2, 1] }}
      className="absolute"
      style={{
        left: element.position.x,
        top: element.position.y,
        width: element.size.w,
        height: element.size.h,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
      }}
    >
      <ElementRenderer
        element={element}
        animations={animations}
        activeAnimations={activeAnimations}
        delayOverrides={delayOverrides}
      />
    </motion.div>
  );
}

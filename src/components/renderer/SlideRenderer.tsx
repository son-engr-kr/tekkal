import { useMemo, memo } from "react";
import type { Slide, Animation, DeckTheme } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { AnimationStep } from "@/utils/animationSteps";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { ElementRenderer } from "./ElementRenderer";

interface Props {
  slide: Slide;
  scale: number;
  animate?: boolean;
  thumbnail?: boolean;
  /** Current step index (0 = no interactive steps triggered yet) */
  activeStep?: number;
  /** Grouped animation steps from computeSteps */
  steps?: AnimationStep[];
  /** Called when clicking the slide area — parent uses this to advance step */
  onAdvance?: () => void;
  /** Deck-level theme for default styles */
  theme?: DeckTheme;
  /** Animations to preview on the editor canvas */
  previewAnimations?: Animation[];
  /** Delay overrides for sequential preview playback */
  previewDelayOverrides?: Map<Animation, number>;
  /** Incrementing key to force remount for replay */
  previewKey?: number;
  /** Suppress video autoplay in editor */
  editorMode?: boolean;
}

export const SlideRenderer = memo(function SlideRenderer({ slide, scale, animate, thumbnail, activeStep, steps, onAdvance, theme, previewAnimations, previewDelayOverrides, previewKey, editorMode }: Props) {
  const bg = slide.background;
  const themeBgColor = theme?.slide?.background?.color;
  const resolvedBgImage = useAssetUrl(bg?.image);

  const isPreview = previewAnimations !== null && previewAnimations !== undefined && previewAnimations.length > 0;

  // Build element→animations lookup when animating or previewing
  const animationMap = useMemo(() => {
    const anims = isPreview ? slide.animations : animate ? slide.animations : null;
    if (!anims || anims.length === 0) return null;
    const map = new Map<string, Animation[]>();
    for (const anim of anims) {
      const list = map.get(anim.target);
      if (list) {
        list.push(anim);
      } else {
        map.set(anim.target, [anim]);
      }
    }
    return map;
  }, [animate, slide.animations, isPreview]);

  // Build the set of active animations + delay overrides from steps (or preview)
  const { activeAnimations, delayOverrides } = useMemo(() => {
    if (isPreview) {
      return {
        activeAnimations: new Set(previewAnimations),
        delayOverrides: previewDelayOverrides ?? undefined,
      };
    }
    if (!animate || activeStep === undefined || !steps) {
      return { activeAnimations: undefined, delayOverrides: undefined };
    }
    const set = new Set<Animation>();
    const delays = new Map<Animation, number>();
    for (let i = 0; i < activeStep && i < steps.length; i++) {
      const step = steps[i]!;
      for (const anim of step.animations) {
        set.add(anim);
        const override = step.delayOverrides.get(anim);
        if (override !== undefined) {
          delays.set(anim, override);
        }
      }
    }
    return { activeAnimations: set, delayOverrides: delays };
  }, [animate, activeStep, steps, isPreview, previewAnimations, previewDelayOverrides]);

  const content = (
    <div
      style={{
        width: CANVAS_WIDTH * scale,
        height: CANVAS_HEIGHT * scale,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        onClick={onAdvance}
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          backgroundColor: bg?.color ?? themeBgColor ?? "#ffffff",
          backgroundImage: resolvedBgImage ? `url(${resolvedBgImage})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          position: "absolute",
          top: 0,
          left: 0,
          cursor: onAdvance ? "default" : undefined,
        }}
      >
        {slide.elements.map((element) => (
          <ElementRenderer
            key={element.id}
            element={element}
            animations={animationMap?.get(element.id)}
            activeAnimations={activeAnimations}
            delayOverrides={delayOverrides}
            thumbnail={thumbnail}
            previewMode={isPreview}
            previewKey={isPreview ? previewKey : undefined}
            editorMode={editorMode}
          />
        ))}
      </div>
    </div>
  );

  return <ThemeProvider theme={theme ?? {}}>{content}</ThemeProvider>;
});

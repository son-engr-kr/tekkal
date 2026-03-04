import type { SlideElement } from "@/types/deck";

/**
 * Canonical positioning style for a slide element.
 * Used by both the visual renderer and the selection overlay
 * so position, size, and rotation never diverge.
 */
export function getElementPositionStyle(element: SlideElement): React.CSSProperties {
  return {
    left: element.position.x,
    top: element.position.y,
    width: element.size.w,
    height: element.size.h,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    transformOrigin: "center center",
  };
}

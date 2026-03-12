import { lazy, Suspense, useRef, useCallback, useEffect } from "react";
import type { ImageElement as ImageElementType, ImageStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { useDeckStore } from "@/stores/deckStore";

const PdfRenderer = lazy(() => import("./PdfRenderer"));

function isPdfSrc(src: string): boolean {
  const path = src.split("?")[0]!;
  return path.toLowerCase().endsWith(".pdf");
}

interface Props {
  element: ImageElementType;
  editorMode?: boolean;
}

export function ImageElementRenderer({ element, editorMode }: Props) {
  const style = useElementStyle<ImageStyle>("image", element.style);
  const resolvedSrc = useAssetUrl(element.src);
  const isCropping = useDeckStore((s) => s.cropElementId === element.id);
  const updateElement = useDeckStore((s) => s.updateElement);
  const slideId = useDeckStore((s) => s.deck?.slides[s.currentSlideIndex]?.id);

  // Auto-correct element size to match natural image ratio (editor only)
  const correctedRef = useRef(false);
  useEffect(() => { correctedRef.current = false; }, [element.src]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    if (!editorMode || !slideId || correctedRef.current) return;
    correctedRef.current = true;
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    const elementRatio = element.size.w / element.size.h;
    if (Math.abs(naturalRatio - elementRatio) / naturalRatio > 0.02) {
      const newH = Math.round(element.size.w / naturalRatio);
      const dy = Math.round((element.size.h - newH) / 2);
      updateElement(slideId, element.id, {
        position: { x: element.position.x, y: element.position.y + dy },
        size: { w: element.size.w, h: newH },
      });
    }
  }, [editorMode, slideId, element.id, element.size.w, element.size.h, element.position.x, element.position.y, updateElement]);

  if (!resolvedSrc) return null;

  if (isPdfSrc(element.src)) {
    return (
      <Suspense
        fallback={
          <div
            style={{
              width: element.size.w,
              height: element.size.h,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#1a1a2e",
              color: "#666",
              fontSize: 14,
              borderRadius: style.borderRadius ?? 0,
              opacity: style.opacity ?? 1,
            }}
          >
            Loading PDF...
          </div>
        }
      >
        <PdfRenderer
          src={resolvedSrc}
          width={element.size.w}
          height={element.size.h}
          borderRadius={style.borderRadius ?? 0}
          opacity={style.opacity ?? 1}
        />
      </Suspense>
    );
  }

  const crop = style.crop;
  const hasCrop = !isCropping && crop && (crop.top || crop.right || crop.bottom || crop.left);
  const clipPath = hasCrop
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;

  return (
    <img
      src={resolvedSrc}
      alt={element.alt ?? ""}
      draggable={false}
      onLoad={handleLoad}
      style={{
        width: element.size.w,
        height: element.size.h,
        objectFit: (style.objectFit ?? "contain") as React.CSSProperties["objectFit"],
        borderRadius: style.borderRadius ?? 0,
        opacity: style.opacity ?? 1,
        border: style.border,
        clipPath,
      }}
    />
  );
}

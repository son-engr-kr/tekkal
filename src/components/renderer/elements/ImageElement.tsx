import { lazy, Suspense } from "react";
import type { ImageElement as ImageElementType, ImageStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";

const PdfRenderer = lazy(() => import("./PdfRenderer"));

function isPdfSrc(src: string): boolean {
  const path = src.split("?")[0]!;
  return path.toLowerCase().endsWith(".pdf");
}

interface Props {
  element: ImageElementType;
}

export function ImageElementRenderer({ element }: Props) {
  const style = useElementStyle<ImageStyle>("image", element.style);
  const resolvedSrc = useAssetUrl(element.src);

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
  const clipPath = crop
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;

  return (
    <img
      src={resolvedSrc}
      alt={element.alt ?? ""}
      draggable={false}
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

import type { ImageElement as ImageElementType, ImageStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";

interface Props {
  element: ImageElementType;
}

export function ImageElementRenderer({ element }: Props) {
  const style = useElementStyle<ImageStyle>("image", element.style);
  const resolvedSrc = useAssetUrl(element.src);

  if (!resolvedSrc) return null;

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
      }}
    />
  );
}

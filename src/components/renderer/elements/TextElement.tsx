import { useRef, useState, useLayoutEffect } from "react";
import type { TextElement as TextElementType, TextStyle } from "@/types/deck";
import { renderMarkdown } from "@/utils/markdown";
import { useElementStyle } from "@/contexts/ThemeContext";

const MIN_FONT_SIZE = 6;

interface Props {
  element: TextElementType;
}

export function TextElementRenderer({ element }: Props) {
  const style = useElementStyle<TextStyle>("text", element.style);
  const verticalAlign = style.verticalAlign ?? "top";
  const alignItems = { top: "flex-start", middle: "center", bottom: "flex-end" }[verticalAlign];

  const baseFontSize = style.fontSize ?? 24;
  const textSizing = style.textSizing ?? "flexible";
  const isFixed = textSizing === "fixed";

  const [fontSize, setFontSize] = useState(baseFontSize);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Auto-shrink: binary-search the largest fontSize that fits the box
  // Only runs in "flexible" mode
  useLayoutEffect(() => {
    if (isFixed) {
      setFontSize(baseFontSize);
      return;
    }

    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    outer.style.fontSize = `${baseFontSize}px`;
    if (inner.scrollHeight <= outer.clientHeight + 1) {
      setFontSize(baseFontSize);
      return;
    }

    let lo = MIN_FONT_SIZE;
    let hi = baseFontSize;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      outer.style.fontSize = `${mid}px`;
      if (inner.scrollHeight <= outer.clientHeight + 1) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    setFontSize(Math.floor(lo));
  }, [baseFontSize, isFixed, element.content, element.size.w, element.size.h]);

  return (
    <div
      ref={outerRef}
      className="flex overflow-hidden"
      style={{
        width: element.size.w,
        height: element.size.h,
        fontFamily: style.fontFamily ?? "Inter, system-ui, sans-serif",
        fontSize,
        color: style.color ?? "#1e293b",
        textAlign: (style.textAlign ?? "left") as React.CSSProperties["textAlign"],
        lineHeight: style.lineHeight ?? 1.5,
        alignItems,
      }}
    >
      <div ref={innerRef} className="w-full">{renderMarkdown(element.content)}</div>
    </div>
  );
}

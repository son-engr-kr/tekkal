import { useRef, useState, useLayoutEffect } from "react";
import type { TextStyle } from "@/types/deck";
import { renderMarkdown } from "@/utils/markdown";

const MIN_FONT_SIZE = 12;

interface Props {
  content: string;
  style: TextStyle;
  width: number;
  height: number;
}

/**
 * Shared markdown text renderer used by both TextElement and ShapeElement (text overlay).
 * Handles vertical/horizontal alignment, flex-fit font shrinking, and math-aware sizing.
 */
export function TextContent({ content, style, width, height }: Props) {
  const verticalAlign = style.verticalAlign ?? "top";
  const alignItems = { top: "flex-start", middle: "center", bottom: "flex-end" }[verticalAlign];

  const baseFontSize = style.fontSize ?? 24;
  // Treat elements with math ($...$) as fixed — auto-shrink distorts KaTeX rendering
  const hasMath = /\$/.test(content ?? "");
  const textSizing = style.textSizing ?? (hasMath ? "fixed" : "flexible");
  const isFixed = textSizing === "fixed";

  const [fontSize, setFontSize] = useState(baseFontSize);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

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
  }, [baseFontSize, isFixed, content, width, height]);

  return (
    <div
      ref={outerRef}
      className="flex overflow-hidden"
      style={{
        width,
        height,
        fontFamily: style.fontFamily ?? "Inter, system-ui, sans-serif",
        fontSize,
        color: style.color ?? "#1e293b",
        textAlign: (style.textAlign ?? "left") as React.CSSProperties["textAlign"],
        lineHeight: style.lineHeight ?? 1.5,
        alignItems,
      }}
    >
      <div ref={innerRef} className="w-full">{renderMarkdown(content, fontSize)}</div>
    </div>
  );
}

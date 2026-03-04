import { useState, useEffect, useRef, useCallback } from "react";
import type { MermaidElement as MermaidElementType, MermaidStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useDeckStore } from "@/stores/deckStore";

interface Props {
  element: MermaidElementType;
  thumbnail?: boolean;
}

let mermaidIdCounter = 0;

export function MermaidElementRenderer({ element, thumbnail }: Props) {
  const style = useElementStyle<MermaidStyle>("mermaid", element.style);
  const [svgHtml, setSvgHtml] = useState<string | null>(element.renderedSvg ?? null);
  const [error, setError] = useState<string | null>(element.renderError ?? null);
  const renderIdRef = useRef(0);

  const isCached =
    element.renderedSvg &&
    element.renderedContent === element.content;

  const render = useCallback(async (content: string) => {
    const renderId = ++renderIdRef.current;

    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "sans-serif",
    });

    const id = `mermaid-${Date.now()}-${++mermaidIdCounter}`;
    const { svg } = await mermaid.render(id, content);

    if (renderId !== renderIdRef.current) return;

    setSvgHtml(svg);
    setError(null);

    useDeckStore.getState().patchElementById(element.id, {
      renderedSvg: svg,
      renderedContent: content,
      renderError: undefined,
    } as Record<string, unknown>);
  }, [element.id]);

  useEffect(() => {
    if (isCached) {
      setSvgHtml(element.renderedSvg!);
      setError(null);
      return;
    }

    if (!element.content.trim()) return;

    render(element.content).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setSvgHtml(null);
      useDeckStore.getState().patchElementById(element.id, {
        renderError: err instanceof Error ? err.message : String(err),
        renderedSvg: undefined,
        renderedContent: undefined,
      } as Record<string, unknown>);
    });
  }, [element.content, element.id, isCached, element.renderedSvg, render]);

  // SVG rendered successfully
  if (svgHtml) {
    return (
      <div
        style={{
          width: element.size.w,
          height: element.size.h,
          backgroundColor: style.backgroundColor ?? "transparent",
          borderRadius: style.borderRadius ?? 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    );
  }

  // Error state
  if (error) {
    return (
      <div
        style={{
          width: element.size.w,
          height: element.size.h,
          backgroundColor: "#2a1215",
          borderRadius: style.borderRadius ?? 4,
          border: "1px solid #7f1d1d",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: 8,
        }}
      >
        <div style={{ color: "#f87171", fontSize: thumbnail ? 7 : 11, fontWeight: 600, marginBottom: 4 }}>
          Mermaid render error
        </div>
        {!thumbnail && (
          <pre
            style={{
              color: "#fca5a5",
              fontSize: 9,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              overflow: "auto",
              maxHeight: element.size.h - 30,
              textAlign: "left",
              width: "100%",
              margin: 0,
            }}
          >
            {error}
          </pre>
        )}
      </div>
    );
  }

  // Placeholder
  return (
    <div
      style={{
        width: element.size.w,
        height: element.size.h,
        backgroundColor: style.backgroundColor ?? "#1e1e2e",
        borderRadius: style.borderRadius ?? 4,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
      }}
    >
      <div style={{ color: "#888", fontSize: thumbnail ? 8 : 12, marginBottom: 4 }}>
        Mermaid (rendering...)
      </div>
      {!thumbnail && (
        <pre
          style={{
            color: "#aaa",
            fontSize: 9,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            overflow: "hidden",
            maxHeight: element.size.h - 30,
            textAlign: "left",
            width: "100%",
          }}
        >
          {element.content.slice(0, 300)}
        </pre>
      )}
    </div>
  );
}

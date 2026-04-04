import { useState, useCallback } from "react";
import type { TikZElement as TikZElementType, TikZStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { useDeckStore } from "@/stores/deckStore";

interface Props {
  element: TikZElementType;
  thumbnail?: boolean;
}

function isSvgFresh(element: TikZElementType): boolean {
  if (!element.svgUrl) return false;
  if (element.renderedContent === undefined) return false;
  return (
    element.content === element.renderedContent &&
    (element.preamble ?? "") === (element.renderedPreamble ?? "")
  );
}

export function TikZElementRenderer({ element, thumbnail }: Props) {
  const style = useElementStyle<TikZStyle>("tikz", element.style);
  const resolvedSvgUrl = useAssetUrl(element.svgUrl);
  const [imgBroken, setImgBroken] = useState(false);

  const handleImgError = useCallback(() => {
    setImgBroken(true);
    useDeckStore.getState().patchElementById(element.id, {
      svgUrl: undefined,
      renderedContent: undefined,
      renderedPreamble: undefined,
    } as Record<string, unknown>);
  }, [element.id]);

  if (isSvgFresh(element) && resolvedSvgUrl && !imgBroken) {
    return (
      <img
        src={resolvedSvgUrl}
        alt="TikZ diagram"
        onError={handleImgError}
        style={{
          width: element.size.w,
          height: element.size.h,
          objectFit: "contain",
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius ?? 0,
        }}
      />
    );
  }

  // Error state: auto-render failed
  if (element.renderError) {
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
          TikZ render error
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
            {element.renderError}
          </pre>
        )}
      </div>
    );
  }

  // Placeholder: show TikZ source preview
  return (
    <div
      style={{
        width: element.size.w,
        height: element.size.h,
        backgroundColor: "#1e1e2e",
        borderRadius: style.borderRadius ?? 4,
        border: "1px dashed #334155",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: thumbnail ? 8 : 12, marginBottom: 4 }}>
        TikZ (not rendered)
      </div>
      {!thumbnail && (
        <pre
          style={{
            color: "#cbd5e1",
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

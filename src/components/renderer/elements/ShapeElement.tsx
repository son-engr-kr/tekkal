import type { ShapeElement as ShapeElementType, ShapeStyle, TextStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { resolveMarkers } from "@/utils/lineMarkers";
import { TextContent } from "./TextContent";

interface Props {
  element: ShapeElementType;
}

/** Apply alpha to a CSS color string. Handles hex (#rgb, #rrggbb), "transparent", and pass-through. */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  if (color === "transparent") return color;
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

export function ShapeElementRenderer({ element }: Props) {
  const style = useElementStyle<ShapeStyle>("shape", element.style);
  const { w, h } = element.size;
  const fOp = style.fillOpacity ?? 1;
  const sOp = style.strokeOpacity ?? 1;

  if (element.shape === "ellipse") {
    // Inset radii by half the stroke width so the stroke doesn't get clipped at the edges
    const sw = style.strokeWidth ?? 1;
    const rx = Math.max(0, w / 2 - sw / 2);
    const ry = Math.max(0, h / 2 - sw / 2);
    return (
      <div style={{ position: "relative", width: w, height: h }}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ opacity: style.opacity ?? 1 }}>
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={rx}
            ry={ry}
            fill={style.fill ?? "transparent"}
            fillOpacity={fOp}
            stroke={style.stroke ?? "#888888"}
            strokeOpacity={sOp}
            strokeWidth={sw}
          />
        </svg>
        {element.text && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <TextContent
              content={element.text}
              style={shapeTextStyle(element.textStyle)}
              width={w}
              height={h}
            />
          </div>
        )}
      </div>
    );
  }

  if (element.shape === "line" || element.shape === "arrow") {
    const { startMarker, endMarker } = resolveMarkers(element, style);
    const strokeColor = style.stroke ?? "#888888";
    const sw = style.strokeWidth ?? 2;
    const pathD = style.path;
    const waypoints = style.waypoints;
    const hasWaypoints = waypoints && waypoints.length >= 2;

    const markerDefs: React.ReactNode[] = [];
    // Scale markers with sqrt(sw) so they grow gently instead of linearly
    const ms = Math.sqrt(sw);
    const arrowW = 10 * ms;
    const arrowH = 7 * ms;
    const circleSize = 8 * ms;

    // Shorten line at ends with arrow markers so stroke doesn't poke through the tip
    const shortenStart = startMarker === "arrow" ? sw * 1.5 : 0;
    const shortenEnd = endMarker === "arrow" ? sw * 1.5 : 0;

    const addArrowMarker = (id: string, position: "start" | "end") => {
      // refX compensates for shortened line so the arrow tip reaches the original endpoint
      const shorten = position === "start" ? shortenStart : shortenEnd;
      markerDefs.push(
        <marker
          key={id}
          id={id}
          markerUnits="userSpaceOnUse"
          markerWidth={arrowW}
          markerHeight={arrowH}
          refX={arrowW - shorten}
          refY={arrowH / 2}
          orient={position === "start" ? "auto-start-reverse" : "auto"}
        >
          <polygon
            points={`0 0, ${arrowW} ${arrowH / 2}, 0 ${arrowH}`}
            fill={strokeColor}
            fillOpacity={sOp}
          />
        </marker>,
      );
    };

    const addCircleMarker = (id: string, position: "start" | "end") => {
      const r = circleSize * 0.375;
      markerDefs.push(
        <marker
          key={id}
          id={id}
          markerUnits="userSpaceOnUse"
          markerWidth={circleSize}
          markerHeight={circleSize}
          refX={position === "start" ? circleSize * 0.25 : circleSize * 0.75}
          refY={circleSize / 2}
          orient="auto"
        >
          <circle
            cx={circleSize / 2}
            cy={circleSize / 2}
            r={r}
            fill={strokeColor}
            fillOpacity={sOp}
          />
        </marker>,
      );
    };

    let markerStartAttr: string | undefined;
    let markerEndAttr: string | undefined;

    if (startMarker !== "none") {
      const id = `marker-start-${element.id}`;
      if (startMarker === "arrow") addArrowMarker(id, "start");
      else addCircleMarker(id, "start");
      markerStartAttr = `url(#${id})`;
    }
    if (endMarker !== "none") {
      const id = `marker-end-${element.id}`;
      if (endMarker === "arrow") addArrowMarker(id, "end");
      else addCircleMarker(id, "end");
      markerEndAttr = `url(#${id})`;
    }

    // Shorten polyline/line endpoints so the stroke ends at the arrow base
    let drawnWaypoints: string | undefined;
    if (hasWaypoints && (shortenStart > 0 || shortenEnd > 0)) {
      const pts = waypoints.map((p) => ({ ...p }));
      if (shortenStart > 0 && pts.length >= 2) {
        const [p0, p1] = [pts[0]!, pts[1]!];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > shortenStart) {
          pts[0] = { x: p0.x + (dx / len) * shortenStart, y: p0.y + (dy / len) * shortenStart };
        }
      }
      if (shortenEnd > 0 && pts.length >= 2) {
        const li = pts.length - 1;
        const [pLast, pPrev] = [pts[li]!, pts[li - 1]!];
        const dx = pPrev.x - pLast.x, dy = pPrev.y - pLast.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > shortenEnd) {
          pts[li] = { x: pLast.x + (dx / len) * shortenEnd, y: pLast.y + (dy / len) * shortenEnd };
        }
      }
      drawnWaypoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
    }

    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ opacity: style.opacity ?? 1, overflow: "visible" }}
      >
        {markerDefs.length > 0 && <defs>{markerDefs}</defs>}
        {hasWaypoints ? (
          <polyline
            points={drawnWaypoints ?? waypoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={strokeColor}
            strokeOpacity={sOp}
            strokeWidth={sw}
            markerStart={markerStartAttr}
            markerEnd={markerEndAttr}
          />
        ) : pathD ? (
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeOpacity={sOp}
            strokeWidth={sw}
            markerStart={markerStartAttr}
            markerEnd={markerEndAttr}
          />
        ) : (
          <line
            x1={shortenStart}
            y1={0}
            x2={w - shortenEnd}
            y2={0}
            stroke={strokeColor}
            strokeOpacity={sOp}
            strokeWidth={sw}
            markerStart={markerStartAttr}
            markerEnd={markerEndAttr}
          />
        )}
      </svg>
    );
  }

  // Rectangle (default)
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        backgroundColor: withAlpha(style.fill ?? "transparent", fOp),
        border:
          style.stroke || style.strokeWidth
            ? `${style.strokeWidth ?? 1}px solid ${withAlpha(style.stroke ?? "#888888", sOp)}`
            : undefined,
        borderRadius: style.borderRadius ?? 0,
        opacity: style.opacity ?? 1,
      }}
    >
      {element.text && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <TextContent
            content={element.text}
            style={shapeTextStyle(element.textStyle)}
            width={w}
            height={h}
          />
        </div>
      )}
    </div>
  );
}

/** Default text style for shape labels: centered both axes. */
function shapeTextStyle(override?: TextStyle): TextStyle {
  return {
    textAlign: "center",
    verticalAlign: "middle",
    fontSize: 16,
    ...override,
  };
}

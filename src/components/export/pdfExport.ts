import { jsPDF } from "jspdf";
import { toPng, toJpeg } from "html-to-image";
import { codeToHtml } from "shiki";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  TextStyle,
  CodeElement,
  CodeStyle,
  ShapeElement,
  ShapeStyle,
  ImageElement,
  ImageStyle,
  TableElement,
  TableStyle,
  TikZElement,
  MermaidElement,
  ReferenceElement,
  VideoElement as VideoElementType,
  VideoStyle,
} from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import {
  fetchImageAsBase64,
  resolveStyle,
  resolveAssetSrc,
  isPdfSrc,
  rasterizePdfToBase64,
  DEFAULT_BG,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_FONT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_CODE_SIZE,
  DEFAULT_CODE_BG,
  DEFAULT_CODE_FG,
  DEFAULT_CODE_RADIUS,
  DEFAULT_CODE_THEME,
  DEFAULT_TABLE_SIZE,
  captureVideoFirstFrame,
} from "@/utils/exportUtils";
import { computeBounds } from "@/utils/bounds";
import { resolveMarkers } from "@/utils/lineMarkers";

const MIN_FONT_SIZE = 6;
const CAPTURE_SCALE = 2;

export type ExportProgressCallback = (current: number, total: number) => void;

export interface PdfImageOptions {
  /** Pixel ratio for capture (default: 2) */
  scale?: number;
  /** Image format — "png" for lossless, "jpeg" for smaller files (default: "png") */
  format?: "png" | "jpeg";
  /** JPEG quality 0-1 (default: 0.75) */
  quality?: number;
  /** Progress callback, called after each slide is rendered */
  onProgress?: ExportProgressCallback;
}

// ---- HTML escape ----

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ========================================================================
// Markdown → HTML string (mirrors renderMarkdown from utils/markdown.ts
// but outputs an HTML string instead of React elements, so we avoid
// needing React rendering in the export path)
// ========================================================================

function mdToHtml(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let listItems: string[] = [];
  let mathBuf: string[] | null = null;

  const flushList = () => {
    if (!listItems.length) return;
    out.push(
      `<ul style="list-style-type:disc;padding-left:1.5em;margin:0.25em 0">${listItems.map((li) => `<li>${inlineHtml(li)}</li>`).join("")}</ul>`,
    );
    listItems = [];
  };

  for (const line of lines) {
    const t = line.trim();

    // Block math delimiter $$
    if (t === "$$") {
      if (mathBuf === null) {
        flushList();
        mathBuf = [];
      } else {
        out.push(
          `<div style="margin:0.5em 0;text-align:center">${katex.renderToString(mathBuf.join("\n"), { displayMode: true, throwOnError: false })}</div>`,
        );
        mathBuf = null;
      }
      continue;
    }
    if (mathBuf !== null) {
      mathBuf.push(line);
      continue;
    }

    // Single-line block math $$...$$
    const slm = t.match(/^\$\$(.+)\$\$$/);
    if (slm) {
      flushList();
      out.push(
        `<div style="margin:0.5em 0;text-align:center">${katex.renderToString(slm[1]!, { displayMode: true, throwOnError: false })}</div>`,
      );
      continue;
    }

    // List item
    if (t.startsWith("- ") || t.startsWith("* ")) {
      listItems.push(t.slice(2));
      continue;
    }

    flushList();
    if (t === "") continue;

    // Heading
    const hm = t.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1]!.length as 1 | 2 | 3;
      const sz = { 1: "1.8em", 2: "1.4em", 3: "1.1em" }[level];
      const fw = { 1: "bold", 2: "600", 3: "500" }[level];
      out.push(
        `<div style="font-size:${sz};font-weight:${fw}">${inlineHtml(hm[2]!)}</div>`,
      );
      continue;
    }

    // Paragraph
    out.push(`<p style="margin:0">${inlineHtml(t)}</p>`);
  }

  flushList();
  return out.join("");
}

function inlineHtml(text: string): string {
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\$(.+?)\$)/g;
  let r = "";
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) r += esc(text.slice(last, m.index));
    if (m[2] !== undefined) r += `<strong>${esc(m[2])}</strong>`;
    else if (m[4] !== undefined) r += `<em>${esc(m[4])}</em>`;
    else if (m[6] !== undefined)
      r += `<code style="background:rgba(255,255,255,0.1);padding:0 0.375em;border-radius:0.25em;font-size:0.85em;font-family:monospace">${esc(m[6])}</code>`;
    else if (m[8] !== undefined)
      r += katex.renderToString(m[8], {
        displayMode: false,
        throwOnError: false,
      });
    last = m.index + m[0].length;
  }

  if (last < text.length) r += esc(text.slice(last));
  return r;
}

// ========================================================================
// Main export
// ========================================================================

export async function exportToPdf(
  deck: Deck,
  adapter: FileSystemAdapter,
  opts?: PdfImageOptions,
): Promise<void> {
  const captureScale = opts?.scale ?? CAPTURE_SCALE;
  const imgFormat = opts?.format ?? "png";
  const jpegQuality = opts?.quality ?? 0.75;
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [CANVAS_WIDTH, CANVAS_HEIGHT],
    hotfixes: ["px_scaling"],
  });

  const slides = deck.slides.filter((s) => !s.hidden);
  const totalPages = slides.length;

  for (let i = 0; i < slides.length; i++) {
    if (i > 0) doc.addPage([CANVAS_WIDTH, CANVAS_HEIGHT], "landscape");
    await renderSlide(doc, slides[i]!, deck, adapter, i + 1, totalPages, captureScale, imgFormat, jpegQuality);
    opts?.onProgress?.(i + 1, slides.length);
  }

  const name = (deck.meta.title || "presentation").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  doc.save(`${name}.pdf`);
}

// ========================================================================
// Capture one slide: build full DOM tree → capture with toPng/toJpeg
//
// KEY FIX: the captured node (ctr) has NO position offset. A separate
// wrapper div hides it behind the app via z-index. Previous code used
// position:fixed;left:-9999px on the captured node itself, which caused
// html-to-image to inline those styles into the SVG foreignObject clone,
// positioning content outside the visible SVG area → blank output.
// ========================================================================

/**
 * Render a single slide to a data-URL image (PNG or JPEG).
 * Used by both the PDF image export and the standalone image export.
 */
export async function captureSlideToDataUrl(
  slide: Slide,
  deck: Deck,
  adapter: FileSystemAdapter,
  pageNumber: number,
  totalPages: number,
  captureScale: number = CAPTURE_SCALE,
  imgFormat: "png" | "jpeg" = "png",
  jpegQuality: number = 0.75,
): Promise<string> {
  // Wrapper: positioned at (0,0) behind everything (lowest z-index).
  // This is NOT the captured node — its styles don't get cloned.
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;left:0;top:0;z-index:-2147483647;pointer-events:none";

  // Slide container: the node we capture. No position offset!
  const ctr = document.createElement("div");
  const bg = slide.background ?? deck.theme?.slide?.background;
  const bgColor = bg?.color ?? DEFAULT_BG;
  ctr.style.cssText = `width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;background-color:${bgColor}`;
  if (bg?.image) {
    ctr.style.backgroundImage = `url(${bg.image})`;
    ctr.style.backgroundSize = "cover";
    ctr.style.backgroundPosition = "center";
  }

  wrapper.appendChild(ctr);
  document.body.appendChild(wrapper);

  // Build each element as a positioned child of the slide container
  for (const el of slide.elements) {
    try {
      const node = await buildElement(el, deck, adapter);
      if (!node) continue;
      node.style.position = "absolute";
      node.style.left = `${el.position.x}px`;
      node.style.top = `${el.position.y}px`;
      node.style.width = `${el.size.w}px`;
      node.style.height = `${el.size.h}px`;
      // Line/arrow SVGs need overflow:visible so markers & strokes aren't clipped
      const isLineShape =
        el.type === "shape" && ((el as ShapeElement).shape === "line" || (el as ShapeElement).shape === "arrow");
      node.style.overflow = isLineShape ? "visible" : "hidden";
      ctr.appendChild(node);

      // Flexible text sizing: shrink font to fit (needs DOM attachment)
      if (node.dataset.flexFit) {
        fitFont(node, Number(node.dataset.flexFit));
      }
      // Also handle nested flex-fit (e.g. text inside reference components)
      for (const nested of node.querySelectorAll("[data-flex-fit]")) {
        fitFont(nested as HTMLElement, Number((nested as HTMLElement).dataset.flexFit));
      }
    } catch (err) {
      console.error("[PDF] element build error:", el.type, el.id, err);
    }
  }

  // Page number overlay
  const pnConfig = deck.pageNumbers;
  if (pnConfig?.enabled && !slide.hidePageNumber) {
    const pn = document.createElement("div");
    const pos = pnConfig.position ?? "bottom-right";
    const margin = pnConfig.margin ?? 20;
    const fontSize = pnConfig.fontSize ?? 14;
    const color = pnConfig.color ?? "#94a3b8";
    const fontFamily = pnConfig.fontFamily || "sans-serif";
    const opacity = pnConfig.opacity ?? 1;
    const text = pnConfig.format === "number-total"
      ? `${pageNumber} / ${totalPages}`
      : `${pageNumber}`;

    pn.textContent = text;
    pn.style.cssText = `position:absolute;font-size:${fontSize}px;color:${color};font-family:${fontFamily};opacity:${opacity};line-height:1;white-space:nowrap;pointer-events:none`;
    if (pos.startsWith("bottom")) pn.style.bottom = `${margin}px`;
    else pn.style.top = `${margin}px`;
    if (pos.endsWith("right")) pn.style.right = `${margin}px`;
    else if (pos.endsWith("left")) pn.style.left = `${margin}px`;
    else { pn.style.left = "50%"; pn.style.transform = "translateX(-50%)"; }
    ctr.appendChild(pn);
  }

  // Wait for all images to load
  const imgs = ctr.querySelectorAll("img");
  await Promise.all(
    Array.from(imgs).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          }),
    ),
  );

  // Capture the slide container
  const capture = imgFormat === "jpeg" ? toJpeg : toPng;
  const captureOpts = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    pixelRatio: captureScale,
    ...(imgFormat === "jpeg" ? { quality: jpegQuality } : {}),
  };

  let dataUrl: string;
  try {
    dataUrl = await capture(ctr, captureOpts);
  } catch {
    // Retry without font embedding (CORS/Vite font-fetch failures)
    try {
      dataUrl = await capture(ctr, { ...captureOpts, skipFonts: true });
    } catch (err) {
      console.error("[PDF] slide capture failed:", err);
      wrapper.remove();
      // 1×1 transparent PNG as fallback
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/pOHurgAAAABJRU5ErkJggg==";
    }
  }

  wrapper.remove();
  return dataUrl!;
}

/**
 * Internal: render one slide and add it to the jsPDF document.
 */
async function renderSlide(
  doc: jsPDF,
  slide: Slide,
  deck: Deck,
  adapter: FileSystemAdapter,
  pageNumber: number,
  totalPages: number,
  captureScale: number = CAPTURE_SCALE,
  imgFormat: "png" | "jpeg" = "png",
  jpegQuality: number = 0.75,
): Promise<void> {
  const dataUrl = await captureSlideToDataUrl(
    slide, deck, adapter, pageNumber, totalPages,
    captureScale, imgFormat, jpegQuality,
  );
  const pdfFormat = imgFormat === "jpeg" ? "JPEG" : "PNG";
  doc.addImage(dataUrl, pdfFormat, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

// ---- Flexible text font fitting (binary search, mirrors TextElement.tsx) ----

function fitFont(outer: HTMLElement, base: number): void {
  const inner = outer.firstElementChild as HTMLElement | null;
  if (!inner) return;
  outer.style.fontSize = `${base}px`;
  if (inner.scrollHeight <= outer.clientHeight + 1) return;

  let lo = MIN_FONT_SIZE;
  let hi = base;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    outer.style.fontSize = `${mid}px`;
    if (inner.scrollHeight <= outer.clientHeight + 1) lo = mid;
    else hi = mid;
  }
  outer.style.fontSize = `${Math.floor(lo)}px`;
}

// ========================================================================
// Element builders — each returns a DOM node matching the React renderer
// ========================================================================

async function buildElement(
  el: SlideElement,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<HTMLElement | null> {
  switch (el.type) {
    case "text":
      return buildText(el, deck);
    case "code":
      return await buildCode(el, deck);
    case "image":
      return await buildImage(el, deck, adapter);
    case "shape":
      return buildShape(el, deck);
    case "table":
      return buildTable(el, deck);
    case "tikz":
      return await buildTikZ(el, adapter);
    case "mermaid":
      return buildMermaid(el);
    case "video":
      return await buildVideo(el as VideoElementType, deck, adapter);
    case "reference":
      return await buildReference(el as ReferenceElement, deck, adapter);
    default:
      return null;
  }
}

// ---- Reference (mirrors ReferenceElement.tsx) ----

async function buildReference(
  el: ReferenceElement,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<HTMLElement | null> {
  const comp = deck.components?.[el.componentId];
  if (!comp) return null;

  const bounds = computeBounds(comp.elements);
  const scaleX = bounds.w > 0 ? el.size.w / bounds.w : 1;
  const scaleY = bounds.h > 0 ? el.size.h / bounds.h : 1;

  const outer = document.createElement("div");
  outer.style.cssText = "width:100%;height:100%;position:relative;overflow:hidden";

  const inner = document.createElement("div");
  inner.style.cssText = `width:${bounds.w}px;height:${bounds.h}px;transform:scale(${scaleX},${scaleY});transform-origin:top left;position:relative`;

  const origin = document.createElement("div");
  origin.style.cssText = `position:relative;left:${-bounds.x}px;top:${-bounds.y}px`;

  for (const child of comp.elements) {
    const node = await buildElement(child, deck, adapter);
    if (!node) continue;
    node.style.position = "absolute";
    node.style.left = `${child.position.x}px`;
    node.style.top = `${child.position.y}px`;
    node.style.width = `${child.size.w}px`;
    node.style.height = `${child.size.h}px`;
    node.style.overflow = "hidden";
    origin.appendChild(node);
  }

  inner.appendChild(origin);
  outer.appendChild(inner);
  return outer;
}

// ---- Text (mirrors TextElement.tsx) ----

function buildText(el: TextElement, deck: Deck): HTMLElement {
  const s = resolveStyle<TextStyle>(deck.theme?.text, el.style);
  const font = s.fontFamily ?? DEFAULT_TEXT_FONT;
  const size = s.fontSize ?? DEFAULT_TEXT_SIZE;
  const color = s.color ?? DEFAULT_TEXT_COLOR;
  const align = s.textAlign ?? "left";
  const lh = s.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const va = s.verticalAlign ?? "top";
  const sizing = s.textSizing ?? "flexible";
  const ai = { top: "flex-start", middle: "center", bottom: "flex-end" }[va];

  const d = document.createElement("div");
  d.style.cssText = `display:flex;align-items:${ai};font-family:${font};font-size:${size}px;color:${color};text-align:${align};line-height:${lh};width:100%;height:100%`;

  const inner = document.createElement("div");
  inner.style.width = "100%";
  inner.innerHTML = mdToHtml(el.content);
  d.appendChild(inner);

  if (sizing === "flexible") d.dataset.flexFit = String(size);
  return d;
}

// ---- Code (mirrors CodeElement.tsx — uses Shiki codeToHtml) ----

async function buildCode(el: CodeElement, deck: Deck): Promise<HTMLElement> {
  const s = resolveStyle<CodeStyle>(deck.theme?.code, el.style);
  const size = s.fontSize ?? DEFAULT_CODE_SIZE;
  const radius = s.borderRadius ?? DEFAULT_CODE_RADIUS;
  const theme = s.theme ?? DEFAULT_CODE_THEME;

  const d = document.createElement("div");
  d.style.cssText = `width:100%;height:100%;border-radius:${radius}px;overflow:hidden;font-size:${size}px`;

  if (el.content) {
    const html = await codeToHtml(el.content, { lang: el.language, theme });
    d.innerHTML = html;
    const pre = d.querySelector("pre");
    if (pre instanceof HTMLElement) {
      pre.style.cssText =
        "height:100%;width:100%;padding:16px;margin:0;overflow:auto;border-radius:0";
    }
    const code = d.querySelector("code");
    if (code instanceof HTMLElement) {
      code.style.fontFamily =
        "'Courier New', Consolas, 'Fira Code', monospace";
    }
  } else {
    d.style.backgroundColor = DEFAULT_CODE_BG;
    d.style.color = DEFAULT_CODE_FG;
  }

  return d;
}

// ---- Image (mirrors ImageElement.tsx) ----

async function buildImage(
  el: ImageElement,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<HTMLElement | null> {
  const s = resolveStyle<ImageStyle>(deck.theme?.image, el.style);

  const d = document.createElement("div");
  d.style.cssText = "width:100%;height:100%";

  const img = document.createElement("img");
  const crop = s.crop;
  const hasCrop = crop && (crop.top || crop.right || crop.bottom || crop.left);
  img.style.cssText = [
    "width:100%",
    "height:100%",
    `object-fit:${s.objectFit ?? "contain"}`,
    `border-radius:${s.borderRadius ?? 0}px`,
    `opacity:${s.opacity ?? 1}`,
    s.border ? `border:${s.border}` : "",
    hasCrop ? `clip-path:inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)` : "",
  ]
    .filter(Boolean)
    .join(";");

  // Resolve via the active adapter (blob URL on FsAccess, server path on Vite)
  // then pre-fetch as base64 to avoid CORS issues in html-to-image capture
  const resolved = await resolveAssetSrc(el.src, adapter);

  // PDF files can't be rendered in <img> — rasterize first page via pdfjs
  if (isPdfSrc(el.src)) {
    const pdfPng = await rasterizePdfToBase64(resolved, el.size.w, el.size.h);
    if (!pdfPng) return null;
    img.src = pdfPng;
  } else {
    const b64 = await fetchImageAsBase64(resolved);
    img.src = b64 ?? resolved;
  }

  d.appendChild(img);
  return d;
}

// ---- Shape (mirrors ShapeElement.tsx) ----

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

function buildShape(el: ShapeElement, deck: Deck): HTMLElement {
  const s = resolveStyle<ShapeStyle>(deck.theme?.shape, el.style);
  const fill = s.fill ?? "transparent";
  const stroke = s.stroke ?? "#888888";
  const op = s.opacity ?? 1;
  const fOp = s.fillOpacity ?? 1;
  const sOp = s.strokeOpacity ?? 1;
  const { w, h } = el.size;
  const ns = "http://www.w3.org/2000/svg";

  // Line / Arrow → inline SVG (matches ShapeElementRenderer)
  if (el.shape === "line" || el.shape === "arrow") {
    const sw = s.strokeWidth ?? 2;
    const d = document.createElement("div");
    d.style.cssText = `width:100%;height:100%;opacity:${op}`;

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.overflow = "visible";

    const { startMarker, endMarker } = resolveMarkers(el, s);
    const defs = document.createElementNS(ns, "defs");
    let hasDefs = false;

    const ms = Math.sqrt(sw);
    const arrowW = 10 * ms;
    const arrowH = 7 * ms;
    const circleSize = 8 * ms;

    const shortenStart = startMarker === "arrow" ? sw * 1.5 : 0;
    const shortenEnd = endMarker === "arrow" ? sw * 1.5 : 0;

    const addArrowMarkerDom = (id: string, position: "start" | "end") => {
      const shorten = position === "start" ? shortenStart : shortenEnd;
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.setAttribute("markerWidth", String(arrowW));
      marker.setAttribute("markerHeight", String(arrowH));
      marker.setAttribute("refX", String(arrowW - shorten));
      marker.setAttribute("refY", String(arrowH / 2));
      marker.setAttribute("orient", position === "start" ? "auto-start-reverse" : "auto");
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("points", `0 0, ${arrowW} ${arrowH / 2}, 0 ${arrowH}`);
      poly.setAttribute("fill", stroke);
      poly.setAttribute("fill-opacity", String(sOp));
      marker.appendChild(poly);
      defs.appendChild(marker);
      hasDefs = true;
    };

    const addCircleMarkerDom = (id: string, position: "start" | "end") => {
      const r = circleSize * 0.375;
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.setAttribute("markerWidth", String(circleSize));
      marker.setAttribute("markerHeight", String(circleSize));
      marker.setAttribute("refX", String(position === "start" ? circleSize * 0.25 : circleSize * 0.75));
      marker.setAttribute("refY", String(circleSize / 2));
      marker.setAttribute("orient", "auto");
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", String(circleSize / 2));
      circle.setAttribute("cy", String(circleSize / 2));
      circle.setAttribute("r", String(r));
      circle.setAttribute("fill", stroke);
      circle.setAttribute("fill-opacity", String(sOp));
      marker.appendChild(circle);
      defs.appendChild(marker);
      hasDefs = true;
    };

    let markerStartAttr: string | undefined;
    let markerEndAttr: string | undefined;

    if (startMarker !== "none") {
      const id = `marker-start-${el.id}`;
      if (startMarker === "arrow") addArrowMarkerDom(id, "start");
      else addCircleMarkerDom(id, "start");
      markerStartAttr = `url(#${id})`;
    }
    if (endMarker !== "none") {
      const id = `marker-end-${el.id}`;
      if (endMarker === "arrow") addArrowMarkerDom(id, "end");
      else addCircleMarkerDom(id, "end");
      markerEndAttr = `url(#${id})`;
    }

    if (hasDefs) svg.appendChild(defs);

    const pathD = s.path;
    const waypoints = s.waypoints;
    const hasWaypoints = waypoints && waypoints.length >= 2;

    if (hasWaypoints) {
      svg.setAttribute("style", `opacity:${op};overflow:visible`);
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
      const polyline = document.createElementNS(ns, "polyline");
      polyline.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", stroke);
      polyline.setAttribute("stroke-opacity", String(sOp));
      polyline.setAttribute("stroke-width", String(sw));
      if (markerStartAttr) polyline.setAttribute("marker-start", markerStartAttr);
      if (markerEndAttr) polyline.setAttribute("marker-end", markerEndAttr);
      svg.appendChild(polyline);
    } else if (pathD) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", pathD);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-opacity", String(sOp));
      path.setAttribute("stroke-width", String(sw));
      if (markerStartAttr) path.setAttribute("marker-start", markerStartAttr);
      if (markerEndAttr) path.setAttribute("marker-end", markerEndAttr);
      svg.appendChild(path);
    } else {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(shortenStart));
      line.setAttribute("y1", "0");
      line.setAttribute("x2", String(w - shortenEnd));
      line.setAttribute("y2", "0");
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-opacity", String(sOp));
      line.setAttribute("stroke-width", String(sw));
      if (markerStartAttr) line.setAttribute("marker-start", markerStartAttr);
      if (markerEndAttr) line.setAttribute("marker-end", markerEndAttr);
      svg.appendChild(line);
    }

    d.appendChild(svg);
    return d;
  }

  // Ellipse → inline SVG (matches ShapeElementRenderer)
  if (el.shape === "ellipse") {
    const sw = s.strokeWidth ?? 1;
    const d = document.createElement("div");
    d.style.cssText = `width:100%;height:100%;opacity:${op}`;

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const ellipse = document.createElementNS(ns, "ellipse");
    const rx = Math.max(0, w / 2 - sw / 2);
    const ry = Math.max(0, h / 2 - sw / 2);
    ellipse.setAttribute("cx", String(w / 2));
    ellipse.setAttribute("cy", String(h / 2));
    ellipse.setAttribute("rx", String(rx));
    ellipse.setAttribute("ry", String(ry));
    ellipse.setAttribute("fill", fill);
    ellipse.setAttribute("fill-opacity", String(fOp));
    ellipse.setAttribute("stroke", stroke);
    ellipse.setAttribute("stroke-opacity", String(sOp));
    ellipse.setAttribute("stroke-width", String(sw));
    svg.appendChild(ellipse);
    d.appendChild(svg);
    return d;
  }

  // Rectangle → CSS div (matches ShapeElementRenderer)
  const sw = s.strokeWidth ?? 1;
  const hasBorder = !!s.stroke || !!s.strokeWidth;
  const fillColor = fOp < 1 ? withAlpha(fill, fOp) : fill;
  const strokeColor = sOp < 1 ? withAlpha(stroke, sOp) : stroke;
  const d = document.createElement("div");
  d.style.cssText = [
    "width:100%",
    "height:100%",
    `background-color:${fillColor}`,
    hasBorder ? `border:${sw}px solid ${strokeColor}` : "",
    `border-radius:${s.borderRadius ?? 0}px`,
    `opacity:${op}`,
    "box-sizing:border-box",
  ]
    .filter(Boolean)
    .join(";");
  return d;
}

// ---- Table (mirrors TableElement.tsx) ----

function buildTable(el: TableElement, deck: Deck): HTMLElement {
  const s = resolveStyle<TableStyle>(deck.theme?.table, el.style);
  const size = s.fontSize ?? DEFAULT_TABLE_SIZE;
  const color = s.color ?? "#1e293b";
  const hBg = s.headerBackground ?? "#f1f5f9";
  const hColor = s.headerColor ?? "#0f172a";
  const bColor = s.borderColor ?? "#e2e8f0";
  const striped = s.striped ?? false;
  const radius = s.borderRadius ?? 8;

  const d = document.createElement("div");
  d.style.cssText = `width:100%;height:100%;overflow:auto;border-radius:${radius}px;border:1px solid ${bColor}`;

  const table = document.createElement("table");
  table.style.cssText = `width:100%;height:100%;border-collapse:collapse;font-size:${size}px;color:${color};font-family:${DEFAULT_TEXT_FONT}`;

  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  for (const col of el.columns) {
    const th = document.createElement("th");
    th.style.cssText = `background:${hBg};color:${hColor};padding:6px 10px;border-bottom:1px solid ${bColor};text-align:left;font-weight:600;white-space:nowrap`;
    th.innerHTML = inlineHtml(col);
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (let ri = 0; ri < el.rows.length; ri++) {
    const tr = document.createElement("tr");
    if (striped && ri % 2 === 1) tr.style.background = `${hBg}80`;
    const isLast = ri === el.rows.length - 1;
    for (let ci = 0; ci < el.columns.length; ci++) {
      const td = document.createElement("td");
      td.style.cssText = `padding:5px 10px;border-bottom:${isLast ? "none" : `1px solid ${bColor}`}`;
      td.innerHTML = inlineHtml(el.rows[ri]?.[ci] ?? "");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  d.appendChild(table);
  return d;
}

// ---- TikZ ----

async function buildTikZ(
  el: TikZElement,
  adapter: FileSystemAdapter,
): Promise<HTMLElement | null> {
  if (!el.svgUrl) return null;
  const resolved = await resolveAssetSrc(el.svgUrl, adapter);

  // SVGs inside html-to-image's foreignObject are problematic (cross-origin,
  // namespace issues). Rasterize the SVG to a PNG data URL via an offscreen
  // canvas so the <img> in the slide DOM uses a self-contained bitmap.
  const rasterized = await rasterizeSvg(resolved, el.size.w, el.size.h);

  const d = document.createElement("div");
  d.style.cssText = "width:100%;height:100%";
  const img = document.createElement("img");
  img.style.cssText = "width:100%;height:100%;object-fit:contain";
  img.src = rasterized ?? resolved;
  d.appendChild(img);
  return d;
}

async function rasterizeSvg(
  url: string,
  w: number,
  h: number,
): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const svgText = await resp.text();
    const blob = new Blob([svgText], {
      type: "image/svg+xml;charset=utf-8",
    });
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = blobUrl;
    });
    if (!loaded) {
      URL.revokeObjectURL(blobUrl);
      return null;
    }
    // Preserve the SVG's natural aspect ratio (object-fit: contain).
    // Without this, drawImage stretches the SVG to fill the element box.
    const nw = img.naturalWidth || w;
    const nh = img.naturalHeight || h;
    let rw: number, rh: number;
    if (nw / nh > w / h) {
      rw = w;
      rh = w * (nh / nw);
    } else {
      rh = h;
      rw = h * (nw / nh);
    }

    const scale = CAPTURE_SCALE;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rw * scale);
    canvas.height = Math.round(rh * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, rw, rh);
    URL.revokeObjectURL(blobUrl);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// ---- Mermaid (render cached SVG) ----

function buildMermaid(el: MermaidElement): HTMLElement {
  const d = document.createElement("div");
  d.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${el.style?.backgroundColor ?? "transparent"}`;
  if (el.renderedSvg) {
    d.innerHTML = el.renderedSvg;
  } else {
    d.textContent = "[Mermaid]";
    d.style.color = "#999";
    d.style.fontSize = "14px";
  }
  return d;
}

// ---- Video (first frame or placeholder) ----

async function buildVideo(
  el: VideoElementType,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<HTMLElement> {
  const s = resolveStyle<VideoStyle>(deck.theme?.video, el.style);
  const resolved = await resolveAssetSrc(el.src, adapter);
  const frame = await captureVideoFirstFrame(resolved);

  if (!frame) {
    const d = document.createElement("div");
    d.style.cssText = `width:100%;height:100%;background:#1e1e1e;border:1px solid #666;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;font-family:${DEFAULT_TEXT_FONT}`;
    d.textContent = "[Video]";
    return d;
  }

  const d = document.createElement("div");
  d.style.cssText = "width:100%;height:100%";

  const img = document.createElement("img");
  const crop = s.crop;
  const hasCrop = crop && (crop.top || crop.right || crop.bottom || crop.left);
  img.style.cssText = [
    "width:100%",
    "height:100%",
    `object-fit:${s.objectFit ?? "contain"}`,
    `border-radius:${s.borderRadius ?? 0}px`,
    hasCrop ? `clip-path:inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)` : "",
  ].filter(Boolean).join(";");
  img.src = frame;
  d.appendChild(img);
  return d;
}

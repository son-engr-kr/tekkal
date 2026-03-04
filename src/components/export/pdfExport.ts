import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";
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
} from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import {
  fetchImageAsBase64,
  resolveStyle,
  resolveAssetSrc,
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
} from "@/utils/exportUtils";

const MIN_FONT_SIZE = 6;
const CAPTURE_SCALE = 2;

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
): Promise<void> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [CANVAS_WIDTH, CANVAS_HEIGHT],
    hotfixes: ["px_scaling"],
  });

  const slides = deck.slides.filter((s) => !s.hidden);

  for (let i = 0; i < slides.length; i++) {
    if (i > 0) doc.addPage([CANVAS_WIDTH, CANVAS_HEIGHT], "landscape");
    await renderSlide(doc, slides[i]!, deck, adapter);
  }

  const name = (deck.meta.title || "presentation").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  doc.save(`${name}.pdf`);
}

// ========================================================================
// Render one slide: build full DOM tree → capture with toPng → add to PDF
//
// KEY FIX: the captured node (ctr) has NO position offset. A separate
// wrapper div hides it behind the app via z-index. Previous code used
// position:fixed;left:-9999px on the captured node itself, which caused
// html-to-image to inline those styles into the SVG foreignObject clone,
// positioning content outside the visible SVG area → blank output.
// ========================================================================

async function renderSlide(
  doc: jsPDF,
  slide: Slide,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
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
      node.style.overflow = "hidden";
      ctr.appendChild(node);

      // Flexible text sizing: shrink font to fit (needs DOM attachment)
      if (node.dataset.flexFit) {
        fitFont(node, Number(node.dataset.flexFit));
      }
    } catch (err) {
      console.error("[PDF] element build error:", el.type, el.id, err);
    }
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

  // Capture the slide container (one toPng call per slide)
  try {
    const png = await toPng(ctr, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      pixelRatio: CAPTURE_SCALE,
    });
    doc.addImage(png, "PNG", 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } catch {
    // Retry without font embedding (CORS/Vite font-fetch failures)
    try {
      const png = await toPng(ctr, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        pixelRatio: CAPTURE_SCALE,
        skipFonts: true,
      });
      doc.addImage(png, "PNG", 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (err) {
      console.error("[PDF] slide capture failed:", err);
    }
  }

  wrapper.remove();
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
      return buildVideo();
    default:
      return null;
  }
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
  img.style.cssText = [
    "width:100%",
    "height:100%",
    `object-fit:${s.objectFit ?? "contain"}`,
    `border-radius:${s.borderRadius ?? 0}px`,
    `opacity:${s.opacity ?? 1}`,
    s.border ? `border:${s.border}` : "",
  ]
    .filter(Boolean)
    .join(";");

  // Resolve via the active adapter (blob URL on FsAccess, server path on Vite)
  // then pre-fetch as base64 to avoid CORS issues in html-to-image capture
  const resolved = await resolveAssetSrc(el.src, adapter);
  const b64 = await fetchImageAsBase64(resolved);
  img.src = b64 ?? resolved;

  d.appendChild(img);
  return d;
}

// ---- Shape (mirrors ShapeElement.tsx) ----

function buildShape(el: ShapeElement, deck: Deck): HTMLElement {
  const s = resolveStyle<ShapeStyle>(deck.theme?.shape, el.style);
  const fill = s.fill ?? "transparent";
  const stroke = s.stroke ?? "#ffffff";
  const op = s.opacity ?? 1;
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

    if (el.shape === "arrow") {
      const defs = document.createElementNS(ns, "defs");
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", `arrow-${el.id}`);
      marker.setAttribute("markerWidth", "10");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "3.5");
      marker.setAttribute("orient", "auto");
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("points", "0 0, 10 3.5, 0 7");
      poly.setAttribute("fill", stroke);
      marker.appendChild(poly);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", String(h / 2));
    line.setAttribute("x2", String(w));
    line.setAttribute("y2", String(h / 2));
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", String(sw));
    if (el.shape === "arrow") {
      line.setAttribute("marker-end", `url(#arrow-${el.id})`);
    }
    svg.appendChild(line);
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
    ellipse.setAttribute("stroke", stroke);
    ellipse.setAttribute("stroke-width", String(sw));
    svg.appendChild(ellipse);
    d.appendChild(svg);
    return d;
  }

  // Rectangle → CSS div (matches ShapeElementRenderer)
  const sw = s.strokeWidth ?? 1;
  const hasBorder = !!s.stroke || !!s.strokeWidth;
  const d = document.createElement("div");
  d.style.cssText = [
    "width:100%",
    "height:100%",
    `background-color:${fill}`,
    hasBorder ? `border:${sw}px solid ${stroke}` : "",
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
    th.textContent = col;
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
      td.textContent = el.rows[ri]?.[ci] ?? "";
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

// ---- Video (placeholder) ----

function buildVideo(): HTMLElement {
  const d = document.createElement("div");
  d.style.cssText = `width:100%;height:100%;background:#1e1e1e;border:1px solid #666;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;font-family:${DEFAULT_TEXT_FONT}`;
  d.textContent = "[Video]";
  return d;
}

import { jsPDF } from "jspdf";
import { codeToHtml } from "shiki";
import katex from "katex";
import type {
  Deck,
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
  Slide,
} from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import {
  resolveStyle,
  resolveAssetSrc,
  fetchImageAsBase64,
  isPdfSrc,
  rasterizePdfToBase64,
  hexToRgb,
  DEFAULT_BG,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_FONT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_CODE_SIZE,
  DEFAULT_CODE_BG,
  DEFAULT_CODE_RADIUS,
  DEFAULT_CODE_THEME,
  DEFAULT_TABLE_SIZE,
} from "@/utils/exportUtils";
import { resolveMarkers } from "@/utils/lineMarkers";
import type { TextRun, ParsedLine } from "@/utils/markdownParser";
import { parseMarkdownLines } from "@/utils/markdownParser";
import { parseShikiHtml } from "@/utils/shikiTokenParser";
import {
  rasterizeHtmlToBase64 as rasterizeHtmlToImage,
  rasterizeSvgToBase64 as rasterizeSvg,
} from "@/utils/rasterize";

const MIN_FONT_SIZE = 6;
const RASTER_SCALE = 2;

/** Detect image format from a data URI for jsPDF addImage(). */
function detectImageFormat(dataUri: string): string {
  const m = dataUri.match(/^data:image\/(\w+)/);
  if (!m) return "PNG";
  const fmt = m[1]!.toUpperCase();
  if (fmt === "JPG") return "JPEG";
  return fmt;
}

// Regex to detect characters that jsPDF's standard 14 fonts cannot render:
// CJK Unified Ideographs, Hangul, Hiragana, Katakana, CJK symbols, etc.
const NON_LATIN_RE =
  /[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

function containsNonLatin(text: string): boolean {
  return NON_LATIN_RE.test(text);
}

// ---- Font mapping: custom fonts → jsPDF 14 standard fonts ----

function mapFont(fontFamily: string): string {
  const lower = fontFamily.toLowerCase();
  if (
    lower.includes("courier") ||
    lower.includes("mono") ||
    lower.includes("fira")
  )
    return "courier";
  if (lower.includes("times") || lower.includes("serif")) return "times";
  return "helvetica";
}

// ---- Color helpers ----

function setFillColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
}

function setDrawColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
}

function setTextColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  doc.setTextColor(r, g, b);
}

// ---- Rotation helper ----
// Applies a rotation transform around the element's center using the PDF
// `cm` (concat matrix) operator. The caller must saveGraphicsState/restore.

function applyRotation(
  doc: jsPDF,
  cx: number,
  cy: number,
  angleDeg: number,
): void {
  const rad = (-angleDeg * Math.PI) / 180; // PDF rotates counter-clockwise
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // jsPDF uses px units with hotfix; internal coordinates match our units.
  // The affine matrix [a b c d e f] translates to PDF cm operator.
  // We translate origin to center, rotate, then translate back.
  const tx = cx - cos * cx - sin * cy;
  const ty = cy + sin * cx - cos * cy;
  // Use internal write to emit the cm operator
  const f = (n: number) => n.toFixed(6);
  // @ts-expect-error jsPDF internal.write exists but is not in TS defs
  doc.internal.write(
    `${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${f(tx)} ${f(ty)} cm`,
  );
}

// ========================================================================
// Markdown text → PDF (drawText)
// ========================================================================

// ---- Rasterize entire text element for CJK / non-Latin content ----
// Mirrors pdfExport.ts buildText + mdToHtml pipeline: renders the text as
// an offscreen DOM element, captures it with html-to-image, embeds as PNG.

async function drawTextAsRaster(
  doc: jsPDF,
  el: TextElement,
  deck: Deck,
): Promise<void> {
  const s = resolveStyle<TextStyle>(deck.theme?.text, el.style);
  const font = s.fontFamily ?? DEFAULT_TEXT_FONT;
  const size = s.fontSize ?? DEFAULT_TEXT_SIZE;
  const color = s.color ?? DEFAULT_TEXT_COLOR;
  const alignCss = s.textAlign ?? "left";
  const lh = s.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const va = s.verticalAlign ?? "top";
  const sizing = s.textSizing ?? "flexible";
  const ai = { top: "flex-start", middle: "center", bottom: "flex-end" }[va];

  const { x, y } = el.position;
  const { w, h } = el.size;

  // Build the same DOM structure as pdfExport.ts buildText
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;left:0;top:0;z-index:-2147483647;pointer-events:none";

  const outer = document.createElement("div");
  outer.style.cssText = `display:flex;align-items:${ai};font-family:${font};font-size:${size}px;color:${color};text-align:${alignCss};line-height:${lh};width:${w}px;height:${h}px;overflow:hidden`;

  const inner = document.createElement("div");
  inner.style.width = "100%";

  // Use the same mdToHtml pipeline as pdfExport.ts (inline import to avoid
  // duplicating the function — we call katex.renderToString for math)
  const mdHtml = rasterMdToHtml(el.content, color);
  inner.innerHTML = mdHtml;
  outer.appendChild(inner);
  wrapper.appendChild(outer);
  document.body.appendChild(wrapper);

  // Flexible text sizing: binary-search font shrink (mirrors fitFont in pdfExport.ts)
  if (sizing === "flexible") {
    outer.style.fontSize = `${size}px`;
    if (inner.scrollHeight > outer.clientHeight + 1) {
      let lo = MIN_FONT_SIZE;
      let hi = size;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        outer.style.fontSize = `${mid}px`;
        if (inner.scrollHeight <= outer.clientHeight + 1) lo = mid;
        else hi = mid;
      }
      outer.style.fontSize = `${Math.floor(lo)}px`;
    }
  }

  // Wait for fonts
  await document.fonts.ready;

  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(outer, {
    width: w,
    height: h,
    pixelRatio: RASTER_SCALE,
  });
  wrapper.remove();

  doc.addImage(dataUrl, "PNG", x, y, w, h);
}

// Simplified markdown → HTML for rasterization (same as pdfExport.ts mdToHtml)
function rasterMdToHtml(source: string, _color: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let listItems: string[] = [];
  let mathBuf: string[] | null = null;

  const flushList = () => {
    if (!listItems.length) return;
    out.push(
      `<ul style="list-style-type:disc;padding-left:1.5em;margin:0.25em 0">${listItems.map((li) => `<li>${rasterInlineHtml(li)}</li>`).join("")}</ul>`,
    );
    listItems = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (t === "$$") {
      if (mathBuf === null) { flushList(); mathBuf = []; }
      else {
        out.push(`<div style="margin:0.5em 0;text-align:center">${katex.renderToString(mathBuf.join("\n"), { displayMode: true, throwOnError: false })}</div>`);
        mathBuf = null;
      }
      continue;
    }
    if (mathBuf !== null) { mathBuf.push(line); continue; }
    const slm = t.match(/^\$\$(.+)\$\$$/);
    if (slm) {
      flushList();
      out.push(`<div style="margin:0.5em 0;text-align:center">${katex.renderToString(slm[1]!, { displayMode: true, throwOnError: false })}</div>`);
      continue;
    }
    if (t.startsWith("- ") || t.startsWith("* ")) { listItems.push(t.slice(2)); continue; }
    flushList();
    if (t === "") continue;
    const hm = t.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1]!.length as 1 | 2 | 3;
      const sz = { 1: "1.8em", 2: "1.4em", 3: "1.1em" }[level];
      const fw = { 1: "bold", 2: "600", 3: "500" }[level];
      out.push(`<div style="font-size:${sz};font-weight:${fw}">${rasterInlineHtml(hm[2]!)}</div>`);
      continue;
    }
    out.push(`<p style="margin:0">${rasterInlineHtml(t)}</p>`);
  }
  flushList();
  return out.join("");
}

function rasterInlineHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\$(.+?)\$)/g;
  let r = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) r += esc(text.slice(last, m.index));
    if (m[2] !== undefined) r += `<strong>${esc(m[2])}</strong>`;
    else if (m[4] !== undefined) r += `<em>${esc(m[4])}</em>`;
    else if (m[6] !== undefined) r += `<code style="background:rgba(255,255,255,0.1);padding:0 0.375em;border-radius:0.25em;font-size:0.85em;font-family:monospace">${esc(m[6])}</code>`;
    else if (m[8] !== undefined) r += katex.renderToString(m[8], { displayMode: false, throwOnError: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) r += esc(text.slice(last));
  return r;
}


// ---- Layout and render text at a given font scale (returns total height) ----

interface VisualLine {
  segments: Array<{
    text: string;
    font: string;
    style: string;
    size: number;
    mathRun?: TextRun; // if this segment is an inline math placeholder
  }>;
  indent: number;
  bullet: boolean;
  blockMath: string | null; // block-level math expression
}

function layoutText(
  doc: jsPDF,
  parsedLines: ParsedLine[],
  baseFontSize: number,
  pdfFont: string,
  maxWidth: number,
): VisualLine[] {
  const visualLines: VisualLine[] = [];

  for (const pl of parsedLines) {
    // Block math — rendered as a separate visual line
    if (pl.blockMath !== null) {
      visualLines.push({
        segments: [],
        indent: 0,
        bullet: false,
        blockMath: pl.blockMath,
      });
      continue;
    }

    const fontSize = baseFontSize * pl.fontScale;
    // Resolve list indent: -1 sentinel → 1.5em (matching CSS padding-left)
    const indent = pl.indent === -1 ? Math.round(fontSize * 1.5) : pl.indent;
    const availWidth = maxWidth - indent;

    const words: Array<{
      text: string;
      font: string;
      style: string;
      size: number;
      mathRun?: TextRun;
    }> = [];

    for (const run of pl.runs) {
      // Inline math — treated as a single "word" with placeholder width
      if (run.math) {
        words.push({
          text: `$${run.text}$`,
          font: pdfFont,
          style: "normal",
          size: fontSize,
          mathRun: run,
        });
        continue;
      }

      let style = "normal";
      let font = pdfFont;
      if (pl.isBold || run.bold) style = "bold";
      else if (run.italic) style = "italic";
      if (run.code) font = "courier";

      const runWords = run.text.split(/(\s+)/);
      for (const rw of runWords) {
        if (rw.length === 0) continue;
        words.push({ text: rw, font, style, size: fontSize });
      }
    }

    let currentLine: VisualLine = {
      segments: [],
      indent,
      bullet: pl.bullet,
      blockMath: null,
    };
    let currentWidth = 0;

    for (const w of words) {
      doc.setFont(w.font, w.style);
      doc.setFontSize(w.size);
      const ww = doc.getTextWidth(w.text);

      if (currentWidth + ww > availWidth && currentLine.segments.length > 0) {
        visualLines.push(currentLine);
        currentLine = {
          segments: [],
          indent,
          bullet: false,
          blockMath: null,
        };
        currentWidth = 0;
        if (w.text.trim().length === 0) continue;
      }

      currentLine.segments.push(w);
      currentWidth += ww;
    }

    if (currentLine.segments.length > 0) {
      visualLines.push(currentLine);
    }
  }

  return visualLines;
}

function computeTextHeight(
  visualLines: VisualLine[],
  baseFontSize: number,
  lineHeight: number,
): number {
  const listMargin = baseFontSize * 0.25; // matches CSS margin: 0.25em 0
  let height = 0;
  let prevWasBullet = false;
  for (const vl of visualLines) {
    // Add margin before first bullet in a group, and after last bullet
    const isBullet = vl.bullet || (vl.indent > 0 && vl.blockMath === null);
    if (isBullet && !prevWasBullet) height += listMargin;
    if (!isBullet && prevWasBullet) height += listMargin;
    prevWasBullet = isBullet;

    if (vl.blockMath !== null) {
      height += baseFontSize * 2.5;
    } else {
      // Use the largest segment fontSize to compute line height.
      // Headings have fontScale > 1, so their lines are taller.
      const maxSegSize =
        vl.segments.length > 0
          ? Math.max(...vl.segments.map((s) => s.size))
          : baseFontSize;
      height += maxSegSize * lineHeight;
    }
  }
  return height;
}

async function drawText(
  doc: jsPDF,
  el: TextElement,
  deck: Deck,
): Promise<void> {
  const s = resolveStyle<TextStyle>(deck.theme?.text, el.style);
  const fontFamily = s.fontFamily ?? DEFAULT_TEXT_FONT;
  const configuredFontSize = s.fontSize ?? DEFAULT_TEXT_SIZE;
  const color = s.color ?? DEFAULT_TEXT_COLOR;
  const align = s.textAlign ?? "left";
  const lineHeight = s.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const verticalAlign = s.verticalAlign ?? "top";
  const sizing = s.textSizing ?? "flexible";
  const pdfFont = mapFont(fontFamily);

  const { x, y } = el.position;
  const { w, h } = el.size;

  // jsPDF's standard 14 fonts don't support CJK characters (Korean, Chinese,
  // Japanese). When text contains these characters, rasterize the entire
  // element using the same HTML→PNG pipeline as the image-based export.
  if (containsNonLatin(el.content)) {
    await drawTextAsRaster(doc, el, deck);
    return;
  }
  // No padding — matches the React TextElement renderer which uses the full
  // element bounding box with no internal spacing.
  const maxWidth = w;

  const parsedLines = parseMarkdownLines(el.content);

  // Determine effective font size (flexible sizing = shrink to fit)
  let baseFontSize = configuredFontSize;
  if (sizing === "flexible") {
    const testLines = layoutText(doc, parsedLines, baseFontSize, pdfFont, maxWidth);
    const totalH = computeTextHeight(testLines, baseFontSize, lineHeight);
    const availH = h;

    if (totalH > availH) {
      // Binary search for the largest font size that fits
      let lo = MIN_FONT_SIZE;
      let hi = baseFontSize;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        const midLines = layoutText(doc, parsedLines, mid, pdfFont, maxWidth);
        const midH = computeTextHeight(midLines, mid, lineHeight);
        if (midH <= availH) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      baseFontSize = Math.floor(lo);
    }
  }

  const visualLines = layoutText(doc, parsedLines, baseFontSize, pdfFont, maxWidth);

  // Compute total height (accounting for block math)
  const totalHeight = computeTextHeight(visualLines, baseFontSize, lineHeight);
  // First line baseline offset: use the first line's actual font size (headings are larger)
  const firstLineSize =
    visualLines.length > 0 && visualLines[0]!.segments.length > 0
      ? Math.max(...visualLines[0]!.segments.map((s) => s.size))
      : baseFontSize;
  let startY: number;
  if (verticalAlign === "middle") {
    startY = y + (h - totalHeight) / 2 + firstLineSize;
  } else if (verticalAlign === "bottom") {
    startY = y + h - totalHeight + firstLineSize;
  } else {
    startY = y + firstLineSize;
  }

  let currentY = startY;
  const listMargin = baseFontSize * 0.25;
  let prevWasBullet = false;

  for (const vl of visualLines) {
    if (currentY > y + h) break;

    // List margin spacing (matches CSS ul margin: 0.25em 0)
    const isBullet = vl.bullet || (vl.indent > 0 && vl.blockMath === null);
    if (isBullet && !prevWasBullet) currentY += listMargin;
    if (!isBullet && prevWasBullet) currentY += listMargin;
    prevWasBullet = isBullet;

    // Block math — render via KaTeX HTML → rasterize → embed as image
    if (vl.blockMath !== null) {
      const mathHtml = katex.renderToString(vl.blockMath, {
        displayMode: true,
        throwOnError: false,
      });
      const img = await rasterizeHtmlToImage(mathHtml, maxWidth, color);
      if (img) {
        // Scale to fit in the available width
        let imgW = img.width;
        let imgH = img.height;
        if (imgW > maxWidth) {
          const scale = maxWidth / imgW;
          imgW *= scale;
          imgH *= scale;
        }
        // Center block math
        const imgX = x + (maxWidth - imgW) / 2;
        const imgY = currentY - baseFontSize; // offset since currentY is baseline
        doc.addImage(img.dataUrl, "PNG", imgX, imgY, imgW, imgH);
        currentY += imgH + baseFontSize * 0.5;
      } else {
        currentY += baseFontSize * lineHeight;
      }
      continue;
    }

    const lineY = currentY;

    let lineX: number;
    if (align === "center") {
      let totalW = vl.indent;
      for (const seg of vl.segments) {
        doc.setFont(seg.font, seg.style);
        doc.setFontSize(seg.size);
        totalW += doc.getTextWidth(seg.text);
      }
      lineX = x + (maxWidth - totalW) / 2 + vl.indent;
    } else if (align === "right") {
      let totalW = 0;
      for (const seg of vl.segments) {
        doc.setFont(seg.font, seg.style);
        doc.setFontSize(seg.size);
        totalW += doc.getTextWidth(seg.text);
      }
      lineX = x + w - totalW;
    } else {
      lineX = x + vl.indent;
    }

    // Draw bullet (positioned at start of indent area, matching CSS disc list-style)
    if (vl.bullet) {
      doc.setFont(pdfFont, "normal");
      doc.setFontSize(baseFontSize);
      setTextColor(doc, color);
      const bulletOffset = baseFontSize * 0.75; // roughly center of 1.5em indent
      doc.text("\u2022", lineX - bulletOffset, lineY);
    }

    // Draw segments
    for (const seg of vl.segments) {
      // Inline math — rasterize and embed as image
      if (seg.mathRun) {
        const mathHtml = katex.renderToString(seg.mathRun.text, {
          displayMode: false,
          throwOnError: false,
        });
        const img = await rasterizeHtmlToImage(mathHtml, maxWidth, color);
        if (img) {
          let imgW = img.width;
          let imgH = img.height;
          // Scale inline math to match font size
          const targetH = baseFontSize * 1.2;
          if (imgH > targetH) {
            const scale = targetH / imgH;
            imgW *= scale;
            imgH *= scale;
          }
          doc.addImage(img.dataUrl, "PNG", lineX, lineY - imgH * 0.75, imgW, imgH);
          lineX += imgW + 2;
        }
        continue;
      }

      doc.setFont(seg.font, seg.style);
      doc.setFontSize(seg.size);
      setTextColor(doc, color);
      doc.text(seg.text, lineX, lineY);
      lineX += doc.getTextWidth(seg.text);
    }

    // Advance by line height proportional to the largest segment font size
    const maxSegSize =
      vl.segments.length > 0
        ? Math.max(...vl.segments.map((s) => s.size))
        : baseFontSize;
    currentY += maxSegSize * lineHeight;
  }
}

// ========================================================================
// Shiki code → PDF (drawCode)
// ========================================================================


async function drawCode(
  doc: jsPDF,
  el: CodeElement,
  deck: Deck,
): Promise<void> {
  const s = resolveStyle<CodeStyle>(deck.theme?.code, el.style);
  const fontSize = s.fontSize ?? DEFAULT_CODE_SIZE;
  const radius = s.borderRadius ?? DEFAULT_CODE_RADIUS;
  const theme = s.theme ?? DEFAULT_CODE_THEME;
  const bgColor = DEFAULT_CODE_BG;

  const { x, y } = el.position;
  const { w, h } = el.size;

  // Draw background
  setFillColor(doc, bgColor);
  doc.roundedRect(x, y, w, h, radius, radius, "F");

  if (!el.content) return;

  const html = await codeToHtml(el.content, { lang: el.language, theme });
  const tokenLines = parseShikiHtml(html);

  const padding = 16;
  const maxContentW = w - padding * 2;

  // jsPDF Courier is narrower than browser monospace (Consolas).
  // At 16px: jsPDF=7.2px/char vs browser=8.8px/char (ratio ≈ 1.22).
  // Scale up fontSize so character widths match the browser rendering.
  const CHAR_WIDTH_RATIO = 8.8 / 7.2;
  let effectiveFontSize = fontSize * CHAR_WIDTH_RATIO;

  doc.setFont("courier", "normal");
  doc.setFontSize(effectiveFontSize);

  // Auto-fit: if longest line overflows after scaling, shrink to fit
  let maxLineW = 0;
  for (const tokens of tokenLines) {
    let lineW = 0;
    for (const token of tokens) {
      lineW += doc.getTextWidth(token.text);
    }
    if (lineW > maxLineW) maxLineW = lineW;
  }

  if (maxLineW > maxContentW && maxLineW > 0) {
    effectiveFontSize = Math.max(6, effectiveFontSize * (maxContentW / maxLineW));
    doc.setFontSize(effectiveFontSize);
  }

  // Use original fontSize for line height and vertical positioning (CSS line-height)
  const lineHeight = fontSize * 1.5;
  let drawY = y + padding + fontSize;

  for (const tokens of tokenLines) {
    if (drawY > y + h - padding) break;

    let drawX = x + padding;
    for (const token of tokens) {
      setTextColor(doc, token.color);
      doc.text(token.text, drawX, drawY);
      drawX += doc.getTextWidth(token.text);
    }
    drawY += lineHeight;
  }
}

// ========================================================================
// Shape → PDF (drawShape)
// ========================================================================

function drawShape(doc: jsPDF, el: ShapeElement, deck: Deck): void {
  const s = resolveStyle<ShapeStyle>(deck.theme?.shape, el.style);
  const fill = s.fill ?? "transparent";
  const stroke = s.stroke ?? "#ffffff";
  // Browser defaults: rectangle=1, line/arrow=2 (see ShapeElement.tsx)
  const isLineOrArrow = el.shape === "line" || el.shape === "arrow";
  const strokeWidth = s.strokeWidth ?? (isLineOrArrow ? 2 : 1);
  const opacity = s.opacity ?? 1;
  const fOp = (s.fillOpacity ?? 1) * opacity;
  const sOp = (s.strokeOpacity ?? 1) * opacity;
  const { x, y } = el.position;
  const { w, h } = el.size;

  if (fOp < 1 || sOp < 1) {
    doc.saveGraphicsState();
    // @ts-expect-error GState constructor is available on jsPDF instance
    doc.setGState(new doc.GState({ opacity: fOp, "stroke-opacity": sOp }));
  }

  doc.setLineWidth(strokeWidth);
  setDrawColor(doc, stroke);

  if (el.shape === "rectangle") {
    const radius = s.borderRadius ?? 0;
    const hasFill = fill !== "transparent";
    if (hasFill) setFillColor(doc, fill);

    const drawMode = hasFill ? "FD" : "S";
    if (radius > 0) {
      doc.roundedRect(x, y, w, h, radius, radius, drawMode);
    } else {
      doc.rect(x, y, w, h, drawMode);
    }
  } else if (el.shape === "ellipse") {
    const hasFill = fill !== "transparent";
    if (hasFill) setFillColor(doc, fill);
    const drawMode = hasFill ? "FD" : "S";
    doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, drawMode);
  } else if (el.shape === "line" || el.shape === "arrow") {
    const { startMarker, endMarker } = resolveMarkers(el, s);
    const waypoints = s.waypoints;
    const hasWaypoints = waypoints && waypoints.length >= 2;

    // Scale marker size with sqrt(sw) for gentle growth
    const ms = Math.sqrt(strokeWidth);
    const headSize = 10 * ms;
    const circleR = 3 * ms;

    // Shorten line at arrow ends so stroke doesn't poke through
    const shortenStart = startMarker === "arrow" ? strokeWidth * 1.5 : 0;
    const shortenEnd = endMarker === "arrow" ? strokeWidth * 1.5 : 0;

    if (hasWaypoints) {
      // Build shortened waypoints for drawing
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
      // Draw line segments between shortened waypoints
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        doc.line(x + p1.x, y + p1.y, x + p2.x, y + p2.y);
      }
      // Markers at original first/last waypoint
      const first = waypoints[0]!;
      const last = waypoints[waypoints.length - 1]!;
      if (endMarker === "arrow") {
        setFillColor(doc, stroke);
        const prev = waypoints[waypoints.length - 2]!;
        const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
        const tipX = x + last.x;
        const tipY = y + last.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        doc.triangle(
          tipX, tipY,
          tipX - headSize * cos + (headSize / 2) * sin,
          tipY - headSize * sin - (headSize / 2) * cos,
          tipX - headSize * cos - (headSize / 2) * sin,
          tipY - headSize * sin + (headSize / 2) * cos,
          "F",
        );
      } else if (endMarker === "circle") {
        setFillColor(doc, stroke);
        doc.circle(x + last.x, y + last.y, circleR, "F");
      }
      if (startMarker === "arrow") {
        setFillColor(doc, stroke);
        const next = waypoints[1]!;
        const angle = Math.atan2(first.y - next.y, first.x - next.x);
        const tipX = x + first.x;
        const tipY = y + first.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        doc.triangle(
          tipX, tipY,
          tipX - headSize * cos + (headSize / 2) * sin,
          tipY - headSize * sin - (headSize / 2) * cos,
          tipX - headSize * cos - (headSize / 2) * sin,
          tipY - headSize * sin + (headSize / 2) * cos,
          "F",
        );
      } else if (startMarker === "circle") {
        setFillColor(doc, stroke);
        doc.circle(x + first.x, y + first.y, circleR, "F");
      }
    } else {
      doc.line(x + shortenStart, y + h / 2, x + w - shortenEnd, y + h / 2);
      // End marker
      if (endMarker === "arrow") {
        const tipX = x + w;
        const tipY = y + h / 2;
        setFillColor(doc, stroke);
        doc.triangle(tipX, tipY, tipX - headSize, tipY - headSize / 2, tipX - headSize, tipY + headSize / 2, "F");
      } else if (endMarker === "circle") {
        setFillColor(doc, stroke);
        doc.circle(x + w, y + h / 2, circleR, "F");
      }
      // Start marker
      if (startMarker === "arrow") {
        const tipX = x;
        const tipY = y + h / 2;
        setFillColor(doc, stroke);
        doc.triangle(tipX, tipY, tipX + headSize, tipY - headSize / 2, tipX + headSize, tipY + headSize / 2, "F");
      } else if (startMarker === "circle") {
        setFillColor(doc, stroke);
        doc.circle(x, y + h / 2, circleR, "F");
      }
    }
  }

  if (fOp < 1 || sOp < 1) {
    doc.restoreGraphicsState();
  }
}

// ========================================================================
// Image → PDF (drawImage)
// ========================================================================

async function drawImage(
  doc: jsPDF,
  el: ImageElement,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  const s = resolveStyle<ImageStyle>(deck.theme?.image, el.style);
  const objectFit = s.objectFit ?? "contain";

  const resolved = await resolveAssetSrc(el.src, adapter);
  const isSvg =
    resolved.endsWith(".svg") || resolved.startsWith("data:image/svg");

  let imgData: string | null;
  if (isPdfSrc(el.src)) {
    // PDF files can't be embedded directly — rasterize first page via pdfjs
    imgData = await rasterizePdfToBase64(resolved, el.size.w, el.size.h);
  } else if (isSvg) {
    // SVGs must be rasterized — jsPDF can't embed SVGs directly.
    // rasterizeSvg already preserves aspect ratio in the canvas.
    imgData = await rasterizeSvg(resolved, el.size.w, el.size.h);
  } else {
    imgData = await fetchImageAsBase64(resolved);
  }
  if (!imgData) return;

  const { x, y } = el.position;
  const { w, h } = el.size;

  // Load image to determine natural dimensions for object-fit
  const img = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = imgData!;
  });

  const imgFormat = detectImageFormat(imgData);

  if (!loaded) {
    doc.addImage(imgData, imgFormat, x, y, w, h);
    return;
  }

  const nw = img.naturalWidth || w;
  const nh = img.naturalHeight || h;

  let rw: number, rh: number;
  if (objectFit === "fill") {
    rw = w;
    rh = h;
  } else if (objectFit === "cover") {
    if (nw / nh > w / h) {
      rh = h;
      rw = h * (nw / nh);
    } else {
      rw = w;
      rh = w * (nh / nw);
    }
  } else {
    // contain (default): fit within box, preserve aspect ratio
    if (nw / nh > w / h) {
      rw = w;
      rh = w * (nh / nw);
    } else {
      rh = h;
      rw = h * (nw / nh);
    }
  }

  // Center the image within the element box
  const imgX = x + (w - rw) / 2;
  const imgY = y + (h - rh) / 2;

  // Apply opacity if set
  const opacity = s.opacity ?? 1;
  if (opacity < 1) {
    doc.saveGraphicsState();
    // @ts-expect-error GState constructor is available on jsPDF instance
    doc.setGState(new doc.GState({ opacity }));
  }

  doc.addImage(imgData, imgFormat, imgX, imgY, rw, rh);

  if (opacity < 1) {
    doc.restoreGraphicsState();
  }
}

// ========================================================================
// Table → PDF (drawTable)
// ========================================================================

function drawTable(doc: jsPDF, el: TableElement, deck: Deck): void {
  const s = resolveStyle<TableStyle>(deck.theme?.table, el.style);
  const fontSize = s.fontSize ?? DEFAULT_TABLE_SIZE;
  const color = s.color ?? "#1e293b";
  const hBg = s.headerBackground ?? "#f1f5f9";
  const hColor = s.headerColor ?? "#0f172a";
  const bColor = s.borderColor ?? "#e2e8f0";

  const { x, y } = el.position;
  const { w, h } = el.size;
  const colCount = el.columns.length;
  const rowCount = el.rows.length + 1; // +1 for header
  const colWidth = w / colCount;
  const rowHeight = h / rowCount;
  const cellPadding = 6;

  doc.setFontSize(fontSize);
  doc.setLineWidth(0.5);

  // Draw outer border
  setDrawColor(doc, bColor);
  doc.rect(x, y, w, h, "S");

  // Header row
  setFillColor(doc, hBg);
  doc.rect(x, y, w, rowHeight, "F");
  doc.setFont("helvetica", "bold");
  setTextColor(doc, hColor);

  for (let ci = 0; ci < colCount; ci++) {
    const cellX = x + ci * colWidth;
    doc.text(
      el.columns[ci] ?? "",
      cellX + cellPadding,
      y + rowHeight / 2 + fontSize / 3,
    );
    // Column separator
    if (ci > 0) {
      doc.line(cellX, y, cellX, y + h);
    }
  }

  // Header bottom border
  doc.line(x, y + rowHeight, x + w, y + rowHeight);

  // Data rows
  doc.setFont("helvetica", "normal");
  setTextColor(doc, color);

  for (let ri = 0; ri < el.rows.length; ri++) {
    const rowY = y + (ri + 1) * rowHeight;

    // Row bottom border
    if (ri < el.rows.length - 1) {
      setDrawColor(doc, bColor);
      doc.line(x, rowY + rowHeight, x + w, rowY + rowHeight);
    }

    for (let ci = 0; ci < colCount; ci++) {
      const cellX = x + ci * colWidth;
      const cellText = el.rows[ri]?.[ci] ?? "";
      doc.text(
        cellText,
        cellX + cellPadding,
        rowY + rowHeight / 2 + fontSize / 3,
      );
    }
  }
}

// ========================================================================
// TikZ → PDF via rasterization
//
// TikZ SVGs use custom fonts from tikzjax WASM output that svg2pdf.js
// cannot map, causing garbled text (ð characters). Rasterize to PNG
// instead, same as the image-based export path.
// ========================================================================


async function drawTikZ(
  doc: jsPDF,
  el: TikZElement,
  _deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  if (!el.svgUrl) return;

  const resolved = await resolveAssetSrc(el.svgUrl, adapter);
  const { x, y } = el.position;
  const { w, h } = el.size;

  const rasterized = await rasterizeSvg(resolved, w, h);
  if (rasterized) {
    doc.addImage(rasterized, "PNG", x, y, w, h);
  }
}

// ========================================================================
// Video → PDF (placeholder)
// ========================================================================

function drawVideo(doc: jsPDF, el: SlideElement): void {
  const { x, y } = el.position;
  const { w, h } = el.size;

  setFillColor(doc, "#1e1e1e");
  doc.rect(x, y, w, h, "F");

  setDrawColor(doc, "#666666");
  doc.setLineWidth(1);
  doc.rect(x, y, w, h, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  setTextColor(doc, "#999999");
  doc.text("[Video]", x + w / 2, y + h / 2, { align: "center" });
}

// ========================================================================
// Custom element → PDF (placeholder)
// ========================================================================

function drawCustomPlaceholder(doc: jsPDF, el: SlideElement): void {
  const { x, y } = el.position;
  const { w, h } = el.size;

  setFillColor(doc, "#2d2d2d");
  doc.rect(x, y, w, h, "F");

  setDrawColor(doc, "#555555");
  doc.setLineWidth(1);
  doc.rect(x, y, w, h, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  setTextColor(doc, "#888888");
  doc.text("[Custom Element]", x + w / 2, y + h / 2, { align: "center" });
}

// ========================================================================
// Scene3D → PDF (placeholder — 3D canvas cannot be natively drawn in jsPDF)
// ========================================================================

function drawScene3DPlaceholder(doc: jsPDF, el: SlideElement): void {
  const { x, y } = el.position;
  const { w, h } = el.size;

  setFillColor(doc, "#1a1a2e");
  doc.rect(x, y, w, h, "F");

  setDrawColor(doc, "#444466");
  doc.setLineWidth(1);
  doc.rect(x, y, w, h, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  setTextColor(doc, "#8888aa");
  doc.text("[3D Scene]", x + w / 2, y + h / 2, { align: "center" });
}

function drawMermaidPlaceholder(doc: jsPDF, el: SlideElement): void {
  const { x, y } = el.position;
  const { w, h } = el.size;

  setFillColor(doc, "#1e1e2e");
  doc.rect(x, y, w, h, "F");

  setDrawColor(doc, "#445566");
  doc.setLineWidth(1);
  doc.rect(x, y, w, h, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  setTextColor(doc, "#88aacc");
  doc.text("[Mermaid]", x + w / 2, y + h / 2, { align: "center" });
}

// ========================================================================
// Slide rendering
// ========================================================================

async function renderSlide(
  doc: jsPDF,
  slide: Slide,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  // Fill slide background
  const bg = slide.background ?? deck.theme?.slide?.background;
  const bgColor = bg?.color ?? DEFAULT_BG;
  setFillColor(doc, bgColor);
  doc.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, "F");

  // Background image (drawn on top of color fill)
  if (bg?.image) {
    const resolved = await resolveAssetSrc(bg.image, adapter);
    const isSvg =
      resolved.endsWith(".svg") || resolved.startsWith("data:image/svg");
    let imgData: string | null;
    if (isSvg) {
      imgData = await rasterizeSvg(resolved, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      imgData = await fetchImageAsBase64(resolved);
    }
    if (imgData) {
      doc.addImage(imgData, "PNG", 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }

  // Render each element
  for (const el of slide.elements) {
    const rotation = el.rotation ?? 0;
    if (rotation !== 0) {
      doc.saveGraphicsState();
      const cx = el.position.x + el.size.w / 2;
      const cy = el.position.y + el.size.h / 2;
      applyRotation(doc, cx, cy, rotation);
    }

    switch (el.type) {
      case "text":
        await drawText(doc, el, deck);
        break;
      case "code":
        await drawCode(doc, el, deck);
        break;
      case "shape":
        drawShape(doc, el, deck);
        break;
      case "image":
        await drawImage(doc, el, deck, adapter);
        break;
      case "table":
        drawTable(doc, el, deck);
        break;
      case "tikz":
        await drawTikZ(doc, el, deck, adapter);
        break;
      case "mermaid":
        drawMermaidPlaceholder(doc, el);
        break;
      case "video":
        drawVideo(doc, el);
        break;
      case "custom":
        drawCustomPlaceholder(doc, el);
        break;
      case "scene3d":
        drawScene3DPlaceholder(doc, el);
        break;
    }

    if (rotation !== 0) {
      doc.restoreGraphicsState();
    }
  }
}

// ========================================================================
// Public API
// ========================================================================

export async function buildNativePdf(
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<jsPDF> {
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

  return doc;
}

export async function exportToNativePdf(
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  const doc = await buildNativePdf(deck, adapter);
  const name = (deck.meta.title || "presentation").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  doc.save(`${name}_native.pdf`);
}

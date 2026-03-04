import PptxGenJS from "pptxgenjs";
import { codeToHtml } from "shiki";
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
  MermaidElement,
} from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import {
  resolveStyle,
  resolveAssetSrc,
  toHex,
  fetchImageAsBase64,
  DEFAULT_BG,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_FONT,
  DEFAULT_CODE_SIZE,
  DEFAULT_CODE_BG,
  DEFAULT_CODE_FG,
  DEFAULT_CODE_RADIUS,
  DEFAULT_CODE_THEME,
  DEFAULT_TABLE_SIZE,
} from "@/utils/exportUtils";
import type { ParsedLine } from "@/utils/markdownParser";
import { parseMarkdownLines } from "@/utils/markdownParser";
import { parseShikiHtml } from "@/utils/shikiTokenParser";
import {
  rasterizeKatexToBase64,
  rasterizeSvgToBase64,
} from "@/utils/rasterize";

const SLIDE_W = 10; // inches (standard 16:9 widescreen)
const SLIDE_H = 5.625;
const PX_TO_IN_X = SLIDE_W / CANVAS_WIDTH;
const PX_TO_IN_Y = SLIDE_H / CANVAS_HEIGHT;

// PPTX font sizes are in points; canvas uses px. 1px ≈ 0.75pt at 96dpi.
const PX_TO_PT = 0.75;

export async function exportToPptx(
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "DECKODE", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "DECKODE";
  pres.title = deck.meta.title;
  if (deck.meta.author) pres.author = deck.meta.author;

  for (const slide of deck.slides.filter((s) => !s.hidden)) {
    const pptSlide = pres.addSlide();

    // Background
    const bg = slide.background ?? deck.theme?.slide?.background;
    if (bg?.image) {
      const resolved = await resolveAssetSrc(bg.image, adapter);
      const base64 = await fetchImageAsBase64(resolved);
      if (base64) {
        pptSlide.background = { data: base64 };
      } else if (bg?.color) {
        const hex = toHex(bg.color);
        if (hex) pptSlide.background = { fill: hex };
      }
    } else if (bg?.color) {
      const hex = toHex(bg.color);
      if (hex) pptSlide.background = { fill: hex };
    } else {
      pptSlide.background = { fill: toHex(DEFAULT_BG)! };
    }

    // Elements
    for (const el of slide.elements) {
      await addElement(pptSlide, el, deck, adapter);
    }

    // Notes (strip [step:N]...[/step] markers)
    if (slide.notes) {
      const clean = slide.notes
        .replace(/\[step:\d+\]/g, "")
        .replace(/\[\/step\]/g, "");
      pptSlide.addNotes(clean);
    }
  }

  const filename = (deck.meta.title || "presentation").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  await pres.writeFile({ fileName: `${filename}.pptx` });
}

// ========================================================================
// Element routing
// ========================================================================

async function addElement(
  slide: PptxGenJS.Slide,
  el: SlideElement,
  deck: Deck,
  adapter: FileSystemAdapter,
): Promise<void> {
  const x = el.position.x * PX_TO_IN_X;
  const y = el.position.y * PX_TO_IN_Y;
  const w = el.size.w * PX_TO_IN_X;
  const h = el.size.h * PX_TO_IN_Y;
  const rotate = el.rotation ?? 0;

  switch (el.type) {
    case "text":
      await addText(slide, el, deck, x, y, w, h, rotate);
      break;
    case "code":
      await addCode(slide, el, deck, x, y, w, h, rotate);
      break;
    case "image":
      await addImage(slide, el, deck, adapter, x, y, w, h, rotate);
      break;
    case "shape":
      addShape(slide, el, deck, x, y, w, h, rotate);
      break;
    case "table":
      addTable(slide, el, deck, x, y, w, h, rotate);
      break;
    case "tikz":
      await addTikZ(slide, el, adapter, x, y, w, h, rotate);
      break;
    case "video":
      addVideo(slide, x, y, w, h, rotate);
      break;
    case "custom":
      addCustomPlaceholder(slide, x, y, w, h, rotate);
      break;
    case "mermaid":
      await addMermaid(slide, el, x, y, w, h, rotate);
      break;
    case "scene3d":
      addScene3DPlaceholder(slide, x, y, w, h, rotate);
      break;
  }
}

// ========================================================================
// Text (rich markdown → PptxGenJS TextProps[])
// ========================================================================

function parsedLinesToTextProps(
  parsedLines: ParsedLine[],
  baseFontSize: number,
  fontFace: string,
  color: string,
): PptxGenJS.TextProps[] {
  const textProps: PptxGenJS.TextProps[] = [];
  const colorHex = toHex(color);

  for (let i = 0; i < parsedLines.length; i++) {
    const pl = parsedLines[i]!;

    // Block math — plain text fallback (can't embed images in text runs)
    if (pl.blockMath !== null) {
      textProps.push({
        text: `[${pl.blockMath}]`,
        options: {
          fontSize: Math.round(baseFontSize * PX_TO_PT),
          fontFace,
          color: colorHex,
          italic: true,
          breakLine: i > 0 ? true : undefined,
        },
      });
      continue;
    }

    const fontSize = Math.round(baseFontSize * pl.fontScale * PX_TO_PT);

    if (pl.runs.length === 0) continue;

    for (let ri = 0; ri < pl.runs.length; ri++) {
      const run = pl.runs[ri]!;

      // First run of a new line gets a line break (except the very first line)
      const isFirstRunOfLine = ri === 0;
      const needBreak = isFirstRunOfLine && i > 0;

      if (run.math) {
        // Inline math — plain text fallback
        textProps.push({
          text: `[${run.text}]`,
          options: {
            fontSize,
            fontFace,
            color: colorHex,
            italic: true,
            bold: pl.isBold || undefined,
            bullet: isFirstRunOfLine && pl.bullet ? true : undefined,
            indentLevel: pl.bullet ? 1 : undefined,
            breakLine: needBreak ? true : undefined,
          },
        });
        continue;
      }

      textProps.push({
        text: run.text,
        options: {
          fontSize,
          fontFace: run.code ? "Courier New" : fontFace,
          color: colorHex,
          bold: (pl.isBold || run.bold) || undefined,
          italic: run.italic || undefined,
          highlight: run.code ? "3C3C3C" : undefined,
          bullet: isFirstRunOfLine && pl.bullet ? true : undefined,
          indentLevel: pl.bullet ? 1 : undefined,
          breakLine: needBreak ? true : undefined,
        },
      });
    }
  }

  return textProps;
}

async function addText(
  slide: PptxGenJS.Slide,
  el: TextElement,
  deck: Deck,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  const s = resolveStyle<TextStyle>(deck.theme?.text, el.style);
  const fontSize = s.fontSize ?? DEFAULT_TEXT_SIZE;
  const fontFace = s.fontFamily ?? DEFAULT_TEXT_FONT;
  const color = s.color ?? DEFAULT_TEXT_COLOR;
  const align = s.textAlign ?? "left";
  const valign = s.verticalAlign ?? "top";

  const parsedLines = parseMarkdownLines(el.content);

  // Check if there are block math expressions that need rasterization
  const hasBlockMath = parsedLines.some((pl) => pl.blockMath !== null);

  if (hasBlockMath) {
    // For slides with block math, try to render math as images
    // and interleave them with text
    await addTextWithMathImages(
      slide,
      parsedLines,
      fontSize,
      fontFace,
      color,
      align,
      valign,
      x,
      y,
      w,
      h,
      rotate,
    );
    return;
  }

  const textProps = parsedLinesToTextProps(parsedLines, fontSize, fontFace, color);

  if (textProps.length === 0) return;

  slide.addText(textProps, {
    x,
    y,
    w,
    h,
    align,
    valign,
    wrap: true,
    margin: 0,
    rotate,
  });
}

async function addTextWithMathImages(
  slide: PptxGenJS.Slide,
  parsedLines: ParsedLine[],
  baseFontSize: number,
  fontFace: string,
  color: string,
  align: "left" | "center" | "right",
  valign: "top" | "middle" | "bottom",
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  // Split parsedLines into groups: consecutive non-math lines vs math lines
  const textGroups: ParsedLine[][] = [];
  const mathExpressions: { expr: string; afterGroupIdx: number }[] = [];
  let currentGroup: ParsedLine[] = [];

  for (const pl of parsedLines) {
    if (pl.blockMath !== null) {
      textGroups.push(currentGroup);
      mathExpressions.push({
        expr: pl.blockMath,
        afterGroupIdx: textGroups.length - 1,
      });
      currentGroup = [];
    } else {
      currentGroup.push(pl);
    }
  }
  textGroups.push(currentGroup);

  // Render text groups as normal text
  const totalGroups = textGroups.length + mathExpressions.length;
  const slotH = h / Math.max(totalGroups, 1);
  let currentY = y;

  let mathIdx = 0;
  for (let gi = 0; gi < textGroups.length; gi++) {
    const group = textGroups[gi]!;
    if (group.length > 0) {
      const textProps = parsedLinesToTextProps(group, baseFontSize, fontFace, color);
      if (textProps.length > 0) {
        const groupH = Math.min(slotH * group.length, h - (currentY - y));
        slide.addText(textProps, {
          x,
          y: currentY,
          w,
          h: groupH,
          align,
          valign: gi === 0 ? valign : "top",
          wrap: true,
          margin: 0,
          rotate,
        });
        currentY += groupH;
      }
    }

    // Add math image after this group if there is one
    if (mathIdx < mathExpressions.length && mathExpressions[mathIdx]!.afterGroupIdx === gi) {
      const mathExpr = mathExpressions[mathIdx]!.expr;
      const maxWidthPx = w / PX_TO_IN_X;
      const img = await rasterizeKatexToBase64(mathExpr, true, maxWidthPx, color);
      if (img) {
        const imgWIn = (img.width / maxWidthPx) * w;
        const imgHIn = (img.height / maxWidthPx) * w;
        const imgX = x + (w - imgWIn) / 2;
        slide.addImage({
          data: img.dataUrl,
          x: imgX,
          y: currentY,
          w: imgWIn,
          h: imgHIn,
          rotate,
        });
        currentY += imgHIn;
      }
      mathIdx++;
    }
  }
}

// ========================================================================
// Code (syntax-highlighted via Shiki → colored TextProps[])
// ========================================================================

async function addCode(
  slide: PptxGenJS.Slide,
  el: CodeElement,
  deck: Deck,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  const s = resolveStyle<CodeStyle>(deck.theme?.code, el.style);
  const fontSize = s.fontSize ?? DEFAULT_CODE_SIZE;
  const theme = s.theme ?? DEFAULT_CODE_THEME;
  const bgHex = toHex(DEFAULT_CODE_BG)!;
  const radius = s.borderRadius ?? DEFAULT_CODE_RADIUS;

  if (!el.content) {
    // Empty code block — just draw background
    slide.addShape("roundRect" as PptxGenJS.ShapeType, {
      x,
      y,
      w,
      h,
      fill: { color: bgHex },
      rectRadius: radius * PX_TO_IN_X,
      rotate,
    });
    return;
  }

  const html = await codeToHtml(el.content, { lang: el.language, theme });
  const tokenLines = parseShikiHtml(html);

  const textProps: PptxGenJS.TextProps[] = [];
  const defaultFg = toHex(DEFAULT_CODE_FG)!;

  for (let li = 0; li < tokenLines.length; li++) {
    const tokens = tokenLines[li]!;
    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti]!;
      const isFirstTokenOfLine = ti === 0;
      textProps.push({
        text: token.text,
        options: {
          fontSize: Math.round(fontSize * PX_TO_PT),
          fontFace: "Courier New",
          color: toHex(token.color) || defaultFg,
          breakLine: isFirstTokenOfLine && li > 0 ? true : undefined,
        },
      });
    }
    // If the line is empty, add a blank line
    if (tokens.length === 0) {
      textProps.push({
        text: " ",
        options: {
          fontSize: Math.round(fontSize * PX_TO_PT),
          fontFace: "Courier New",
          color: defaultFg,
          breakLine: li > 0 ? true : undefined,
        },
      });
    }
  }

  slide.addText(textProps, {
    x,
    y,
    w,
    h,
    fill: { color: bgHex },
    valign: "top",
    wrap: true,
    margin: [4, 8, 4, 8],
    rectRadius: radius * PX_TO_IN_X,
    rotate,
  });
}

// ========================================================================
// Image
// ========================================================================

async function addImage(
  slide: PptxGenJS.Slide,
  el: ImageElement,
  deck: Deck,
  adapter: FileSystemAdapter,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  const s = resolveStyle<ImageStyle>(deck.theme?.image, el.style);
  const opacity = s.opacity ?? 1;

  const resolved = await resolveAssetSrc(el.src, adapter);
  const isSvg =
    resolved.endsWith(".svg") || resolved.startsWith("data:image/svg");

  let imgData: string | null;
  if (isSvg) {
    imgData = await rasterizeSvgToBase64(resolved, el.size.w, el.size.h);
  } else {
    imgData = await fetchImageAsBase64(resolved);
  }
  if (!imgData) return;

  slide.addImage({
    data: imgData,
    x,
    y,
    w,
    h,
    rotate,
    transparency: opacity < 1 ? Math.round((1 - opacity) * 100) : undefined,
    altText: el.alt,
  });
}

// ========================================================================
// Shape
// ========================================================================

function addShape(
  slide: PptxGenJS.Slide,
  el: ShapeElement,
  deck: Deck,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  const s = resolveStyle<ShapeStyle>(deck.theme?.shape, el.style);
  const fillHex = toHex(s.fill);
  const strokeHex = toHex(s.stroke);
  const opacity = s.opacity ?? 1;

  const fill =
    fillHex && fillHex !== "transparent"
      ? {
          color: fillHex,
          transparency: opacity < 1 ? Math.round((1 - opacity) * 100) : undefined,
        }
      : undefined;
  const line = strokeHex
    ? { color: strokeHex, width: s.strokeWidth ?? 1 }
    : undefined;

  if (el.shape === "rectangle") {
    slide.addShape("rect" as PptxGenJS.ShapeType, {
      x,
      y,
      w,
      h,
      fill,
      line,
      rectRadius: s.borderRadius ? s.borderRadius * PX_TO_IN_X : undefined,
      rotate,
    });
  } else if (el.shape === "ellipse") {
    slide.addShape("ellipse" as PptxGenJS.ShapeType, {
      x,
      y,
      w,
      h,
      fill,
      line,
      rotate,
    });
  } else if (el.shape === "line" || el.shape === "arrow") {
    const isLineOrArrow = true;
    const sw = s.strokeWidth ?? (isLineOrArrow ? 2 : 1);
    slide.addShape("line" as PptxGenJS.ShapeType, {
      x,
      y,
      w,
      h: 0,
      line: {
        color: strokeHex ?? "FFFFFF",
        width: sw,
        endArrowType: el.shape === "arrow" ? "triangle" : undefined,
      },
      rotate,
    });
  }
}

// ========================================================================
// Table
// ========================================================================

function addTable(
  slide: PptxGenJS.Slide,
  el: TableElement,
  deck: Deck,
  x: number,
  y: number,
  w: number,
  _h: number,
  _rotate: number,
) {
  const s = resolveStyle<TableStyle>(deck.theme?.table, el.style);
  const headerBg = toHex(s.headerBackground ?? "#f1f5f9");
  const headerColor = toHex(s.headerColor ?? "#0f172a");
  const textColor = toHex(s.color ?? "#1e293b");
  const borderColor = toHex(s.borderColor ?? "#e2e8f0");
  const fontSize = s.fontSize
    ? Math.round(s.fontSize * PX_TO_PT)
    : Math.round(DEFAULT_TABLE_SIZE * PX_TO_PT);

  const headerRow: PptxGenJS.TableRow = el.columns.map((col) => ({
    text: col,
    options: {
      bold: true,
      fontSize,
      color: headerColor,
      fill: headerBg ? { color: headerBg } : undefined,
    },
  }));

  const dataRows: PptxGenJS.TableRow[] = el.rows.map((row) =>
    el.columns.map((_, ci) => ({
      text: row[ci] ?? "",
      options: {
        fontSize,
        color: textColor,
      },
    })),
  );

  const colW = w / el.columns.length;

  slide.addTable([headerRow, ...dataRows], {
    x,
    y,
    w,
    colW,
    border: borderColor
      ? { type: "solid", pt: 0.5, color: borderColor }
      : undefined,
    margin: [2, 4, 2, 4],
    // PptxGenJS tables don't support rotate directly; ignore for tables
  });
}

// ========================================================================
// TikZ (SVG → rasterized PNG → embedded image)
// ========================================================================

async function addTikZ(
  slide: PptxGenJS.Slide,
  el: TikZElement,
  adapter: FileSystemAdapter,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  if (!el.svgUrl) return;

  const resolved = await resolveAssetSrc(el.svgUrl, adapter);
  const rasterized = await rasterizeSvgToBase64(resolved, el.size.w, el.size.h);
  if (rasterized) {
    slide.addImage({
      data: rasterized,
      x,
      y,
      w,
      h,
      rotate,
    });
  }
}

// ========================================================================
// Mermaid (rendered SVG → rasterized PNG → embedded image)
// ========================================================================

async function addMermaid(
  slide: PptxGenJS.Slide,
  el: MermaidElement,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  if (!el.renderedSvg) return;

  const svgBlob = new Blob([el.renderedSvg], { type: "image/svg+xml" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const rasterized = await rasterizeSvgToBase64(svgUrl, el.size.w, el.size.h);
  URL.revokeObjectURL(svgUrl);

  if (rasterized) {
    slide.addImage({
      data: rasterized,
      x,
      y,
      w,
      h,
      rotate,
    });
  }
}

// ========================================================================
// Video placeholder
// ========================================================================

function addVideo(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  // Dark rect + [Video] text, same as PDF native
  slide.addShape("rect" as PptxGenJS.ShapeType, {
    x,
    y,
    w,
    h,
    fill: { color: "1E1E1E" },
    line: { color: "666666", width: 1 },
    rotate,
  });
  slide.addText("[Video]", {
    x,
    y,
    w,
    h,
    fontSize: 14,
    fontFace: "Arial",
    color: "999999",
    align: "center",
    valign: "middle",
    rotate,
  });
}

// ========================================================================
// Custom element placeholder
// ========================================================================

function addCustomPlaceholder(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  slide.addShape("rect" as PptxGenJS.ShapeType, {
    x,
    y,
    w,
    h,
    fill: { color: "2D2D2D" },
    line: { color: "555555", width: 1, dashType: "dash" },
    rotate,
  });
  slide.addText("[Custom Element]", {
    x,
    y,
    w,
    h,
    fontSize: 12,
    fontFace: "Arial",
    color: "888888",
    align: "center",
    valign: "middle",
    rotate,
  });
}

// ========================================================================
// Scene3D placeholder
// ========================================================================

function addScene3DPlaceholder(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
) {
  slide.addShape("rect" as PptxGenJS.ShapeType, {
    x,
    y,
    w,
    h,
    fill: { color: "1A1A2E" },
    line: { color: "444466", width: 1 },
    rotate,
  });
  slide.addText("[3D Scene]", {
    x,
    y,
    w,
    h,
    fontSize: 14,
    fontFace: "Arial",
    color: "8888AA",
    align: "center",
    valign: "middle",
    rotate,
  });
}

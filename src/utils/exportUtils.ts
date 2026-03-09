import type { FileSystemAdapter } from "@/adapters/types";

// ---- Defaults (matching React renderers exactly) ----

export const DEFAULT_BG = "#ffffff";
export const DEFAULT_TEXT_COLOR = "#1e293b";
export const DEFAULT_TEXT_SIZE = 24;
export const DEFAULT_TEXT_FONT = "Inter, system-ui, sans-serif";
export const DEFAULT_LINE_HEIGHT = 1.5;
export const DEFAULT_CODE_SIZE = 16;
export const DEFAULT_CODE_BG = "#f8f8f8";
export const DEFAULT_CODE_FG = "#1e293b";
export const DEFAULT_CODE_RADIUS = 8;
export const DEFAULT_CODE_THEME = "github-light";
export const DEFAULT_TABLE_SIZE = 14;

// ---- Style resolution (mirrors ThemeContext.resolveStyle) ----

export function resolveStyle<T extends object>(
  theme: Partial<T> | undefined,
  element: Partial<T> | undefined,
): Partial<T> {
  if (!theme) return element ?? ({} as Partial<T>);
  if (!element) return theme;
  return { ...theme, ...element };
}

// ---- Asset URL resolution (delegates to the active adapter) ----

export async function resolveAssetSrc(
  src: string,
  adapter: FileSystemAdapter,
): Promise<string> {
  const result = adapter.resolveAssetUrl(src);
  return typeof result === "string" ? result : await result;
}

// ----

export function stripMarkdown(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/^\s*[-*]\s/gm, "")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1") // block math
    .replace(/\$(.*?)\$/g, "$1") // inline math
    .trim();
}

export function toHex(color: string | undefined): string | undefined {
  if (!color || color === "transparent") return undefined;
  return color.replace(/^#/, "");
}

export async function fetchImageAsBase64(src: string): Promise<string | null> {
  const urls = [
    src,
    src.startsWith("./") ? src.slice(2) : src,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      continue;
    }
  }
  return null;
}

/** Check if a source path points to a PDF file. */
export function isPdfSrc(src: string): boolean {
  const path = src.split("?")[0]!;
  return path.toLowerCase().endsWith(".pdf");
}

/**
 * Render the first page of a PDF to a PNG data URI.
 * Used by PDF/PPTX exporters to handle PDF-as-image elements.
 */
export async function rasterizePdfToBase64(
  src: string,
  width: number,
  height: number,
): Promise<string | null> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  let doc;
  try {
    doc = await getDocument(src).promise;
  } catch {
    return null;
  }

  const page = await doc.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = (width / baseViewport.width) * 2; // 2x for quality
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/png");
  doc.destroy();
  return dataUrl;
}

export function hexToRgb(hex: string): [number, number, number] {
  let clean = hex.replace(/^#/, "");
  // Short hex: #RGB → RRGGBB
  if (clean.length === 3 || clean.length === 4) {
    clean = clean[0]! + clean[0]! + clean[1]! + clean[1]! + clean[2]! + clean[2]!;
  }
  // 8-char hex with alpha: RRGGBBAA → RRGGBB
  if (clean.length === 8) {
    clean = clean.slice(0, 6);
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

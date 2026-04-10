/**
 * Browser-side image downscaling for Gemini multimodal calls.
 *
 * Gemini bills images by tile (~258 tokens per 768x768 tile), so token cost is
 * roughly linear in pixel area. Resizing a 4000x3000 photo to 1280x720 cuts
 * cost 5-10x with negligible accuracy loss for slide-context understanding.
 *
 * Output is base64 (no data URL prefix), ready for inlineData.data.
 */

export interface DownscaleOptions {
  maxLongEdge?: number;
  format?: "webp" | "jpeg";
  quality?: number;
}

export interface DownscaledImage {
  base64: string;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
}

const DEFAULT_LONG_EDGE = 1280;
const DEFAULT_QUALITY = 0.85;

const cache = new Map<string, Promise<DownscaledImage>>();

function cacheKey(src: string, opts: Required<DownscaleOptions>): string {
  return `${src}|${opts.maxLongEdge}|${opts.format}|${opts.quality}`;
}

/**
 * Downscale an image to a target long-edge size and encode as base64.
 * Results are cached in memory keyed by src + options for the lifetime of the page.
 */
export function downscaleImage(
  src: string,
  options: DownscaleOptions = {},
): Promise<DownscaledImage> {
  const opts: Required<DownscaleOptions> = {
    maxLongEdge: options.maxLongEdge ?? DEFAULT_LONG_EDGE,
    format: options.format ?? "webp",
    quality: options.quality ?? DEFAULT_QUALITY,
  };
  const key = cacheKey(src, opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = runDownscale(src, opts);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

async function runDownscale(
  src: string,
  opts: Required<DownscaleOptions>,
): Promise<DownscaledImage> {
  const img = await loadImage(src);
  const { width, height } = computeTargetSize(img.width, img.height, opts.maxLongEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = opts.format === "webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      mimeType,
      opts.quality,
    );
  });

  const base64 = await blobToBase64(blob);
  return { base64, mimeType, width, height, bytes: blob.size };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function computeTargetSize(
  srcW: number,
  srcH: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(srcW, srcH);
  if (longEdge <= maxLongEdge) return { width: srcW, height: srcH };
  const scale = maxLongEdge / longEdge;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** Clear the in-memory cache. Useful in tests or when memory pressure matters. */
export function clearDownscaleCache(): void {
  cache.clear();
}

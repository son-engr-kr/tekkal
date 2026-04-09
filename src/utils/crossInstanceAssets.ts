import type { SlideElement, ImageElement, VideoElement, TikZElement, Slide } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";

// ── Helpers ──

function isLocalAsset(src: string): boolean {
  return !!src && !src.startsWith("data:") && !/^https?:\/\//.test(src) && !src.startsWith("blob:");
}

function getAssetSrcs(el: SlideElement): string[] {
  if (el.type === "image" || el.type === "video") return [(el as ImageElement | VideoElement).src];
  if (el.type === "tikz") {
    const svgUrl = (el as TikZElement).svgUrl;
    return svgUrl ? [svgUrl] : [];
  }
  return [];
}

// ── Copy side: collect asset data URLs ──

/**
 * Resolve asset paths to data URLs for embedding in clipboard.
 * Returns a map: original path → data URL.
 */
export async function collectAssetDataUrls(
  elements: SlideElement[],
  adapter: FileSystemAdapter,
  extraPaths?: string[],
): Promise<Record<string, string>> {
  const assetData: Record<string, string> = {};
  const paths = new Set<string>();

  for (const el of elements) {
    for (const src of getAssetSrcs(el)) {
      if (isLocalAsset(src)) paths.add(src);
    }
  }
  if (extraPaths) {
    for (const p of extraPaths) {
      if (isLocalAsset(p)) paths.add(p);
    }
  }

  for (const path of paths) {
    try {
      const resolved = await adapter.resolveAssetUrl(path);
      if (!resolved) continue;
      // Fetch the resolved URL (could be blob URL or server path) and convert to data URL
      const resp = await fetch(resolved);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const dataUrl = await blobToDataUrl(blob);
      assetData[path] = dataUrl;
    } catch {
      // Skip assets that can't be resolved
    }
  }
  return assetData;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Paste side: restore assets from clipboard data ──

/**
 * Upload an asset from embedded data URL or fetch from remote server.
 * Returns new local path, or keeps original on failure.
 */
async function restoreAsset(
  src: string,
  assetData: Record<string, string> | undefined,
  remoteOrigin: string | undefined,
  remoteProject: string | undefined,
  adapter: FileSystemAdapter,
): Promise<string> {
  if (!isLocalAsset(src)) return src;

  // 1. Try embedded data URL from clipboard
  if (assetData?.[src]) {
    try {
      const dataUrl = assetData[src]!;
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const filename = src.split("/").pop()?.split("?")[0] || "asset.bin";
      const file = new File([blob], filename, { type: blob.type });
      return await adapter.uploadAsset(file);
    } catch {
      // Fall through to HTTP fetch
    }
  }

  // 2. Fallback: fetch from remote server (works in Vite dev mode)
  if (remoteOrigin && remoteProject) {
    try {
      let url: string | null = null;
      if (src.startsWith("./assets/")) {
        url = `${remoteOrigin}/assets/${remoteProject}/${src.slice(9)}`;
      } else if (src.startsWith("/")) {
        url = `${remoteOrigin}${src}`;
      }
      if (url) {
        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          const filename = src.split("/").pop()?.split("?")[0] || "asset.bin";
          const file = new File([blob], filename, { type: blob.type });
          return await adapter.uploadAsset(file);
        }
      }
    } catch {
      // Give up
    }
  }

  return src;
}

/** Restore all asset references in an element. */
export async function restoreElementAssets(
  el: SlideElement,
  assetData: Record<string, string> | undefined,
  remoteOrigin: string | undefined,
  remoteProject: string | undefined,
  adapter: FileSystemAdapter,
): Promise<void> {
  if (el.type === "image" || el.type === "video") {
    const typed = el as ImageElement | VideoElement;
    typed.src = await restoreAsset(typed.src, assetData, remoteOrigin, remoteProject, adapter);
  } else if (el.type === "tikz") {
    const typed = el as TikZElement;
    if (typed.svgUrl) typed.svgUrl = await restoreAsset(typed.svgUrl, assetData, remoteOrigin, remoteProject, adapter);
  }
}

/** Restore all assets in a slide (elements + background image). */
export async function restoreSlideAssets(
  slide: Slide,
  assetData: Record<string, string> | undefined,
  remoteOrigin: string | undefined,
  remoteProject: string | undefined,
  adapter: FileSystemAdapter,
): Promise<void> {
  for (const el of slide.elements) {
    await restoreElementAssets(el, assetData, remoteOrigin, remoteProject, adapter);
  }
  if (slide.background?.image && isLocalAsset(slide.background.image)) {
    slide.background.image = await restoreAsset(slide.background.image, assetData, remoteOrigin, remoteProject, adapter);
  }
}

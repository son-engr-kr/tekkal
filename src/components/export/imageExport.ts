import JSZip from "jszip";
import type { Deck } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import { captureSlideToDataUrl, type PdfImageOptions } from "./pdfExport";

/**
 * Export every visible slide as an image, bundled into a single ZIP file.
 *
 * Re-uses the same DOM→image capture pipeline that the PDF (image) export
 * uses, so the output is pixel-identical.
 */
export async function exportSlidesToImages(
  deck: Deck,
  adapter: FileSystemAdapter,
  opts?: PdfImageOptions,
): Promise<void> {
  const captureScale = opts?.scale ?? 2;
  const imgFormat = opts?.format ?? "png";
  const jpegQuality = opts?.quality ?? 0.75;

  const slides = deck.slides.filter((s) => !s.hidden);
  const zip = new JSZip();

  for (let i = 0; i < slides.length; i++) {
    const dataUrl = await captureSlideToDataUrl(
      slides[i]!,
      deck,
      adapter,
      i + 1,
      slides.length,
      captureScale,
      imgFormat,
      jpegQuality,
    );

    // data:image/png;base64,xxxx → raw binary
    const base64 = dataUrl.split(",")[1]!;
    const pad = String(i + 1).padStart(String(slides.length).length, "0");
    zip.file(`slide-${pad}.${imgFormat}`, base64, { base64: true });

    opts?.onProgress?.(i + 1, slides.length);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const name = (deck.meta.title || "presentation").replace(/[^a-zA-Z0-9_-]/g, "_");

  // Browser download
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_slides.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

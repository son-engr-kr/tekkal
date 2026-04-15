import { useEffect, useState } from "react";
import type { Deck } from "@/types/deck";
import type { FileSystemAdapter } from "@/adapters/types";
import { useDeckStore } from "@/stores/deckStore";
import { exportToPdf } from "@/components/export/pdfExport";
import { exportToNativePdf } from "@/components/export/pdfNativeExport";
import { exportToPptx } from "@/components/export/pptxExport";
import { exportSlidesToImages } from "@/components/export/imageExport";
import { warmScene3DCache } from "@/utils/renderScene3D";

interface Props {
  open: boolean;
  onClose: () => void;
  deck: Deck;
  adapter: FileSystemAdapter;
}

type ExportProgress = { current: number; total: number; label: string } | null;

/**
 * Unified export picker. Lists every export format with a one-line
 * description and runs the chosen one with a shared progress bar.
 */
export function ExportDialog({ open, onClose, deck, adapter }: Props) {
  const [progress, setProgress] = useState<ExportProgress>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !progress) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, progress]);

  if (!open) return null;

  const run = async (
    label: string,
    task: (onProgress: (c: number, t: number) => void) => Promise<void>,
  ) => {
    const total = deck.slides.length;
    setProgress({ current: 0, total, label });
    const onProgress = (c: number, t: number) => setProgress({ current: c, total: t, label });
    try {
      const { currentSlideIndex, setCurrentSlide } = useDeckStore.getState();
      await warmScene3DCache(deck, setCurrentSlide, currentSlideIndex);
      await task(onProgress);
    } finally {
      setProgress(null);
      onClose();
    }
  };

  const options: { label: string; desc: string; run: () => void }[] = [
    {
      label: "PDF (Image HD)",
      desc: "Raster at 4× — highest quality, larger file",
      run: () => run("PDF (Image HD)", (onProgress) =>
        exportToPdf(deck, adapter, { scale: 4, format: "jpeg", quality: 0.92, onProgress })),
    },
    {
      label: "PDF (Image)",
      desc: "Raster at 2× — balanced quality and size",
      run: () => run("PDF (Image)", (onProgress) =>
        exportToPdf(deck, adapter, { scale: 2, format: "jpeg", quality: 0.92, onProgress })),
    },
    {
      label: "PDF (Native)",
      desc: "Vector text + shapes — small file, searchable",
      run: () => run("PDF (Native)", (onProgress) =>
        exportToNativePdf(deck, adapter, onProgress)),
    },
    {
      label: "PPTX",
      desc: "PowerPoint with native text, shapes, and tables",
      run: () => run("PPTX", (onProgress) =>
        exportToPptx(deck, adapter, onProgress)),
    },
    {
      label: "Images (ZIP)",
      desc: "PNG per slide, bundled in a ZIP",
      run: () => run("Images (ZIP)", (onProgress) =>
        exportSlidesToImages(deck, adapter, { scale: 2, format: "png", onProgress })),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !progress && onClose()}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Export</h2>
          <button
            onClick={onClose}
            disabled={!!progress}
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {options.map((opt) => (
            <button
              key={opt.label}
              disabled={!!progress}
              onClick={opt.run}
              className="w-full text-left p-3 rounded hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <div className="text-sm font-medium text-zinc-100">{opt.label}</div>
              <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>

        {progress && (
          <div className="border-t border-zinc-800 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-zinc-300 mb-1.5">
              <span>{progress.label}</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

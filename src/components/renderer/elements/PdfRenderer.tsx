import { useRef, useEffect, useState, useCallback } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

// Module-level cache: "src:width" → per-page snapshot { dataUrl, displayHeight }
const pageCache = new Map<string, { dataUrl: string; displayHeight: number }[]>();

function cacheKey(src: string, width: number): string {
  return `${src}:${width}`;
}

interface Props {
  src: string;
  width: number;
  height: number;
  borderRadius: number;
  opacity: number;
}

export default function PdfRenderer({ src, width, height, borderRadius, opacity }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const cached = pageCache.get(cacheKey(src, width));

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    const task = getDocument(src);
    task.promise.then(
      (doc) => {
        if (cancelled) {
          doc.destroy();
        } else {
          loadedDoc = doc;
          setPdf(doc);
        }
      },
      () => { /* task was destroyed during cleanup — expected */ },
    );
    return () => {
      cancelled = true;
      if (loadedDoc) {
        loadedDoc.destroy();
      } else {
        task.destroy();
      }
    };
  }, [src]);

  // PDF not loaded yet — show cache or loading placeholder
  if (!pdf) {
    if (cached && cached.length > 0) {
      const isSinglePage = cached.length === 1;
      return (
        <div
          style={{
            width,
            height,
            borderRadius,
            opacity,
            overflow: isSinglePage ? "hidden" : "auto",
          }}
        >
          {cached.map((page, i) => (
            <img
              key={i}
              src={page.dataUrl}
              draggable={false}
              style={{ display: "block", width, height: page.displayHeight }}
            />
          ))}
        </div>
      );
    }

    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a2e",
          color: "#666",
          fontSize: 14,
          borderRadius,
          opacity,
        }}
      >
        Loading PDF...
      </div>
    );
  }

  const isSinglePage = pdf.numPages === 1;

  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        opacity,
        overflow: isSinglePage ? "hidden" : "auto",
      }}
    >
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPageCanvas
          key={i}
          src={src}
          pdf={pdf}
          pageNumber={i + 1}
          pageCount={pdf.numPages}
          containerWidth={width}
          lazy={!isSinglePage}
        />
      ))}
    </div>
  );
}

function PdfPageCanvas({
  src,
  pdf,
  pageNumber,
  pageCount,
  containerWidth,
  lazy,
}: {
  src: string;
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  containerWidth: number;
  lazy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!lazy) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [lazy]);

  const renderPage = useCallback(
    async (page: PDFPageProxy) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth / baseViewport.width) * dpr;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const displayHeight = viewport.height / dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      await page.render({ canvas, viewport }).promise;

      // Cache rendered page as image snapshot
      const dataUrl = canvas.toDataURL("image/png");
      const key = cacheKey(src, containerWidth);
      let pages = pageCache.get(key);
      if (!pages) {
        pages = new Array(pageCount);
        pageCache.set(key, pages);
      }
      pages[pageNumber - 1] = { dataUrl, displayHeight };
    },
    [src, containerWidth, pageNumber, pageCount],
  );

  useEffect(() => {
    if (!visible || renderedRef.current) return;
    renderedRef.current = true;
    pdf.getPage(pageNumber).then(renderPage);
  }, [visible, pdf, pageNumber, renderPage]);

  // Show cached image while canvas renders
  const cachedPage = pageCache.get(cacheKey(src, containerWidth))?.[pageNumber - 1];

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          display: renderedRef.current || !cachedPage ? "block" : "none",
          width: containerWidth,
        }}
      />
      {!renderedRef.current && cachedPage && (
        <img
          src={cachedPage.dataUrl}
          draggable={false}
          style={{ display: "block", width: containerWidth, height: cachedPage.displayHeight }}
        />
      )}
    </>
  );
}

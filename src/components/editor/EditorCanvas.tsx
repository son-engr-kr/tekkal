import { useRef, useState, useEffect, useCallback, memo } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { usePreviewStore } from "@/stores/previewStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import type { ImageElement, VideoElement, SlideElement, ShapeElement } from "@/types/deck";
import { getPageNumberInfo } from "@/utils/pageNumbers";
import { SelectionOverlay, TrimOverlay } from "./SelectionOverlay";
import { useAdapter } from "@/contexts/AdapterContext";
import { assert } from "@/utils/assert";
import { ComponentEditOverlay } from "./ComponentEditOverlay";
import { useGitDiff } from "@/contexts/GitDiffContext";
import { reuploadElementAssets, reuploadSlideAssets } from "@/utils/crossInstanceAssets";

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface MarqueeRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

export const EditorCanvas = memo(function EditorCanvas({ showDiff = false }: { showDiff?: boolean }) {
  const slide = useDeckStore((s) => s.deck?.slides[s.currentSlideIndex]);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const theme = useDeckStore((s) => s.deck?.theme);
  const deck = useDeckStore((s) => s.deck);
  const selectElement = useDeckStore((s) => s.selectElement);
  const selectElements = useDeckStore((s) => s.selectElements);
  const addElement = useDeckStore((s) => s.addElement);
  const trimElementId = useDeckStore((s) => s.trimElementId);
  const editingComponentId = useDeckStore((s) => s.editingComponentId);
  const showAnimationOrder = useDeckStore((s) => s.showAnimationOrder);
  const adapter = useAdapter();
  const gitDiff = useGitDiff();

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeRef = useRef<MarqueeRect | null>(null);

  const previewAnimations = usePreviewStore((s) => s.animations);
  const previewDelayOverrides = usePreviewStore((s) => s.delayOverrides);
  const previewFlashTimes = usePreviewStore((s) => s.flashTimes);
  const previewKey = usePreviewStore((s) => s.key);
  const clearPreview = usePreviewStore((s) => s.clearPreview);

  const [flashActive, setFlashActive] = useState(false);

  // Auto-clear preview after animations complete
  useEffect(() => {
    if (!previewAnimations || previewAnimations.length === 0) return;
    const maxMs = previewAnimations.reduce(
      (max, a) => {
        const delay = previewDelayOverrides?.get(a) ?? (a.delay ?? 0);
        return Math.max(max, delay + (a.duration ?? 500));
      },
      0,
    );
    const timer = setTimeout(clearPreview, maxMs + 100);
    return () => clearTimeout(timer);
  }, [previewAnimations, previewDelayOverrides, previewKey, clearPreview]);

  // Schedule border flashes for onClick/onKey step boundaries
  useEffect(() => {
    if (previewFlashTimes.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const t of previewFlashTimes) {
      timers.push(setTimeout(() => setFlashActive(true), t));
      timers.push(setTimeout(() => setFlashActive(false), t + 300));
    }
    return () => timers.forEach(clearTimeout);
  }, [previewFlashTimes, previewKey]);

  // ---- Zoom / Pan state ----
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [baseScale, setBaseScale] = useState(0.8);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const scale = baseScale * zoom;

  // Ref for reading current view state in event handlers (avoids stale closures)
  const viewRef = useRef({ zoom, panX, panY, baseScale });
  viewRef.current = { zoom, panX, panY, baseScale };

  const clampPan = useCallback((px: number, py: number, z: number, bs: number) => {
    const s = bs * z;
    const cw = CANVAS_WIDTH * s;
    const ch = CANVAS_HEIGHT * s;
    const container = containerRef.current;
    if (!container) return { px: 0, py: 0 };
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const maxPx = Math.max(0, (cw - containerW) / 2);
    const maxPy = Math.max(0, (ch - containerH) / 2);
    return {
      px: cw <= containerW ? 0 : Math.min(Math.max(px, -maxPx), maxPx),
      py: ch <= containerH ? 0 : Math.min(Math.max(py, -maxPy), maxPy),
    };
  }, []);

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const padding = 40;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    setContainerSize({ w: cw, h: ch });
    const availW = cw - padding * 2;
    const availH = ch - padding * 2;
    setBaseScale(Math.min(availW / CANVAS_WIDTH, availH / CANVAS_HEIGHT, 1.5));
  }, []);

  useEffect(() => {
    updateScale();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => updateScale());
    ro.observe(container);
    return () => ro.disconnect();
  }, [updateScale]);

  // Zoom: Ctrl+Wheel toward cursor position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const { zoom: z, panX: px, panY: py, baseScale: bs } = viewRef.current;
      const s = bs * z;
      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const containerW = container.clientWidth;
      const containerH = container.clientHeight;
      const canvasW = CANVAS_WIDTH * s;
      const canvasH = CANVAS_HEIGHT * s;

      // Current canvas position in container
      const centerX = (containerW - canvasW) / 2;
      const centerY = (containerH - canvasH) / 2;
      const curLeft = centerX + px;
      const curTop = centerY + py;

      // Canvas point under cursor (in 960×540 space)
      const cpx = (cursorX - curLeft) / s;
      const cpy = (cursorY - curTop) / s;

      // Compute new zoom
      const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const newZoom = Math.min(Math.max(z * factor, MIN_ZOOM), MAX_ZOOM);
      const newScale = bs * newZoom;

      // Adjust pan so the same canvas point stays under cursor
      const newCanvasW = CANVAS_WIDTH * newScale;
      const newCanvasH = CANVAS_HEIGHT * newScale;
      const newCenterX = (containerW - newCanvasW) / 2;
      const newCenterY = (containerH - newCanvasH) / 2;
      const rawPanX = (cursorX - cpx * newScale) - newCenterX;
      const rawPanY = (cursorY - cpy * newScale) - newCenterY;

      const clamped = clampPan(rawPanX, rawPanY, newZoom, bs);
      setZoom(newZoom);
      setPanX(clamped.px);
      setPanY(clamped.py);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [clampPan]);

  // Reset zoom/pan: Ctrl+0
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPanX(0);
        setPanY(0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Clipboard paste: add image/video/elements from Ctrl+V
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!slide) return;

      // Don't intercept paste in text inputs
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      // 1. Try media files (images, videos, PDFs)
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf",
      );
      if (file) {
        e.preventDefault();
        const ext = file.name.split(".").pop() || "png";
        const renamed = new File([file], `paste-${Date.now()}.${ext}`, {
          type: file.type,
        });
        let storedUrl: string;
        try {
          storedUrl = await adapter.uploadAsset(renamed);
        } catch {
          // Adapter doesn't support upload (e.g. read-only mode) — embed as data URL
          storedUrl = await fileToDataUrl(file);
        }
        const slideId = slide.id;
        const id = crypto.randomUUID();
        // Use blob URL for dimension probing (storedUrl may be a relative path)
        const probeUrl = URL.createObjectURL(file);

        if (file.type.startsWith("video/")) {
          const video = document.createElement("video");
          video.onloadedmetadata = () => {
            URL.revokeObjectURL(probeUrl);
            const ratio = video.videoWidth / video.videoHeight;
            const maxW = 560, maxH = 400;
            let w: number, h: number;
            if (ratio > maxW / maxH) {
              w = Math.min(video.videoWidth, maxW);
              h = Math.round(w / ratio);
            } else {
              h = Math.min(video.videoHeight, maxH);
              w = Math.round(h * ratio);
            }
            const element: VideoElement = {
              id,
              type: "video",
              src: storedUrl,
              autoplay: false,
              controls: true,
              position: { x: 230, y: 120 },
              size: { w, h },
            };
            useDeckStore.getState().addElement(slideId, element);
            useDeckStore.getState().selectElement(id);
          };
          video.src = probeUrl;
        } else if (file.type === "application/pdf") {
          URL.revokeObjectURL(probeUrl);
          const element: ImageElement = {
            id,
            type: "image",
            src: storedUrl,
            position: { x: 280, y: 120 },
            size: { w: 400, h: 300 },
          };
          addElement(slideId, element);
          selectElement(id);
        } else {
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(probeUrl);
            const ratio = img.naturalWidth / img.naturalHeight;
            const maxW = 400, maxH = 400;
            let w: number, h: number;
            if (ratio > maxW / maxH) {
              w = Math.min(img.naturalWidth, maxW);
              h = Math.round(w / ratio);
            } else {
              h = Math.min(img.naturalHeight, maxH);
              w = Math.round(h * ratio);
            }
            const element: ImageElement = {
              id,
              type: "image",
              src: storedUrl,
              position: { x: 330, y: 170 },
              size: { w, h },
            };
            useDeckStore.getState().addElement(slideId, element);
            useDeckStore.getState().selectElement(id);
          };
          img.src = probeUrl;
        }
        return;
      }

      // 2. Try deckode data from system clipboard
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.__deckode) {
            const isCrossInstance = (parsed.origin && parsed.origin !== window.location.origin)
              || (parsed.project && parsed.project !== adapter.projectName);

            // Element paste
            if (Array.isArray(parsed.elements)) {
              e.preventDefault();
              const { nextElementId } = await import("@/utils/id");

              // Merge referenced components into deck (re-upload assets if cross-origin)
              if (parsed.components && typeof parsed.components === "object") {
                const state = useDeckStore.getState();
                if (state.deck) {
                  if (!state.deck.components) state.deck.components = {};
                  for (const [compId, comp] of Object.entries(parsed.components)) {
                    if (!state.deck.components[compId]) {
                      const c = comp as import("@/types/deck").SharedComponent;
                      if (isCrossInstance) {
                        for (const el of c.elements) await reuploadElementAssets(el, parsed.origin, parsed.project, adapter);
                      }
                      state.deck.components[compId] = c;
                    }
                  }
                }
              }

              const newIds: string[] = [];
              for (const original of parsed.elements as SlideElement[]) {
                const clone: SlideElement = JSON.parse(JSON.stringify(original));
                clone.id = nextElementId();
                clone.position = { x: original.position.x + 20, y: original.position.y + 20 };
                delete clone.groupId;
                // Re-upload assets from other instance
                if (isCrossInstance) {
                  await reuploadElementAssets(clone, parsed.origin, parsed.project, adapter);
                }
                addElement(slide.id, clone);
                newIds.push(clone.id);
              }
              selectElement(newIds[0]!);
              for (let i = 1; i < newIds.length; i++) {
                selectElement(newIds[i]!, "add");
              }
              // Update clipboard positions for cascade offset on next paste
              for (const el of parsed.elements as SlideElement[]) {
                el.position = { x: el.position.x + 20, y: el.position.y + 20 };
              }
              navigator.clipboard.writeText(JSON.stringify(parsed)).catch(() => {});
              return;
            }

            // Slide paste (supports both single `slide` and array `slides`)
            const slidesToPaste: import("@/types/deck").Slide[] | undefined =
              Array.isArray(parsed.slides) ? parsed.slides
              : parsed.slide ? [parsed.slide]
              : undefined;
            if (slidesToPaste && slidesToPaste.length > 0) {
              e.preventDefault();
              const { cloneSlide } = await import("@/utils/id");
              const state = useDeckStore.getState();

              // Merge referenced components (re-upload assets if cross-origin)
              if (parsed.components && typeof parsed.components === "object") {
                if (state.deck) {
                  if (!state.deck.components) state.deck.components = {};
                  for (const [compId, comp] of Object.entries(parsed.components)) {
                    if (!state.deck.components[compId]) {
                      const c = comp as import("@/types/deck").SharedComponent;
                      if (isCrossInstance) {
                        for (const el of c.elements) await reuploadElementAssets(el, parsed.origin, parsed.project, adapter);
                      }
                      state.deck.components[compId] = c;
                    }
                  }
                }
              }

              let insertIndex = state.currentSlideIndex;
              const newSlideIds: string[] = [];
              for (const srcSlide of slidesToPaste) {
                const clone = cloneSlide(srcSlide);
                // Re-upload assets from other instance
                if (isCrossInstance) {
                  await reuploadSlideAssets(clone, parsed.origin, parsed.project, adapter);
                }
                state.addSlide(clone, insertIndex);
                insertIndex++;
                newSlideIds.push(clone.id);
              }
              state.setCurrentSlide(state.currentSlideIndex + 1);
              if (newSlideIds.length > 1) {
                state.setSelectedSlides(newSlideIds);
              }
              return;
            }

            // Component reference paste
            if (parsed.componentRef) {
              e.preventDefault();
              const state = useDeckStore.getState();
              if (state.deck) {
                const s = state.deck.slides[state.currentSlideIndex];
                if (s && state.deck.components?.[parsed.componentRef]) {
                  state.pasteReference(s.id, parsed.componentRef, { x: 100, y: 100 });
                }
              }
              return;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [slide, adapter, addElement, selectElement]);

  if (!slide) return null;

  if (slide._missing) {
    return (
      <div
        ref={containerRef}
        className="flex-1 relative bg-zinc-900 overflow-hidden flex items-center justify-center"
      >
        <div
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
            backgroundColor: "#fef2f2",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 48 * scale }}>⚠</div>
          <div style={{ fontSize: 24 * scale, fontWeight: 700, color: "#991b1b" }}>Missing file</div>
          <div style={{ fontSize: 14 * scale, color: "#b91c1c", marginTop: 8 * scale, fontFamily: "monospace" }}>
            {slide._ref}
          </div>
        </div>
      </div>
    );
  }

  // ---- Compute canvas position (centered + pan, clamped) ----
  const canvasW = CANVAS_WIDTH * scale;
  const canvasH = CANVAS_HEIGHT * scale;
  const maxPanXD = Math.max(0, (canvasW - containerSize.w) / 2);
  const maxPanYD = Math.max(0, (canvasH - containerSize.h) / 2);
  const displayPanX = canvasW <= containerSize.w ? 0 : Math.min(Math.max(panX, -maxPanXD), maxPanXD);
  const displayPanY = canvasH <= containerSize.h ? 0 : Math.min(Math.max(panY, -maxPanYD), maxPanYD);
  const canvasLeft = (containerSize.w - canvasW) / 2 + displayPanX;
  const canvasTop = (containerSize.h - canvasH) / 2 + displayPanY;

  // Start marquee selection, pan, or deselect when clicking canvas area.
  // InteractiveElement's handleMouseDown calls stopPropagation, so element clicks never reach here.
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Middle mouse: pan
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const { panX: startPanX, panY: startPanY, zoom: z, baseScale: bs } = viewRef.current;

      const handleMove = (me: MouseEvent) => {
        const rawPx = startPanX + (me.clientX - startX);
        const rawPy = startPanY + (me.clientY - startY);
        const clamped = clampPan(rawPx, rawPy, z, bs);
        setPanX(clamped.px);
        setPanY(clamped.py);
      };

      const handleUp = () => {
        setIsPanning(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      return;
    }

    if (e.button !== 0) return;

    const wrapper = canvasWrapperRef.current;
    if (!wrapper) {
      selectElement(null);
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / scale;
    const canvasY = (e.clientY - rect.top) / scale;

    // Only start marquee if click is within the canvas area
    if (canvasX < 0 || canvasX > CANVAS_WIDTH || canvasY < 0 || canvasY > CANVAS_HEIGHT) {
      selectElement(null);
      return;
    }

    const isShift = e.shiftKey;
    const startRect: MarqueeRect = { startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY };
    marqueeRef.current = startRect;
    // Don't show marquee yet — wait for actual drag movement
    let didDrag = false;

    const handleMouseMove = (me: MouseEvent) => {
      const cx = (me.clientX - rect.left) / scale;
      const cy = (me.clientY - rect.top) / scale;
      const updated = { ...marqueeRef.current!, endX: cx, endY: cy };
      marqueeRef.current = updated;
      if (!didDrag && (Math.abs(cx - canvasX) > 3 || Math.abs(cy - canvasY) > 3)) {
        didDrag = true;
      }
      if (didDrag) setMarquee(updated);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      if (!didDrag) {
        // Simple click on empty space — deselect
        selectElement(null);
      } else {
        // Compute which elements intersect the marquee rect
        const m = marqueeRef.current!;
        const mx1 = Math.min(m.startX, m.endX);
        const my1 = Math.min(m.startY, m.endY);
        const mx2 = Math.max(m.startX, m.endX);
        const my2 = Math.max(m.startY, m.endY);

        const currentSlide = useDeckStore.getState().deck?.slides[useDeckStore.getState().currentSlideIndex];
        if (currentSlide) {
          const hitIds = currentSlide.elements
            .filter((el: SlideElement) => {
              let ex1 = el.position.x;
              let ey1 = el.position.y;
              let ex2 = ex1 + el.size.w;
              let ey2 = ey1 + el.size.h;
              // For cropped images/videos, use visible crop bounds
              if (el.type === "image" || el.type === "video") {
                const crop = el.type === "image"
                  ? (el as ImageElement).style?.crop
                  : (el as VideoElement).style?.crop;
                if (crop && (crop.top || crop.right || crop.bottom || crop.left)) {
                  const w = el.size.w;
                  const h = el.size.h;
                  ex1 = el.position.x + crop.left * w;
                  ey1 = el.position.y + crop.top * h;
                  ex2 = el.position.x + w - crop.right * w;
                  ey2 = el.position.y + h - crop.bottom * h;
                }
              }
              // For line/arrow with waypoints, use waypoint-derived bounds
              if (el.type === "shape") {
                const shape = el as ShapeElement;
                if ((shape.shape === "line" || shape.shape === "arrow") && shape.style?.waypoints && shape.style.waypoints.length >= 2) {
                  const wps = shape.style.waypoints;
                  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
                  for (const p of wps) {
                    wMinX = Math.min(wMinX, p.x);
                    wMinY = Math.min(wMinY, p.y);
                    wMaxX = Math.max(wMaxX, p.x);
                    wMaxY = Math.max(wMaxY, p.y);
                  }
                  ex1 = el.position.x + wMinX;
                  ey1 = el.position.y + wMinY;
                  ex2 = el.position.x + wMaxX;
                  ey2 = el.position.y + wMaxY;
                }
              }
              return ex1 < mx2 && ex2 > mx1 && ey1 < my2 && ey2 > my1;
            })
            .map((el: SlideElement) => el.id);

          if (isShift) {
            // Add to existing selection
            const existing = useDeckStore.getState().selectedElementIds;
            const merged = [...new Set([...existing, ...hitIds])];
            selectElements(merged);
          } else {
            selectElements(hitIds);
          }
        }
      }

      marqueeRef.current = null;
      setMarquee(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isVideo && !isPdf) return;

    const storedUrl = await adapter.uploadAsset(file);
    const slideId = slide.id;

    const wrapper = canvasWrapperRef.current;
    assert(wrapper !== null, "canvasWrapperRef not attached");
    const rect = wrapper.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / scale;
    const rawY = (e.clientY - rect.top) / scale;

    const id = crypto.randomUUID();

    const createAtPosition = (elW: number, elH: number) => {
      const x = Math.max(0, Math.min(rawX - elW / 2, CANVAS_WIDTH - elW));
      const y = Math.max(0, Math.min(rawY - elH / 2, CANVAS_HEIGHT - elH));
      return { x, y };
    };

    if (isPdf) {
      const pos = createAtPosition(400, 300);
      const element: ImageElement = {
        id,
        type: "image",
        src: storedUrl,
        position: pos,
        size: { w: 400, h: 300 },
      };
      addElement(slideId, element);
      selectElement(id);
    } else if (isVideo) {
      const probeUrl = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(probeUrl);
        const ratio = video.videoWidth / video.videoHeight;
        const maxW = 560, maxH = 400;
        let w: number, h: number;
        if (ratio > maxW / maxH) {
          w = Math.min(video.videoWidth, maxW);
          h = Math.round(w / ratio);
        } else {
          h = Math.min(video.videoHeight, maxH);
          w = Math.round(h * ratio);
        }
        const pos = createAtPosition(w, h);
        const element: VideoElement = {
          id,
          type: "video",
          src: storedUrl,
          controls: true,
          position: pos,
          size: { w, h },
        };
        useDeckStore.getState().addElement(slideId, element);
        useDeckStore.getState().selectElement(id);
      };
      video.src = probeUrl;
    } else {
      const probeUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(probeUrl);
        const ratio = img.naturalWidth / img.naturalHeight;
        const maxW = 400, maxH = 400;
        let w: number, h: number;
        if (ratio > maxW / maxH) {
          w = Math.min(img.naturalWidth, maxW);
          h = Math.round(w / ratio);
        } else {
          h = Math.min(img.naturalHeight, maxH);
          w = Math.round(h * ratio);
        }
        const pos = createAtPosition(w, h);
        const element: ImageElement = {
          id,
          type: "image",
          src: storedUrl,
          position: pos,
          size: { w, h },
        };
        useDeckStore.getState().addElement(slideId, element);
        useDeckStore.getState().selectElement(id);
      };
      img.src = probeUrl;
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-zinc-900 overflow-hidden"
      style={{ cursor: isPanning ? "grabbing" : undefined }}
      onMouseDown={handleCanvasMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
    >
      <div
        ref={canvasWrapperRef}
        className="absolute"
        style={{
          left: canvasLeft,
          top: canvasTop,
          userSelect: "none",
          WebkitUserDrag: "none",
        } as React.CSSProperties}
        onDragStart={(e) => {
          // Prevent native HTML drag from rendered elements (images, text, SVGs).
          // External file drops still work because they originate outside the window.
          e.preventDefault();
        }}
      >
        <SlideRenderer
          slide={slide}
          scale={scale}
          theme={theme}
          previewAnimations={previewAnimations ?? undefined}
          previewDelayOverrides={previewDelayOverrides ?? undefined}
          previewKey={previewKey}
          editorMode
          pageNumberInfo={deck ? getPageNumberInfo(deck, currentSlideIndex) : undefined}
        />
        {editingComponentId && (
          <ComponentEditOverlay
            componentId={editingComponentId}
            slide={slide}
            scale={scale}
          />
        )}
        {/* Git diff overlay */}
        {showDiff && gitDiff.available && slide && !editingComponentId && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            {(() => {
              const { elementChanges } = gitDiff;
              // If all elements are added → entire slide is new
              const allAdded = slide.elements.length > 0 &&
                slide.elements.every((el) => elementChanges.get(el.id) === "added");
              if (allAdded) {
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: 0, top: 0,
                      width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
                      border: "3px dashed #22c55e",
                      borderRadius: 4,
                    }}
                  />
                );
              }

              // Group changed elements by groupId
              const ungrouped: { el: typeof slide.elements[0]; change: string }[] = [];
              const groupedChanges = new Map<string, typeof slide.elements>();

              for (const el of slide.elements) {
                const change = elementChanges.get(el.id);
                if (!change) continue;
                if (el.groupId) {
                  let group = groupedChanges.get(el.groupId);
                  if (!group) { group = []; groupedChanges.set(el.groupId, group); }
                  group.push(el);
                } else {
                  ungrouped.push({ el, change });
                }
              }

              const rects: React.ReactNode[] = [];

              // Render group bounding boxes
              for (const [groupId, elements] of groupedChanges) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const el of elements) {
                  minX = Math.min(minX, el.position.x);
                  minY = Math.min(minY, el.position.y);
                  maxX = Math.max(maxX, el.position.x + el.size.w);
                  maxY = Math.max(maxY, el.position.y + el.size.h);
                }
                rects.push(
                  <div
                    key={`diff-group-${groupId}`}
                    style={{
                      position: "absolute",
                      left: minX - 4, top: minY - 4,
                      width: maxX - minX + 8, height: maxY - minY + 8,
                      border: "2px dashed #22c55e",
                      borderRadius: 4,
                    }}
                  />
                );
              }

              // Render individual element borders
              for (const { el, change } of ungrouped) {
                const color = change === "removed" ? "#ef4444" : "#22c55e";
                rects.push(
                  <div
                    key={`diff-${el.id}`}
                    style={{
                      position: "absolute",
                      left: el.position.x,
                      top: el.position.y,
                      width: el.size.w,
                      height: el.size.h,
                      border: `2px dashed ${color}`,
                      borderRadius: 2,
                    }}
                  />
                );
              }

              return rects;
            })()}
          </div>
        )}
        {/* Animation order overlay */}
        {showAnimationOrder && slide?.animations && slide.animations.length > 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            {(() => {
              // Compute execution step numbers: withPrevious shares the same step
              const byTarget = new Map<string, number[]>();
              let step = 0;
              slide.animations!.forEach((anim) => {
                if (anim.trigger !== "withPrevious") step++;
                let list = byTarget.get(anim.target);
                if (!list) { list = []; byTarget.set(anim.target, list); }
                if (!list.includes(step)) list.push(step);
              });
              return [...byTarget.entries()].map(([targetId, indices]) => {
                const el = slide.elements.find((e) => e.id === targetId);
                if (!el) return null;
                const badgeSize = 18 / scale;
                const fontSize = 9 / scale;
                const gap = 2 / scale;
                return (
                  <div
                    key={`anim-order-${targetId}`}
                    className="flex"
                    style={{
                      position: "absolute",
                      left: el.position.x - badgeSize / 2,
                      top: el.position.y - badgeSize / 2,
                      gap,
                    }}
                  >
                    {indices.map((n) => (
                      <div
                        key={n}
                        className="flex items-center justify-center rounded-full bg-blue-600 text-white font-bold shadow-md"
                        style={{ width: badgeSize, height: badgeSize, fontSize }}
                      >
                        {n}
                      </div>
                    ))}
                  </div>
                );
              });
            })()}
          </div>
        )}
        {!editingComponentId && <SelectionOverlay slide={slide} scale={scale} />}
        {marquee && !editingComponentId && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: Math.min(marquee.startX, marquee.endX),
                top: Math.min(marquee.startY, marquee.endY),
                width: Math.abs(marquee.endX - marquee.startX),
                height: Math.abs(marquee.endY - marquee.startY),
                border: "1.5px solid rgba(59, 130, 246, 0.8)",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
              }}
            />
          </div>
        )}
        {flashActive && (
          <div
            className="absolute inset-0 pointer-events-none rounded-sm"
            style={{
              boxShadow: "inset 0 0 0 3px rgba(59,130,246,0.8), 0 0 12px 2px rgba(59,130,246,0.4)",
              animation: "flash-fade 300ms ease-out forwards",
            }}
          />
        )}
      </div>
      {/* Trim overlay — floating at bottom of canvas area */}
      {trimElementId && slide && (() => {
        const trimEl = slide.elements.find((e) => e.id === trimElementId);
        if (!trimEl || trimEl.type !== "video") return null;
        return (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2" style={{ width: CANVAS_WIDTH * scale, zIndex: 50 }}>
            <TrimOverlay element={trimEl} slideId={slide.id} />
          </div>
        );
      })()}
      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-black/50 text-zinc-300 text-xs tabular-nums pointer-events-none">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
});

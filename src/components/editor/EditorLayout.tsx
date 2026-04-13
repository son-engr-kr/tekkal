import { useState, useEffect, useCallback, useRef, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useDeckStore, selectIsDirty } from "@/stores/deckStore";
import type { SlideElement } from "@/types/deck";
import type { ReferenceElement, SharedComponent } from "@/types/deck";
import { findUndoChanges } from "@/utils/deckDiff";
import { skipNextRestore } from "@/utils/handleStore";
import { SlideList } from "./SlideList";
import { EditorCanvas } from "./EditorCanvas";
import { PropertyPanel } from "./PropertyPanel";
import { CodePanel } from "./CodePanel";
import { NotesEditor } from "./NotesEditor";
import { ElementPalette } from "./ElementPalette";
import { SlideAnimationList } from "./SlideAnimationList";
import { ElementList } from "./ElementList";
import { ThemePanel } from "./ThemePanel";
import { PresentationMode } from "@/components/presenter/PresentationMode";
import { exportToPdf } from "@/components/export/pdfExport";
import { exportToNativePdf } from "@/components/export/pdfNativeExport";
import { exportToPptx } from "@/components/export/pptxExport";
import { exportSlidesToImages } from "@/components/export/imageExport";
import { useAdapter } from "@/contexts/AdapterContext";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { AiChatPanel } from "./AiChatPanel";
import { useGitDiff } from "@/contexts/GitDiffContext";
import { useTikzAutoRender } from "@/hooks/useTikzAutoRender";

import {
  setElementClipboard,
  setSlideClipboard,
} from "./clipboard";
import { collectAssetDataUrls } from "@/utils/crossInstanceAssets";

// ── Error boundary for PropertyPanel ──

class PropertyPanelErrorBoundary extends Component<
  { elementId: string | null; elementType: string | null; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PropertyPanel] Crash for element "${this.props.elementId}" (${this.props.elementType}):`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: { elementId: string | null; elementType: string | null }) {
    if (prevProps.elementId !== this.props.elementId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-3">
          <div
            style={{
              backgroundColor: "#2a1215",
              border: "1px solid #7f1d1d",
              borderRadius: 6,
              padding: "10px 12px",
              color: "#f87171",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            PropertyPanel crashed
            {this.props.elementType && (
              <div style={{ fontWeight: 400, marginTop: 4, color: "#fca5a5" }}>
                {this.props.elementType}
                {this.props.elementId ? ` / ${this.props.elementId}` : ""}
              </div>
            )}
            <div style={{ fontWeight: 400, marginTop: 6, color: "#ef4444", fontSize: 11 }}>
              {this.state.error.message}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function performUndoRedo(direction: "undo" | "redo") {
  const temporal = useDeckStore.temporal.getState();
  const pastLen = temporal.pastStates.length;
  const futureLen = temporal.futureStates.length;
  if (direction === "undo" && pastLen === 0) return;
  if (direction === "redo" && futureLen === 0) return;

  const oldDeck = useDeckStore.getState().deck;
  temporal[direction]();
  const newDeck = useDeckStore.getState().deck;

  const changes = findUndoChanges(oldDeck, newDeck);
  if (changes.slideIndex !== -1) {
    useDeckStore.getState().setCurrentSlide(changes.slideIndex);
  }
  if (changes.elementIds.length > 0) {
    useDeckStore.getState().highlightElements(changes.elementIds);
  }
}

type BottomPanel = "code" | null;
type RightPanel = "properties" | "theme";

export function EditorLayout() {
  useTikzAutoRender();
  const adapter = useAdapter();
  const gitDiff = useGitDiff();
  const isReadOnly = adapter.mode === "readonly";
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>("properties");
  const [showAi, setShowAi] = useState(false);
  const [aiWidth, setAiWidth] = useState(300);
  const [presenting, setPresenting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  const isDirty = useDeckStore(selectIsDirty);
  const isSaving = useDeckStore((s) => s.isSaving);
  const saveToDisk = useDeckStore((s) => s.saveToDisk);
  const selectedElementId = useDeckStore((s) => s.selectedElementIds?.[0] ?? null);
  const selectedElement = useDeckStore((s) => {
    const id = s.selectedElementIds?.[0];
    if (!id) return null;
    const slide = s.deck?.slides?.[s.currentSlideIndex];
    return slide?.elements?.find((e) => e.id === id) ?? null;
  });

  // Resizable panel widths
  const [leftWidth, setLeftWidth] = useState(170);
  const [rightWidth, setRightWidth] = useState(240);
  const [notesHeight, setNotesHeight] = useState(160);
  const [codeHeight, setCodeHeight] = useState(250);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const dragRef = useRef<{
    side: "left" | "right" | "notes" | "code";
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const notesHeightRef = useRef(notesHeight);
  notesHeightRef.current = notesHeight;
  const codeHeightRef = useRef(codeHeight);
  codeHeightRef.current = codeHeight;

  // Close PDF menu on click outside
  useEffect(() => {
    if (!pdfMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node)) {
        setPdfMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pdfMenuOpen]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { side, startX, startWidth, startY, startHeight } = dragRef.current;
      if (side === "notes") {
        const delta = startY - e.clientY;
        setNotesHeight(Math.max(80, Math.min(400, startHeight + delta)));
      } else if (side === "code") {
        const delta = startY - e.clientY;
        setCodeHeight(Math.max(100, Math.min(500, startHeight + delta)));
      } else {
        const delta = e.clientX - startX;
        if (side === "left") {
          setLeftWidth(Math.max(120, Math.min(400, startWidth + delta)));
        } else {
          setRightWidth(Math.max(180, Math.min(500, startWidth - delta)));
        }
      }
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startDrag = useCallback(
    (side: "left" | "right" | "notes" | "code", e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        side,
        startX: e.clientX,
        startY: e.clientY,
        startWidth:
          side === "left" ? leftWidthRef.current : rightWidthRef.current,
        startHeight:
          side === "notes" ? notesHeightRef.current : codeHeightRef.current,
      };
      document.body.style.cursor = (side === "notes" || side === "code") ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const handleSave = useCallback(() => {
    saveToDisk();
  }, [saveToDisk]);

  // Enter fullscreen presentation — must be called from a user gesture handler
  const startPresentation = useCallback(() => {
    document.documentElement.requestFullscreen?.();
    setPresenting(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        startPresentation();
        return;
      }

      // Exit crop/trim/component edit mode on Escape or Enter
      if (e.key === "Escape" || e.key === "Enter") {
        const state = useDeckStore.getState();
        if (state.editingComponentId) {
          e.preventDefault();
          state.exitComponentEditMode();
          return;
        }
        if (state.cropElementId) {
          e.preventDefault();
          state.setCropElement(null);
          return;
        }
        if (state.trimElementId) {
          e.preventDefault();
          state.setTrimElement(null);
          return;
        }
      }

      // Skip remaining shortcuts if typing in an input
      if (isInput) return;

      // If user has selected text (e.g. in comments, labels), let browser handle copy/cut natively
      const textSelection = window.getSelection();
      const hasTextSelection = textSelection !== null && textSelection.toString().length > 0;

      // Copy: Ctrl+C — let browser handle if user has text selected
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyC") {
        if (hasTextSelection) return;
        const { deck, currentSlideIndex, selectedElementIds, selectedSlideIds } = useDeckStore.getState();
        if (deck) {
          const slide = deck.slides[currentSlideIndex];
          if (slide && selectedElementIds.length > 0) {
            // Copy selected elements
            const elements = selectedElementIds
              .map(id => slide.elements.find(el => el.id === id))
              .filter((el): el is SlideElement => el !== undefined);
            if (elements.length > 0) {
              setElementClipboard(JSON.parse(JSON.stringify(elements)));
              setSlideClipboard(null);
              // Collect referenced components for cross-instance paste
              const components: Record<string, SharedComponent> = {};
              for (const el of elements) {
                if (el.type === "reference" && deck.components) {
                  const compId = (el as ReferenceElement).componentId;
                  const comp = deck.components[compId];
                  if (comp) components[compId] = comp;
                }
              }
              // Write to system clipboard for cross-instance paste
              const clipData: Record<string, unknown> = { __tekkal: true, origin: window.location.origin, project: adapter.projectName, elements };
              if (Object.keys(components).length > 0) clipData.components = components;
              e.preventDefault();
              // Embed asset data URLs for adapters without HTTP serving (FsAccess, read-only)
              collectAssetDataUrls(elements, adapter).then((assetData) => {
                if (Object.keys(assetData).length > 0) clipData.assetData = assetData;
                navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
              }).catch(() => {
                navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
              });
            }
          } else if (slide) {
            // No elements selected → copy selected slides (or current slide)
            const slidesToCopy = selectedSlideIds.length > 1
              ? selectedSlideIds
                  .map(id => deck.slides.find(s => s.id === id))
                  .filter((s): s is import("@/types/deck").Slide => s !== undefined)
              : [slide];
            const slidesData: import("@/types/deck").Slide[] = JSON.parse(JSON.stringify(slidesToCopy));
            // Collect referenced components from all slides
            const components: Record<string, SharedComponent> = {};
            for (const s of slidesData) {
              for (const el of s.elements) {
                if (el.type === "reference" && deck.components) {
                  const compId = (el as ReferenceElement).componentId;
                  const comp = deck.components[compId];
                  if (comp) components[compId] = comp;
                }
              }
            }
            setSlideClipboard(slidesData);
            setElementClipboard(null);
            const clipData: Record<string, unknown> = { __tekkal: true, origin: window.location.origin, project: adapter.projectName, slides: slidesData };
            if (Object.keys(components).length > 0) clipData.components = components;
            e.preventDefault();
            // Embed asset data URLs
            const allElements = slidesData.flatMap(s => s.elements);
            const bgImages = slidesData.map(s => s.background?.image).filter((v): v is string => !!v);
            collectAssetDataUrls(allElements, adapter, bgImages).then((assetData) => {
              if (Object.keys(assetData).length > 0) clipData.assetData = assetData;
              navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
            }).catch(() => {
              navigator.clipboard.writeText(JSON.stringify(clipData)).catch(() => {});
            });
          }
        }
        return;
      }
      // Cut: Ctrl+X — let browser handle if user has text selected
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyX") {
        if (hasTextSelection) return;
        const { deck, currentSlideIndex, selectedElementIds, deleteElement } = useDeckStore.getState();
        if (deck && selectedElementIds.length > 0) {
          const slide = deck.slides[currentSlideIndex];
          if (slide) {
            const elements = selectedElementIds
              .map(id => slide.elements.find(el => el.id === id))
              .filter((el): el is SlideElement => el !== undefined);
            if (elements.length > 0) {
              const cloned = JSON.parse(JSON.stringify(elements));
              setElementClipboard(cloned);
              // Write to system clipboard so paste event can access it
              const cutData: Record<string, unknown> = { __tekkal: true, origin: window.location.origin, project: adapter.projectName, elements: cloned };
              collectAssetDataUrls(cloned, adapter).then((assetData) => {
                if (Object.keys(assetData).length > 0) cutData.assetData = assetData;
                navigator.clipboard.writeText(JSON.stringify(cutData)).catch(() => {});
              }).catch(() => {
                navigator.clipboard.writeText(JSON.stringify(cutData)).catch(() => {});
              });
              for (const elId of [...selectedElementIds]) {
                deleteElement(slide.id, elId);
              }
              e.preventDefault();
            }
          }
        }
        return;
      }
      // Paste: Ctrl+V — don't preventDefault, let paste event in EditorCanvas
      // handle everything (system clipboard takes priority over stale internal clipboard)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyV") {
        return;
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        performUndoRedo("undo");
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        performUndoRedo("redo");
        return;
      }
      // Group: Ctrl+G (merges into one flat group, replaces existing groups)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        const { deck, currentSlideIndex, selectedElementIds, groupElements } = useDeckStore.getState();
        if (deck && selectedElementIds.length >= 2) {
          const slide = deck.slides[currentSlideIndex];
          if (slide) {
            // Skip if all selected are already in the same single group
            const groupIds = new Set<string>();
            for (const id of selectedElementIds) {
              const el = slide.elements.find((el) => el.id === id);
              if (el?.groupId) groupIds.add(el.groupId);
            }
            const allSameGroup = groupIds.size === 1 &&
              selectedElementIds.every((id) => slide.elements.find((el) => el.id === id)?.groupId);
            if (!allSameGroup) groupElements(slide.id, selectedElementIds);
          }
        }
        return;
      }
      // Ungroup: Ctrl+Shift+G
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        const { deck, currentSlideIndex, selectedElementIds, ungroupElements } = useDeckStore.getState();
        if (deck && selectedElementIds.length > 0) {
          const slide = deck.slides[currentSlideIndex];
          if (slide) {
            const groupIds = new Set<string>();
            for (const id of selectedElementIds) {
              const el = slide.elements.find((el) => el.id === id);
              if (el?.groupId) groupIds.add(el.groupId);
            }
            for (const gid of groupIds) {
              ungroupElements(slide.id, gid);
            }
          }
        }
        return;
      }
      // Diff view: Ctrl+Shift+D
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        setShowDiff((v) => !v);
        return;
      }
      // Duplicate element(s): Ctrl+D
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        const { deck, currentSlideIndex, selectedElementIds, duplicateElement, selectElement } = useDeckStore.getState();
        if (deck && selectedElementIds.length > 0) {
          const slide = deck.slides[currentSlideIndex];
          if (slide) {
            const cloneIds: string[] = [];
            for (const elId of selectedElementIds) {
              duplicateElement(slide.id, elId);
              const lastIds = useDeckStore.getState().selectedElementIds;
              cloneIds.push(lastIds[lastIds.length - 1]!);
            }
            selectElement(cloneIds[0]!);
            for (let i = 1; i < cloneIds.length; i++) {
              selectElement(cloneIds[i]!, "add");
            }
          }
        }
        return;
      }
      // Delete selected element(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        const { deck, currentSlideIndex, selectedElementIds, deleteElement } = useDeckStore.getState();
        if (deck && selectedElementIds.length > 0) {
          const slide = deck.slides[currentSlideIndex];
          if (slide) {
            for (const elId of [...selectedElementIds]) {
              deleteElement(slide.id, elId);
            }
          }
        }
        return;
      }
      // Navigate slides with arrow keys when no element is selected
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const { selectedElementIds, prevSlide, nextSlide } = useDeckStore.getState();
        if (selectedElementIds.length === 0) {
          e.preventDefault();
          if (e.key === "ArrowUp") prevSlide();
          else nextSlide();
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleSave, startPresentation]);

  if (presenting) {
    return <PresentationMode onExit={() => setPresenting(false)} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-white">
      {/* Toolbar */}
      <div className="h-10 border-b border-zinc-800 flex items-center px-4 gap-4 shrink-0">
        <button
          onClick={() => {
            if (isReadOnly) {
              history.replaceState(null, "", window.location.pathname);
            } else {
              skipNextRestore();
            }
            useDeckStore.getState().closeProject();
          }}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Back to projects"
        >
          {isReadOnly ? "Back" : "Projects"}
        </button>
        {import.meta.env.DEV ? (
          <button
            onClick={() => setShowProjectSettings(true)}
            className="text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition-colors"
            title="Project settings"
          >
            {useDeckStore.getState().currentProject}
          </button>
        ) : (
          <span className="text-sm font-semibold text-zinc-300">
            {useDeckStore.getState().currentProject}
          </span>
        )}

        {/* Save status / Read-only badge */}
        {isReadOnly ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-600/20 text-amber-400 border border-amber-600/30">
            Read-Only
          </span>
        ) : (
          <span className="text-xs text-zinc-500">
            {isSaving ? "Saving..." : isDirty ? "Unsaved" : "Saved"}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => performUndoRedo("undo")}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={() => performUndoRedo("redo")}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>

        <div className="w-px h-5 bg-zinc-700" />

        <ElementPalette />

        {isReadOnly ? (
          <button
            onClick={() => {
              const params = new URLSearchParams(window.location.search);
              params.set("mode", "present");
              const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
              navigator.clipboard.writeText(shareUrl);
              setShareToast(true);
              setTimeout(() => setShareToast(false), 2000);
            }}
            className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors relative"
          >
            {shareToast ? "Copied!" : "Share"}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
          >
            Save
          </button>
        )}
        <button
          onClick={startPresentation}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Present (F5)
        </button>
        <div className="relative" ref={pdfMenuRef}>
          <button
            onClick={() => setPdfMenuOpen(!pdfMenuOpen)}
            className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            PDF ▾
          </button>
          {pdfMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50 min-w-[140px]">
              {([
                ["PDF (Image HD)", { scale: 4, format: "jpeg" as const, quality: 0.92 }],
                ["PDF (Image)", { scale: 2, format: "jpeg" as const, quality: 0.92 }],
              ] as const).map(([label, opts]) => (
                <button
                  key={label}
                  disabled={!!exportProgress}
                  onClick={() => {
                    setPdfMenuOpen(false);
                    const deck = useDeckStore.getState().deck;
                    if (!deck) return;
                    const onProgress = (c: number, t: number) => setExportProgress({ current: c, total: t, label });
                    setExportProgress({ current: 0, total: deck.slides.length, label });
                    exportToPdf(deck, adapter, { ...opts, onProgress }).finally(() => setExportProgress(null));
                  }}
                  className="w-full text-left text-xs px-3 py-2 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
              <button
                disabled={!!exportProgress}
                onClick={() => {
                  setPdfMenuOpen(false);
                  const deck = useDeckStore.getState().deck;
                  if (!deck) return;
                  const onProgress = (c: number, t: number) => setExportProgress({ current: c, total: t, label: "PDF (Native)" });
                  setExportProgress({ current: 0, total: deck.slides.length, label: "PDF (Native)" });
                  exportToNativePdf(deck, adapter, onProgress).finally(() => setExportProgress(null));
                }}
                className="w-full text-left text-xs px-3 py-2 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
              >
                PDF (Native)
              </button>
            </div>
          )}
        </div>
        <button
          disabled={!!exportProgress}
          onClick={() => {
            const deck = useDeckStore.getState().deck;
            if (!deck) return;
            const onProgress = (c: number, t: number) => setExportProgress({ current: c, total: t, label: "PPTX" });
            setExportProgress({ current: 0, total: deck.slides.length, label: "PPTX" });
            exportToPptx(deck, adapter, onProgress).finally(() => setExportProgress(null));
          }}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          PPTX
        </button>
        <button
          disabled={!!exportProgress}
          onClick={() => {
            const deck = useDeckStore.getState().deck;
            if (!deck) return;
            const onProgress = (c: number, t: number) => setExportProgress({ current: c, total: t, label: "Images (ZIP)" });
            setExportProgress({ current: 0, total: deck.slides.length, label: "Images (ZIP)" });
            exportSlidesToImages(deck, adapter, { scale: 2, format: "png", onProgress }).finally(() => setExportProgress(null));
          }}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          Images
        </button>
        {import.meta.env.DEV && (
          <button
            onClick={() => {
              if (!showDiff && !gitDiff.available) {
                if (gitDiff.unavailableReason === "no-path") {
                  setShowProjectSettings(true);
                }
                return;
              }
              setShowDiff(!showDiff);
            }}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showDiff
                ? "bg-green-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title={!gitDiff.available
              ? "Git history not available"
              : "Git Diff (Ctrl+Shift+D)"}
          >
            Diff
          </button>
        )}
        <AnimOrderToggle />
        <button
          onClick={() => setRightPanel(rightPanel === "theme" ? "properties" : "theme")}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            rightPanel === "theme"
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Theme
        </button>
        <button
          onClick={() => setBottomPanel(bottomPanel === "code" ? null : "code")}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            bottomPanel === "code"
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          JSON
        </button>
        <button
          onClick={() => setShowAi((v) => !v)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showAi
              ? "bg-purple-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          AI
        </button>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide list sidebar */}
        <div
          style={{ width: leftWidth, scrollbarGutter: "stable" }}
          className="overflow-y-auto shrink-0 border-r border-zinc-800"
        >
          <SlideList showDiff={showDiff} />
        </div>

        {/* Left resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/40 transition-colors"
          onMouseDown={(e) => startDrag("left", e)}
        />

        {/* Center: canvas + optional bottom panels */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorCanvas showDiff={showDiff} />

          {/* Notes drag handle */}
          {notesExpanded && (
            <div
              className="h-1 shrink-0 cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/40 transition-colors border-t border-zinc-800"
              onMouseDown={(e) => startDrag("notes", e)}
            />
          )}

          {/* Notes panel */}
          <div
            style={notesExpanded ? { height: notesHeight } : undefined}
            className={`shrink-0 ${notesExpanded ? "flex flex-col overflow-hidden" : "border-t border-zinc-800"}`}
          >
            <NotesEditor
              expanded={notesExpanded}
              onToggle={() => setNotesExpanded((v) => !v)}
              showDiff={showDiff}
            />
          </div>

          {/* Code drag handle */}
          {bottomPanel === "code" && (
            <div
              className="h-1 shrink-0 cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/40 transition-colors border-t border-zinc-800"
              onMouseDown={(e) => startDrag("code", e)}
            />
          )}

          {/* Code panel */}
          {bottomPanel === "code" && (
            <div style={{ height: codeHeight }} className="shrink-0 overflow-hidden">
              <CodePanel />
            </div>
          )}
        </div>

        {/* Right resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/40 transition-colors"
          onMouseDown={(e) => startDrag("right", e)}
        />

        {/* Right sidebar */}
        <div
          style={{ width: rightWidth }}
          className="flex flex-col shrink-0 border-l border-zinc-800"
        >
          {rightPanel === "theme" ? (
            <div className="flex-1 overflow-y-auto">
              <ThemePanel />
            </div>
          ) : (
            <>
              {/* Properties */}
              <div className="flex-1 overflow-y-auto border-b border-zinc-800">
                <PropertyPanelErrorBoundary
                  elementId={selectedElementId}
                  elementType={selectedElement?.type ?? null}
                >
                  <PropertyPanel />
                </PropertyPanelErrorBoundary>
              </div>
              {/* Element list */}
              <div className="h-[180px] shrink-0 overflow-y-auto border-b border-zinc-800">
                <ElementList
                  onSelectElement={(elementId) => {
                    useDeckStore.getState().selectElement(elementId);
                  }}
                />
              </div>
              {/* Animations */}
              <div className="flex-1 overflow-y-auto">
                <SlideAnimationList
                  onSelectElement={(elementId) => {
                    useDeckStore.getState().selectElement(elementId);
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* AI panel — independent, rightmost */}
        {showAi && (
          <>
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-purple-500/40 active:bg-purple-500/40 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = aiWidth;
                const onMove = (ev: MouseEvent) => setAiWidth(Math.max(200, Math.min(500, startW - (ev.clientX - startX))));
                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
            <div
              style={{ width: aiWidth }}
              className="flex flex-col shrink-0 border-l border-zinc-800 overflow-hidden"
            >
              <AiChatPanel />
            </div>
          </>
        )}
      </div>
      {exportProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl px-5 py-3 flex items-center gap-3 min-w-[280px]">
          <div className="flex-1">
            <div className="text-xs text-zinc-300 mb-1.5">
              {exportProgress.label} — {exportProgress.current}/{exportProgress.total} slides
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${exportProgress.total > 0 ? (exportProgress.current / exportProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
      {showProjectSettings && (
        <ProjectSettingsDialog
          projectName={useDeckStore.getState().currentProject ?? ""}
          onClose={() => setShowProjectSettings(false)}
          onPathSaved={() => {
            gitDiff.refetch();
            setShowDiff(true);
          }}
        />
      )}
    </div>
  );
}

function AnimOrderToggle() {
  const active = useDeckStore((s) => s.showAnimationOrder);
  return (
    <button
      onClick={() => useDeckStore.setState({ showAnimationOrder: !active })}
      className={`text-xs px-2 py-1 rounded transition-colors ${
        active ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
      title="Show animation order on canvas"
    >
      Anim#
    </button>
  );
}

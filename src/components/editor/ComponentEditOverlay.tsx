import { useEffect, useRef, useCallback, useState, memo } from "react";
import { useDeckStore, setDeckDragging } from "@/stores/deckStore";
import type { Slide, SlideElement, ReferenceElement } from "@/types/deck";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/types/deck";
import { computeBounds } from "@/utils/bounds";
import { ElementRenderer } from "@/components/renderer/ElementRenderer";
import { ThemeProvider } from "@/contexts/ThemeContext";

interface Props {
  componentId: string;
  slide: Slide;
  scale: number;
}

export function ComponentEditOverlay({ componentId, slide, scale }: Props) {
  const component = useDeckStore((s) => s.deck?.components?.[componentId]);
  const theme = useDeckStore((s) => s.deck?.theme);
  const exitComponentEditMode = useDeckStore((s) => s.exitComponentEditMode);
  const selectedElementIds = useDeckStore((s) => s.selectedElementIds);
  const selectElement = useDeckStore((s) => s.selectElement);
  const updateComponentElement = useDeckStore((s) => s.updateComponentElement);

  // Find the first reference to this component on the current slide for positioning
  const refEl = slide.elements.find(
    (el) => el.type === "reference" && (el as ReferenceElement).componentId === componentId,
  ) as ReferenceElement | undefined;

  // Freeze bounds at mount so dragging doesn't cause scale jumps
  const [frozenBounds] = useState(() => {
    const comp = useDeckStore.getState().deck?.components?.[componentId];
    return comp ? computeBounds(comp.elements) : { x: 0, y: 0, w: 0, h: 0 };
  });

  const offsetX = refEl?.position.x ?? 0;
  const offsetY = refEl?.position.y ?? 0;
  const scaleX = refEl && frozenBounds.w > 0 ? refEl.size.w / frozenBounds.w : 1;
  const scaleY = refEl && frozenBounds.h > 0 ? refEl.size.h / frozenBounds.h : 1;

  // Escape to exit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exitComponentEditMode();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [exitComponentEditMode]);

  if (!component) return null;

  // Compute the component area bounds (in canvas coordinates) for the cutout
  const compLeft = offsetX;
  const compTop = offsetY;
  const compW = refEl ? refEl.size.w : frozenBounds.w;
  const compH = refEl ? refEl.size.h : frozenBounds.h;

  // CSS clip-path to cut out the component area from the dim overlay
  const clipPath = `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${compLeft}px ${compTop}px,
    ${compLeft}px ${compTop + compH}px,
    ${compLeft + compW}px ${compTop + compH}px,
    ${compLeft + compW}px ${compTop}px,
    ${compLeft}px ${compTop}px
  )`;

  return (
    <>
      {/* Dim layer with cutout over component area */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          background: "rgba(0, 0, 0, 0.5)",
          clipPath,
          zIndex: 10,
        }}
      />
      {/* Component elements rendered at the reference position */}
      <div
        className="absolute"
        style={{
          left: 0,
          top: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          zIndex: 11,
          pointerEvents: "none",
        }}
      >
        <ThemeProvider theme={theme ?? {}}>
          {component.elements.map((child) => {
            const isSelected = selectedElementIds.includes(child.id);
            return (
              <ComponentElementBox
                key={child.id}
                element={child}
                offsetX={offsetX}
                offsetY={offsetY}
                originX={frozenBounds.x}
                originY={frozenBounds.y}
                scaleX={scaleX}
                scaleY={scaleY}
                isSelected={isSelected}
                scale={scale}
                onSelect={() => selectElement(child.id)}
                onMove={(dx, dy) => {
                  updateComponentElement(componentId, child.id, {
                    position: {
                      x: child.position.x + dx,
                      y: child.position.y + dy,
                    },
                  } as Partial<SlideElement>);
                }}
              />
            );
          })}
        </ThemeProvider>
      </div>
      {/* Banner */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20"
        style={{ top: 8 }}
      >
        <div className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-md shadow-lg flex items-center gap-3">
          <span>Editing Component: <strong>{component.name}</strong></span>
          <button
            onClick={exitComponentEditMode}
            className="bg-indigo-500 hover:bg-indigo-400 px-2 py-0.5 rounded text-xs transition-colors"
          >
            Done (Esc)
          </button>
        </div>
      </div>
    </>
  );
}

const ComponentElementBox = memo(function ComponentElementBox({
  element,
  offsetX,
  offsetY,
  originX,
  originY,
  scaleX,
  scaleY,
  isSelected,
  scale,
  onSelect,
  onMove,
}: {
  element: SlideElement;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  isSelected: boolean;
  scale: number;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const dragStart = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      setDeckDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ex: element.position.x,
        ey: element.position.y,
      };

      const prevent = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", prevent);
      let rafId = 0;
      let dragStarted = false;

      const handleMouseUp = () => {
        cancelAnimationFrame(rafId);
        setDeckDragging(false);
        dragStart.current = null;
        document.removeEventListener("selectstart", prevent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragStart.current) return;
        if (me.buttons === 0) { handleMouseUp(); return; }
        if (!dragStarted) {
          const rawDx = me.clientX - dragStart.current.x;
          const rawDy = me.clientY - dragStart.current.y;
          if (rawDx * rawDx + rawDy * rawDy < 64) return;
          dragStarted = true;
        }
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (!dragStart.current) return;
          // Divide by both canvas scale and component scale
          const dx = (me.clientX - dragStart.current.x) / scale / scaleX;
          const dy = (me.clientY - dragStart.current.y) / scale / scaleY;
          onMove(
            Math.round(dragStart.current.ex + dx - element.position.x),
            Math.round(dragStart.current.ey + dy - element.position.y),
          );
        });
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [element.position.x, element.position.y, scale, scaleX, scaleY, onSelect, onMove],
  );

  // Position the element at reference offset + scaled component-local position (minus origin)
  const left = offsetX + (element.position.x - originX) * scaleX;
  const top = offsetY + (element.position.y - originY) * scaleY;
  const width = element.size.w * scaleX;
  const height = element.size.h * scaleY;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        pointerEvents: "auto",
        cursor: "move",
        outline: isSelected ? "2px solid #6366f1" : "1px solid rgba(99,102,241,0.4)",
        outlineOffset: -1,
      }}
      onMouseDown={handleMouseDown}
    >
      <div style={{ width: element.size.w, height: element.size.h, transform: `scale(${scaleX}, ${scaleY})`, transformOrigin: "top left" }}>
        <ElementRenderer element={element} editorMode noPosition />
      </div>
    </div>
  );
});

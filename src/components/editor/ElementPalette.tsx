import { useState, useRef, useEffect } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { useAdapter } from "@/contexts/AdapterContext";
import { nextElementId } from "@/utils/id";
import type { SlideElement } from "@/types/deck";

const ELEMENT_PRESETS: { label: string; create: () => SlideElement }[] = [
  {
    label: "Text",
    create: () => ({
      id: nextElementId(),
      type: "text" as const,
      content: "New text",
      position: { x: 60, y: 200 },
      size: { w: 400, h: 100 },
      style: { fontSize: 24, color: "#ffffff" },
    }),
  },
  {
    label: "Code",
    create: () => ({
      id: nextElementId(),
      type: "code" as const,
      language: "typescript",
      content: "// your code here",
      position: { x: 60, y: 200 },
      size: { w: 500, h: 150 },
      style: { fontSize: 16, borderRadius: 8 },
    }),
  },
  {
    label: "Shape",
    create: () => ({
      id: nextElementId(),
      type: "shape" as const,
      shape: "rectangle" as const,
      position: { x: 200, y: 200 },
      size: { w: 200, h: 120 },
      style: { fill: "#3b82f6", borderRadius: 8 },
    }),
  },
  {
    label: "Image",
    create: () => ({
      id: nextElementId(),
      type: "image" as const,
      src: "",
      position: { x: 200, y: 150 },
      size: { w: 300, h: 200 },
      style: { objectFit: "contain" as const },
    }),
  },
  {
    label: "Video",
    create: () => ({
      id: nextElementId(),
      type: "video" as const,
      src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      position: { x: 200, y: 110 },
      size: { w: 560, h: 315 },
      controls: true,
      muted: true,
    }),
  },
  {
    label: "Table",
    create: () => ({
      id: nextElementId(),
      type: "table" as const,
      columns: ["Column 1", "Column 2", "Column 3"],
      rows: [
        ["Row 1", "Data", "Data"],
        ["Row 2", "Data", "Data"],
      ],
      position: { x: 100, y: 150 },
      size: { w: 500, h: 200 },
    }),
  },
  {
    label: "TikZ",
    create: () => ({
      id: nextElementId(),
      type: "tikz" as const,
      content: "\\begin{tikzpicture}\n  \\draw[thick, blue] (0,0) -- (3,2) -- (1,3) -- cycle;\n\\end{tikzpicture}",
      position: { x: 200, y: 100 },
      size: { w: 400, h: 300 },
    }),
  },
  {
    label: "Mermaid",
    create: () => ({
      id: nextElementId(),
      type: "mermaid" as const,
      content: "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Cancel]",
      position: { x: 200, y: 100 },
      size: { w: 400, h: 300 },
    }),
  },
  {
    label: "3D Scene",
    create: () => ({
      id: nextElementId(),
      type: "scene3d" as const,
      position: { x: 200, y: 50 },
      size: { w: 500, h: 400 },
      scene: {
        camera: { position: [5, 5, 5] as [number, number, number], fov: 50 },
        ambientLight: 0.5,
        directionalLight: { position: [5, 10, 5] as [number, number, number], intensity: 0.8 },
        objects: [
          { id: "box1", geometry: "box" as const, material: { color: "#3b82f6" } },
        ],
        orbitControls: true,
        helpers: { grid: true },
      },
    }),
  },
];

export function ElementPalette() {
  const [open, setOpen] = useState(false);
  const [customComponents, setCustomComponents] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const adapter = useAdapter();

  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const addElement = useDeckStore((s) => s.addElement);
  const selectElement = useDeckStore((s) => s.selectElement);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    adapter.listComponents().then(setCustomComponents);
  }, [open, adapter]);

  if (!deck) return null;
  const slide = deck.slides[currentSlideIndex];
  if (!slide) return null;

  const handleAdd = (preset: (typeof ELEMENT_PRESETS)[number]) => {
    const element = preset.create();
    addElement(slide.id, element);
    selectElement(element.id);
    setOpen(false);
  };

  const handleAddCustom = (componentName: string) => {
    const element: SlideElement = {
      id: nextElementId(),
      type: "custom" as const,
      component: componentName,
      props: {},
      position: { x: 200, y: 150 },
      size: { w: 300, h: 200 },
    };
    addElement(slide.id, element);
    selectElement(element.id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs px-2 py-1 rounded transition-colors ${
          open ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        + Element
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50 py-1 min-w-[120px]">
          {ELEMENT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleAdd(preset)}
              className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              {preset.label}
            </button>
          ))}
          {customComponents.length > 0 && (
            <>
              <div className="border-t border-zinc-700 my-1" />
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider">Custom</div>
              {customComponents.map((name) => (
                <button
                  key={name}
                  onClick={() => handleAddCustom(name)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-purple-300 hover:bg-zinc-700 transition-colors"
                >
                  {name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

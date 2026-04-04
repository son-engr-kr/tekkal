import { useState, useEffect, useRef, useCallback } from "react";
import { useDeckStore } from "@/stores/deckStore";
import type { Slide, SlideElement, TikZElement, MermaidElement, TableElement, CustomElement, Scene3DElement, ImageElement, VideoElement, ShapeElement, CropRect, DeckTheme, ReferenceElement } from "@/types/deck";
import { resolveStyle } from "@/contexts/ThemeContext";
import { computeBounds } from "@/utils/bounds";
import { useAdapter } from "@/contexts/AdapterContext";
import { AnimationEditor } from "./AnimationEditor";
import { CommentList } from "./CommentList";
import {
  ColorField,
  NumberField,
  SelectField,
  TextField,
  FieldLabel,
  CODE_THEMES,
  OBJECT_FIT_OPTIONS,
  TEXT_ALIGN_OPTIONS,
  VERTICAL_ALIGN_OPTIONS,
  TEXT_SIZING_OPTIONS,
} from "./fields";

export function PropertyPanel() {
  const slide = useDeckStore((s) => s.deck?.slides[s.currentSlideIndex]);
  const slides = useDeckStore((s) => s.deck?.slides);
  const theme = useDeckStore((s) => s.deck?.theme);
  const selectedSlideIds = useDeckStore((s) => s.selectedSlideIds);
  const selectedElementIds = useDeckStore((s) => s.selectedElementIds);
  const updateElement = useDeckStore((s) => s.updateElement);
  const updateSlide = useDeckStore((s) => s.updateSlide);

  if (!slides) return null;

  if (selectedElementIds.length === 0) {
    return (
      <SlidePropertiesPanel
        slides={slides}
        theme={theme}
        selectedSlideIds={selectedSlideIds}
        updateSlide={updateSlide}
      />
    );
  }

  if (selectedElementIds.length > 1) {
    return (
      <MultiElementPanel
        slide={slide!}
        selectedElementIds={selectedElementIds}
        updateElement={updateElement}
        theme={theme}
      />
    );
  }

  if (!slide) return null;
  const element = slide.elements.find((e) => e.id === selectedElementIds[0]);
  if (!element) return null;

  const handleNumberChange = (
    path: "position.x" | "position.y" | "size.w" | "size.h",
    value: string,
  ) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;

    const [group, field] = path.split(".") as ["position" | "size", string];
    const updated = { [group]: { ...element[group], [field]: num } };
    updateElement(slide.id, element.id, updated as Partial<SlideElement>);
  };

  return (
    <div className="p-3 space-y-4 text-sm overflow-y-auto overflow-x-hidden">
      {/* Element info */}
      <div>
        <FieldLabel>Element</FieldLabel>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-300 font-mono text-xs">
            {element.type} / {element.id}
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(element.id);
            }}
            className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors shrink-0"
            title="Copy element ID"
          >
            ID
          </button>
        </div>
      </div>

      {/* Position */}
      <div>
        <FieldLabel>Position</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={element.position.x} onChange={(v) => handleNumberChange("position.x", v)} />
          <NumberInput label="Y" value={element.position.y} onChange={(v) => handleNumberChange("position.y", v)} />
        </div>
      </div>

      {/* Size */}
      <div>
        <FieldLabel>Size</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="W" value={element.size.w} onChange={(v) => handleNumberChange("size.w", v)} />
          <NumberInput label="H" value={element.size.h} onChange={(v) => handleNumberChange("size.h", v)} />
        </div>
        {(element.type === "image" || element.type === "video") && (
          <button
            className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Reset element height to match the original aspect ratio"
            onClick={() => {
              const src = (element as ImageElement | VideoElement).src;
              if (element.type === "image") {
                const imgs = document.querySelectorAll<HTMLImageElement>(`img[src]`);
                for (const img of imgs) {
                  if (img.naturalWidth > 0 && img.src.includes(src)) {
                    const ratio = img.naturalWidth / img.naturalHeight;
                    const newH = Math.round(element.size.w / ratio);
                    updateElement(slide.id, element.id, { size: { w: element.size.w, h: newH } } as Partial<SlideElement>);
                    return;
                  }
                }
              } else if (element.type === "video") {
                const videos = document.querySelectorAll<HTMLVideoElement>(`video[src]`);
                for (const vid of videos) {
                  if (vid.videoWidth > 0 && vid.src.includes(src)) {
                    const ratio = vid.videoWidth / vid.videoHeight;
                    const newH = Math.round(element.size.w / ratio);
                    updateElement(slide.id, element.id, { size: { w: element.size.w, h: newH } } as Partial<SlideElement>);
                    return;
                  }
                }
              }
            }}
          >
            ↺ Reset ratio
          </button>
        )}
      </div>

      {/* Content (for text/code — not tikz/mermaid, which have their own editors) */}
      {"content" in element && element.type !== "tikz" && element.type !== "mermaid" && (
        <div>
          <FieldLabel>Content</FieldLabel>
          <textarea
            className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-20 border border-zinc-700 focus:border-blue-500 focus:outline-none"
            value={element.content}
            rows={5}
            onChange={(e) => {
              updateElement(slide.id, element.id, { content: e.target.value } as Partial<SlideElement>);
            }}
          />
        </div>
      )}

      {/* TikZ editor */}
      {element.type === "tikz" && (
        <TikZEditor
          element={element}
          slideId={slide.id}
          updateElement={updateElement}
        />
      )}

      {/* Mermaid editor */}
      {element.type === "mermaid" && (
        <MermaidEditor
          element={element}
          slideId={slide.id}
          updateElement={updateElement}
        />
      )}

      {/* Custom component properties */}
      {element.type === "custom" && (
        <CustomPropsEditor
          element={element}
          slideId={slide.id}
          updateElement={updateElement}
        />
      )}

      {/* Table properties */}
      {element.type === "table" && (
        <TableDataEditor
          element={element}
          slideId={slide.id}
          updateElement={updateElement}
        />
      )}

      {/* Scene3D properties */}
      {element.type === "scene3d" && (
        <Scene3DEditor
          element={element}
          slideId={slide.id}
          updateElement={updateElement}
        />
      )}

      {/* Reference (shared component) properties */}
      {element.type === "reference" && (
        <ReferenceProperties element={element as ReferenceElement} slides={slides!} />
      )}

      {/* Video properties */}
      {element.type === "video" && (
        <>
          <div>
            <FieldLabel>Video URL</FieldLabel>
            <input
              type="text"
              className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs font-mono border border-zinc-700 focus:border-blue-500 focus:outline-none"
              value={element.src}
              onChange={(e) => {
                updateElement(slide.id, element.id, { src: e.target.value } as Partial<SlideElement>);
              }}
            />
          </div>
          <TextField label="Alt Text" value={element.alt} onChange={(v) => updateElement(slide.id, element.id, { alt: v } as Partial<SlideElement>)} placeholder="Describe the video" />
          <div>
            <FieldLabel>Options</FieldLabel>
            <div className="space-y-1">
              {(["autoplay", "loop", "muted", "controls"] as const).map((prop) => (
                <label key={prop} className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={!!element[prop]}
                    onChange={(e) => {
                      updateElement(slide.id, element.id, { [prop]: e.target.checked } as Partial<SlideElement>);
                    }}
                    className="rounded border-zinc-600"
                  />
                  {prop}
                </label>
              ))}
            </div>
          </div>
          <TrimActions element={element} slideId={slide.id} />
        </>
      )}

      {/* Crop (image/video only) */}
      {(element.type === "image" || element.type === "video") && (
        <CropActions element={element} slideId={slide.id} />
      )}

      {/* Style */}
      <ElementStyleEditor
        element={element}
        slideId={slide.id}
        updateElement={updateElement}
        theme={theme}
      />

      {/* Animations */}
      <AnimationEditor
        slideId={slide.id}
        elementId={element.id}
        animations={slide.animations ?? []}
      />

      {/* Comments */}
      <CommentList slideId={slide.id} elementId={element.id} />
    </div>
  );
}

// -- Helpers for multi-element editing --

/** Get a property value from multiple elements. Returns { value, mixed }. */
function multiVal<T>(elements: SlideElement[], getter: (el: SlideElement) => T | undefined): { value: T | undefined; mixed: boolean } {
  const values = elements.map(getter);
  const first = values[0];
  const allSame = values.every((v) => v === first);
  return { value: allSame ? first : undefined, mixed: !allSame };
}

function multiStyleVal<T>(elements: SlideElement[], prop: string): { value: T | undefined; mixed: boolean } {
  return multiVal(elements, (el) => {
    const style = "style" in el ? (el.style as Record<string, unknown> | undefined) : undefined;
    return style?.[prop] as T | undefined;
  });
}

// -- Group bounding-box position/size --

function GroupTransformFields({
  elements,
  slideId,
  updateElement,
}: {
  elements: SlideElement[];
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const bounds = computeBounds(elements);

  const moveGroup = (axis: "x" | "y", target: number) => {
    const delta = target - bounds[axis];
    for (const el of elements) {
      updateElement(slideId, el.id, {
        position: {
          ...el.position,
          [axis]: el.position[axis] + delta,
        },
      } as Partial<SlideElement>);
    }
  };

  const resizeGroup = (dim: "w" | "h", target: number) => {
    if (bounds[dim] === 0) return;
    const scale = target / bounds[dim];
    const origin = dim === "w" ? bounds.x : bounds.y;
    const posAxis = dim === "w" ? "x" : "y";
    const sizeAxis = dim;
    for (const el of elements) {
      updateElement(slideId, el.id, {
        position: {
          ...el.position,
          [posAxis]: Math.round(origin + (el.position[posAxis] - origin) * scale),
        },
        size: {
          ...el.size,
          [sizeAxis]: Math.round(el.size[sizeAxis] * scale),
        },
      } as Partial<SlideElement>);
    }
  };

  return (
    <>
      <div>
        <FieldLabel>Position</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={Math.round(bounds.x)} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) moveGroup("x", num);
          }} />
          <NumberInput label="Y" value={Math.round(bounds.y)} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) moveGroup("y", num);
          }} />
        </div>
      </div>
      <div>
        <FieldLabel>Size</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="W" value={Math.round(bounds.w)} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num) && num > 0) resizeGroup("w", num);
          }} />
          <NumberInput label="H" value={Math.round(bounds.h)} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num) && num > 0) resizeGroup("h", num);
          }} />
        </div>
      </div>
    </>
  );
}

// -- Loose multi-select position/size/rotation --

function LooseTransformFields({
  elements,
  slideId,
  updateElement,
  patchAll,
}: {
  elements: SlideElement[];
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
  patchAll: (patch: Partial<SlideElement>) => void;
}) {
  const px = multiVal(elements, (el) => el.position.x);
  const py = multiVal(elements, (el) => el.position.y);
  const sw = multiVal(elements, (el) => el.size.w);
  const sh = multiVal(elements, (el) => el.size.h);
  const rot = multiVal(elements, (el) => el.rotation ?? 0);

  return (
    <>
      <div>
        <FieldLabel>Position</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={px.value ?? 0} mixed={px.mixed} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) for (const el of elements) updateElement(slideId, el.id, { position: { ...el.position, x: num } } as Partial<SlideElement>);
          }} />
          <NumberInput label="Y" value={py.value ?? 0} mixed={py.mixed} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) for (const el of elements) updateElement(slideId, el.id, { position: { ...el.position, y: num } } as Partial<SlideElement>);
          }} />
        </div>
      </div>
      <div>
        <FieldLabel>Size</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="W" value={sw.value ?? 0} mixed={sw.mixed} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) for (const el of elements) updateElement(slideId, el.id, { size: { ...el.size, w: num } } as Partial<SlideElement>);
          }} />
          <NumberInput label="H" value={sh.value ?? 0} mixed={sh.mixed} onChange={(v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num)) for (const el of elements) updateElement(slideId, el.id, { size: { ...el.size, h: num } } as Partial<SlideElement>);
          }} />
        </div>
      </div>
      <div>
        <FieldLabel>Rotation</FieldLabel>
        <NumberField label="Angle" value={rot.value} mixed={rot.mixed} onChange={(v) => patchAll({ rotation: v } as Partial<SlideElement>)} min={-360} max={360} />
      </div>
    </>
  );
}

// -- Multi-element panel --

function MultiElementPanel({
  slide,
  selectedElementIds,
  updateElement,
  theme,
}: {
  slide: Slide;
  selectedElementIds: string[];
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
  theme?: DeckTheme;
}) {
  const selectedElements = slide.elements.filter((e) => selectedElementIds.includes(e.id));
  const groupIds = new Set(selectedElements.map((e) => e.groupId).filter(Boolean));
  const isGroup = groupIds.size === 1 && selectedElements.every((e) => e.groupId);
  const groupId = isGroup ? [...groupIds][0] : undefined;

  // Determine common type(s)
  const types = new Set(selectedElements.map((e) => e.type));
  const singleType = types.size === 1 ? [...types][0]! : null;

  // Type counts for info display
  const typeCounts = new Map<string, number>();
  for (const el of selectedElements) {
    typeCounts.set(el.type, (typeCounts.get(el.type) ?? 0) + 1);
  }

  const patchAll = (patch: Partial<SlideElement>) => {
    for (const el of selectedElements) {
      updateElement(slide.id, el.id, patch);
    }
  };

  const patchAllStyle = (prop: string, value: unknown) => {
    for (const el of selectedElements) {
      const style = "style" in el ? el.style : undefined;
      updateElement(slide.id, el.id, {
        style: { ...style, [prop]: value },
      } as Partial<SlideElement>);
    }
  };

  return (
    <div className="p-3 space-y-4 text-sm overflow-y-auto overflow-x-hidden">
      {/* Selection info */}
      <div>
        <FieldLabel>Selection</FieldLabel>
        <div className="text-zinc-300 text-xs">
          {selectedElements.length} elements
          {isGroup && <span className="text-purple-400 ml-1">(group)</span>}
        </div>
        <div className="text-zinc-500 text-[10px] font-mono mt-0.5">
          {[...typeCounts.entries()].map(([t, c]) => `${t}${c > 1 ? ` ×${c}` : ""}`).join(", ")}
        </div>
        {groupId && (
          <div className="text-zinc-600 text-[10px] font-mono mt-0.5">{groupId}</div>
        )}
      </div>

      {/* Position & Size — group: bounding box; loose multi-select: per-element mixed */}
      {isGroup ? (
        <GroupTransformFields elements={selectedElements} slideId={slide.id} updateElement={updateElement} />
      ) : (
        <LooseTransformFields elements={selectedElements} slideId={slide.id} updateElement={updateElement} patchAll={patchAll} />
      )}

      {/* Type-specific style editing */}
      {singleType && singleType !== "custom" && singleType !== "scene3d" && singleType !== "reference" && (
        <div>
          <FieldLabel>Style</FieldLabel>
          <div className="space-y-2">
            {singleType === "text" && (
              <MultiTextStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} theme={theme} />
            )}
            {singleType === "code" && (
              <MultiCodeStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} />
            )}
            {singleType === "shape" && (
              <MultiShapeStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} theme={theme} />
            )}
            {singleType === "image" && (
              <MultiImageStyleFields elements={selectedElements} patchAll={patchAll} patchAllStyle={patchAllStyle} />
            )}
            {singleType === "video" && (
              <MultiVideoStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} />
            )}
            {singleType === "tikz" && (
              <MultiTikZStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} />
            )}
            {singleType === "mermaid" && (
              <MultiMermaidStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} />
            )}
            {singleType === "table" && (
              <MultiTableStyleFields elements={selectedElements} patchAllStyle={patchAllStyle} />
            )}
          </div>
        </div>
      )}

      {/* Comments (group or multi-select) */}
      {isGroup && <CommentList slideId={slide.id} elementId={selectedElements[0]?.id} />}
    </div>
  );
}

// -- Multi-element style field sets --

function MultiTextStyleFields({ elements, patchAllStyle, theme }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void; theme?: DeckTheme }) {
  const color = multiStyleVal<string>(elements, "color");
  const fontFamily = multiStyleVal<string>(elements, "fontFamily");
  const fontSize = multiStyleVal<number>(elements, "fontSize");
  const textSizing = multiStyleVal<string>(elements, "textSizing");
  const textAlign = multiStyleVal<string>(elements, "textAlign");
  const lineHeight = multiStyleVal<number>(elements, "lineHeight");
  const verticalAlign = multiStyleVal<string>(elements, "verticalAlign");

  // For inherited color display
  const themeColor = theme?.text?.color;
  const effectiveColor = color.mixed ? undefined : (color.value ?? themeColor);
  const colorInherited = !color.mixed && color.value === undefined && themeColor !== undefined;

  return (
    <>
      <ColorField label="Color" value={effectiveColor} mixed={color.mixed} inherited={colorInherited} onChange={(v) => patchAllStyle("color", v)} />
      <TextField label="Font Family" value={fontFamily.mixed ? undefined : fontFamily.value} onChange={(v) => patchAllStyle("fontFamily", v)} placeholder={fontFamily.mixed ? "\u2014" : "sans-serif"} />
      <NumberField label="Font Size" value={fontSize.value} mixed={fontSize.mixed} onChange={(v) => patchAllStyle("fontSize", v)} min={8} max={200} />
      <SelectField label="Text Sizing" value={(textSizing.mixed ? undefined : textSizing.value) as "flexible" | "fixed" | undefined} options={TEXT_SIZING_OPTIONS} mixed={textSizing.mixed} onChange={(v) => patchAllStyle("textSizing", v)} />
      <SelectField label="Text Align" value={(textAlign.mixed ? undefined : textAlign.value) as "left" | "center" | "right" | undefined} options={TEXT_ALIGN_OPTIONS} mixed={textAlign.mixed} onChange={(v) => patchAllStyle("textAlign", v)} />
      <NumberField label="Line Height" value={lineHeight.value} mixed={lineHeight.mixed} onChange={(v) => patchAllStyle("lineHeight", v)} min={0.5} max={4} step={0.1} />
      <SelectField label="Vertical Align" value={(verticalAlign.mixed ? undefined : verticalAlign.value) as "top" | "middle" | "bottom" | undefined} options={VERTICAL_ALIGN_OPTIONS} mixed={verticalAlign.mixed} onChange={(v) => patchAllStyle("verticalAlign", v)} />
    </>
  );
}

function MultiCodeStyleFields({ elements, patchAllStyle }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void }) {
  const codeTheme = multiStyleVal<string>(elements, "theme");
  const fontSize = multiStyleVal<number>(elements, "fontSize");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  return (
    <>
      <SelectField label="Theme" value={(codeTheme.mixed ? undefined : codeTheme.value) as typeof CODE_THEMES[number] | undefined} options={CODE_THEMES} mixed={codeTheme.mixed} onChange={(v) => patchAllStyle("theme", v)} />
      <NumberField label="Font Size" value={fontSize.value} mixed={fontSize.mixed} onChange={(v) => patchAllStyle("fontSize", v)} min={8} max={48} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={32} />
    </>
  );
}

function MultiShapeStyleFields({ elements, patchAllStyle, theme }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void; theme?: DeckTheme }) {
  const fill = multiStyleVal<string>(elements, "fill");
  const fillOpacity = multiStyleVal<number>(elements, "fillOpacity");
  const stroke = multiStyleVal<string>(elements, "stroke");
  const strokeOpacity = multiStyleVal<number>(elements, "strokeOpacity");
  const strokeWidth = multiStyleVal<number>(elements, "strokeWidth");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");

  const themeFill = theme?.shape?.fill;
  const themeStroke = theme?.shape?.stroke;

  return (
    <>
      <ColorField label="Fill" value={fill.mixed ? undefined : (fill.value ?? themeFill)} mixed={fill.mixed} inherited={!fill.mixed && fill.value === undefined && themeFill !== undefined} onChange={(v) => patchAllStyle("fill", v)} />
      <NumberField label="Fill Opacity" value={fillOpacity.value} mixed={fillOpacity.mixed} onChange={(v) => patchAllStyle("fillOpacity", v)} min={0} max={1} step={0.05} />
      <ColorField label="Stroke" value={stroke.mixed ? undefined : (stroke.value ?? themeStroke)} mixed={stroke.mixed} inherited={!stroke.mixed && stroke.value === undefined && themeStroke !== undefined} onChange={(v) => patchAllStyle("stroke", v)} />
      <NumberField label="Stroke Opacity" value={strokeOpacity.value} mixed={strokeOpacity.mixed} onChange={(v) => patchAllStyle("strokeOpacity", v)} min={0} max={1} step={0.05} />
      <NumberField label="Stroke Width" value={strokeWidth.value} mixed={strokeWidth.mixed} onChange={(v) => patchAllStyle("strokeWidth", v)} min={0} max={20} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={100} />
    </>
  );
}

function MultiImageStyleFields({ elements, patchAll, patchAllStyle }: { elements: SlideElement[]; patchAll: (p: Partial<SlideElement>) => void; patchAllStyle: (p: string, v: unknown) => void }) {
  const objectFit = multiStyleVal<string>(elements, "objectFit");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  const opacity = multiStyleVal<number>(elements, "opacity");
  const alt = multiVal(elements, (el) => (el as ImageElement).alt);
  return (
    <>
      <TextField label="Alt Text" value={alt.mixed ? undefined : alt.value} onChange={(v) => patchAll({ alt: v } as Partial<SlideElement>)} placeholder={alt.mixed ? "\u2014" : "Describe the image"} />
      <SelectField label="Object Fit" value={(objectFit.mixed ? undefined : objectFit.value) as "contain" | "cover" | "fill" | undefined} options={OBJECT_FIT_OPTIONS} mixed={objectFit.mixed} onChange={(v) => patchAllStyle("objectFit", v)} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={100} />
      <NumberField label="Opacity" value={opacity.value} mixed={opacity.mixed} onChange={(v) => patchAllStyle("opacity", v)} min={0} max={1} step={0.05} />
    </>
  );
}

function MultiVideoStyleFields({ elements, patchAllStyle }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void }) {
  const objectFit = multiStyleVal<string>(elements, "objectFit");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  return (
    <>
      <SelectField label="Object Fit" value={(objectFit.mixed ? undefined : objectFit.value) as "contain" | "cover" | "fill" | undefined} options={OBJECT_FIT_OPTIONS} mixed={objectFit.mixed} onChange={(v) => patchAllStyle("objectFit", v)} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={100} />
    </>
  );
}

function MultiTikZStyleFields({ elements, patchAllStyle }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void }) {
  const backgroundColor = multiStyleVal<string>(elements, "backgroundColor");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  return (
    <>
      <ColorField label="Background" value={backgroundColor.mixed ? undefined : backgroundColor.value} mixed={backgroundColor.mixed} onChange={(v) => patchAllStyle("backgroundColor", v)} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={32} />
    </>
  );
}

function MultiMermaidStyleFields({ elements, patchAllStyle }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void }) {
  const backgroundColor = multiStyleVal<string>(elements, "backgroundColor");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  return (
    <>
      <ColorField label="Background" value={backgroundColor.mixed ? undefined : backgroundColor.value} mixed={backgroundColor.mixed} onChange={(v) => patchAllStyle("backgroundColor", v)} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={32} />
    </>
  );
}

function MultiTableStyleFields({ elements, patchAllStyle }: { elements: SlideElement[]; patchAllStyle: (p: string, v: unknown) => void }) {
  const fontSize = multiStyleVal<number>(elements, "fontSize");
  const color = multiStyleVal<string>(elements, "color");
  const headerBackground = multiStyleVal<string>(elements, "headerBackground");
  const headerColor = multiStyleVal<string>(elements, "headerColor");
  const borderColor = multiStyleVal<string>(elements, "borderColor");
  const borderRadius = multiStyleVal<number>(elements, "borderRadius");
  return (
    <>
      <NumberField label="Font Size" value={fontSize.value} mixed={fontSize.mixed} onChange={(v) => patchAllStyle("fontSize", v)} min={8} max={48} />
      <ColorField label="Color" value={color.mixed ? undefined : color.value} mixed={color.mixed} onChange={(v) => patchAllStyle("color", v)} />
      <ColorField label="Header BG" value={headerBackground.mixed ? undefined : headerBackground.value} mixed={headerBackground.mixed} onChange={(v) => patchAllStyle("headerBackground", v)} />
      <ColorField label="Header Color" value={headerColor.mixed ? undefined : headerColor.value} mixed={headerColor.mixed} onChange={(v) => patchAllStyle("headerColor", v)} />
      <ColorField label="Border Color" value={borderColor.mixed ? undefined : borderColor.value} mixed={borderColor.mixed} onChange={(v) => patchAllStyle("borderColor", v)} />
      <NumberField label="Border Radius" value={borderRadius.value} mixed={borderRadius.mixed} onChange={(v) => patchAllStyle("borderRadius", v)} min={0} max={32} />
    </>
  );
}

function ReferenceProperties({ element, slides }: { element: ReferenceElement; slides: Slide[] }) {
  const component = useDeckStore((s) => s.deck?.components?.[element.componentId]);
  const renameComponent = useDeckStore((s) => s.renameComponent);
  const enterComponentEditMode = useDeckStore((s) => s.enterComponentEditMode);

  // Count how many slides reference this component
  const refCount = slides.reduce((count, slide) => {
    return count + slide.elements.filter(
      (el) => el.type === "reference" && (el as ReferenceElement).componentId === element.componentId,
    ).length;
  }, 0);

  if (!component) {
    return (
      <div>
        <FieldLabel>Component</FieldLabel>
        <div className="text-red-400 text-xs">Missing component: {element.componentId}</div>
      </div>
    );
  }

  return (
    <>
      <div>
        <FieldLabel>Component Name</FieldLabel>
        <input
          type="text"
          className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={component.name}
          onChange={(e) => renameComponent(element.componentId, e.target.value)}
        />
      </div>
      <div>
        <FieldLabel>References</FieldLabel>
        <div className="text-zinc-300 text-xs">
          Referenced in {refCount} place{refCount !== 1 ? "s" : ""}
        </div>
      </div>
      <div>
        <FieldLabel>Component ID</FieldLabel>
        <div className="text-zinc-500 text-xs font-mono select-all">{element.componentId}</div>
      </div>
      <button
        onClick={() => enterComponentEditMode(element.componentId)}
        className="w-full text-xs px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
      >
        Edit Component
      </button>
    </>
  );
}

function SlidePropertiesPanel({
  slides,
  theme,
  selectedSlideIds,
  updateSlide,
}: {
  slides: Slide[];
  theme?: import("@/types/deck").DeckTheme;
  selectedSlideIds: string[];
  updateSlide: (slideId: string, patch: Partial<Slide>) => void;
}) {
  const selectedSlides = selectedSlideIds
    .map((id) => slides.find((s) => s.id === id))
    .filter((s): s is Slide => s !== undefined);

  if (selectedSlides.length === 0) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        Select a slide to edit its properties
      </div>
    );
  }

  // Compute common background color across all selected slides
  const bgColors = selectedSlides.map((s) => s.background?.color);
  const allSame = bgColors.every((c) => c === bgColors[0]);
  const isMixed = !allSame;
  const commonBgColor = allSame ? bgColors[0] : undefined;
  const themeBgColor = theme?.slide?.background?.color;

  // Check if any selected slide has a per-slide override
  const hasOverride = selectedSlides.some((s) => s.background?.color !== undefined);
  // All selected slides are using the theme default (no per-slide color set)
  const allInherited = !isMixed && commonBgColor === undefined && themeBgColor !== undefined;

  return (
    <div className="p-3 space-y-4 text-sm overflow-y-auto overflow-x-hidden">
      <div>
        <FieldLabel>Slide</FieldLabel>
        <div className="text-zinc-300 font-mono">
          {selectedSlides.length === 1
            ? selectedSlides[0]!.id
            : `${selectedSlides.length} slides selected`}
        </div>
      </div>

      <div>
        <FieldLabel>Background</FieldLabel>
        <div className="space-y-2">
          <ColorField
            label="Color"
            value={commonBgColor ?? themeBgColor}
            mixed={isMixed}
            inherited={allInherited}
            onChange={(v) => {
              for (const slide of selectedSlides) {
                updateSlide(slide.id, {
                  background: { ...slide.background, color: v },
                });
              }
            }}
          />
          {hasOverride && (
            <button
              onClick={() => {
                for (const slide of selectedSlides) {
                  const bg = { ...slide.background };
                  delete bg.color;
                  // If background object is now empty, remove it entirely
                  const hasKeys = Object.keys(bg).length > 0;
                  updateSlide(slide.id, { background: hasKeys ? bg : undefined });
                }
              }}
              className="w-full px-3 py-1.5 text-xs font-medium rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              Use theme default
            </button>
          )}
        </div>
      </div>

      {/* Transition */}
      <div>
        <FieldLabel>Transition</FieldLabel>
        <div className="space-y-2">
          <SelectField
            label="Type"
            value={selectedSlides.length === 1 ? (selectedSlides[0]!.transition?.type ?? "fade") : undefined}
            options={TRANSITION_TYPE_OPTIONS}
            onChange={(v) => {
              for (const slide of selectedSlides) {
                updateSlide(slide.id, {
                  transition: { ...slide.transition, type: v },
                });
              }
            }}
          />
          <NumberField
            label="Duration (ms)"
            value={selectedSlides.length === 1 ? (selectedSlides[0]!.transition?.duration ?? 300) : undefined}
            onChange={(v) => {
              for (const slide of selectedSlides) {
                updateSlide(slide.id, {
                  transition: { ...slide.transition, type: slide.transition?.type ?? "fade", duration: v },
                });
              }
            }}
            min={0}
            max={3000}
          />
        </div>
      </div>

      {/* Bookmark */}
      {selectedSlides.length === 1 && (() => {
        const s = selectedSlides[0]!;
        const isBookmarked = !!s.bookmark;
        return (
          <div>
            <FieldLabel>Bookmark</FieldLabel>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={isBookmarked}
                  onChange={(e) => {
                    updateSlide(s.id, { bookmark: e.target.checked ? (s.bookmark || `Slide ${s.id}`) : undefined } as Partial<Slide>);
                  }}
                  className="rounded border-zinc-600"
                />
                Bookmarked
              </label>
              {isBookmarked && (
                <input
                  type="text"
                  className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-blue-500 focus:outline-none"
                  value={s.bookmark ?? ""}
                  placeholder="Bookmark title"
                  onChange={(e) => updateSlide(s.id, { bookmark: e.target.value || undefined } as Partial<Slide>)}
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* Comments (all comments on this slide) */}
      {selectedSlides.length === 1 && (
        <CommentList slideId={selectedSlides[0]!.id} />
      )}

    </div>
  );
}

const TRANSITION_TYPE_OPTIONS = ["fade", "slide", "morph", "none"] as const;
const MARKER_OPTIONS = ["none", "arrow", "circle"] as const;

function ElementStyleEditor({
  element,
  slideId,
  updateElement,
  theme,
}: {
  element: SlideElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
  theme?: DeckTheme;
}) {
  if (element.type === "custom" || element.type === "scene3d" || element.type === "reference") return null;

  const patchStyle = (prop: string, value: unknown) => {
    updateElement(slideId, element.id, {
      style: { ...element.style, [prop]: value },
    } as Partial<SlideElement>);
  };

  // Merge theme + element style so color pickers show the effective value
  const themeKey = element.type as keyof DeckTheme;
  const merged = resolveStyle(theme?.[themeKey] as Record<string, unknown> | undefined, element.style as Record<string, unknown> | undefined);
  const isInherited = (prop: string) => element.style?.[prop as keyof typeof element.style] === undefined && merged[prop] !== undefined;

  return (
    <div>
      <FieldLabel>Style</FieldLabel>
      <div className="space-y-2">
        {element.type === "text" && (
          <>
            <ColorField label="Color" value={merged.color as string | undefined} inherited={isInherited("color")} onChange={(v) => patchStyle("color", v)} />
            <TextField label="Font Family" value={element.style?.fontFamily} onChange={(v) => patchStyle("fontFamily", v)} placeholder="sans-serif" />
            <NumberField label="Font Size" value={element.style?.fontSize} onChange={(v) => patchStyle("fontSize", v)} min={8} max={200} />
            <SelectField label="Text Sizing" value={element.style?.textSizing} options={TEXT_SIZING_OPTIONS} onChange={(v) => patchStyle("textSizing", v)} />
            <SelectField label="Text Align" value={element.style?.textAlign} options={TEXT_ALIGN_OPTIONS} onChange={(v) => patchStyle("textAlign", v)} />
            <NumberField label="Line Height" value={element.style?.lineHeight} onChange={(v) => patchStyle("lineHeight", v)} min={0.5} max={4} step={0.1} />
            <SelectField label="Vertical Align" value={element.style?.verticalAlign} options={VERTICAL_ALIGN_OPTIONS} onChange={(v) => patchStyle("verticalAlign", v)} />
          </>
        )}
        {element.type === "code" && (
          <>
            <SelectField label="Theme" value={element.style?.theme} options={CODE_THEMES} onChange={(v) => patchStyle("theme", v)} />
            <NumberField label="Font Size" value={element.style?.fontSize} onChange={(v) => patchStyle("fontSize", v)} min={8} max={48} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={32} />
          </>
        )}
        {element.type === "shape" && (
          <>
            <ColorField label="Fill" value={merged.fill as string | undefined} inherited={isInherited("fill")} onChange={(v) => patchStyle("fill", v)} />
            <NumberField label="Fill Opacity" value={element.style?.fillOpacity ?? 1} onChange={(v) => patchStyle("fillOpacity", v)} min={0} max={1} step={0.05} />
            <ColorField label="Stroke" value={merged.stroke as string | undefined} inherited={isInherited("stroke")} onChange={(v) => patchStyle("stroke", v)} />
            <NumberField label="Stroke Opacity" value={element.style?.strokeOpacity ?? 1} onChange={(v) => patchStyle("strokeOpacity", v)} min={0} max={1} step={0.05} />
            <NumberField label="Stroke Width" value={element.style?.strokeWidth} onChange={(v) => patchStyle("strokeWidth", v)} min={0} max={20} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={100} />
            {(element.shape === "line" || element.shape === "arrow") && (
              <>
                <SelectField
                  label="Start Marker"
                  value={element.style?.markerStart ?? "none"}
                  options={MARKER_OPTIONS}
                  onChange={(v) => patchStyle("markerStart", v)}
                />
                <SelectField
                  label="End Marker"
                  value={element.style?.markerEnd ?? (element.shape === "arrow" ? "arrow" : "none")}
                  options={MARKER_OPTIONS}
                  onChange={(v) => patchStyle("markerEnd", v)}
                />
                <WaypointControls
                  element={element as ShapeElement}
                  slideId={slideId}
                  updateElement={updateElement}
                />
              </>
            )}
          </>
        )}
        {element.type === "image" && (
          <>
            <TextField label="Alt Text" value={element.alt} onChange={(v) => updateElement(slideId, element.id, { alt: v } as Partial<SlideElement>)} placeholder="Describe the image" />
            <SelectField label="Object Fit" value={element.style?.objectFit} options={OBJECT_FIT_OPTIONS} onChange={(v) => patchStyle("objectFit", v)} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={100} />
            <NumberField label="Opacity" value={element.style?.opacity ?? 1} onChange={(v) => patchStyle("opacity", v)} min={0} max={1} step={0.05} />
          </>
        )}
        {element.type === "video" && (
          <>
            <SelectField label="Object Fit" value={element.style?.objectFit} options={OBJECT_FIT_OPTIONS} onChange={(v) => patchStyle("objectFit", v)} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={100} />
          </>
        )}
        {element.type === "tikz" && (
          <>
            <ColorField label="Background" value={element.style?.backgroundColor} onChange={(v) => patchStyle("backgroundColor", v)} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={32} />
          </>
        )}
        {element.type === "mermaid" && (
          <>
            <ColorField label="Background" value={element.style?.backgroundColor} onChange={(v) => patchStyle("backgroundColor", v)} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={32} />
          </>
        )}
        {element.type === "table" && (
          <>
            <NumberField label="Font Size" value={element.style?.fontSize} onChange={(v) => patchStyle("fontSize", v)} min={8} max={48} />
            <ColorField label="Color" value={element.style?.color} onChange={(v) => patchStyle("color", v)} />
            <ColorField label="Header BG" value={element.style?.headerBackground} onChange={(v) => patchStyle("headerBackground", v)} />
            <ColorField label="Header Color" value={element.style?.headerColor} onChange={(v) => patchStyle("headerColor", v)} />
            <ColorField label="Border Color" value={element.style?.borderColor} onChange={(v) => patchStyle("borderColor", v)} />
            <NumberField label="Border Radius" value={element.style?.borderRadius ?? 0} onChange={(v) => patchStyle("borderRadius", v)} min={0} max={32} />
          </>
        )}
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  mixed,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  mixed?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-zinc-500 text-xs w-3">{label}</span>
      <input
        type="number"
        className={`flex-1 bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs font-mono border focus:border-blue-500 focus:outline-none w-0 ${
          mixed ? "border-dashed border-zinc-600" : "border-zinc-700"
        }`}
        value={mixed ? "" : value}
        placeholder={mixed ? "\u2014" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

// -- TikZ Editor --

type RenderStatus = "idle" | "modified" | "rendering" | "rendered" | "error";

function TikZEditor({
  element,
  slideId,
  updateElement,
}: {
  element: TikZElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const adapter = useAdapter();
  const [status, setStatus] = useState<RenderStatus>(element.svgUrl ? "rendered" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [showPreamble, setShowPreamble] = useState(!!element.preamble);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderIdRef = useRef(0);

  // Sync status when svgUrl is cleared externally (e.g. file deleted → onError)
  useEffect(() => {
    if (!element.svgUrl && status === "rendered") {
      setStatus("idle");
    }
  }, [element.svgUrl, status]);

  const doRender = useCallback(async (content: string, preamble?: string) => {
    const renderId = ++renderIdRef.current;
    setStatus("rendering");
    setError(null);

    const result = await adapter.renderTikz(element.id, content, preamble);

    // Stale render — a newer one was triggered
    if (renderId !== renderIdRef.current) return;

    if (result.ok) {
      setStatus("rendered");
      setError(null);
      updateElement(slideId, element.id, {
        svgUrl: result.svgUrl,
        renderedContent: content,
        renderedPreamble: preamble ?? "",
        renderError: undefined,
      } as Partial<SlideElement>);
    } else {
      setStatus("error");
      setError(result.error);
      updateElement(slideId, element.id, {
        renderError: result.error,
      } as Partial<SlideElement>);
    }
  }, [adapter, element.id, slideId, updateElement]);

  // Auto-render: debounce 1.5s after content/preamble changes
  const scheduleRender = useCallback((content: string, preamble?: string) => {
    setStatus("modified");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doRender(content, preamble);
    }, 1500);
  }, [doRender]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleContentChange = (value: string) => {
    updateElement(slideId, element.id, { content: value } as Partial<SlideElement>);
    scheduleRender(value, element.preamble);
  };

  const handlePreambleChange = (value: string) => {
    updateElement(slideId, element.id, { preamble: value } as Partial<SlideElement>);
    scheduleRender(element.content, value);
  };

  const handleManualRender = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doRender(element.content, element.preamble);
  };

  return (
    <>
      {/* TikZ Code */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel>TikZ Code</FieldLabel>
          <StatusBadge status={status} />
        </div>
        <textarea
          className="w-full bg-zinc-900 text-green-300 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-32 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={element.content}
          rows={10}
          spellCheck={false}
          onChange={(e) => handleContentChange(e.target.value)}
        />
      </div>

      {/* Preamble (collapsible) */}
      <div>
        <button
          onClick={() => setShowPreamble(!showPreamble)}
          className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors"
        >
          {showPreamble ? "- Preamble" : "+ Preamble"}
        </button>
        {showPreamble && (
          <textarea
            className="w-full mt-1 bg-zinc-900 text-yellow-300 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-12 border border-zinc-700 focus:border-blue-500 focus:outline-none"
            value={element.preamble ?? ""}
            rows={3}
            spellCheck={false}
            placeholder="\\usepackage{amsmath}"
            onChange={(e) => handlePreambleChange(e.target.value)}
          />
        )}
      </div>

      {/* Render button */}
      <button
        onClick={handleManualRender}
        disabled={status === "rendering"}
        className="w-full px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === "rendering" ? "Rendering..." : "Render"}
      </button>

      {/* Error display */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-2">
          <div className="text-red-400 text-xs font-mono whitespace-pre-wrap break-all">
            {error}
          </div>
        </div>
      )}
    </>
  );
}

function CustomPropsEditor({
  element,
  slideId,
  updateElement,
}: {
  element: CustomElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(element.props ?? {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  // Sync draft when element.props changes externally (undo/redo)
  useEffect(() => {
    setDraft(JSON.stringify(element.props ?? {}, null, 2));
    setParseError(null);
  }, [element.id]);

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(draft);
      setParseError(null);
      updateElement(slideId, element.id, { props: parsed } as Partial<SlideElement>);
    } catch (e: any) {
      setParseError(e.message);
    }
  };

  return (
    <>
      <div>
        <FieldLabel>Component</FieldLabel>
        <div className="text-purple-300 font-mono text-xs">{element.component}</div>
      </div>
      <div>
        <FieldLabel>Props (JSON)</FieldLabel>
        <textarea
          className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-20 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={draft}
          rows={6}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
        />
        {parseError && (
          <div className="text-red-400 text-xs mt-1 font-mono">{parseError}</div>
        )}
      </div>
    </>
  );
}

function TableDataEditor({
  element,
  slideId,
  updateElement,
}: {
  element: TableElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const updateColumn = (index: number, value: string) => {
    const columns = [...element.columns];
    columns[index] = value;
    updateElement(slideId, element.id, { columns } as Partial<SlideElement>);
  };

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    const rows = element.rows.map((r) => [...r]);
    rows[rowIndex]![colIndex] = value;
    updateElement(slideId, element.id, { rows } as Partial<SlideElement>);
  };

  const addColumn = () => {
    const columns = [...element.columns, `Col ${element.columns.length + 1}`];
    const rows = element.rows.map((r) => [...r, ""]);
    updateElement(slideId, element.id, { columns, rows } as Partial<SlideElement>);
  };

  const removeColumn = () => {
    if (element.columns.length <= 1) return;
    const columns = element.columns.slice(0, -1);
    const rows = element.rows.map((r) => r.slice(0, -1));
    updateElement(slideId, element.id, { columns, rows } as Partial<SlideElement>);
  };

  const addRow = () => {
    const rows = [...element.rows, Array(element.columns.length).fill("")];
    updateElement(slideId, element.id, { rows } as Partial<SlideElement>);
  };

  const removeRow = () => {
    if (element.rows.length <= 1) return;
    const rows = element.rows.slice(0, -1);
    updateElement(slideId, element.id, { rows } as Partial<SlideElement>);
  };

  const toggleStriped = () => {
    updateElement(slideId, element.id, {
      style: { ...element.style, striped: !(element.style?.striped ?? false) },
    } as Partial<SlideElement>);
  };

  return (
    <>
      <div>
        <FieldLabel>Columns</FieldLabel>
        <div className="space-y-1">
          {element.columns.map((col, i) => (
            <input
              key={i}
              type="text"
              className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs font-mono border border-zinc-700 focus:border-blue-500 focus:outline-none"
              value={col}
              onChange={(e) => updateColumn(i, e.target.value)}
            />
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          <button
            onClick={addColumn}
            className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            + Col
          </button>
          <button
            onClick={removeColumn}
            disabled={element.columns.length <= 1}
            className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            - Col
          </button>
        </div>
      </div>

      <div>
        <FieldLabel>Rows</FieldLabel>
        <div className="space-y-2">
          {element.rows.map((row, ri) => (
            <div key={ri} className="space-y-1">
              <div className="text-zinc-500 text-[10px]">Row {ri + 1}</div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${element.columns.length}, 1fr)` }}>
                {element.columns.map((_, ci) => (
                  <input
                    key={ci}
                    type="text"
                    className="w-full bg-zinc-800 text-zinc-200 rounded px-1.5 py-1 text-xs font-mono border border-zinc-700 focus:border-blue-500 focus:outline-none"
                    value={row[ci] ?? ""}
                    onChange={(e) => updateCell(ri, ci, e.target.value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          <button
            onClick={addRow}
            className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            + Row
          </button>
          <button
            onClick={removeRow}
            disabled={element.rows.length <= 1}
            className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            - Row
          </button>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={element.style?.striped ?? false}
            onChange={toggleStriped}
            className="rounded border-zinc-600"
          />
          Striped rows
        </label>
      </div>
    </>
  );
}

function Scene3DEditor({
  element,
  slideId,
  updateElement,
}: {
  element: Scene3DElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const [sceneDraft, setSceneDraft] = useState(() => JSON.stringify(element.scene ?? {}, null, 2));
  const [keyframesDraft, setKeyframesDraft] = useState(() =>
    JSON.stringify(element.keyframes ?? [], null, 2),
  );
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [keyframesError, setKeyframesError] = useState<string | null>(null);

  useEffect(() => {
    setSceneDraft(JSON.stringify(element.scene ?? {}, null, 2));
    setSceneError(null);
  }, [element.id]);

  useEffect(() => {
    setKeyframesDraft(JSON.stringify(element.keyframes ?? [], null, 2));
    setKeyframesError(null);
  }, [element.id]);

  const handleSceneBlur = () => {
    try {
      const parsed = JSON.parse(sceneDraft);
      setSceneError(null);
      updateElement(slideId, element.id, { scene: parsed } as Partial<SlideElement>);
    } catch (e: any) {
      setSceneError(e.message);
    }
  };

  const handleKeyframesBlur = () => {
    try {
      const parsed = JSON.parse(keyframesDraft);
      setKeyframesError(null);
      updateElement(slideId, element.id, { keyframes: parsed } as Partial<SlideElement>);
    } catch (e: any) {
      setKeyframesError(e.message);
    }
  };

  const patchStyle = (prop: string, value: unknown) => {
    updateElement(slideId, element.id, {
      style: { ...element.style, [prop]: value },
    } as Partial<SlideElement>);
  };

  const toggleSceneProp = (prop: "orbitControls") => {
    const scene = { ...element.scene, [prop]: !element.scene?.[prop] };
    updateElement(slideId, element.id, { scene } as Partial<SlideElement>);
  };

  const toggleHelper = (prop: "grid" | "axes") => {
    const helpers = { ...element.scene?.helpers, [prop]: !(element.scene?.helpers?.[prop] ?? false) };
    const scene = { ...element.scene, helpers };
    updateElement(slideId, element.id, { scene } as Partial<SlideElement>);
  };

  return (
    <>
      <div>
        <FieldLabel>Quick Toggles</FieldLabel>
        <div className="space-y-1">
          {(["orbitControls"] as const).map((prop) => (
            <label key={prop} className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={!!element.scene?.[prop]}
                onChange={() => toggleSceneProp(prop)}
                className="rounded border-zinc-600"
              />
              Orbit Controls
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={element.scene?.helpers?.grid ?? false}
              onChange={() => toggleHelper("grid")}
              className="rounded border-zinc-600"
            />
            Grid
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={element.scene?.helpers?.axes ?? false}
              onChange={() => toggleHelper("axes")}
              className="rounded border-zinc-600"
            />
            Axes
          </label>
        </div>
      </div>

      <div>
        <FieldLabel>Style</FieldLabel>
        <NumberField
          label="Border Radius"
          value={element.style?.borderRadius}
          onChange={(v) => patchStyle("borderRadius", v)}
          min={0}
          max={32}
        />
      </div>

      <div>
        <FieldLabel>Scene (JSON)</FieldLabel>
        <textarea
          className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-32 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={sceneDraft}
          rows={12}
          spellCheck={false}
          onChange={(e) => setSceneDraft(e.target.value)}
          onBlur={handleSceneBlur}
        />
        {sceneError && (
          <div className="text-red-400 text-xs mt-1 font-mono">{sceneError}</div>
        )}
      </div>

      <div>
        <FieldLabel>Keyframes (JSON)</FieldLabel>
        <textarea
          className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-20 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={keyframesDraft}
          rows={8}
          spellCheck={false}
          onChange={(e) => setKeyframesDraft(e.target.value)}
          onBlur={handleKeyframesBlur}
        />
        {keyframesError && (
          <div className="text-red-400 text-xs mt-1 font-mono">{keyframesError}</div>
        )}
      </div>
    </>
  );
}

function MermaidEditor({
  element,
  slideId,
  updateElement,
}: {
  element: MermaidElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  return (
    <>
      <div>
        <FieldLabel>Mermaid Code</FieldLabel>
        <textarea
          className="w-full bg-zinc-900 text-cyan-300 rounded px-2 py-1.5 text-xs font-mono resize-y min-h-32 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          value={element.content}
          rows={10}
          spellCheck={false}
          onChange={(e) => {
            updateElement(slideId, element.id, { content: e.target.value } as Partial<SlideElement>);
          }}
        />
      </div>

      {element.renderError && (
        <div className="bg-red-900/30 border border-red-700 rounded p-2">
          <div className="text-red-400 text-xs font-mono whitespace-pre-wrap break-all">
            {element.renderError}
          </div>
        </div>
      )}
    </>
  );
}

function CropActions({
  element,
  slideId,
}: {
  element: ImageElement | VideoElement;
  slideId: string;
}) {
  const setCropElement = useDeckStore((s) => s.setCropElement);
  const cropElementId = useDeckStore((s) => s.cropElementId);
  const updateElement = useDeckStore((s) => s.updateElement);
  const crop = element.style?.crop;
  const hasCrop = !!(crop && (crop.top || crop.right || crop.bottom || crop.left));
  const isActive = cropElementId === element.id;

  const patchCrop = (key: keyof CropRect, value: number | undefined) => {
    const cur = crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const next = { ...cur, [key]: value ?? 0 };
    updateElement(slideId, element.id, {
      style: { ...element.style, crop: next },
    } as Partial<SlideElement>);
  };

  return (
    <div>
      <FieldLabel>Crop</FieldLabel>
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setCropElement(isActive ? null : element.id)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            isActive
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500"
          }`}
        >
          {isActive ? "Done" : "Crop"}
        </button>
        {hasCrop && (
          <button
            onClick={() => {
              const { crop: _, ...rest } = element.style!;
              updateElement(slideId, element.id, {
                style: rest,
              } as Partial<SlideElement>);
              if (isActive) setCropElement(null);
            }}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <NumberField label="Top %" value={Math.round((crop?.top ?? 0) * 100)} onChange={(v) => patchCrop("top", (v ?? 0) / 100)} min={0} max={95} step={1} />
        <NumberField label="Bottom %" value={Math.round((crop?.bottom ?? 0) * 100)} onChange={(v) => patchCrop("bottom", (v ?? 0) / 100)} min={0} max={95} step={1} />
        <NumberField label="Left %" value={Math.round((crop?.left ?? 0) * 100)} onChange={(v) => patchCrop("left", (v ?? 0) / 100)} min={0} max={95} step={1} />
        <NumberField label="Right %" value={Math.round((crop?.right ?? 0) * 100)} onChange={(v) => patchCrop("right", (v ?? 0) / 100)} min={0} max={95} step={1} />
      </div>
    </div>
  );
}

function TrimActions({
  element,
  slideId,
}: {
  element: VideoElement;
  slideId: string;
}) {
  const setTrimElement = useDeckStore((s) => s.setTrimElement);
  const trimElementId = useDeckStore((s) => s.trimElementId);
  const updateElement = useDeckStore((s) => s.updateElement);
  const [duration, setDuration] = useState(0);

  const hasTrim = element.trimStart !== undefined || element.trimEnd !== undefined;
  const isActive = trimElementId === element.id;

  useEffect(() => {
    const vid = document.querySelector(
      `[data-element-id="${element.id}"] video`,
    ) as HTMLVideoElement | null;
    if (!vid) return;
    const onDur = () => setDuration(vid.duration || 0);
    vid.addEventListener("loadedmetadata", onDur);
    vid.addEventListener("durationchange", onDur);
    if (vid.duration) setDuration(vid.duration);
    return () => {
      vid.removeEventListener("loadedmetadata", onDur);
      vid.removeEventListener("durationchange", onDur);
    };
  }, [element.id]);

  const trimStart = element.trimStart ?? 0;
  const trimEnd = element.trimEnd ?? duration;
  const trimDuration = Math.max(0, trimEnd - trimStart);

  const fmt = (s: number) => {
    if (!isFinite(s) || s === 0) return "0.0s";
    return `${s.toFixed(1)}s`;
  };

  return (
    <div>
      <FieldLabel>Trim</FieldLabel>
      <div className="flex gap-2">
        <button
          onClick={() => setTrimElement(isActive ? null : element.id)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            isActive
              ? "bg-amber-600 text-white"
              : "bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500"
          }`}
        >
          {isActive ? "Done" : "Trim"}
        </button>
        {hasTrim && (
          <button
            onClick={() => {
              updateElement(slideId, element.id, {
                trimStart: undefined,
                trimEnd: undefined,
              } as Partial<SlideElement>);
              if (isActive) setTrimElement(null);
            }}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      {/* Trim info summary */}
      {hasTrim && duration > 0 && (
        <div className="mt-1.5 text-xs text-zinc-400 font-mono bg-zinc-800/50 rounded px-2 py-1">
          {fmt(trimStart)} ~ {fmt(trimEnd)} / {fmt(duration)} ({fmt(trimDuration)})
        </div>
      )}
    </div>
  );
}

function WaypointControls({
  element,
  slideId,
  updateElement,
}: {
  element: ShapeElement;
  slideId: string;
  updateElement: (slideId: string, elementId: string, patch: Partial<SlideElement>) => void;
}) {
  const waypoints = element.style?.waypoints;
  const { w, h } = element.size;

  const setWaypoints = (pts: { x: number; y: number }[] | undefined) => {
    const { waypoints: _, ...rest } = element.style ?? {};
    updateElement(slideId, element.id, {
      style: pts ? { ...rest, waypoints: pts } : rest,
    } as Partial<SlideElement>);
  };

  if (!waypoints || waypoints.length < 2) {
    return (
      <div>
        <FieldLabel>Waypoints</FieldLabel>
        <button
          onClick={() => setWaypoints([{ x: 0, y: Math.round(h / 2) }, { x: w, y: Math.round(h / 2) }])}
          className="w-full px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          Add Waypoints
        </button>
      </div>
    );
  }

  const updatePoint = (index: number, axis: "x" | "y", value: number | undefined) => {
    if (value === undefined) return;
    const pts = waypoints.map((p, i) =>
      i === index ? { ...p, [axis]: value } : { ...p },
    );
    setWaypoints(pts);
  };

  const addPoint = () => {
    const last = waypoints[waypoints.length - 1]!;
    const prev = waypoints[waypoints.length - 2]!;
    const mid = {
      x: Math.round((prev.x + last.x) / 2),
      y: Math.round((prev.y + last.y) / 2),
    };
    const pts = [...waypoints.slice(0, -1), mid, last];
    setWaypoints(pts);
  };

  const removePoint = (index: number) => {
    if (waypoints.length <= 2) return;
    setWaypoints(waypoints.filter((_, i) => i !== index));
  };

  return (
    <div>
      <FieldLabel>Waypoints</FieldLabel>
      <div className="space-y-1.5">
        {waypoints.map((pt, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="text-zinc-500 text-[10px] w-3 shrink-0">{i + 1}</span>
            <input
              type="number"
              className="flex-1 bg-zinc-800 text-zinc-200 rounded px-1.5 py-0.5 text-xs font-mono border border-zinc-700 focus:border-blue-500 focus:outline-none w-0"
              value={pt.x}
              onChange={(e) => updatePoint(i, "x", parseInt(e.target.value, 10))}
            />
            <input
              type="number"
              className="flex-1 bg-zinc-800 text-zinc-200 rounded px-1.5 py-0.5 text-xs font-mono border border-zinc-700 focus:border-blue-500 focus:outline-none w-0"
              value={pt.y}
              onChange={(e) => updatePoint(i, "y", parseInt(e.target.value, 10))}
            />
            <button
              onClick={() => removePoint(i)}
              disabled={waypoints.length <= 2}
              className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed text-xs px-1"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        <button
          onClick={addPoint}
          className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          + Point
        </button>
        <button
          onClick={() => setWaypoints(undefined)}
          className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RenderStatus }) {
  const config: Record<RenderStatus, { label: string; color: string }> = {
    idle: { label: "Not rendered", color: "text-zinc-500" },
    modified: { label: "Modified", color: "text-yellow-400" },
    rendering: { label: "Rendering...", color: "text-blue-400" },
    rendered: { label: "Rendered", color: "text-green-400" },
    error: { label: "Error", color: "text-red-400" },
  };
  const { label, color } = config[status];
  return <span className={`text-xs ${color}`}>{label}</span>;
}

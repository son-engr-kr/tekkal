import { useState, useCallback } from "react";
import { useDeckStore } from "@/stores/deckStore";
import type {
  DeckTheme,
  SlideBackground,
} from "@/types/deck";
import {
  ColorField,
  NumberField,
  SelectField,
  CheckboxField,
  TextField,
  CODE_THEMES,
  OBJECT_FIT_OPTIONS,
  TEXT_ALIGN_OPTIONS,
  VERTICAL_ALIGN_OPTIONS,
  TEXT_SIZING_OPTIONS,
} from "./fields";

// -- Accordion section --

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800/50 transition-colors"
      >
        <span className="uppercase tracking-wider">{title}</span>
        <span className="text-zinc-500">{open ? "\u2212" : "+"}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// -- Main panel --

export function ThemePanel() {
  const theme = useDeckStore((s) => s.deck?.theme) ?? {};
  const updateTheme = useDeckStore((s) => s.updateTheme);

  const patchStyle = useCallback(
    <K extends keyof DeckTheme>(key: K) =>
      (patch: Partial<NonNullable<DeckTheme[K]>>) =>
        updateTheme({ [key]: patch } as Partial<DeckTheme>),
    [updateTheme],
  );

  const patchSlide = (patch: Partial<SlideBackground>) =>
    updateTheme({ slide: { background: { ...theme.slide?.background, ...patch } } });

  const patchText = patchStyle("text");
  const patchCode = patchStyle("code");
  const patchShape = patchStyle("shape");
  const patchImage = patchStyle("image");
  const patchVideo = patchStyle("video");
  const patchTikZ = patchStyle("tikz");
  const patchMermaid = patchStyle("mermaid");

  return (
    <div className="text-sm">
      <div className="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
        Theme Defaults
      </div>

      <Section title="Slide" defaultOpen>
        <ColorField
          label="Background"
          value={theme.slide?.background?.color}
          onChange={(v) => patchSlide({ color: v })}
        />
      </Section>

      <Section title="Text" defaultOpen>
        <ColorField
          label="Color"
          value={theme.text?.color}
          onChange={(v) => patchText({ color: v })}
        />
        <TextField
          label="Font Family"
          value={theme.text?.fontFamily}
          onChange={(v) => patchText({ fontFamily: v })}
          placeholder="sans-serif"
        />
        <NumberField
          label="Font Size"
          value={theme.text?.fontSize}
          onChange={(v) => patchText({ fontSize: v })}
          min={8}
          max={200}
        />
        <SelectField
          label="Text Align"
          value={theme.text?.textAlign}
          options={TEXT_ALIGN_OPTIONS}
          onChange={(v) => patchText({ textAlign: v })}
        />
        <SelectField
          label="Text Sizing"
          value={theme.text?.textSizing}
          options={TEXT_SIZING_OPTIONS}
          onChange={(v) => patchText({ textSizing: v })}
        />
        <NumberField
          label="Line Height"
          value={theme.text?.lineHeight}
          onChange={(v) => patchText({ lineHeight: v })}
          min={0.5}
          max={4}
          step={0.1}
        />
        <SelectField
          label="Vertical Align"
          value={theme.text?.verticalAlign}
          options={VERTICAL_ALIGN_OPTIONS}
          onChange={(v) => patchText({ verticalAlign: v })}
        />
      </Section>

      <Section title="Code">
        <SelectField
          label="Theme"
          value={theme.code?.theme}
          options={CODE_THEMES}
          onChange={(v) => patchCode({ theme: v })}
        />
        <NumberField
          label="Font Size"
          value={theme.code?.fontSize}
          onChange={(v) => patchCode({ fontSize: v })}
          min={8}
          max={48}
        />
        <NumberField
          label="Border Radius"
          value={theme.code?.borderRadius}
          onChange={(v) => patchCode({ borderRadius: v })}
          min={0}
          max={32}
        />
        <CheckboxField
          label="Line Numbers"
          value={theme.code?.lineNumbers}
          onChange={(v) => patchCode({ lineNumbers: v })}
        />
      </Section>

      <Section title="Shape">
        <ColorField
          label="Stroke"
          value={theme.shape?.stroke}
          onChange={(v) => patchShape({ stroke: v })}
        />
        <ColorField
          label="Fill"
          value={theme.shape?.fill}
          onChange={(v) => patchShape({ fill: v })}
        />
        <NumberField
          label="Stroke Width"
          value={theme.shape?.strokeWidth}
          onChange={(v) => patchShape({ strokeWidth: v })}
          min={0}
          max={20}
        />
        <NumberField
          label="Border Radius"
          value={theme.shape?.borderRadius}
          onChange={(v) => patchShape({ borderRadius: v })}
          min={0}
          max={100}
        />
        <NumberField
          label="Opacity"
          value={theme.shape?.opacity}
          onChange={(v) => patchShape({ opacity: v })}
          min={0}
          max={1}
          step={0.05}
        />
      </Section>

      <Section title="Image">
        <SelectField
          label="Object Fit"
          value={theme.image?.objectFit}
          options={OBJECT_FIT_OPTIONS}
          onChange={(v) => patchImage({ objectFit: v })}
        />
        <NumberField
          label="Border Radius"
          value={theme.image?.borderRadius}
          onChange={(v) => patchImage({ borderRadius: v })}
          min={0}
          max={100}
        />
        <NumberField
          label="Opacity"
          value={theme.image?.opacity}
          onChange={(v) => patchImage({ opacity: v })}
          min={0}
          max={1}
          step={0.05}
        />
      </Section>

      <Section title="Video">
        <SelectField
          label="Object Fit"
          value={theme.video?.objectFit}
          options={OBJECT_FIT_OPTIONS}
          onChange={(v) => patchVideo({ objectFit: v })}
        />
        <NumberField
          label="Border Radius"
          value={theme.video?.borderRadius}
          onChange={(v) => patchVideo({ borderRadius: v })}
          min={0}
          max={100}
        />
      </Section>

      <Section title="TikZ">
        <ColorField
          label="Background"
          value={theme.tikz?.backgroundColor}
          onChange={(v) => patchTikZ({ backgroundColor: v })}
        />
        <NumberField
          label="Border Radius"
          value={theme.tikz?.borderRadius}
          onChange={(v) => patchTikZ({ borderRadius: v })}
          min={0}
          max={32}
        />
      </Section>

      <Section title="Mermaid">
        <ColorField
          label="Background"
          value={theme.mermaid?.backgroundColor}
          onChange={(v) => patchMermaid({ backgroundColor: v })}
        />
        <NumberField
          label="Border Radius"
          value={theme.mermaid?.borderRadius}
          onChange={(v) => patchMermaid({ borderRadius: v })}
          min={0}
          max={32}
        />
      </Section>
    </div>
  );
}

// Bundled guide files — Vite ?raw imports for build-time inclusion.
// Shared between fsAccess adapter (project scaffolding) and AI pipeline (read_guide tool).

import guideIndex from "../../docs/deckode-guide.md?raw";
import guide01 from "../../docs/guide/01-overview.md?raw";
import guide02 from "../../docs/guide/02-slide-splitting.md?raw";
import guide03a from "../../docs/guide/03a-schema-deck.md?raw";
import guide03b from "../../docs/guide/03b-schema-elements.md?raw";
import guide04a from "../../docs/guide/04a-elem-text-code.md?raw";
import guide04b from "../../docs/guide/04b-elem-media.md?raw";
import guide04c from "../../docs/guide/04c-elem-shape.md?raw";
import guide04d from "../../docs/guide/04d-elem-tikz.md?raw";
import guide04e from "../../docs/guide/04e-elem-diagrams.md?raw";
import guide04f from "../../docs/guide/04f-elem-table-mermaid.md?raw";
import guide04g from "../../docs/guide/04g-elem-scene3d.md?raw";
import guide04h from "../../docs/guide/04h-elem-scene3d-examples.md?raw";
import guide05 from "../../docs/guide/05-animations.md?raw";
import guide06 from "../../docs/guide/06-theme.md?raw";
import guide07 from "../../docs/guide/07-slide-features.md?raw";
import guide08a from "../../docs/guide/08a-guidelines.md?raw";
import guide08b from "../../docs/guide/08b-style-preferences.md?raw";
import guide08c from "../../docs/guide/08c-visual-style.md?raw";
import guide08d from "../../docs/guide/08d-layout-templates.md?raw";
import guide09 from "../../docs/guide/09-example.md?raw";

export const GUIDE_INDEX = guideIndex;

export const GUIDE_SECTIONS: Record<string, string> = {
  "01-overview.md": guide01,
  "02-slide-splitting.md": guide02,
  "03a-schema-deck.md": guide03a,
  "03b-schema-elements.md": guide03b,
  "04a-elem-text-code.md": guide04a,
  "04b-elem-media.md": guide04b,
  "04c-elem-shape.md": guide04c,
  "04d-elem-tikz.md": guide04d,
  "04e-elem-diagrams.md": guide04e,
  "04f-elem-table-mermaid.md": guide04f,
  "04g-elem-scene3d.md": guide04g,
  "04h-elem-scene3d-examples.md": guide04h,
  "05-animations.md": guide05,
  "06-theme.md": guide06,
  "07-slide-features.md": guide07,
  "08a-guidelines.md": guide08a,
  "08b-style-preferences.md": guide08b,
  "08c-visual-style.md": guide08c,
  "08d-layout-templates.md": guide08d,
  "09-example.md": guide09,
};

export function readGuide(section: string): string {
  // Allow with or without .md extension, and partial matching
  const normalized = section.replace(/\.md$/, "");
  for (const [key, content] of Object.entries(GUIDE_SECTIONS)) {
    if (key === section || key === `${normalized}.md` || key.startsWith(normalized)) {
      return content;
    }
  }
  const available = Object.keys(GUIDE_SECTIONS).join(", ");
  return `Section "${section}" not found. Available sections: ${available}`;
}

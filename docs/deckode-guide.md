# Deckode Guide

You are creating slides for Deckode, a local-first, JSON-based slide platform. This is the navigation index for the complete specification. Read the relevant section files below as needed.

> **IMPORTANT**: When a new deck is first created or confirmed, you **must** ask the user about their style preferences (theme, animations, notes tone, highlight boxes). See [Style Preferences](./guide/08b-style-preferences.md). For existing decks, infer from existing slides.

> **Read order for new decks**: Style Preferences (ask user first) → Overview → Schema → Element types you need → Animations → Guidelines
>
> **Read order for modifications**: Schema (to understand structure) → the specific section you need

## Sections

| # | File | Description |
|---|------|-------------|
| 1 | [Overview](./guide/01-overview.md) | Project structure, core concept, coordinate system (960x540) |
| 2 | [Slide Splitting](./guide/02-slide-splitting.md) | `$ref` pointers for splitting large decks into external slide files |
| 3a | [Schema: Deck & Slides](./guide/03a-schema-deck.md) | `deck.json` top-level structure, slide object, comments |
| 3b | [Schema: Elements & Components](./guide/03b-schema-elements.md) | Element common fields, grouping, shared components |
| 4a | [Text & Code](./guide/04a-elem-text-code.md) | `text` (Markdown) and `code` (syntax-highlighted) elements |
| 4b | [Image, Video & Custom](./guide/04b-elem-media.md) | `image`, `video` (local/YouTube/Vimeo), `custom` (React) elements |
| 4c | [Shape](./guide/04c-elem-shape.md) | `shape` element: rectangle, ellipse, line, arrow, waypoints |
| 4d | [TikZ](./guide/04d-elem-tikz.md) | `tikz` element: TikZJax engine, PGFPlots, limitations |
| 4e | [Flow Diagrams](./guide/04e-elem-diagrams.md) | When to use native elements vs TikZ, step-by-step guide |
| 4f | [Table & Mermaid](./guide/04f-elem-table-mermaid.md) | `table` and `mermaid` elements |
| 4g | [Scene3D](./guide/04g-elem-scene3d.md) | `scene3d` element: Three.js scenes, objects, materials, keyframes |
| 4h | [Scene3D Examples](./guide/04h-elem-scene3d-examples.md) | Surface geometry, line geometry, complete interactive example |
| 5 | [Animations](./guide/05-animations.md) | Animation triggers, effects, and sequencing examples |
| 6 | [Theme](./guide/06-theme.md) | Deck-level theme defaults and page number overlay |
| 7 | [Slide Features](./guide/07-slide-features.md) | Bookmarks, presenter notes (step markers), layout templates, rotation |
| 8a | [Guidelines](./guide/08a-guidelines.md) | Common pitfalls (must-read) and AI best practices |
| 8b | [Style Preferences](./guide/08b-style-preferences.md) | Ask user about theme, animations, notes tone, highlight boxes |
| 8c | [Visual Style Guide](./guide/08c-visual-style.md) | Default color palette, typography, layout rules, diagram patterns |
| 8d | [Layout Templates](./guide/08d-layout-templates.md) | Pre-designed slide layouts, "Analytical Insight" palette, design principles |
| 9 | [Complete Example](./guide/09-example.md) | A full 3-slide deck.json example |

## Quick Reference

- **Virtual canvas**: 960 x 540 (16:9)
- **Slide IDs**: `"s1"`, `"s2"`, ...
- **Element IDs**: `"e1"`, `"e2"`, ... (unique within slide)
- **Resolution order**: `element.style` > `deck.theme` > hardcoded defaults
- **Critical pitfalls**: No `**` in LaTeX math, no `rotation` on line/arrow, always provide `waypoints` for line/arrow

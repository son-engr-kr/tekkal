# Deckode Guide

You are creating slides for Deckode, a local-first, JSON-based slide platform. This document is the complete specification for generating and modifying slide decks. It is the only reference you need.

---

## Project Structure

A Deckode project is a folder with this layout:

```
my-project/
  deck.json            # The presentation (source of truth)
  slides/              # External slide files (optional, referenced via $ref)
    intro.json
    demo.json
  layouts/             # Layout templates (pre-positioned element sets)
    blank.json
    title.json
    title-content.json
    two-column.json
    section-header.json
    code-slide.json
    image-left.json
  assets/              # Images, videos, and other media (created on demand)
  components/          # Custom React components (optional, dev mode only)
  docs/
    deckode-guide.md   # This file
```

Your primary task is to read and write `deck.json`. Assets go in `assets/` with relative paths (`"./assets/photo.png"`).

---

## Slide File Splitting (`$ref`)

When a deck grows large, individual slides can be split into separate files under `slides/`. A slide entry in the `slides` array can be either an inline slide object or a `$ref` pointer to an external file:

```json
{
  "slides": [
    { "id": "slide-1", "elements": [...] },
    { "$ref": "./slides/intro.json" },
    { "id": "slide-3", "elements": [...] }
  ]
}
```

The external file is a plain Slide JSON object (same schema as inline):

```json
{
  "id": "intro",
  "elements": [...],
  "animations": [...]
}
```

**How it works:**

- On load, `$ref` entries are resolved by reading the referenced file. The resolved slide receives a `_ref` field tracking its origin path.
- On save, slides with `_ref` are written back to their external file and replaced with `{ "$ref": "..." }` in deck.json.
- The editor, store, and renderers are unaware of the split — they see a flat array of resolved slides.
- New slides added via the editor are automatically externalized (saved to `./slides/{slideId}.json`).

**AI tools:**

- `extract-slide` — moves an inline slide to `./slides/{slideId}.json` and replaces it with a `$ref` pointer.
- `inline-slide` — brings an external `$ref` slide back inline into deck.json and deletes the external file.

**Convention:** use `./slides/` as the directory for external slide files. Use the slide `id` as the filename (e.g., `./slides/intro.json`).

---

## Core Concept

A Deckode presentation is a single `deck.json` file (with optional `$ref` splits). It is a JSON scene graph: a tree of slides, each containing positioned elements. You produce this JSON. Deckode renders it.

---

## Coordinate System

- Virtual canvas: **960 x 540** pixels (16:9 aspect ratio)
- Origin `(0, 0)` is the **top-left** corner of the slide
- All `position` and `size` values use this virtual coordinate space
- The renderer scales the virtual canvas to fit the actual viewport

---

## deck.json Schema

### Top-Level Structure

```json
{
  "deckode": "0.1.0",
  "meta": {
    "title": "Presentation Title",
    "author": "Author Name",
    "aspectRatio": "16:9"
  },
  "theme": {
    "slide": { "background": { "color": "#0f172a" } },
    "text": { "fontFamily": "Inter, system-ui, sans-serif", "fontSize": 24, "color": "#ffffff" },
    "code": { "theme": "github-dark", "fontSize": 16 },
    "shape": { "stroke": "#ffffff", "strokeWidth": 1 },
    "image": { "objectFit": "contain" },
    "video": { "objectFit": "contain" },
    "tikz": { "backgroundColor": "#1e1e2e" },
    "table": { "headerBackground": "#1e293b", "borderColor": "#334155" }
  },
  "slides": [ ... ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deckode` | string | yes | Schema version. Use `"0.1.0"` |
| `meta.title` | string | yes | Presentation title |
| `meta.author` | string | no | Author name |
| `meta.aspectRatio` | `"16:9"` \| `"4:3"` | yes | Slide aspect ratio |
| `theme` | object | no | Deck-level default styles (see Theme section below) |

### Slide Object

```json
{
  "id": "s1",
  "layout": "blank",
  "background": { "color": "#0f172a" },
  "transition": { "type": "fade", "duration": 300 },
  "notes": "Speaker notes for this slide",
  "elements": [ ... ],
  "animations": [ ... ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique slide ID. Convention: `"s1"`, `"s2"`, ... |
| `layout` | string | no | Layout template name. Default: `"blank"` |
| `background` | object | no | Slide background |
| `background.color` | string | no | CSS color value |
| `background.image` | string | no | Path to image (`"./assets/bg.jpg"`) |
| `transition` | object | no | Slide enter transition |
| `transition.type` | `"fade"` \| `"slide"` \| `"none"` | no | Transition type |
| `transition.duration` | number | no | Duration in ms. Default: `300` |
| `notes` | string | no | Speaker notes (plain text or Markdown) |
| `elements` | array | yes | Array of Element objects |
| `animations` | array | no | Array of Animation objects |

### Element Object

Every element has these common fields:

```json
{
  "id": "e1",
  "type": "text",
  "position": { "x": 100, "y": 200 },
  "size": { "w": 400, "h": 120 },
  "style": { ... },
  "content": "..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique element ID within the slide. Convention: `"e1"`, `"e2"`, ... |
| `type` | string | yes | Element type (see below) |
| `position` | object | yes | `{ "x": number, "y": number }` in virtual coordinates |
| `size` | object | yes | `{ "w": number, "h": number }` in virtual coordinates |
| `style` | object | no | Type-specific styling |
| `rotation` | number | no | Rotation in degrees (clockwise) |
| `groupId` | string | no | Group identifier. Elements sharing the same `groupId` form a group — they move and scale together. |

### Grouping

Elements can be grouped by assigning the same `groupId` string. Grouped elements behave as a unit:

- Clicking any member selects the entire group
- Dragging moves all members together
- Resizing scales all members proportionally
- A purple dashed bounding box appears around the group

Grouping is flat (1-level only). Grouping elements that already belong to different groups merges them into one group.

**Convention:** use `"group-"` prefix followed by a short identifier (e.g., `"group-box-a"`).

**Arrow connectors must always be grouped with their label.** An arrow element (`"shape": "arrow"`) and its associated text label should share the same `groupId` so they stay aligned when moved:

```json
{
  "id": "arrow-1",
  "type": "shape", "shape": "arrow",
  "position": { "x": 240, "y": 155 },
  "size": { "w": 80, "h": 20 },
  "style": { "stroke": "#64748b", "strokeWidth": 2 },
  "groupId": "group-arrow-1"
},
{
  "id": "label-1",
  "type": "text",
  "content": "Yes",
  "position": { "x": 255, "y": 138 },
  "size": { "w": 50, "h": 18 },
  "style": { "fontSize": 12, "color": "#64748b", "textAlign": "center" },
  "groupId": "group-arrow-1"
}
```

Similarly, box + label pairs in diagrams should be grouped:

```json
{
  "id": "box-input", "type": "shape", "shape": "rectangle",
  "position": { "x": 80, "y": 130 }, "size": { "w": 160, "h": 70 },
  "style": { "fill": "#dbeafe", "stroke": "#3b82f6", "strokeWidth": 2, "borderRadius": 10 },
  "groupId": "group-input"
},
{
  "id": "label-input", "type": "text",
  "content": "**Input**\nUser request",
  "position": { "x": 80, "y": 130 }, "size": { "w": 160, "h": 70 },
  "style": { "fontSize": 14, "color": "#1e40af", "textAlign": "center", "verticalAlign": "middle" },
  "groupId": "group-input"
}
```

---

## Element Types

### `"text"`

Renders Markdown text content.

```json
{
  "id": "e1",
  "type": "text",
  "content": "# Title\n\nThis is **bold** and *italic*.\n\nInline math: $E = mc^2$",
  "position": { "x": 60, "y": 40 },
  "size": { "w": 840, "h": 200 },
  "style": {
    "fontFamily": "Inter",
    "fontSize": 24,
    "color": "#ffffff",
    "textAlign": "left",
    "lineHeight": 1.5,
    "verticalAlign": "top"
  }
}
```

**Content format**: Markdown string. Supports:
- Headings (`#`, `##`, `###`)
- Bold (`**text**`), italic (`*text*`)
- Inline code (`` `code` ``)
- Links (`[text](url)`)
- Unordered lists (`- item`)
- Inline math (`$E = mc^2$`)
- Block math (`$$\int_0^1 f(x) dx$$`)

**LaTeX math bold**: Do NOT use Markdown `**` inside math expressions — it renders as plain text. Use `\bm{}` (bold-italic, recommended for symbols) or `\mathbf{}` (bold-upright) instead. Example: `$\bm{\kappa}$` → **κ**, `$\mathbf{A}$` → **A**.

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fontFamily` | string | `"Inter"` | Font family |
| `fontSize` | number | `24` | Base font size in px (headings scale relative to this) |
| `color` | string | `"#ffffff"` | Text color |
| `textAlign` | `"left"` \| `"center"` \| `"right"` | `"left"` | Horizontal alignment |
| `lineHeight` | number | `1.5` | Line height multiplier |
| `verticalAlign` | `"top"` \| `"middle"` \| `"bottom"` | `"top"` | Vertical alignment within the box |

### `"image"`

Renders an image.

```json
{
  "id": "e2",
  "type": "image",
  "src": "./assets/diagram.png",
  "alt": "System architecture diagram showing client-server interaction",
  "position": { "x": 500, "y": 100 },
  "size": { "w": 400, "h": 300 },
  "style": {
    "objectFit": "contain",
    "borderRadius": 8,
    "opacity": 1
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | string | yes | Image path relative to project root, or absolute URL |
| `alt` | string | no | Alt text describing the image content. Helps AI agents understand what the image depicts beyond just the filename. Also used for accessibility and PPTX export. |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `objectFit` | `"contain"` \| `"cover"` \| `"fill"` | `"contain"` | Image fit behavior |
| `borderRadius` | number | `0` | Corner radius in px |
| `opacity` | number | `1` | Opacity (0-1) |
| `border` | string | none | CSS border (e.g., `"2px solid #fff"`) |

### `"code"`

Renders a syntax-highlighted code block.

```json
{
  "id": "e3",
  "type": "code",
  "language": "typescript",
  "content": "const greeting = (name: string) => {\n  return `Hello, ${name}!`;\n};",
  "position": { "x": 60, "y": 300 },
  "size": { "w": 840, "h": 180 },
  "style": {
    "theme": "github-dark",
    "fontSize": 16,
    "lineNumbers": false,
    "highlightLines": [2]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `language` | string | yes | Language identifier (e.g., `"typescript"`, `"python"`, `"rust"`) |
| `content` | string | yes | Raw code string |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | string | `"github-dark"` | Shiki theme name |
| `fontSize` | number | `16` | Font size in px |
| `lineNumbers` | boolean | `false` | Show line numbers |
| `highlightLines` | number[] | `[]` | 1-indexed line numbers to highlight |
| `borderRadius` | number | `8` | Corner radius |

### `"shape"`

Renders a geometric shape.

```json
{
  "id": "e4",
  "type": "shape",
  "shape": "rectangle",
  "position": { "x": 100, "y": 100 },
  "size": { "w": 200, "h": 200 },
  "style": {
    "fill": "#3b82f6",
    "stroke": "#60a5fa",
    "strokeWidth": 2,
    "borderRadius": 16,
    "opacity": 0.8
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shape` | `"rectangle"` \| `"ellipse"` \| `"line"` \| `"arrow"` | yes | Shape type |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fill` | string | `"transparent"` | Fill color |
| `stroke` | string | `"#ffffff"` | Stroke color |
| `strokeWidth` | number | `1` | Stroke width in px |
| `borderRadius` | number | `0` | Corner radius (rectangle only) |
| `opacity` | number | `1` | Opacity (0-1) |
| `markerStart` | `"none"` \| `"arrow"` \| `"circle"` | `"none"` | Start marker (line/arrow only) |
| `markerEnd` | `"none"` \| `"arrow"` \| `"circle"` | `"none"` (`"arrow"` for `shape: "arrow"`) | End marker (line/arrow only) |
| `path` | string | — | SVG path `d` attribute for custom line routing (line/arrow only). When absent, line is straight horizontal. |
| `waypoints` | `{x,y}[]` | — | Polyline waypoints in element-local coords (line/arrow only). 2+ points renders a polyline. Takes priority over `path`. |

For `"line"` and `"arrow"`: `position` is the start point. The line extends horizontally by `size.w` pixels. `size.h` is ignored for straight horizontal lines (set to a small value like `1`). The `"arrow"` shape is shorthand for `"line"` with `markerEnd: "arrow"`. Use `markerStart`/`markerEnd` for fine-grained control. **Never use `rotation` on line/arrow elements** — the code asserts against this. Use `waypoints` to control line direction instead.

**Line example** (horizontal divider):
```json
{
  "id": "divider",
  "type": "shape",
  "shape": "line",
  "position": { "x": 60, "y": 260 },
  "size": { "w": 840, "h": 4 },
  "style": { "stroke": "#475569", "strokeWidth": 1 }
}
```

**Arrow example** (pointing right):
```json
{
  "id": "flow-arrow",
  "type": "shape",
  "shape": "arrow",
  "position": { "x": 200, "y": 300 },
  "size": { "w": 560, "h": 4 },
  "style": { "stroke": "#3b82f6", "strokeWidth": 3 }
}
```

**Double-headed arrow**:
```json
{
  "id": "bidirectional",
  "type": "shape",
  "shape": "line",
  "position": { "x": 100, "y": 270 },
  "size": { "w": 300, "h": 4 },
  "style": { "stroke": "#8b5cf6", "strokeWidth": 2, "markerStart": "arrow", "markerEnd": "arrow" }
}
```

**Circle-ended connector**:
```json
{
  "id": "connector",
  "type": "shape",
  "shape": "line",
  "position": { "x": 100, "y": 300 },
  "size": { "w": 200, "h": 4 },
  "style": { "stroke": "#06b6d4", "strokeWidth": 2, "markerStart": "circle", "markerEnd": "arrow" }
}
```

**Curved path** (SVG `d` attribute):
```json
{
  "id": "curve",
  "type": "shape",
  "shape": "line",
  "position": { "x": 100, "y": 100 },
  "size": { "w": 300, "h": 150 },
  "style": { "stroke": "#f59e0b", "strokeWidth": 2, "markerEnd": "arrow", "path": "M 0 75 C 100 0, 200 150, 300 75" }
}
```

**Polyline waypoints** (routed connector):
```json
{
  "id": "routed",
  "type": "shape",
  "shape": "arrow",
  "position": { "x": 100, "y": 100 },
  "size": { "w": 300, "h": 200 },
  "style": {
    "stroke": "#10b981", "strokeWidth": 2,
    "waypoints": [{"x": 0, "y": 100}, {"x": 150, "y": 100}, {"x": 150, "y": 0}, {"x": 300, "y": 0}]
  }
}
```

Waypoints are in element-local coordinates (relative to `position`). They can extend beyond the element's bounding box. In the editor, select a line/arrow and use the Property Panel to add waypoints, then drag the green handles on the canvas. Rendering priority: `waypoints` (2+ points) > `path` > straight line.

**Export limitations**: The `path` and `waypoints` fields are fully rendered in the editor and HTML-based PDF export. Native PDF export draws waypoint line segments. PPTX export falls back to a straight line between first and last waypoint.

### `"tikz"`

Renders a TikZ/PGFPlots diagram via a WASM-based TeX engine (compiled entirely in the browser).

```json
{
  "id": "e6",
  "type": "tikz",
  "content": "\\begin{tikzpicture}\n  \\draw[thick, blue, ->] (0,0) -- (3,2) node[right] {$\\vec{v}$};\n  \\draw[thick, red, ->] (0,0) -- (2,-1) node[right] {$\\vec{u}$};\n  \\draw[dashed, gray] (3,2) -- (5,1);\n  \\draw[dashed, gray] (2,-1) -- (5,1);\n  \\draw[thick, purple, ->] (0,0) -- (5,1) node[right] {$\\vec{v}+\\vec{u}$};\n\\end{tikzpicture}",
  "position": { "x": 200, "y": 100 },
  "size": { "w": 560, "h": 340 },
  "preamble": "",
  "style": {
    "backgroundColor": "#1e1e2e",
    "borderRadius": 8
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | TikZ source code (the body inside `\begin{tikzpicture}...\end{tikzpicture}`) |
| `preamble` | string | no | Additional LaTeX preamble (e.g., extra `\usepackage{}` declarations). `pgfplots` and `pgfplotsset{compat=1.18}` are included by default |

**Auto-managed fields** (do not set these manually — the editor manages them):

| Field | Description |
|-------|-------------|
| `svgUrl` | Path to the rendered SVG. Set automatically after compilation |
| `renderedContent` | Snapshot of `content` at the time of last render. Used to detect stale SVGs |
| `renderedPreamble` | Snapshot of `preamble` at the time of last render |

When you create or modify a TikZ element, only set `content` and optionally `preamble`. The editor will compile the TikZ source and populate the other fields automatically.

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `backgroundColor` | string | `"#1e1e2e"` | Background color behind the rendered SVG |
| `borderRadius` | number | `0` | Corner radius in px |

**PGFPlots example** (bar chart):
```json
{
  "id": "chart",
  "type": "tikz",
  "content": "\\begin{tikzpicture}\n  \\begin{axis}[\n    ybar,\n    bar width=20pt,\n    xlabel={Category},\n    ylabel={Value},\n    symbolic x coords={A, B, C, D},\n    xtick=data,\n    nodes near coords,\n    axis lines=left,\n    enlarge x limits=0.2\n  ]\n    \\addplot coordinates {(A,45) (B,72) (C,38) (D,91)};\n  \\end{axis}\n\\end{tikzpicture}",
  "position": { "x": 160, "y": 80 },
  "size": { "w": 640, "h": 400 },
  "style": { "backgroundColor": "#0f172a" }
}
```

**TikZJax Engine Limitations**:

The TikZ renderer uses TikZJax (a WASM-based TeX engine), NOT full pdflatex. Key constraints:

| Category | Supported (verified) | NOT Supported (verified) |
|----------|---------------------|------------------------|
| Math | `\mathbf`, `\mathrm`, `\hat`, `\vec`, `\in`, `\tau` | `\mathbb` (requires amssymb — silently fails) |
| Packages | `tikz` core, `pgfplots` | `amssymb`, `amsfonts` |
| Features | `\definecolor{...}{RGB}{r,g,b}`, `\footnotesize`, `\scriptsize`, `\bfseries` | Untested: `\colorlet`, complex TikZ libraries |

Workarounds for common issues:
- `\mathbb{R}` → use `\mathbf{R}` instead
- If compilation fails silently (error: "Could not find file input.dvi"), the TikZ source has an unsupported command — simplify

**SVG Fitting & Container Sizing**:

The rendered SVG is scaled to fit inside the element's `size` container while preserving aspect ratio. This means:

1. **Aspect ratio mismatch = clipping or dead space.** If the diagram is tall but the container is wide, the top/bottom will be cropped (or vice versa).
2. **Design the diagram's aspect ratio to match the container.** For a container of `w: 880, h: 200` (ratio 4.4:1), the TikZ coordinate range should have a similar ratio (e.g., 8.8cm wide × 2cm tall).
3. **Two-line nodes are taller than `minimum height`.** A node with `\\` (line break) expands beyond `minimum height` to fit text. Account for this when estimating total diagram height.
4. **Leave margin in the TikZ coordinates.** If the top row of nodes is at `y=0`, the node border extends above `y=0`. Either shift content down (e.g., start at `y=-0.5`) or increase the container height.

**Sizing rule of thumb**: For `\footnotesize` text with two-line nodes (`minimum height=0.7cm`), actual node height is ~0.9cm. For `\small` text, ~1.1cm.

**Explicit bounding box (CRITICAL)**: TikZJax computes a tight SVG bounding box that often clips multi-line nodes. Always add an invisible `\path` rectangle as the first drawing command to force the correct bounding box:

```latex
% After \definecolor declarations, BEFORE any \node or \draw:
\path (xmin, ymax) rectangle (xmax, ymin);
```

Calculate the bounds by taking the outermost node centers ± half their actual size, plus ~0.2cm padding. Example for a diagram with nodes from x=-1 to x=7 and y=+0.5 to y=-2:

```latex
\path (-1.2, 0.7) rectangle (7.2, -2.2);
```

This is the single most common cause of clipped TikZ diagrams. **Always include it.**

**`backgroundColor`**: Must be `#rrggbb` — do NOT use `"transparent"` (causes console error).

### TikZ vs Native Elements for Diagrams

For **flow diagrams, pipeline diagrams, and block-and-arrow layouts**, prefer **native elements** (`shape` + `text`) over TikZ. Native elements give you:

1. **Pixel-perfect coordinate control** — positions are in the 960×540 virtual canvas, no TikZ→SVG→fit scaling ambiguity
2. **Per-element animations** — each box and arrow can fade in independently on click, enabling step-by-step reveal
3. **No rendering issues** — no TikZJax engine limitations, no bounding box clipping, no font fallback issues
4. **Direct text rendering** — Markdown and inline LaTeX math (`$\tau$`) work in `text` elements without escaping gymnastics

**When TikZ is still better:**
- Complex mathematical plots (PGFPlots bar/line/scatter charts)
- Diagrams requiring precise curved paths, Bézier curves, or complex node shapes
- TikZ library features like `calc`, `intersections`, `decorations`
- Diagrams where the visual density is too high for discrete elements

#### How to Build Flow Diagrams with Native Elements

**Step 1: Plan the layout.** Sketch box positions on the 960×540 canvas. Typical box sizes:
- Standard box: `w: 110–160, h: 38–45`
- Wide box (with subtitle): `w: 150–200, h: 55–70`
- Arrow gap between boxes: `40–65px`

**Step 2: Build each box as a shape + text pair** with the same `groupId`:

```json
{
  "id": "my-box",
  "type": "shape", "shape": "rectangle",
  "position": { "x": 200, "y": 140 },
  "size": { "w": 140, "h": 42 },
  "style": {
    "fill": "rgba(124,58,237,0.08)",
    "stroke": "#7c3aed",
    "strokeWidth": 2,
    "borderRadius": 8
  },
  "groupId": "group-my-box"
},
{
  "id": "my-box-text",
  "type": "text",
  "content": "**SAC Policy**",
  "position": { "x": 200, "y": 140 },
  "size": { "w": 140, "h": 42 },
  "style": { "fontSize": 14, "color": "#7c3aed", "textAlign": "center", "verticalAlign": "middle" },
  "groupId": "group-my-box"
}
```

**Step 3: Connect boxes with native arrow elements.** Use `"shape": "arrow"` with `waypoints` for direction:

> **IMPORTANT: Never use `rotation` on line/arrow elements.** The code will assert-fail. Use `waypoints` to control direction instead.

```json
{
  "id": "arrow-a-b",
  "type": "shape", "shape": "arrow",
  "position": { "x": 340, "y": 155 },
  "size": { "w": 60, "h": 1 },
  "style": { "stroke": "#7c3aed", "strokeWidth": 2 }
}
```

**Arrow directions via `waypoints`:**
- Right (default): `waypoints` omitted (straight horizontal line from `position`)
- Down: `"size": { "w": 1, "h": 60 }` with `"waypoints": [{ "x": 0, "y": 0 }, { "x": 0, "y": 60 }]`
- Left: `"waypoints": [{ "x": 60, "y": 0 }, { "x": 0, "y": 0 }]` (reverses marker direction)
- Up: `"size": { "w": 1, "h": 60 }` with `"waypoints": [{ "x": 0, "y": 60 }, { "x": 0, "y": 0 }]`

If the arrow has a label, group them together:

```json
{
  "id": "arrow-yes", "type": "shape", "shape": "arrow",
  "position": { "x": 510, "y": 340 }, "size": { "w": 80, "h": 1 },
  "style": { "stroke": "#22c55e", "strokeWidth": 2 },
  "groupId": "group-arrow-yes"
},
{
  "id": "label-yes", "type": "text", "content": "Yes",
  "position": { "x": 530, "y": 322 }, "size": { "w": 40, "h": 18 },
  "style": { "fontSize": 12, "color": "#22c55e", "textAlign": "center" },
  "groupId": "group-arrow-yes"
}
```

**Step 4: Build feedback loops.** Use `waypoints` for vertical segments:

```json
{ "id": "fb-right", "type": "shape", "shape": "line",
  "position": { "x": 804, "y": 100 }, "size": { "w": 1, "h": 40 },
  "style": { "stroke": "#7c3aed", "strokeWidth": 2, "waypoints": [{ "x": 0, "y": 0 }, { "x": 0, "y": 40 }] } },
{ "id": "fb-horiz", "type": "shape", "shape": "line",
  "position": { "x": 270, "y": 100 }, "size": { "w": 536, "h": 1 },
  "style": { "stroke": "#7c3aed", "strokeWidth": 2 } },
{ "id": "fb-left", "type": "shape", "shape": "line",
  "position": { "x": 269, "y": 100 }, "size": { "w": 1, "h": 40 },
  "style": { "stroke": "#7c3aed", "strokeWidth": 2, "waypoints": [{ "x": 0, "y": 0 }, { "x": 0, "y": 40 }] } }
```

**Step 5: Add step-by-step animation.** Each click reveals one logical group:

```json
{ "target": "box-bg",   "trigger": "onClick",      "effect": "fadeIn", "duration": 300 },
{ "target": "box-text", "trigger": "withPrevious",  "effect": "fadeIn", "duration": 300 },
{ "target": "arrow-ab", "trigger": "withPrevious",  "effect": "fadeIn", "duration": 300 }
```

Use `"onClick"` for the first element in each group, `"withPrevious"` for siblings.

**Color convention for pipeline diagrams:**
- 🟢 Green (`#16a34a`): Data sources (MoCap, datasets)
- 🟣 Purple (`#7c3aed`): RL-trained components
- 🟠 Orange (`#ea580c`): Supervised / unsupervised learning
- ⬜ Gray (`#94a3b8`): Frozen / fixed components
- 🔴 Red (`#dc2626`): Simulators
- 🔵 Blue (`#3b82f6`): Math / computation

Use `rgba()` fills at 6–8% opacity with the matching stroke color for a cohesive look.

### `"mermaid"`

Renders a Mermaid diagram client-side. Unlike TikZ, no server-side adapter is needed — the `mermaid` library runs entirely in the browser.

```json
{
  "id": "e-mermaid",
  "type": "mermaid",
  "content": "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Cancel]",
  "position": { "x": 200, "y": 100 },
  "size": { "w": 400, "h": 300 },
  "style": {
    "backgroundColor": "#1e1e2e",
    "borderRadius": 8
  }
}
```

**Content format**: Any valid Mermaid diagram syntax — flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, etc.

**Caching**: On successful render, `renderedSvg` and `renderedContent` are stored on the element. Re-renders only trigger when `content` changes.

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `backgroundColor` | string | `"transparent"` | Background behind the diagram |
| `borderRadius` | number | `0` | Corner rounding in px |

### `"table"`

Renders a data table with column headers and rows.

```json
{
  "id": "e8",
  "type": "table",
  "columns": ["Name", "Role", "Status"],
  "rows": [
    ["Alice", "Engineer", "Active"],
    ["Bob", "Designer", "Active"],
    ["Carol", "PM", "On Leave"]
  ],
  "position": { "x": 60, "y": 120 },
  "size": { "w": 500, "h": 200 },
  "style": {
    "fontSize": 14,
    "color": "#e2e8f0",
    "headerBackground": "#1e293b",
    "headerColor": "#f8fafc",
    "borderColor": "#334155",
    "striped": true,
    "borderRadius": 8
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `columns` | string[] | yes | Header labels for each column |
| `rows` | string[][] | yes | 2D array of cell data. Each inner array is one row |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fontSize` | number | `14` | Font size in px |
| `color` | string | `"#e2e8f0"` | Body text color |
| `headerBackground` | string | `"#1e293b"` | Header row background color |
| `headerColor` | string | `"#f8fafc"` | Header row text color |
| `borderColor` | string | `"#334155"` | Border/divider color |
| `striped` | boolean | `false` | Alternate row background shading |
| `borderRadius` | number | `8` | Corner radius of the table container |

### `"custom"`

Renders a user-defined React component loaded from the project's `components/` directory.

```json
{
  "id": "e7",
  "type": "custom",
  "component": "InteractiveChart",
  "props": {
    "data": [10, 25, 40, 30, 55],
    "color": "#3b82f6",
    "animated": true
  },
  "position": { "x": 100, "y": 100 },
  "size": { "w": 760, "h": 380 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `component` | string | yes | Component filename (without extension) from the project's `components/` directory |
| `props` | object | no | Arbitrary props passed to the component. The component also receives `size: { w, h }` automatically |

The component must be a default-exported React component placed in the project folder (e.g., `components/InteractiveChart.tsx`).

### `"video"`

Renders a video player. Supports local MP4/WebM files, YouTube URLs, and Vimeo URLs.

```json
{
  "id": "e5",
  "type": "video",
  "src": "./assets/demo.mp4",
  "position": { "x": 60, "y": 100 },
  "size": { "w": 840, "h": 380 },
  "autoplay": false,
  "loop": false,
  "muted": false,
  "controls": true,
  "style": {
    "objectFit": "contain",
    "borderRadius": 8
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | string | yes | Video source: local path (`./assets/video.mp4`), YouTube URL, or Vimeo URL |
| `autoplay` | boolean | no | Auto-play when slide is shown. Default: `false` |
| `loop` | boolean | no | Loop playback. Default: `false` |
| `muted` | boolean | no | Mute audio. Default: `false` |
| `controls` | boolean | no | Show player controls. Default: `false` |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `objectFit` | `"contain"` \| `"cover"` \| `"fill"` | `"contain"` | Video fit behavior |
| `borderRadius` | number | `0` | Corner radius in px |

**Source URL handling**:

- **Local files**: `"./assets/video.mp4"` — served from the project's assets folder
- **YouTube**: `"https://www.youtube.com/watch?v=VIDEO_ID"` or `"https://youtu.be/VIDEO_ID"` — auto-converted to embed iframe
- **Vimeo**: `"https://vimeo.com/VIDEO_ID"` — auto-converted to embed iframe

**Video examples**:

Local MP4 with autoplay (muted required for browser autoplay policy):
```json
{
  "id": "bg-video",
  "type": "video",
  "src": "./assets/background.mp4",
  "position": { "x": 0, "y": 0 },
  "size": { "w": 960, "h": 540 },
  "autoplay": true,
  "loop": true,
  "muted": true,
  "style": { "objectFit": "cover" }
}
```

YouTube embed with controls:
```json
{
  "id": "yt-demo",
  "type": "video",
  "src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "position": { "x": 180, "y": 80 },
  "size": { "w": 600, "h": 338 },
  "controls": true,
  "muted": true
}
```

### `"scene3d"`

Renders an interactive 3D scene using Three.js (React Three Fiber). Supports multiple geometry types, PBR materials, camera controls, and keyframe animations.

```json
{
  "id": "my-scene",
  "type": "scene3d",
  "position": { "x": 60, "y": 100 },
  "size": { "w": 520, "h": 380 },
  "scene": {
    "camera": { "position": [4, 3, 4], "target": [0, 0, 0], "fov": 50 },
    "ambientLight": 0.4,
    "directionalLight": { "position": [5, 10, 5], "intensity": 0.9 },
    "objects": [
      {
        "id": "cube",
        "geometry": "box",
        "position": [0, 0.5, 0],
        "material": { "color": "#60a5fa", "metalness": 0.3, "roughness": 0.5 }
      }
    ],
    "orbitControls": true,
    "helpers": { "grid": true, "axes": true }
  },
  "keyframes": [ ... ],
  "style": { "borderRadius": 12 }
}
```

#### `scene` (Scene3DConfig) — required

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `camera` | object | no | Camera setup (see below). Default: position `[5, 5, 5]`, target `[0, 0, 0]`, fov `50` |
| `background` | string | no | Scene background color (hex). Default: transparent (slide background shows through) |
| `ambientLight` | number | no | Ambient light intensity (0-1). Default: `0.5` |
| `directionalLight` | object | no | `{ position: [x, y, z], intensity?: number }`. Default intensity: `0.8` |
| `objects` | array | yes | Array of Scene3DObject (see below) |
| `helpers` | object | no | `{ grid?: boolean, axes?: boolean }`. Debug helpers |
| `orbitControls` | boolean | no | Enable mouse drag-to-rotate. Default: `false` |

**Camera**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `position` | `[x, y, z]` | `[5, 5, 5]` | Camera location in 3D space |
| `target` | `[x, y, z]` | `[0, 0, 0]` | Look-at point |
| `fov` | number | `50` | Field of view in degrees |

**Scene3DObject**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique object ID (used by keyframe `target`) |
| `geometry` | string | yes | `"box"` \| `"sphere"` \| `"cylinder"` \| `"cone"` \| `"torus"` \| `"plane"` \| `"line"` \| `"surface"` |
| `position` | `[x, y, z]` | no | 3D position. Default: `[0, 0, 0]` |
| `rotation` | `[x, y, z]` | no | Euler rotation in radians. Default: `[0, 0, 0]` |
| `scale` | `[x, y, z]` | no | Scale factors. Default: `[1, 1, 1]` |
| `material` | object | no | Material properties (see below) |
| `label` | string | no | Text label displayed near the object |
| `visible` | boolean | no | Initial visibility. Default: `true` |
| `points` | `[x, y, z][]` | no | For `"line"` geometry only: array of 3D points defining the curve |
| `surface` | object | no | For `"surface"` geometry only: parametric surface config (see below) |

**Material (Scene3DMaterial)**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `color` | string | `"#ffffff"` | Hex color |
| `opacity` | number | `1` | Opacity (0-1) |
| `wireframe` | boolean | `false` | Render as wireframe |
| `metalness` | number | `0` | Metallic appearance (0-1) |
| `roughness` | number | `0.5` | Surface roughness (0-1) |
| `lineWidth` | number | `2` | Line width (for `"line"` geometry only) |

#### `keyframes` — optional

Array of keyframe objects. Each keyframe defines a set of changes applied cumulatively when the scene advances a step.

```json
{
  "keyframes": [
    {
      "duration": 800,
      "camera": { "position": [0, 5, 6] },
      "changes": [
        { "target": "cube", "rotation": [0, 0.785, 0] },
        { "target": "sphere", "visible": true }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration` | number | no | Transition duration in ms |
| `camera` | object | no | Camera changes: `position`, `target`, `fov` |
| `changes` | array | yes | Array of object changes |
| `changes[].target` | string | yes | Object ID to modify |
| `changes[].position` | `[x, y, z]` | no | New position |
| `changes[].rotation` | `[x, y, z]` | no | New rotation (radians) |
| `changes[].scale` | `[x, y, z]` | no | New scale |
| `changes[].material` | object | no | Material property changes (merged) |
| `changes[].visible` | boolean | no | Show/hide the object |
| `changes[].points` | `[x, y, z][]` | no | New curve points (for `"line"` geometry) |
| `changes[].surface` | object | no | Partial surface config update (for `"surface"` geometry). Fields are merged. |

Keyframes are **cumulative**: step 2 applies on top of step 1's changes.

#### Keyframe Animation Wiring

To trigger keyframe steps during a presentation, add `scene3dStep` animations targeting the scene3d element. Each `onClick` + `scene3dStep` advances the scene by one keyframe.

```json
{
  "animations": [
    { "target": "my-scene", "trigger": "onEnter", "effect": "scaleIn", "duration": 500 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 1 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 2 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 3 }
  ]
}
```

The number of `scene3dStep` animations should match the number of keyframes. The `order` field sequences them.

#### Style fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `borderRadius` | number | `0` | Corner radius in px |

#### Tips

- **Transparent background**: Omit `scene.background` so the slide background shows through the 3D canvas. This allows placing text or other elements behind the scene.
- **Floor plane**: Use a `"plane"` geometry with rotation `[-1.5708, 0, 0]` (−π/2 on X) to create a horizontal floor. Scale it up to desired size.
- **Orbit controls**: Enable `orbitControls: true` for interactive scenes the audience can rotate. Disable for static diagrams or when keyframe camera animations should not be overridden.
- **Thumbnails**: Scene3D elements render a static SVG placeholder in slide thumbnails to avoid WebGL overhead.
- **Object visibility**: Set `"visible": false` on objects to hide them initially, then reveal with a keyframe change `{ "target": "id", "visible": true }`.

#### Line geometry example (3D data curves)

```json
{
  "id": "graph-scene",
  "type": "scene3d",
  "position": { "x": 30, "y": 120 },
  "size": { "w": 900, "h": 380 },
  "scene": {
    "background": "#f8fafc",
    "camera": { "position": [6, 4, 6], "target": [2, 1, 0], "fov": 50 },
    "ambientLight": 0.6,
    "directionalLight": { "position": [5, 10, 5], "intensity": 0.8 },
    "objects": [
      {
        "id": "revenue",
        "geometry": "line",
        "points": [
          [0, 0, 0], [0.5, 0.8, 0], [1, 1.5, 0], [1.5, 1.8, 0],
          [2, 2.0, 0], [2.5, 2.3, 0], [3, 2.8, 0], [3.5, 3.2, 0], [4, 3.5, 0]
        ],
        "material": { "color": "#3b82f6", "lineWidth": 3 },
        "label": "Revenue"
      },
      {
        "id": "costs",
        "geometry": "line",
        "points": [
          [0, 0.5, 1], [0.5, 0.7, 1], [1, 0.6, 1], [1.5, 0.9, 1],
          [2, 1.2, 1], [2.5, 1.0, 1], [3, 1.4, 1], [3.5, 1.8, 1], [4, 2.0, 1]
        ],
        "material": { "color": "#f59e0b", "lineWidth": 3 },
        "label": "Costs"
      }
    ],
    "orbitControls": true,
    "helpers": { "grid": true, "axes": true }
  },
  "keyframes": [
    {
      "duration": 800,
      "changes": [
        {
          "target": "revenue",
          "points": [
            [0, 0, 0], [0.5, 1.0, 0], [1, 1.8, 0], [1.5, 2.5, 0],
            [2, 2.8, 0], [2.5, 3.0, 0], [3, 3.5, 0], [3.5, 4.0, 0], [4, 4.5, 0]
          ]
        }
      ]
    }
  ],
  "style": { "borderRadius": 12 }
}
```

#### Surface geometry (parametric math surfaces)

Renders a mathematical surface `y = f(x, z)` as a filled triangulated mesh with optional height-based vertex coloring.

**Surface config (`Scene3DSurface`)**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fn` | string | *(required)* | Math expression in `x` and `z`. Example: `"sin(x) * cos(z)"` |
| `xRange` | `[min, max]` | `[-3, 3]` | X-axis domain |
| `zRange` | `[min, max]` | `[-3, 3]` | Z-axis domain |
| `resolution` | number | `48` | Grid subdivisions (higher = smoother, more triangles) |
| `colorRange` | `[low, high]` | — | Height gradient as two hex colors. When set, vertex colors are applied. |

**Available math functions**: `sin`, `cos`, `tan`, `abs`, `sqrt`, `exp`, `log`, `pow`, `floor`, `ceil`, `round`, `min`, `max`, `PI`, `E`

```json
{
  "id": "wave",
  "geometry": "surface",
  "surface": {
    "fn": "sin(x) * cos(z)",
    "xRange": [-3, 3],
    "zRange": [-3, 3],
    "resolution": 48,
    "colorRange": ["#0ea5e9", "#f97316"]
  },
  "material": { "roughness": 0.6, "metalness": 0.2 }
}
```

To morph between functions in keyframes, use partial `surface` updates in `changes[]`:

```json
{
  "changes": [
    {
      "target": "wave",
      "surface": {
        "fn": "exp(-(x*x + z*z) * 0.3) * 2",
        "colorRange": ["#6366f1", "#ec4899"]
      }
    }
  ]
}
```

The mesh renders double-sided so the surface is visible from below when using orbit controls.

#### Complete scene3d example (interactive with keyframes)

```json
{
  "id": "s3d-main",
  "type": "scene3d",
  "position": { "x": 60, "y": 100 },
  "size": { "w": 520, "h": 380 },
  "scene": {
    "camera": { "position": [4, 3, 4], "target": [0, 0, 0], "fov": 50 },
    "ambientLight": 0.4,
    "directionalLight": { "position": [5, 10, 5], "intensity": 0.9 },
    "objects": [
      {
        "id": "cube",
        "geometry": "box",
        "position": [0, 0.5, 0],
        "material": { "color": "#60a5fa", "metalness": 0.3, "roughness": 0.5 }
      },
      {
        "id": "sphere",
        "geometry": "sphere",
        "position": [2, 0.5, 0],
        "scale": [0.8, 0.8, 0.8],
        "material": { "color": "#fbbf24", "metalness": 0.5, "roughness": 0.3 },
        "visible": false
      },
      {
        "id": "floor",
        "geometry": "plane",
        "position": [0, 0, 0],
        "rotation": [-1.5708, 0, 0],
        "scale": [6, 6, 1],
        "material": { "color": "#e8edf5", "roughness": 0.8 }
      }
    ],
    "orbitControls": true,
    "helpers": { "grid": true, "axes": true }
  },
  "keyframes": [
    {
      "duration": 800,
      "camera": { "position": [0, 5, 6] },
      "changes": [
        { "target": "cube", "rotation": [0, 0.785, 0] }
      ]
    },
    {
      "duration": 600,
      "changes": [
        { "target": "sphere", "visible": true },
        { "target": "cube", "material": { "color": "#a78bfa" } }
      ]
    },
    {
      "duration": 700,
      "camera": { "position": [5, 2, 5] },
      "changes": [
        { "target": "sphere", "position": [2, 1.5, 0], "material": { "color": "#f87171" } },
        { "target": "cube", "scale": [1.3, 1.3, 1.3] }
      ]
    }
  ],
  "style": { "borderRadius": 12 }
}
```

Pair with these animations on the slide:
```json
{
  "animations": [
    { "target": "s3d-main", "trigger": "onEnter", "effect": "scaleIn", "duration": 500 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 1 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 2 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 3 }
  ]
}
```

---

## Animations

Animations are defined per-slide and reference elements by ID.

```json
{
  "animations": [
    { "target": "e1", "trigger": "onEnter", "effect": "fadeIn", "delay": 0, "duration": 400 },
    { "target": "e2", "trigger": "onClick", "effect": "slideInLeft", "delay": 200, "duration": 500 },
    { "target": "e3", "trigger": "afterPrevious", "effect": "fadeIn", "duration": 300 },
    { "target": "e4", "trigger": "withPrevious", "effect": "scaleIn", "duration": 400 },
    { "target": "e5", "trigger": "onKey", "key": "v", "effect": "fadeIn", "duration": 300 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | string | yes | Element ID to animate |
| `trigger` | string | yes | When to trigger (see below) |
| `effect` | string | yes | Animation effect name |
| `delay` | number | no | Delay in ms. Default: `0` |
| `duration` | number | no | Duration in ms. Default: `400` |
| `order` | number | no | Explicit animation sequence number. Controls the step order for `onClick` triggers |
| `key` | string | no | Key to press (required when trigger is `"onKey"`) |

**Triggers**:

| Trigger | Description |
|---------|-------------|
| `"onEnter"` | Plays automatically when the slide is entered |
| `"onClick"` | Plays on click/spacebar/right-arrow (advances through one step at a time) |
| `"afterPrevious"` | Auto-plays after the previous animation finishes |
| `"withPrevious"` | Plays simultaneously with the previous animation |
| `"onKey"` | Plays when a specific key is pressed (requires `key` field) |

**Available effects**: `fadeIn`, `fadeOut`, `slideInLeft`, `slideInRight`, `slideInUp`, `slideInDown`, `scaleIn`, `scaleOut`, `typewriter`, `scene3dStep`

`scene3dStep` is a special effect for `scene3d` elements only. It does not produce a CSS animation — it advances the scene to the next keyframe. Pair one `scene3dStep` animation per keyframe, with sequential `order` values.

### Animation Examples

**Step-by-step reveal** (click to reveal each bullet):
```json
{
  "animations": [
    { "target": "bullet1", "trigger": "onClick", "effect": "fadeIn", "duration": 300 },
    { "target": "bullet2", "trigger": "onClick", "effect": "fadeIn", "duration": 300 },
    { "target": "bullet3", "trigger": "onClick", "effect": "fadeIn", "duration": 300 }
  ]
}
```

**Auto-cascade** (elements appear one after another):
```json
{
  "animations": [
    { "target": "title", "trigger": "onEnter", "effect": "slideInDown", "duration": 400 },
    { "target": "subtitle", "trigger": "afterPrevious", "effect": "fadeIn", "delay": 100, "duration": 300 },
    { "target": "image", "trigger": "afterPrevious", "effect": "scaleIn", "duration": 500 }
  ]
}
```

**Video reveal on click** (click to fade in a video player):
```json
{
  "elements": [
    {
      "id": "play-label",
      "type": "text",
      "content": "Click to play demo",
      "position": { "x": 300, "y": 250 },
      "size": { "w": 360, "h": 40 },
      "style": { "fontSize": 20, "color": "#94a3b8", "textAlign": "center" }
    },
    {
      "id": "demo-video",
      "type": "video",
      "src": "./assets/demo.mp4",
      "position": { "x": 80, "y": 80 },
      "size": { "w": 800, "h": 400 },
      "autoplay": true,
      "muted": true,
      "controls": true
    }
  ],
  "animations": [
    { "target": "demo-video", "trigger": "onClick", "effect": "fadeIn", "duration": 400 },
    { "target": "play-label", "trigger": "withPrevious", "effect": "fadeOut", "duration": 200 }
  ]
}
```

---

## Theme

The optional top-level `theme` object provides default styles per element type. These act as a middle layer between hardcoded defaults and per-element `style` overrides.

**Resolution order**: `element.style` > `deck.theme` > hardcoded defaults

Each key in the theme object corresponds to an element type and accepts the same style fields as that element's `style` property.

| Theme key | Style fields | Hardcoded defaults |
|-----------|-------------|-------------------|
| `theme.slide.background` | `color`, `image` | `color: "#0f172a"` |
| `theme.text` | `fontFamily`, `fontSize`, `color`, `textAlign`, `lineHeight`, `verticalAlign` | `fontFamily: "Inter"`, `fontSize: 24`, `color: "#ffffff"`, `lineHeight: 1.5` |
| `theme.code` | `theme`, `fontSize`, `lineNumbers`, `borderRadius` | `theme: "github-dark"`, `fontSize: 16`, `borderRadius: 8` |
| `theme.shape` | `fill`, `stroke`, `strokeWidth`, `borderRadius`, `opacity`, `markerStart`, `markerEnd`, `path`, `waypoints` | `stroke: "#ffffff"`, `strokeWidth: 1` |
| `theme.image` | `objectFit`, `borderRadius`, `opacity` | `objectFit: "contain"` |
| `theme.video` | `objectFit`, `borderRadius` | `objectFit: "contain"` |
| `theme.tikz` | `backgroundColor`, `borderRadius` | `backgroundColor: "#1e1e2e"` |
| `theme.table` | `fontSize`, `color`, `headerBackground`, `headerColor`, `borderColor`, `striped`, `borderRadius` | `fontSize: 14`, `headerBackground: "#1e293b"` |

To change the default text color for the entire deck to red without touching individual elements:

```json
{
  "theme": { "text": { "color": "#ff0000" } }
}
```

Elements with an explicit `style.color` will still use their own value.

---

## Layout Templates

Deckode includes built-in layout templates that provide pre-positioned elements as a starting point for slides. Set the `layout` field on a slide to use one. Elements from the template are merged into the slide; you can override them or add more.

| Layout Name | Description |
|-------------|-------------|
| `"blank"` | Empty slide with only a background. The default when no layout is specified |
| `"title"` | Large centered title with optional subtitle |
| `"title-content"` | Heading at top + body text area below |
| `"two-column"` | Heading + two side-by-side content columns |
| `"section-header"` | Full-slide section divider with centered text |
| `"code-slide"` | Heading + large code block area |
| `"image-left"` | Image on the left half, text content on the right |

**Usage**: Set the `layout` field on a slide object:

```json
{
  "id": "s1",
  "layout": "title-content",
  "elements": [
    {
      "id": "heading",
      "type": "text",
      "content": "## My Custom Title",
      "position": { "x": 60, "y": 30 },
      "size": { "w": 840, "h": 60 },
      "style": { "fontSize": 32, "color": "#f8fafc" }
    },
    {
      "id": "body",
      "type": "text",
      "content": "Content goes here...",
      "position": { "x": 60, "y": 110 },
      "size": { "w": 840, "h": 380 },
      "style": { "fontSize": 20, "color": "#cbd5e1" }
    }
  ]
}
```

---

## Speaker Notes

Each slide can have a `notes` field with plain text or Markdown content. Notes are displayed in the presenter console during presentations.

### Animation-Aware Notes

Use `[step:N]...[/step]` markers to highlight sections of your notes as animations progress. This helps presenters know what to say at each animation step.

```json
{
  "id": "s2",
  "notes": "Welcome everyone to today's talk.\n\n[step:1]First, let's look at the problem statement. Our current tools are too restrictive.[/step]\n\n[step:2]Here's our proposed solution — a JSON-based approach that gives full control.[/step]\n\n[step:3]And these are the results from our beta testing.[/step]",
  "elements": [ ... ],
  "animations": [
    { "target": "problem", "trigger": "onClick", "effect": "fadeIn" },
    { "target": "solution", "trigger": "onClick", "effect": "slideInLeft" },
    { "target": "results", "trigger": "onClick", "effect": "fadeIn" }
  ]
}
```

**Behavior**:
- Text outside `[step:N]...[/step]` markers is always visible
- Text inside markers is dimmed by default and highlighted (yellow) when the animation reaches that step
- Steps correspond to the order of `onClick` animations: the first `onClick` is step 1, the second is step 2, etc.

---

## Rotation

Any element can be rotated by setting the `rotation` field (degrees, clockwise). **Exception: `line` and `arrow` shapes must NOT use `rotation`** — the code will assert-fail. Use `waypoints` for line/arrow direction instead.

```json
{
  "id": "label",
  "type": "text",
  "content": "DRAFT",
  "position": { "x": 300, "y": 200 },
  "size": { "w": 360, "h": 80 },
  "rotation": -15,
  "style": { "fontSize": 48, "color": "#ef444480", "textAlign": "center" }
}
```

Rotation is applied as a CSS `transform: rotate()` on the element's bounding box. The element rotates around its center point.

---

## Guidelines for AI

### Creating a New Deck

1. Start with the top-level structure including `deckode` version and `meta`
2. Create slides with unique sequential IDs (`s1`, `s2`, ...)
3. Within each slide, create elements with unique sequential IDs (`e1`, `e2`, ...)
4. Position elements thoughtfully — avoid overlaps unless intentional
5. Use the full 960x540 canvas. Leave margins (~40-60px) for visual breathing room

### Layout Tips

- **Title slides**: Large centered text (fontSize 48-64), optionally a subtitle below
- **Content slides**: Title at top (y: 30-60), body content below (y: 120+)
- **Two-column**: Left column x: 40-460, right column x: 500-920
- **Full-bleed image**: position `{ "x": 0, "y": 0 }`, size `{ "w": 960, "h": 540 }`
- **Code walkthrough**: Code block on left/top, explanation text on right/bottom

### Color Palettes

Use consistent color schemes. Here are some starting points:

**Dark (default)**:
- Background: `#0f172a` (slate-900)
- Text: `#f8fafc` (slate-50)
- Accent: `#3b82f6` (blue-500)
- Secondary: `#94a3b8` (slate-400)

**Light**:
- Background: `#ffffff`
- Text: `#1e293b` (slate-800)
- Accent: `#2563eb` (blue-600)
- Secondary: `#64748b` (slate-500)

### Content Best Practices

- Keep text concise — slides are not documents
- One idea per slide
- Use Markdown headings to establish hierarchy
- Use `**bold**` for emphasis, sparingly
- Code blocks: show only the relevant lines, not entire files
- Speaker notes (`notes` field) can hold the detailed explanation

### Modifying an Existing Deck

When asked to modify an existing deck:
1. Preserve all existing `id` values — do not regenerate them
2. When adding new elements, use IDs that don't conflict with existing ones
3. When moving elements, only change `position` — preserve all other fields
4. When restyling, only change `style` fields — preserve content and position

---

## Complete Example

```json
{
  "deckode": "0.1.0",
  "meta": {
    "title": "Introduction to Deckode",
    "author": "Son",
    "aspectRatio": "16:9"
  },
  "theme": {
    "slide": { "background": { "color": "#0f172a" } },
    "text": { "color": "#f8fafc" }
  },
  "slides": [
    {
      "id": "s1",
      "background": { "color": "#0f172a" },
      "elements": [
        {
          "id": "e1",
          "type": "text",
          "content": "# Deckode\n\nSlides as Code, Powered by AI",
          "position": { "x": 180, "y": 160 },
          "size": { "w": 600, "h": 220 },
          "style": { "fontSize": 48, "color": "#f8fafc", "textAlign": "center" }
        },
        {
          "id": "e2",
          "type": "shape",
          "shape": "rectangle",
          "position": { "x": 330, "y": 400 },
          "size": { "w": 300, "h": 4 },
          "style": { "fill": "#3b82f6" }
        }
      ],
      "animations": [
        { "target": "e1", "trigger": "onEnter", "effect": "fadeIn", "duration": 600 },
        { "target": "e2", "trigger": "onEnter", "effect": "scaleIn", "delay": 400, "duration": 400 }
      ]
    },
    {
      "id": "s2",
      "background": { "color": "#0f172a" },
      "notes": "Explain the core problem with existing tools",
      "elements": [
        {
          "id": "e1",
          "type": "text",
          "content": "## The Problem",
          "position": { "x": 60, "y": 40 },
          "size": { "w": 840, "h": 60 },
          "style": { "fontSize": 36, "color": "#f8fafc" }
        },
        {
          "id": "e2",
          "type": "text",
          "content": "- **Gamma/Tome**: Cloud-locked, no code access\n- **Slidev/Marp**: Code-only, no visual editor\n- **PowerPoint**: No AI, no web-native features",
          "position": { "x": 60, "y": 130 },
          "size": { "w": 500, "h": 280 },
          "style": { "fontSize": 22, "color": "#cbd5e1", "lineHeight": 1.8 }
        },
        {
          "id": "e3",
          "type": "shape",
          "shape": "rectangle",
          "position": { "x": 600, "y": 130 },
          "size": { "w": 320, "h": 280 },
          "style": { "fill": "#1e293b", "borderRadius": 12 }
        },
        {
          "id": "e4",
          "type": "text",
          "content": "### Deckode\n\nJSON + Visual Editor\n+ AI Agent\n= Full Control",
          "position": { "x": 620, "y": 150 },
          "size": { "w": 280, "h": 240 },
          "style": { "fontSize": 20, "color": "#3b82f6", "textAlign": "center", "verticalAlign": "middle" }
        }
      ]
    },
    {
      "id": "s3",
      "background": { "color": "#0f172a" },
      "elements": [
        {
          "id": "e1",
          "type": "text",
          "content": "## How It Works",
          "position": { "x": 60, "y": 40 },
          "size": { "w": 840, "h": 60 },
          "style": { "fontSize": 36, "color": "#f8fafc" }
        },
        {
          "id": "e2",
          "type": "code",
          "language": "json",
          "content": "{\n  \"type\": \"text\",\n  \"content\": \"# Hello World\",\n  \"position\": { \"x\": 120, \"y\": 200 },\n  \"size\": { \"w\": 720, \"h\": 120 }\n}",
          "position": { "x": 60, "y": 130 },
          "size": { "w": 840, "h": 200 },
          "style": { "fontSize": 18, "theme": "github-dark", "borderRadius": 12 }
        },
        {
          "id": "e3",
          "type": "text",
          "content": "Every visual change maps to a JSON field.\nDrag an element → `position` updates.\nResize → `size` updates.\nAI generates this JSON directly.",
          "position": { "x": 60, "y": 370 },
          "size": { "w": 840, "h": 140 },
          "style": { "fontSize": 20, "color": "#94a3b8", "lineHeight": 1.8 }
        }
      ]
    }
  ]
}
```

This example produces a 3-slide deck: a title slide, a problem statement, and a technical overview. The AI should generate similar structures, adapting content, layout, and styling to match the user's request.

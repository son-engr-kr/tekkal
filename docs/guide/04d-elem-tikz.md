# TikZ Elements

## `"tikz"`

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
| `content` | string | yes | TikZ source code (body inside `\begin{tikzpicture}...\end{tikzpicture}`) |
| `preamble` | string | no | Additional LaTeX preamble. `pgfplots` and `\pgfplotsset{compat=1.18}` are included by default |

**Auto-managed fields** (do not set manually — the editor populates these after compilation): `svgUrl`, `renderedContent`, `renderedPreamble`.

**Style fields**: `backgroundColor` (string, default `"#1e1e2e"`) — must be `#rrggbb`, do NOT use `"transparent"`. `borderRadius` (number, default `0`) — corner radius in px.

**PGFPlots example** (bar chart):
```json
{
  "id": "chart",
  "type": "tikz",
  "content": "\\begin{tikzpicture}\n  \\begin{axis}[\n    ybar, bar width=20pt,\n    xlabel={Category}, ylabel={Value},\n    symbolic x coords={A, B, C, D}, xtick=data,\n    nodes near coords, axis lines=left, enlarge x limits=0.2\n  ]\n    \\addplot coordinates {(A,45) (B,72) (C,38) (D,91)};\n  \\end{axis}\n\\end{tikzpicture}",
  "position": { "x": 160, "y": 80 },
  "size": { "w": 640, "h": 400 },
  "style": { "backgroundColor": "#0f172a" }
}
```

## JSON Escaping (CRITICAL)

TikZ content is stored inside a JSON string. **Every backslash `\` in LaTeX MUST be written as `\\` in JSON.**

| LaTeX | In JSON string |
|-------|---------------|
| `\node` | `\\node` |
| `\draw` | `\\draw` |
| `\path` | `\\path` |
| `\foreach` | `\\foreach` |
| `\begin` | `\\begin` |
| `\end` | `\\end` |
| newline | `\n` (single backslash-n) |

**WRONG** (will render as `ode` instead of `\node`):
```json
"content": "\node[draw] (a) at (0,0) {A};"
```
**CORRECT**:
```json
"content": "\\node[draw] (a) at (0,0) {A};"
```

## TikZJax Engine Limitations

Uses `@drgrice1/tikzjax` v1.0.0-beta24 (WASM e-TeX + PGF SVG driver). **NOT** full pdflatex.

**Available packages** (bundled): `amsbsy`, `amsfonts`, `amsgen`, `amsmath`, `amsopn`, `amssymb`, `amstext`, `array`, `etoolbox`, `hf-tikz`, `ifthen`, `pgfplots`, `tikz-3dplot`, `tikz-cd`, `xparse`

**Available TikZ libraries** (bundled): `3d`, `angles`, `animations`, `arrows`, `arrows.meta`, `automata`, `babel`, `backgrounds`, `bending`, `calc`, `calendar`, `cd`, `chains`, `circuits.*`, `datavisualization.*`, `decorations.*`, `er`, `fadings`, `fit`, `fixedpointarithmetic`, `folding`, `fpu`, `graphs`, `graphs.standard`, `intersections`, `lindenmayersystems`, `math`, `matrix`, `mindmap`, `patterns`, `patterns.meta`, `perspective`, `petri`, `plothandlers`, `plotmarks`, `positioning`, `quotes`, `rdf`, `scopes`, `shadings`, `shadows`, `shapes.*`, `snakes`, `spy`, `svg.path`, `through`, `trees`, `turtle`, `views`

**CRITICAL**: Deckode passes `addToPreamble` but NOT `texPackages`/`tikzLibraries` dataset attrs — `\usepackage` and `\usetikzlibrary` in the preamble field may fail for some packages. Many work anyway since `.code.tex` files are bundled; test case-by-case.

### Known limitations

| Issue | Workaround |
|-------|------------|
| `\mathbb{R}` | Needs `amssymb` — use `\mathbf{R}` if it fails |
| `input.dvi` not found | TeX compilation failed — simplify source progressively |
| `Error: -3` (Z_DATA_ERROR) | WASM `.gz` double-decompression; fixed by `tikzjaxGzFixPlugin` in `vite.config.ts` |
| Very large diagrams | Worker timeout (10s) — reduce complexity or split elements |
| `\foreach` with dynamic node names | `\node (\i)` inside `\foreach \i in {1,...,5}` may fail when names contain math mode or `|` (conflicts with `\foreach` delimiter). Use simple alphanumeric names, avoid `$...$` in node names. |

## SVG Fitting & Sizing

The SVG scales to fit the element's `size` while preserving aspect ratio — aspect ratio mismatch causes clipping or dead space. Match the TikZ coordinate range ratio to the container ratio (e.g., `w:880, h:200` → ~4.4:1 coordinate range). Account for two-line nodes being taller than `minimum height`. Leave ~0.2cm margin at edges.

**Sizing rule of thumb**: `\footnotesize` two-line nodes (`minimum height=0.7cm`) render ~0.9cm tall; `\small` ~1.1cm.

**Explicit bounding box (CRITICAL)**: TikZJax clips multi-line nodes without an explicit bounding box. Always add an invisible `\path` rectangle as the first drawing command:

```latex
% After \definecolor declarations, BEFORE any \node or \draw:
\path (xmin, ymax) rectangle (xmax, ymin);
% Example for nodes from x=-1..7, y=-2..0.5:
\path (-1.2, 0.7) rectangle (7.2, -2.2);
```

This is the single most common cause of clipped TikZ diagrams. **Always include it.**

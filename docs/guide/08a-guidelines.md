# Common Pitfalls

These are critical mistakes that break rendering. **Read this section before creating or modifying any deck.**

1. **Do NOT use Markdown `**` inside LaTeX math.** `$**x**$` renders as literal asterisks. Use `\bm{x}` (bold-italic) or `\mathbf{x}` (bold-upright) instead. This applies to both inline `$...$` and display `$$...$$` math.

2. **Never use `rotation` on line/arrow elements.** The code will assert-fail. Use `waypoints` to control line direction instead.

3. **Always provide `waypoints` for line/arrow elements.** Without waypoints, lines fall back to `y=0` which may not be the intended position. Always specify at least 2 waypoints: `[{ "x": 0, "y": 0 }, { "x": w, "y": 0 }]` for horizontal lines.

4. **TikZ: always add an explicit bounding box.** TikZJax computes a tight SVG bounding box that clips multi-line nodes. Add an invisible `\path` rectangle as the first drawing command. See the TikZ section for details.

5. **TikZ: prefer native elements for flow diagrams.** Use `shape` + `text` elements instead of TikZ for block-and-arrow layouts. Native elements support per-element animations, drag-and-drop editing, and proper text rendering.

6. **`size` is the bounding box, not the visual size.** For line/arrow, `size` encloses the waypoints. For text, `size.w` controls the text wrap width. Don't confuse it with the visual appearance.


# Guidelines for AI

## Creating a New Deck

1. Start with the top-level structure including `deckode` version and `meta`
2. Create slides with unique sequential IDs (`s1`, `s2`, ...)
3. Within each slide, create elements with unique sequential IDs (`e1`, `e2`, ...)
4. Position elements thoughtfully — avoid overlaps unless intentional
5. Use the full 960x540 canvas. Leave margins (~40-60px) for visual breathing room

## Layout Tips

- **Title slides**: Large centered text (fontSize 48-64), optionally a subtitle below
- **Content slides**: Title at top (y: 30-60), body content below (y: 120+)
- **Two-column**: Left column x: 40-460, right column x: 500-920
- **Full-bleed image**: position `{ "x": 0, "y": 0 }`, size `{ "w": 960, "h": 540 }`
- **Code walkthrough**: Code block on left/top, explanation text on right/bottom

## Color Palettes

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

## Content Best Practices

- Keep text concise — slides are not documents
- One idea per slide
- Use Markdown headings to establish hierarchy
- Use `**bold**` for emphasis, sparingly (see Common Pitfalls for math-mode caveats)
- Code blocks: show only the relevant lines, not entire files
- Speaker notes (`notes` field) can hold the detailed explanation

## Modifying an Existing Deck

When asked to modify an existing deck:
1. Preserve all existing `id` values — do not regenerate them
2. When adding new elements, use IDs that don't conflict with existing ones
3. When moving elements, only change `position` — preserve all other fields
4. When restyling, only change `style` fields — preserve content and position

## Reading Deck State Efficiently

Reading deck state costs tokens. Always prefer the narrowest read that answers your question.

**Read-before-write principle**: Before modifying any slide or element, you must know its current state. But "knowing the current state" rarely means "dump the entire deck."

**Read tool hierarchy** (use the highest-level summary that still answers your question):

1. **`read_deck`** — Returns a summary of the entire deck: title, author, slide count, and per-slide metadata (id, element count, element types, first text preview). Use this to understand overall structure, find a target slide by content, or count slides. **This is your default first read.** It does NOT return full element data.

2. **`read_slide(slideId)`** — Returns the full JSON of a single slide, including all element fields. Use this only after `read_deck` told you which slide you need to inspect. Never call `read_slide` on every slide in a loop — that defeats the purpose of the summary tier.

**Anti-patterns to avoid**:
- Calling `read_slide` on every slide before deciding what to do. Use `read_deck` first; it already tells you which slides have which element types.
- Re-reading the same slide multiple times in one turn. Cache the result mentally and reason about it.
- Reading the entire deck just to confirm a slide exists. The `read_deck` summary already includes all slide IDs.
- Reading slides you have no intention of modifying. If the user said "fix slide 3", you only need to read slide 3.

**When you genuinely need everything**: For deck-wide refactors (e.g., "unify all heading colors", "renumber all slides"), it is acceptable to read every slide. But state to yourself why before doing it, and prefer a single batch over interleaved reads-and-writes.

**Image content in summaries**: The `read_deck` summary includes element types but does not include image pixels. To know what an image depicts, you must read the slide and inspect the `alt` field. Always populate `alt` when adding images so future reads can understand them — see the image element guide for the strict alt-text rule.

# AI Constraints

These rules MUST be followed by all AI agents when generating or modifying decks.

## Element Rules

- Only use the provided tools to modify the deck. Never output raw JSON.
- All element IDs must be unique across the entire deck.
- All slide IDs must be unique.
- Positions must be within bounds: 0 <= x <= 960, 0 <= y <= 540.
- Element size + position must not exceed canvas: x + w <= 960, y + h <= 540.
- Always include required fields: id, type, position, size for elements.

## Text & Math

- For text elements, content is Markdown-formatted (use `**` for bold, `*` for italic).
- CRITICAL: Inside KaTeX math (`$...$`), NEVER use Markdown `**`. Use `\mathbf{}` or `\bm{}` for bold in math.
- For math/formulas, use KaTeX syntax: inline `$x^2$` or display `$$\sum x_i$$`. Do NOT use raw LaTeX outside of `$` delimiters.
- Use real newlines in text content, NOT literal `\n` sequences.

## Media & Diagrams

- DO NOT use external image URLs — they will not load.
- DO NOT use Mermaid elements — build diagrams with shape + text + arrow elements instead.
- NEVER use rotation on line or arrow elements — it will assert-fail. Use waypoints for direction.
- Line/arrow elements MUST have waypoints (at least 2 points). Without waypoints, the element won't render.
- Diagram decision: For flow/pipeline/block-and-arrow diagrams, use native shape+text+arrow elements. For complex technical diagrams (neural nets, math graphs, circuits), use TikZ.

## TikZ

- TikZ content: `"\begin{tikzpicture}...\end{tikzpicture}"` — no preamble needed.
- TikZ MUST include a bounding box: `\path (xmin,ymin) rectangle (xmax,ymax);` — without it, the diagram WILL be clipped.
- Set `style: { backgroundColor: "#ffffff" }` on TikZ elements to match the slide background.
- Avoid using math mode (`$...$`) inside `\foreach` node labels — the `|` delimiter conflicts with LaTeX. Use explicit `\node` definitions instead of dynamic naming in complex cases.

## Tables

- Table elements MUST include both `columns` (string[]) and `rows` (string[][]). `rows` must NOT be empty. Each row array length must match `columns` length.

## Scene3D

- Scene3D elements MUST include `scene.objects` array with at least one geometry object. `scene.camera` is optional (defaults to position `[5,5,5]`) but `scene` itself is required.

## Presenter Notes

- ALWAYS generate presenter notes for every slide.
- Step markers in notes MUST use opening AND closing tags: `[step:1]text here[/step]`. Without `[/step]`, highlighting will not work.
- Step-animation coupling: every `[step:N]` in notes MUST match an `onClick` animation. Mismatched counts break highlighting.

## General

- Prefer clean, professional designs with generous white space.


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

**Universal principle** (applies to any AI agent, including external ones like Claude Code editing `deck.json` directly):

Reading deck state costs tokens. Always prefer the narrowest read that answers your question. Before modifying any slide or element, you must know its current state — but "knowing the current state" rarely means "dump the entire deck." Avoid these anti-patterns regardless of what tools you have available:

- Reading every slide before deciding what to do.
- Re-reading the same slide multiple times in one turn. Cache results mentally.
- Reading the entire deck just to confirm a slide exists.
- Reading slides you have no intention of modifying. If the user said "fix slide 3", only look at slide 3.

**Image content**: The deck summary conveys image semantics via `aiSummary` → `caption` → `description` → `alt` in that priority order. An image with none of those fields is invisible to upstream planning. Always populate `alt` when you add a new image.

---

> **Scope note** — everything below this line assumes access to the Deckode in-app AI pipeline (the chat panel inside the editor), which exposes ~50 specialized tools. If you are an external AI agent (Claude Code, a generic LLM editing `deck.json` via file-system Read/Edit, etc.), these tools do **not** exist in your environment. Skip to the "AI Constraints" section below and edit `deck.json` directly. The tool names in the rest of this document are reference material for in-app agents only.

---

**In-app read tool hierarchy** (use the highest-level summary that still answers your question):

1. **`list_slide_titles`** — One line per slide with its ID and extracted title. Cheapest possible read. Use this when you need a table of contents — e.g., "which slide is about transformers?". Nothing else.

2. **`read_deck`** — Returns a summary of the entire deck: title, author, slide count, and per-slide metadata (id, extracted title, element count, element types). Use this to understand overall structure or to find candidate slides by element type. **Your default first read when list_slide_titles is not enough.** It does NOT return full element data.

3. **`find_elements(query)`** — Search across the deck by `{ type, textContains, slideRange }`. Use this when you know what to look for but not where it is. Example: `find_elements({ type: "image", textContains: "chart" })`. Avoids reading slides you do not need.

4. **`search_text(query, includeNotes?)`** — Full-text search across text/code content, image alt/caption, and optionally speaker notes. Returns match snippets with context. Use when the user asks "which slide mentions X?".

5. **`get_slide_outline(slideId)`** — One line per element on a single slide with id, type, position, size, and a short content preview. Cheaper than `read_slide` when you only need layout information, not full content.

6. **`read_slide(slideId)`** — Returns the full JSON of a single slide, including all element fields. Use this when you need every field of every element on a slide. Never call `read_slide` on every slide in a loop.

7. **`read_element(slideId, elementId)`** — Returns the full JSON of a single element. Prefer this over `read_slide` when you already know the element ID and only need its fields. Cheapest way to inspect one element.

**In-app image caption tools**: When an image shows as `image[no alt — UNDESCRIBED]` in the deck summary, either (a) call `generate_image_caption(slideId, elementId)` to force a caption now and wait for the result, or (b) call `read_slide` / `read_element` on the image, which fires a background caption that the next read will pick up.

## Tool Catalog by Task

> **Scope**: This entire section describes tools available only to the Deckode in-app AI pipeline. External agents editing `deck.json` via file-system tools should skip it — none of these tools exist in your environment. Use the schema sections (`03a`, `03b`, `04*`) and the "AI Constraints" rules below to edit the JSON directly.

Pick the most specific tool for the job. Specialized tools have better validation, smaller token footprints, and avoid the common failure modes that come with free-form edits.

### Moving and resizing elements

- **Position only** → `move_element(slideId, elementId, x?, y?)`. Either x or y or both.
- **Size only** → `resize_element(slideId, elementId, w?, h?, anchor?)`. Anchor defaults to top-left; use `center` / `top-right` / `bottom-left` / `bottom-right` to anchor resize differently.
- **Align multiple elements** → `align_elements(slideId, elementIds[], alignment)`. Alignment is `left | center | right | top | middle | bottom`. **Never compute alignment coordinates by hand** — the tool computes them from the selection's bounding box so you do not have to.
- **Distribute evenly** → `distribute_elements(slideId, elementIds[], "horizontal" | "vertical")`. Requires at least three elements.
- **Z-order** → `bring_to_front`, `send_to_back`, or `change_z_order(slideId, elementId, delta)` for relative shifts.

Do not use `update_element` with a `position` patch when `move_element` applies — the dedicated tool is more explicit and harder to get wrong.

### Element CRUD

- **Add** → `add_element(slideId, element)` with full element shape. For a similar element nearby, `duplicate_element(slideId, elementId)` is faster and guarantees ID uniqueness.
- **Read one** → `read_element(slideId, elementId)`, not `read_slide`.
- **Patch fields** → `update_element(slideId, elementId, patch)` for arbitrary changes. For common operations prefer the specialized tool: `move_element`, `resize_element`, `set_image_alt`, `crop_image`, `set_element_style` (via update_element with a style-only patch).
- **Delete** → `delete_element(slideId, elementId)`.

### Slide structure

- **Add slide** → `add_slide`. For a similar slide, `duplicate_slide(slideId, newSlideId)` is faster.
- **Reorder** → `move_slide` (single slide) or `reorder_slides(order[])` (full permutation, all IDs required).
- **Split** → `split_slide(slideId, pivotElementId, newSlideId)`. Elements at and after the pivot move to a new slide inserted after the source.
- **Merge** → `merge_slides(targetSlideId, sourceSlideIds[])`. Source elements get y-offset stacked into the target, sources are then deleted.
- **Patch meta** → `update_slide(slideId, patch)` for background/notes/hidden/bookmark. For just the background use `set_slide_background(slideId, color?, image?)`. For just notes use `set_speaker_notes(slideId, notes)`.

### Deck-wide style

Use these instead of iterating `update_element` calls:

- **Unify a style across the deck** → `apply_style_to_all(filter, stylePatch)`. Filter by `{ type, slideRange, minFontSize, maxFontSize }`. Example: "make all headings blue" = `apply_style_to_all({ type: "text", minFontSize: 32 }, { color: "#3b82f6" })`.
- **Apply theme patch** → `apply_theme(themePatch)`. Only known buckets (slide/text/code/shape/image/video/tikz/mermaid/table/scene3d) pass the validator.
- **Update deck metadata** → `set_deck_meta({ title?, author?, aspectRatio? })` instead of `create_deck` or full-deck rewrites.

### Images

- **Alt text** → `set_image_alt(slideId, elementId, alt)`.
- **Non-destructive crop** → `crop_image(slideId, elementId, top?, right?, bottom?, left?)`. Values are 0-1 fractions of each edge. The renderer applies clip-path inset; the original asset is preserved.
- **Get a caption right now** → `generate_image_caption(slideId, elementId)`. Waits for the result and writes it to `aiSummary`. Use when you need to reason about image content mid-turn.
- **Replace an image** → no dedicated tool. Delete the image element and add a new one with the new src.

### Animations

- **Add** → `add_animation(slideId, target, effect, trigger, duration?, delay?)`.
- **List** → `list_animations(slideId)` to see indices before patching.
- **Patch one** → `update_animation(slideId, index, patch)`.
- **Remove** → `delete_animation(slideId, index)`.
- **Reorder** → `reorder_animations(slideId, fromIndex, toIndex)`. Order matters: `[step:N]` markers in notes count onClick animations in order.

Do not round-trip through `update_slide` with a full `animations` array for single-animation edits — the dedicated tools are safer.

### Comments

- **Add** → `add_comment(slideId, text, elementId?, category?)`. Category is `content | design | bug | todo | question | done`.
- **Resolve** → `resolve_comment(slideId, commentId)` flips category to `done`.

### Design quality self-check

After a non-trivial edit, run at least one of these before reporting success:

- **Schema check** → `validate_deck()` catches duplicate IDs, out-of-bounds, missing required fields.
- **Layout check** → `check_overlaps(slideId)` catches accidental bounding-box intersections (grouped elements are ignored).
- **Accessibility check** → `check_contrast(slideId)` reports text elements that fail WCAG AA (< 4.5 contrast ratio against the slide background).
- **Combined** → `lint_slide(slideId)` runs all of the above plus empty-text and missing-title checks on one slide.

### Safety net

- **Snapshot before risky multi-step edits** → `snapshot(label)`. Labels are free-form, e.g., `"pre-tikz-rewrite"`. Use this when you are about to touch many elements at once.
- **Restore a snapshot** → `restore(label)`. Replaces the whole deck with the saved state.
- **Walk history** → `undo()` / `redo()` steps through the editor's temporal history, which captures every store change (drag, typing, tool calls). Complements snapshot/restore: undo walks back one step, restore jumps to a named checkpoint.
- **Verify you changed what you intended** → `diff_against_snapshot(label)` reports added / removed / modified slides relative to a saved snapshot.
- **List checkpoints** → `list_snapshots()`.

### Bulk import

- **Convert a markdown outline into slides** → `import_outline(markdown, mode?)`. Each `# heading` becomes one slide with title + body text elements. Modes: `append` (default) or `replace`. Fastest way to bootstrap a deck from an existing text outline.

## Tool Selection Decision Tree

When a user asks for an edit, pick tools in this order:

1. **Is there a specialized tool for exactly this operation?** (move, resize, align, crop, set_image_alt, set_speaker_notes, apply_theme, …) Use it.
2. **Is this a deck-wide consistency operation?** Use `apply_style_to_all` or `apply_theme`, not a loop of `update_element` calls.
3. **Is this a structural operation?** (reorder, split, merge, duplicate) Use the dedicated structure tool.
4. **Only if none of the above apply** → reach for `update_element` or `update_slide` with a hand-crafted patch.

## Common Failure Modes to Avoid

- **Manually computing alignment or distribution coordinates**. Use `align_elements` / `distribute_elements`. The LLM often makes off-by-one and centering mistakes here.
- **Updating elements one by one when a deck-wide operation exists**. Use `apply_style_to_all`.
- **Reading every slide before deciding what to do**. Use `list_slide_titles` → `find_elements` → `read_slide` in order of specificity.
- **Round-tripping the whole `animations` array for a single animation change**. Use `update_animation(slideId, index, patch)`.
- **Forgetting to snapshot before a risky multi-step operation**. A single `snapshot("before-X")` at the start lets you safely `restore("before-X")` if things go wrong.
- **Reporting success without verification**. End non-trivial tool sequences with `validate_deck` or `lint_slide`.
- **Adding an image without alt text**. The deck summary can only describe an image via its alt/caption/aiSummary. No alt = invisible to upstream planning.

# AI Constraints

These rules MUST be followed by all AI agents when generating or modifying decks, whether in-app or external.

## Element Rules

- **In-app agents**: Only use the provided tools to modify the deck. Never output raw JSON. **External agents** (Claude Code, generic LLMs editing `deck.json` directly via file-system tools): you ARE the tool — edit the JSON in place, but honor all schema rules below.
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


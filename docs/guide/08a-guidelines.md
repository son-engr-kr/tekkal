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


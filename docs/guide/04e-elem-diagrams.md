# Flow Diagrams with Native Elements

## TikZ vs Native Elements for Diagrams

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

---

### How to Build Flow Diagrams with Native Elements

**Step 1: Plan the layout.** Sketch box positions on the 960×540 canvas. Typical box sizes:
- Standard box: `w: 110–160, h: 38–45`
- Wide box (with subtitle): `w: 150–200, h: 55–70`
- Arrow gap between boxes: `40–65px`

**Step 2: Build each box as a shape + text pair** sharing the same `groupId`. See the shape file for the full JSON pattern. Keep fills at `rgba()` 6–8% opacity with a matching stroke color.

**Step 3: Connect boxes with native arrow elements.** Use `"shape": "arrow"` with `waypoints` for direction.

> **IMPORTANT: Never use `rotation` on line/arrow elements.** The code will assert-fail. Use `waypoints` to control direction instead.

**Arrow directions via `waypoints`** (always required):
| Direction | `size`             | `waypoints`                                          |
|-----------|--------------------|------------------------------------------------------|
| Right     | `w: 60, h: 1`      | `[{x:0,y:0},{x:60,y:0}]`                            |
| Down      | `w: 1, h: 60`      | `[{x:0,y:0},{x:0,y:60}]`                            |
| Left      | `w: 60, h: 1`      | `[{x:60,y:0},{x:0,y:0}]` (reverses marker)          |
| Up        | `w: 1, h: 60`      | `[{x:0,y:60},{x:0,y:0}]`                            |

If an arrow has a label, group the arrow and label text element under the same `groupId`.

**Step 4: Build feedback loops.** Chain multiple `line` segments (right-turn, horizontal span, left-turn) using `waypoints` to form an L- or U-shaped path. Each segment is a separate element; connect them visually by aligning endpoints.

**Step 5: Add step-by-step animation.** Each click reveals one logical group:

```json
{ "target": "box-bg",   "trigger": "onClick",      "effect": "fadeIn", "duration": 300 },
{ "target": "box-text", "trigger": "withPrevious",  "effect": "fadeIn", "duration": 300 },
{ "target": "arrow-ab", "trigger": "withPrevious",  "effect": "fadeIn", "duration": 300 }
```

Use `"onClick"` for the first element in each group, `"withPrevious"` for siblings.

> **Color note:** Use consistent stroke colors per semantic role (e.g. purple = RL components, green = data sources) with matching `rgba()` fills at 6–8% opacity.

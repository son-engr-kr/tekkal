# Layout Templates & Style Guide

Pre-designed slide layouts the Generator can use as starting points. Each template defines element positions, sizes, and styles for a specific layout pattern. The AI may use these directly (adapting content) or create from scratch following the same design principles.

## Design Palette — "Analytical Insight"

| Role | Color | Usage |
|------|-------|-------|
| Primary | `#1A2B48` (Deep Navy) | Slide titles, headers, emphasis |
| Data | `#5B9BD5` (Medium Blue) | Chart accents, metric values, highlights |
| Data Light | `#BDD7EE` (Light Sky Blue) | Secondary data, card borders |
| Structure | `#E7E6E6` (Soft Gray) | Divider lines, card fills, thin rules |
| Insight BG | `#F2F2F2` (Light Warm Gray) | Key Insight box background |
| Accent | `#A68966` (Muted Gold) | Section numbers, tags, "KEY INSIGHT" label, title rules |
| Body | `#333333` (Charcoal) | Body text, descriptions |
| Secondary | `#8899AA` | Subtitles, metadata |
| Tertiary | `#AABBCC` | Period labels, captions, footer text |
| Background | `#ffffff` | ALL slides — always white |

## Design Principles — MANDATORY

1. **White backgrounds only** — never use dark or colored slide backgrounds
2. **No filled bars or header blocks** — no colored rectangles behind titles
3. **No decorative shapes** — no ellipses, circles, or ornamental fills
4. **Lines to separate** — use 1px `#E7E6E6` rectangles as dividers (w:full, h:1)
5. **Minimal fills** — if a container needs fill, use `#E7E6E6` (cards) or `#F2F2F2` (insight boxes only)
6. **Stroke-only cards** — containers use `stroke: "#E7E6E6"`, `strokeWidth: 1`, `fill: "#E7E6E6"` (very light) or transparent
7. **No multi-line bold** — `**bold text**` must NOT contain `\n`. Use separate text elements per line
8. **Left-aligned** — titles and body text are left-aligned (textAlign: "left") unless inside a centered card
9. **Generous margins** — x >= 40, y >= 18, right edge <= 920, bottom <= 510

## Template Catalog

### t-title-a — Standard Title

Clean title slide: gold accent rule (44x2 rectangle at y:195), title below (fontSize:36, #1A2B48), subtitle (#8899AA, fontSize:14), author at bottom (#AABBCC, fontSize:10).

Layout: all elements left-aligned at x:80. Title at y:210, subtitle at y:280, author at y:492.

### t-title-b — Title with Tag

Small uppercase tag ("RESEARCH 2025", fontSize:9, #A68966) above a thin gold rule, then title and subtitle. Same structure as t-title-a but with an extra tag element.

### t-section — Section Divider

Section number in gold monospace (fontSize:38, #A68966), thin gray rule below, section title (fontSize:28, #1A2B48), description (#AABBCC). Centered vertically — elements start at y:190.

### t-three-metric — Three Metric Columns

**Structure**: Title row at top, three equal columns (w:~270 each), insight box at bottom.

Each column:
- Big metric number (fontSize:32, #5B9BD5, center-aligned)
- Label below (fontSize:10, #AABBCC)
- Image placeholder (w:270, h:140) for chart/graph
- 1px vertical divider line between columns (#E7E6E6)

Bottom insight box: #F2F2F2 fill, left gold accent line (#A68966, 3px wide), "KEY INSIGHT" label (#A68966, fontSize:9), body text (#333333).

Column x-positions: col1 x:40, col2 x:345, col3 x:650. Dividers at x:330, x:635.

### t-card-gallery — Three Info Cards

**Structure**: Title + subtitle row, three equal card columns.

Each card (w:270, h:290):
- Rectangle: fill `#E7E6E6`, borderRadius:6, strokeWidth:0
- Card title inside (fontSize:14, #1A2B48, bold, center)
- Body text (fontSize:11, #333333)
- Metric value (fontSize:20, #5B9BD5, center)
- Secondary text (fontSize:9, #8899AA)

Card x-positions: x:40, x:345, x:650. Top: y:85. Bottom insight box as in t-three-metric.

### t-triple-image — Three Images Row

Title + three image placeholders side by side (w:270, h:190 each), caption below each image.

Image x-positions: x:40, x:345, x:650. Images at y:70, captions at y:270.

Bottom insight box with left gold accent.

### t-image-annotated — Large Image + Annotations

**Left**: large image (w:500, h:340, x:40, y:70).
**Right**: title (fontSize:16, #1A2B48), body text, and callout with circle number badge (#5B9BD5 stroke, 24x24) + annotation text.

Good for: explaining a single diagram, annotating a screenshot.

### t-two-image — Side-by-Side Images

Two images (w:420, h:240 each) side by side. Title at top, captions below each image. Bottom insight box.

Image x-positions: x:40, x:500. Images at y:60. Captions at y:315.

### t-image-table — Image + Data Table

**Left**: image (w:440, h:250, x:40, y:70). Left caption below.
**Right**: table element (x:510, y:70, w:420, h:250) with headerBackground `#E7E6E6`, borderColor `#E7E6E6`, fontSize:10.

Bottom insight box with gold accent.

### t-code-panel — Code + Explanation

**Left**: code element (w:480, h:300, x:40, y:60). Language label above code (#8899AA, fontSize:9).
**Right**: explanation text panel (x:550, y:60).

- Title (fontSize:16, #1A2B48)
- Body (#333333, fontSize:12, lineHeight:1.6)
- Insight box at bottom-right (fill #F2F2F2, left gold accent)

### t-math — Equations Layout

Title at top, horizontal divider line below. Two-column layout:

**Left column**: equation label (#A68966, fontSize:9), display math block ($$...$$), description text.
**Right column**: same structure with second equation.

Bottom insight box. Good for: proofs, formula derivations, mathematical concepts.

### t-hero-stat — Big Number Focus

Large headline number (fontSize:72, #5B9BD5, center-aligned) at center. Title above, description below. Optional comparison line (#8899AA). Full-width horizontal rule (#E7E6E6) below stat.

Good for: KPI highlights, dramatic data points.

### t-timeline — Horizontal Timeline

Title at top, subtitle below. Horizontal line (#E7E6E6, 1px) across middle. Circle markers (#5B9BD5 stroke, 12x12) at intervals along the line. Year/label below each marker, event title above each marker.

## Insight Box Pattern (reusable)

Many templates include a "KEY INSIGHT" box at the bottom:

```
Container: fill #F2F2F2, borderRadius:4, y:~455, x:40, w:880, h:70
Gold accent: fill #A68966, x:40, y:~455, w:3, h:70 (left edge stripe)
Label: "KEY INSIGHT", fontSize:9, #A68966, bold
Body: fontSize:11, #333333
Source: fontSize:8, #AABBCC (optional, bottom-right)
```

## Usage Instructions for AI

1. **Match template to slide type**: Use the plan's `type` field to pick a template (title→t-title-a/b, content→t-card-gallery or t-three-metric, code→t-code-panel, etc.)
2. **Adapt, don't copy blindly**: Change content, metric values, image paths — but keep the position/size/style structure
3. **Mix and match**: Combine patterns from different templates (e.g., insight box from t-three-metric + image layout from t-two-image)
4. **Consistent palette**: ALL colors must come from the palette table above. No other hex values.
5. **Images**: Use `type: "image"` with `src` pointing to project assets. Always provide descriptive alt text.
6. **When creating from scratch**: Follow the same margin rules (x>=40, y>=18), same font sizes, same color palette. The templates are guides, not constraints.

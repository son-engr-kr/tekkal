# Visual Style Guide

This guide defines the default visual design system for the Generator agent. User style preferences (theme, animations, notes tone) override these defaults — see [Style Preferences](./08b-style-preferences.md).

## Color Palette (Professional Academic Style)

- Background: `#ffffff` (white)
- Primary text: `#1e293b` (dark slate)
- Secondary text: `#475569` (medium slate)
- Muted text: `#94a3b8` (light gray, for labels and metadata)
- Primary accent: `#2c5282` (blue — titles, primary elements)
- Secondary accent: `#5b4a8a` (purple — technical details)
- Tertiary accent: `#b45309` (orange — highlights, secondary topics)
- Success: `#3d7a5f` (green — completed items, positive states)
- Error: `#dc2626` (red — problems, warnings)
- Borders/arrows: `#9ca3af` (gray)
- Light fills: Use accent colors at 4-8% opacity for container backgrounds (e.g., `rgba(44,82,130,0.06)`)

## Typography

- Font family: Inter, system-ui, sans-serif
- Slide title: fontSize 36-42, color `#2c5282`, bold (`**title**`)
- Subtitle/section: fontSize 20-22, bold
- Body text: fontSize 14-18, color `#475569`, lineHeight 1.5
- Labels in boxes: fontSize 12-15, center-aligned
- Small metadata: fontSize 9-11, color `#94a3b8`
- Math/equations: fontSize 20-24 for display math (`$$...$$`), at least 16 for inline math. Equations scale with base fontSize — use larger sizes so formulas are readable.

## Layout Rules

- Top margin: y >= 25 for title area
- Side margins: x >= 40, content should not exceed x+w > 920
- Bottom margin: y+h < 510 (leave room for page numbers)
- Title positioned at top: y: 25-40
- Content starts below title: y: 80-100
- Spacing between sections: 40-60px
- Padding inside containers: 15-20px

## Diagrams — Prefer Native Elements for Flow/Pipeline Diagrams

Build flow diagrams, flowcharts, pipelines, and block-and-arrow illustrations using shape + text + arrow elements.
Use TikZ only for complex technical diagrams (neural nets, math graphs, circuits) that are hard to build with shapes.

**Container boxes:**
- type: `"shape"`, shape: `"rectangle"`
- style: `{ fill: "rgba(44,82,130,0.06)", stroke: "#2c5282", strokeWidth: 2, borderRadius: 8 }`
- Size: 150-360px wide, 50-80px tall

**Arrow connectors:**
- type: `"shape"`, shape: `"arrow"`
- style: `{ stroke: "#9ca3af", strokeWidth: 2 }`
- CRITICAL positioning: arrow `position.x` = source box right edge, `position.y` = source box vertical center
- Size: `{ w: gap between boxes, h: 1 }` for horizontal arrows
- Waypoints are RELATIVE to the element position. For a horizontal arrow: `[{x:0,y:0},{x:W,y:0}]`
- For vertical arrows: `position.x` = box horizontal center, size: `{ w: 1, h: gap }`, waypoints: `[{x:0,y:0},{x:0,y:H}]`
- For L-shaped paths: use 3 waypoints `[{x:0,y:0},{x:W,y:0},{x:W,y:H}]`

**Text labels inside boxes:**
- Position and size matching the parent box
- style: `{ fontSize: 14, color: "#2c5282", textAlign: "center", verticalAlign: "middle" }`

**CRITICAL: Always group related elements:**
- Box + its label text must share the same `groupId`
- Arrow + its label must share the same `groupId`
- Convention: `groupId = "group-descriptive-name"`

**Status badges (small rectangles):**
- Size: ~50x16px
- style: `{ fill: "#3d7a5f", borderRadius: 3 }` with white text at fontSize 9

## Animations

- Use `fadeIn` (300-400ms) for progressive content reveal
- Build slides step by step: container first (`onClick`), then content (`withPrevious`/`afterPrevious`)
- Use consistent trigger patterns across slides

## Slide Transitions

- Default: `{ type: "slide", duration: 300 }`
- Title/section slides: `{ type: "fade", duration: 500 }`

## TikZ for Complex Diagrams

Use TikZ elements for neural network architectures, mathematical diagrams, and other complex technical illustrations:
- Content: just the `tikzpicture` environment, no preamble
- Example neural network:
  ```
  \begin{tikzpicture}[node distance=1.5cm]
  \foreach \i in {1,...,3} \node[circle,draw,fill=blue!20] (i\i) at (0,-\i) {};
  \foreach \i in {1,...,4} \node[circle,draw,fill=orange!20] (h\i) at (2,-\i+0.5) {};
  \foreach \i in {1,...,2} \node[circle,draw,fill=green!20] (o\i) at (4,-\i-0.5) {};
  \foreach \i in {1,...,3} \foreach \j in {1,...,4} \draw[->] (i\i) -- (h\j);
  \foreach \i in {1,...,4} \foreach \j in {1,...,2} \draw[->] (h\i) -- (o\j);
  \node[above] at (0,0) {Input};
  \node[above] at (2,0) {Hidden};
  \node[above] at (4,0) {Output};
  \end{tikzpicture}
  ```
- Set `style: { backgroundColor: "#ffffff" }` to match slide background
- Use for: neural nets, attention mechanisms, mathematical graphs, signal flow diagrams

## Tables

- `headerBackground`: light accent color (e.g., `"rgba(61,122,95,0.08)"`)
- `headerColor`: darker accent (e.g., `"#2d5a42"`)
- `borderColor`: `"#d1d5db"`
- `fontSize`: 10-13
- `striped`: true
- `borderRadius`: 6

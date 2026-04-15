<!-- guide-meta: {"label":"Theme","desc":"Deck-level theme defaults and page number overlay"} -->
# Theme

The optional top-level `theme` object provides default styles per element type. These act as a middle layer between hardcoded defaults and per-element `style` overrides.

**Resolution order**: `element.style` > `deck.theme` > hardcoded defaults

Each key in the theme object corresponds to an element type and accepts the same style fields as that element's `style` property.

| Theme key | Style fields | Hardcoded defaults |
|-----------|-------------|-------------------|
| `theme.slide.background` | `color`, `image` | `color: "#0f172a"` |
| `theme.text` | `fontFamily`, `fontSize`, `color`, `textAlign`, `lineHeight`, `verticalAlign` | `fontFamily: "Inter"`, `fontSize: 24`, `color: "#ffffff"`, `lineHeight: 1.5` |
| `theme.code` | `theme`, `fontSize`, `lineNumbers`, `borderRadius` | `theme: "github-dark"`, `fontSize: 16`, `borderRadius: 8` |
| `theme.shape` | `fill`, `stroke`, `strokeWidth`, `borderRadius`, `opacity`, `markerStart`, `markerEnd`, `path`, `waypoints` | `stroke: "#ffffff"`, `strokeWidth: 1` |
| `theme.image` | `objectFit`, `borderRadius`, `opacity` | `objectFit: "fill"` |
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

## Palette allow-list

`theme.palette` is an optional hex allow-list. When set, the validator warns on any element whose style contains a color outside the list (comparing `color`, `fill`, `stroke`, `background`, `backgroundColor`, `headerBackground`, `headerColor`, `borderColor`, case-insensitive, with 3-digit shorthand expanded). Leave it unset to disable the check.

```json
{
  "theme": {
    "palette": ["#1A2B48", "#5B9BD5", "#E7E6E6", "#333333", "#ffffff"]
  }
}
```

Useful for enforcing the Analytical Insight palette (see `08c-visual-style.md`) or any brand-specific color system. Out-of-palette colors produce warnings, not errors — existing decks won't break.


# Page Numbers

The optional top-level `pageNumbers` object enables a page number overlay on all slides. Hidden slides are excluded from the count.

```json
{
  "pageNumbers": {
    "enabled": true,
    "position": "bottom-right",
    "format": "number-total",
    "fontSize": 14,
    "color": "#94a3b8",
    "margin": 20,
    "opacity": 0.8
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | — | Required. Whether to show page numbers |
| `position` | string | `"bottom-right"` | One of: `"bottom-right"`, `"bottom-left"`, `"bottom-center"`, `"top-right"`, `"top-left"`, `"top-center"` |
| `format` | string | `"number"` | `"number"` shows just the page number, `"number-total"` shows `1 / 10` |
| `fontSize` | number | `14` | Font size in px |
| `color` | string | `"#94a3b8"` | CSS color value |
| `fontFamily` | string | `"sans-serif"` | Font family |
| `margin` | number | `20` | Distance from edge in px |
| `opacity` | number | `1` | Opacity (0–1) |

Individual slides can opt out by setting `"hidePageNumber": true` in the slide object. Page numbers appear in the editor, presentation mode, and all exports (PDF, PPTX).


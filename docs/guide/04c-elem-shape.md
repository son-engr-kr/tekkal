# Shape Elements

## `"shape"`

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
| `path` | string | — | SVG path `d` attribute for custom line routing (line/arrow only). Takes priority is overridden by `waypoints` when both are present. |
| `waypoints` | `{x,y}[]` | **yes** (line/arrow) | Polyline waypoints in element-local coords (line/arrow only). **Always provide at least 2 points.** Takes priority over `path`. |

For `"line"` and `"arrow"`: `position` is the bounding box origin. **Always specify `waypoints`** with at least 2 points — they define the actual line path in element-local coordinates (relative to `position`). `size` is the bounding box enclosing the waypoints. The `"arrow"` shape is shorthand for `"line"` with `markerEnd: "arrow"`. Use `markerStart`/`markerEnd` for fine-grained control. **Never use `rotation` on line/arrow elements** — the code asserts against this. Use `waypoints` to control line direction instead.

**Line example** (horizontal divider):
```json
{
  "id": "divider",
  "type": "shape",
  "shape": "line",
  "position": { "x": 60, "y": 260 },
  "size": { "w": 840, "h": 1 },
  "style": { "stroke": "#475569", "strokeWidth": 1, "waypoints": [{ "x": 0, "y": 0 }, { "x": 840, "y": 0 }] }
}
```

**Arrow example** (pointing right):
```json
{
  "id": "flow-arrow",
  "type": "shape",
  "shape": "arrow",
  "position": { "x": 200, "y": 300 },
  "size": { "w": 560, "h": 1 },
  "style": { "stroke": "#3b82f6", "strokeWidth": 3, "waypoints": [{ "x": 0, "y": 0 }, { "x": 560, "y": 0 }] }
}
```

**Double-headed arrow**:
```json
{
  "id": "bidirectional",
  "type": "shape",
  "shape": "line",
  "position": { "x": 100, "y": 270 },
  "size": { "w": 300, "h": 1 },
  "style": { "stroke": "#8b5cf6", "strokeWidth": 2, "markerStart": "arrow", "markerEnd": "arrow", "waypoints": [{ "x": 0, "y": 0 }, { "x": 300, "y": 0 }] }
}
```

**Polyline waypoints** (routed connector):
```json
{
  "id": "routed",
  "type": "shape",
  "shape": "arrow",
  "position": { "x": 100, "y": 100 },
  "size": { "w": 300, "h": 100 },
  "style": {
    "stroke": "#10b981", "strokeWidth": 2,
    "waypoints": [{"x": 0, "y": 100}, {"x": 150, "y": 100}, {"x": 150, "y": 0}, {"x": 300, "y": 0}]
  }
}
```

Waypoints are in element-local coordinates (relative to `position`). `size` should be the bounding box that encloses all waypoints. Waypoints can extend beyond the bounding box (the SVG uses `overflow: visible`). In the editor, select a line/arrow and use the Property Panel to add waypoints, then drag the green handles on the canvas. Custom SVG path routing via the `path` attribute is also supported for advanced curves.

**Export limitations**: The `path` and `waypoints` fields are fully rendered in the editor and HTML-based PDF export. Native PDF export draws waypoint line segments. PPTX export falls back to a straight line between first and last waypoint.

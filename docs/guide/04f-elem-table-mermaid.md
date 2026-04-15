# Table & Mermaid Elements

## `"table"`

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
| `columns` | string[] | yes | Header labels for each column. **Must be plain strings** — `{key, label}` objects are not accepted. |
| `rows` | string[][] | yes | 2D array of cell data. Each inner array is one row, in the same order as `columns`. **Must be plain string arrays** — `{key: value}` row objects are not accepted. |

> **Legacy format (not supported).** Earlier drafts of the example deck used `columns: [{key, label}]` with `rows: [{key: value}]`. That shape has never rendered correctly and is now rejected loudly: dev builds throw, production builds render a visible "Table format error" box. Always use plain `string[]` / `string[][]`.

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


## `"mermaid"`

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


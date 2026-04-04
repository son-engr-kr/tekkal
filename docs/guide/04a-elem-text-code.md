# Text & Code Elements

## `"text"`

Renders Markdown text content.

```json
{
  "id": "e1",
  "type": "text",
  "content": "# Title\n\nThis is **bold** and *italic*.\n\nInline math: $E = mc^2$",
  "position": { "x": 60, "y": 40 },
  "size": { "w": 840, "h": 200 },
  "style": {
    "fontFamily": "Inter",
    "fontSize": 24,
    "color": "#ffffff",
    "textAlign": "left",
    "lineHeight": 1.5,
    "verticalAlign": "top"
  }
}
```

**Content format**: Markdown string. Supports:
- Headings (`#`, `##`, `###`)
- Bold (`**text**`), italic (`*text*`) — **do NOT use `**` inside `$...$` math; use `\bm{}` or `\mathbf{}`**
- Inline code (`` `code` ``)
- Links (`[text](url)`)
- Unordered lists (`- item`)
- Inline math (`$E = mc^2$`)
- Block math (`$$\int_0^1 f(x) dx$$`)

**LaTeX math bold**: Do NOT use Markdown `**` inside math expressions — it renders as plain text. Use `\bm{}` (bold-italic, recommended for symbols) or `\mathbf{}` (bold-upright) instead. Example: `$\bm{\kappa}$` → **κ**, `$\mathbf{A}$` → **A**.

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fontFamily` | string | `"Inter"` | Font family |
| `fontSize` | number | `24` | Base font size in px (headings scale relative to this) |
| `color` | string | `"#ffffff"` | Text color |
| `textAlign` | `"left"` \| `"center"` \| `"right"` | `"left"` | Horizontal alignment |
| `lineHeight` | number | `1.5` | Line height multiplier |
| `verticalAlign` | `"top"` \| `"middle"` \| `"bottom"` | `"top"` | Vertical alignment within the box |


## `"code"`

Renders a syntax-highlighted code block.

```json
{
  "id": "e3",
  "type": "code",
  "language": "typescript",
  "content": "const greeting = (name: string) => {\n  return `Hello, ${name}!`;\n};",
  "position": { "x": 60, "y": 300 },
  "size": { "w": 840, "h": 180 },
  "style": {
    "theme": "github-dark",
    "fontSize": 16,
    "lineNumbers": false,
    "highlightLines": [2]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `language` | string | yes | Language identifier (e.g., `"typescript"`, `"python"`, `"rust"`) |
| `content` | string | yes | Raw code string |

**Style fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | string | `"github-dark"` | Shiki theme name |
| `fontSize` | number | `16` | Font size in px |
| `lineNumbers` | boolean | `false` | Show line numbers |
| `highlightLines` | number[] | `[]` | 1-indexed line numbers to highlight |
| `borderRadius` | number | `8` | Corner radius |


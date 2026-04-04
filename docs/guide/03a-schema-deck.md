# deck.json Schema

## Top-Level Structure

```json
{
  "deckode": "0.1.0",
  "meta": {
    "title": "Presentation Title",
    "author": "Author Name",
    "aspectRatio": "16:9"
  },
  "theme": {
    "slide": { "background": { "color": "#0f172a" } },
    "text": { "fontFamily": "Inter, system-ui, sans-serif", "fontSize": 24, "color": "#ffffff" },
    "code": { "theme": "github-dark", "fontSize": 16 },
    "shape": { "stroke": "#ffffff", "strokeWidth": 1 },
    "image": { "objectFit": "fill" },
    "video": { "objectFit": "contain" },
    "tikz": { "backgroundColor": "#1e1e2e" },
    "table": { "headerBackground": "#1e293b", "borderColor": "#334155" }
  },
  "pageNumbers": { "enabled": true, "position": "bottom-right", "format": "number" },
  "components": {
    "comp-a1b2c3d4": {
      "id": "comp-a1b2c3d4",
      "name": "My Component",
      "elements": [ ... ],
      "size": { "w": 200, "h": 100 }
    }
  },
  "slides": [ ... ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deckode` | string | yes | Schema version. Use `"0.1.0"` |
| `meta.title` | string | yes | Presentation title |
| `meta.author` | string | no | Author name |
| `meta.aspectRatio` | `"16:9"` \| `"4:3"` | yes | Slide aspect ratio |
| `theme` | object | no | Deck-level default styles (see Theme section below) |
| `pageNumbers` | object | no | Page number overlay config (see Page Numbers section below) |
| `components` | object | no | Shared components referenced by `"reference"` elements (see Shared Components below) |

## Slide Object

```json
{
  "id": "s1",
  "layout": "blank",
  "bookmark": "Introduction",
  "background": { "color": "#0f172a" },
  "transition": { "type": "fade", "duration": 300 },
  "notes": "Speaker notes for this slide\n// This line is hidden in presenter mode",
  "elements": [ ... ],
  "animations": [ ... ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique slide ID. Convention: `"s1"`, `"s2"`, ... |
| `layout` | string | no | Layout template name. Default: `"blank"` |
| `background` | object | no | Slide background |
| `background.color` | string | no | CSS color value |
| `background.image` | string | no | Path to image (`"./assets/bg.jpg"`) |
| `transition` | object | no | Slide enter transition |
| `transition.type` | `"fade"` \| `"slide"` \| `"none"` | no | Transition type |
| `transition.duration` | number | no | Duration in ms. Default: `300` |
| `hidden` | boolean | no | Hide this slide from presentation and export |
| `hidePageNumber` | boolean | no | Suppress page number on this slide (when page numbers are enabled globally) |
| `bookmark` | string | no | Bookmark title. Appears in presenter bookmark list for quick navigation |
| `notes` | string | no | Speaker notes (plain text or Markdown) |
| `elements` | array | yes | Array of Element objects |
| `animations` | array | no | Array of Animation objects |
| `comments` | array | no | Array of Comment objects (editor-only, not exported to PDF/PPTX) |

### Comments

Comments are editor-only review annotations attached to a slide or a specific element. They are not rendered on the canvas or exported.

```json
{
  "id": "c1",
  "elementId": "e3",
  "text": "Consider using a darker shade here",
  "author": "user",
  "category": "design",
  "createdAt": 1710700000000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique comment ID (8-char UUID) |
| `elementId` | string | no | Target element ID. Omit for slide-level comments |
| `text` | string | yes | Comment content |
| `author` | string | no | Who wrote the comment (`"user"` for editor, agent name for AI) |
| `category` | string | no | `"content"` \| `"design"` \| `"bug"` \| `"todo"` \| `"question"` |
| `createdAt` | number | yes | Timestamp (ms since epoch) |

Comments are color-coded by author in the editor. Each category has a distinct badge color. When elements are deleted, their associated comments are automatically removed.

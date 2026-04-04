# Bookmarks

Slides can be bookmarked with a title for quick navigation in presenter mode. Set the `bookmark` field on a slide:

```json
{
  "id": "s3",
  "bookmark": "Key Results",
  "elements": [ ... ]
}
```

Bookmarked slides appear in the presenter console as a clickable list sorted by slide order. Bookmark positions are also shown as markers on the slide navigation slider — hovering a marker shows the bookmark title.

The **Skip Anim** toggle in the presenter bottom bar controls whether jumping via bookmark or slider skips to the end of all animations on the target slide, or starts from step 0.

In the editor, bookmarks are managed via the Slide Properties panel (checkbox + title input) and shown as a blue badge on slide thumbnails.


# Presenter Notes

Speaker notes support the following features:

## Step-aware highlighting

Wrap text in `[step:N]...[/step]` markers to highlight it when the presenter reaches that animation step.

**Steps start at 1** (not 0). Step 1 = first `onClick` animation, step 2 = second `onClick`, etc. A `[step:N]` marker stays highlighted once reached (`activeStep >= N`), so step 1 text remains visible at step 2 and beyond.

```
Introduction text always visible.
[step:1]This appears highlighted at step 1.[/step]
[step:2]This appears highlighted at step 2.[/step]
```

## Comments

Lines prefixed with `// ` are hidden from the presenter display but preserved in the source. Use **Ctrl+/** in the notes editor to toggle comments on selected lines.

```
Key talking point here.
// TODO: add statistics from Q3 report
// This line won't show during presentation
Another visible point.
```

Comments are useful for personal reminders, draft notes, or temporarily hiding content without deleting it.


# Layout Templates

Deckode includes built-in layout templates that provide pre-positioned elements as a starting point for slides. Set the `layout` field on a slide to use one. Elements from the template are merged into the slide; you can override them or add more.

| Layout Name | Description |
|-------------|-------------|
| `"blank"` | Empty slide with only a background. The default when no layout is specified |
| `"title"` | Large centered title with optional subtitle |
| `"title-content"` | Heading at top + body text area below |
| `"two-column"` | Heading + two side-by-side content columns |
| `"section-header"` | Full-slide section divider with centered text |
| `"code-slide"` | Heading + large code block area |
| `"image-left"` | Image on the left half, text content on the right |

**Usage**: Set the `layout` field on a slide object:

```json
{
  "id": "s1",
  "layout": "title-content",
  "elements": [
    {
      "id": "heading",
      "type": "text",
      "content": "## My Custom Title",
      "position": { "x": 60, "y": 30 },
      "size": { "w": 840, "h": 60 },
      "style": { "fontSize": 32, "color": "#f8fafc" }
    },
    {
      "id": "body",
      "type": "text",
      "content": "Content goes here...",
      "position": { "x": 60, "y": 110 },
      "size": { "w": 840, "h": 380 },
      "style": { "fontSize": 20, "color": "#cbd5e1" }
    }
  ]
}
```


# Speaker Notes

Each slide can have a `notes` field with plain text or Markdown content. Notes are displayed in the presenter console during presentations.

## Animation-Aware Notes

Use `[step:N]...[/step]` markers to highlight sections of your notes as animations progress. This helps presenters know what to say at each animation step.

```json
{
  "id": "s2",
  "notes": "Welcome everyone to today's talk.\n\n[step:1]First, let's look at the problem statement. Our current tools are too restrictive.[/step]\n\n[step:2]Here's our proposed solution — a JSON-based approach that gives full control.[/step]\n\n[step:3]And these are the results from our beta testing.[/step]",
  "elements": [ ... ],
  "animations": [
    { "target": "problem", "trigger": "onClick", "effect": "fadeIn" },
    { "target": "solution", "trigger": "onClick", "effect": "slideInLeft" },
    { "target": "results", "trigger": "onClick", "effect": "fadeIn" }
  ]
}
```

**Behavior**:
- Text outside `[step:N]...[/step]` markers is always visible
- Text inside markers is dimmed by default and highlighted (yellow) when the animation reaches that step
- **Steps start at 1** (not 0). Steps correspond to the order of `onClick` animations: the first `onClick` is step 1, the second is step 2, etc.
- Once a step is reached, its text stays highlighted (cumulative: `activeStep >= N`)


# Rotation

Any element can be rotated by setting the `rotation` field (degrees, clockwise). **Exception: `line` and `arrow` shapes must NOT use `rotation`** — the code will assert-fail. Use `waypoints` for line/arrow direction instead.

```json
{
  "id": "label",
  "type": "text",
  "content": "DRAFT",
  "position": { "x": 300, "y": 200 },
  "size": { "w": 360, "h": 80 },
  "rotation": -15,
  "style": { "fontSize": 48, "color": "#ef444480", "textAlign": "center" }
}
```

Rotation is applied as a CSS `transform: rotate()` on the element's bounding box. The element rotates around its center point.


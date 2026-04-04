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

Wrap text in `[step:N]...[/step]` markers to highlight it when the presenter reaches that animation step. **Both the opening `[step:N]` and closing `[/step]` tags are required** — the parser uses a regex that matches `[step:N]...[/step]` pairs. Unclosed markers will not be parsed and will render as plain text.

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

## Example: notes with animations

```json
{
  "notes": "Welcome.\n\n[step:1]Problem statement.[/step]\n\n[step:2]Proposed solution.[/step]",
  "animations": [
    { "target": "problem", "trigger": "onClick", "effect": "fadeIn" },
    { "target": "solution", "trigger": "onClick", "effect": "slideInLeft" }
  ]
}
```


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

**Usage**: Set `"layout": "title-content"` on a slide object. Elements from the template are provided as defaults; override positions, styles, or content as needed.


# Rotation

Any element can be rotated by setting the `rotation` field (degrees, clockwise). Rotation is applied as CSS `transform: rotate()` around the element's center. **Exception: `line` and `arrow` shapes must NOT use `rotation`** — use `waypoints` instead.


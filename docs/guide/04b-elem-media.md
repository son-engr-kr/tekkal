# Image, Video & Custom Elements

## `"image"`

Renders an image.

```json
{
  "id": "e2",
  "type": "image",
  "src": "./assets/diagram.png",
  "alt": "System architecture diagram showing client-server interaction",
  "position": { "x": 500, "y": 100 },
  "size": { "w": 400, "aspectRatio": 1.333 },
  "style": {
    "objectFit": "fill",
    "borderRadius": 8,
    "opacity": 1
  }
}
```

**Tip**: Use `aspectRatio` instead of `h` for images to preserve the original ratio. If you know the image is 4:3, use `"size": { "w": 400, "aspectRatio": 1.333 }`. The height is computed automatically at load time. This prevents AI agents from accidentally distorting images.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | string | yes | Image path relative to project root, or absolute URL |
| `alt` | string | **yes (AI must always provide)** | Short description of what the image depicts. Used for accessibility, PPTX export, and — critically — as the only signal AI agents have about image content when planning or summarizing the deck. Without `alt`, downstream agents see the image as an opaque blob and cannot reason about it. Keep it concise (one sentence) and specific (e.g., `"Bar chart of Q4 revenue by region"`, not `"chart"`). |
| `caption` | string | no | Longer, richer description for slide-context understanding. Complementary to `alt` — while `alt` is a one-liner for accessibility, `caption` can be a sentence or two with domain-specific detail. |
| `description` | string | no | Free-form detail field for AI-facing notes about the image. Rarely set directly; use when the AI needs extended context that does not fit in `alt` or `caption`. |
| `aiSummary` | string | no | Machine-generated caption cached from a multimodal image analysis call. Populated automatically on image upload (if the auto-caption setting is on) or on first AI read via the lazy caption trigger. Treat as derived state — do not hand-edit. |

**Alt text rule for AI agents**: When adding or modifying any image element, you MUST populate `alt`. Treat `alt` as required even though the schema marks it optional. The deck-summary representation passed to the Planner agent does not include image pixels — it only sees `alt`, `caption`, `description`, or `aiSummary`. An image with none of these is invisible to upstream planning. If you do not know what the image depicts (e.g., user-uploaded asset with an opaque filename), call `generate_image_caption(slideId, elementId)` — it runs a multimodal Gemini call and writes the result to `aiSummary`. If captioning is not available, write a placeholder describing the filename and slot (`"User-uploaded asset 'diagram-final-v2.png' in slide 3 hero position"`) rather than leaving it blank.

**Image editing tools** (Deckode in-app AI pipeline only — external agents editing `deck.json` directly should patch the fields themselves):

- `set_image_alt(slideId, elementId, alt)` — replace alt text
- `crop_image(slideId, elementId, top?, right?, bottom?, left?)` — non-destructive crop via `style.crop` fractions. The renderer applies `clip-path: inset(...)` and the original asset is preserved.
- `generate_image_caption(slideId, elementId)` — run a multimodal Gemini call right now and write the result to `aiSummary`. Use when you need to understand image content mid-edit.
- To swap out an image, delete the element and add a new one with the new src — there is no dedicated `replace_image` tool.
**Style fields**:
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `objectFit` | `"contain"` \| `"cover"` \| `"fill"` | `"fill"` | Image fit behavior. With `"fill"`, the image stretches to exactly fill the element boundary. Use "Reset ratio" in Property Panel to restore the original aspect ratio. |
| `borderRadius` | number | `0` | Corner radius in px |
| `opacity` | number | `1` | Opacity (0-1) |
| `border` | string | none | CSS border (e.g., `"2px solid #fff"`) |
## `"video"`

Renders a video player. Supports local MP4/WebM files, YouTube URLs, and Vimeo URLs.

```json
{
  "id": "e5",
  "type": "video",
  "src": "./assets/demo.mp4",
  "position": { "x": 60, "y": 100 },
  "size": { "w": 840, "h": 380 },
  "autoplay": false,
  "loop": false,
  "muted": false,
  "controls": true,
  "style": {
    "objectFit": "contain",
    "borderRadius": 8
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | string | yes | Video source: local path (`./assets/video.mp4`), YouTube URL, or Vimeo URL |
| `autoplay` | boolean | no | Auto-play when slide is shown. Default: `false` |
| `loop` | boolean | no | Loop playback. Default: `false` |
| `muted` | boolean | no | Mute audio. Default: `false` |
| `controls` | boolean | no | Show player controls. Default: `false` |

**Style fields**:
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `objectFit` | `"contain"` \| `"cover"` \| `"fill"` | `"contain"` | Video fit behavior. `"contain"` preserves aspect ratio with letterboxing; `"cover"` fills and crops; `"fill"` stretches ignoring aspect ratio. |
| `borderRadius` | number | `0` | Corner radius in px |
**Source URL handling**:
- **Local files**: `"./assets/video.mp4"` — served from the project's assets folder
- **YouTube**: `"https://www.youtube.com/watch?v=VIDEO_ID"` or `"https://youtu.be/VIDEO_ID"` — auto-converted to embed iframe
- **Vimeo**: `"https://vimeo.com/VIDEO_ID"` — auto-converted to embed iframe

## `"custom"`

Renders a user-defined React component loaded from the project's `components/` directory.

```json
{
  "id": "e7",
  "type": "custom",
  "component": "InteractiveChart",
  "props": {
    "data": [10, 25, 40, 30, 55],
    "color": "#3b82f6",
    "animated": true
  },
  "position": { "x": 100, "y": 100 },
  "size": { "w": 760, "h": 380 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `component` | string | yes | Component filename (without extension) from the project's `components/` directory |
| `props` | object | no | Arbitrary props passed to the component. The component also receives `size: { w, h }` automatically |
The component must be a default-exported React component placed in the project folder (e.g., `components/InteractiveChart.tsx`).

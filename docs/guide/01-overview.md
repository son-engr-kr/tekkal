# Project Structure

A Deckode project is a folder with this layout:

```
my-project/
  deck.json            # The presentation (source of truth)
  slides/              # External slide files (optional, referenced via $ref)
    intro.json
    demo.json
  layouts/             # Layout templates (pre-positioned element sets)
    blank.json
    title.json
    title-content.json
    two-column.json
    section-header.json
    code-slide.json
    image-left.json
  assets/              # Images, videos, and other media (created on demand)
  components/          # Custom React components (optional, dev mode only)
  docs/
    deckode-guide.md   # Navigation index
    guide/             # Detailed spec files (split by section)
```

Your primary task is to read and write `deck.json`. Assets go in `assets/` with relative paths (`"./assets/photo.png"`).

# Core Concept

A Deckode presentation is a single `deck.json` file (with optional `$ref` splits). It is a JSON scene graph: a tree of slides, each containing positioned elements. You produce this JSON. Deckode renders it.


# Coordinate System

- Virtual canvas: **960 x 540** pixels (16:9 aspect ratio)
- Origin `(0, 0)` is the **top-left** corner of the slide
- All `position` and `size` values use this virtual coordinate space
- The renderer scales the virtual canvas to fit the actual viewport

# How the Deckode In-App AI Pipeline Sees Your Deck

> **Scope**: This section describes the context-assembly mechanism used by the Deckode in-app AI pipeline (the chat panel inside the editor). If you are an external AI agent (Claude Code, etc.) reading `deck.json` via file-system tools, none of this applies — you receive the raw JSON and there is no sliding window, no multimodal attach, no background captioning. The section is kept here as reference material for in-app agents and for developers working on the pipeline.

The in-app pipeline does not pass the full `deck.json` to every model call. It sees a compressed representation that grows richer on demand:

1. **Deck summary**: title, slide count, and for each slide the extracted title (via the `#` markdown heading convention, falling back to largest fontSize / topmost y / first text), element count, element types, and a per-element one-line hint. Image hints prefer `aiSummary` → `caption` → `description` → `alt`. Shape hints show the shape kind. Code hints show language + line count. This is what powers routing and high-level planning.

2. **Sliding-window detail**: for decks of 8+ slides, only slides within ±2 of the user's current slide get full element hints; distant slides collapse to title-only lines. Keeps prompts bounded on long decks while preserving full local context where the user is working.

3. **On-demand reads** via tools: `list_slide_titles` (cheapest) → `read_deck` → `find_elements` → `get_slide_outline` → `read_slide` → `read_element`. Agents should reach for the narrowest tool that answers the question — see `08a-guidelines` for the decision tree.

4. **Multimodal attach**: when the user explicitly attaches an image via the Context Bar, the pipeline downscales it (1280px long edge, WebP 0.85) and includes it as an inline data part in the Gemini call, so the model can actually see the pixels. Limited to three attached images per call for token budget. Unattached images are still visible via their cached text captions.

5. **Auto image captioning**: when an AI agent reads an image element that lacks `aiSummary`, a background multimodal caption is scheduled so the next read sees meaningful text. Agents can also force an immediate caption via `generate_image_caption`. Upload-time captioning is opt-in via a user setting (default off).

These mechanisms together mean agents rarely need to dump the full deck JSON, and that token cost scales with what you are actually working on rather than the total deck size.


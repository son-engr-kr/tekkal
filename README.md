# Deckode

**Live Demo:** https://hyoungseo.com/deckode/ie5374/?demo

Local-first, AI-agent-driven slide platform. Visual editor backed by a JSON scene graph, where every drag-and-drop action maps to structured code.

## Quick Start

```bash
git clone <repo-url> deckode
cd deckode
npm install
```

### Development (Vite dev server)

```bash
npm run dev
```

Opens at `http://localhost:5173`. In dev mode the Vite plugin handles file I/O — projects are read from and written to the `projects/` directory on disk. TikZ rendering uses a server-side `latex` + `dvisvgm` pipeline.

### Production / Static (File System Access API)

```bash
npm run build && npx serve dist
```

Opens at `http://localhost:3000`. In this mode there is no backend — the app uses the browser's File System Access API to read/write a local project folder you pick via the directory picker. The chosen folder is remembered across reloads (stored in IndexedDB). TikZ rendering runs client-side via TikZJax (WASM).

## Project Structure

```
deckode/
├── src/
│   ├── adapters/          # File-system adapters (Vite API / FS Access API)
│   ├── components/
│   │   ├── editor/        # Visual editor (canvas, property panel, palettes)
│   │   ├── export/        # PDF / PPTX export
│   │   ├── presenter/     # Presenter console & audience view
│   │   ├── renderer/      # Slide & element rendering
│   │   └── ui/            # Shared UI components
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand state management
│   ├── types/             # TypeScript type definitions
│   ├── schema/            # JSON Schema for deck.json validation
│   ├── server/            # Vite dev-server plugin (file I/O, TikZ compilation)
│   └── utils/             # Utilities (TikZJax, diff, API helpers)
├── docs/
│   ├── implementation-plan.md
│   └── deckode-guide.md   # Specification for AI agents creating decks
├── templates/             # Built-in project templates
└── public/
    └── tikzjax/           # WASM-based TeX engine for client-side TikZ
```

## Deck Format

Slides are stored as `deck.json` — a JSON scene graph. See [Deckode Guide](docs/deckode-guide.md) for the full specification.

```jsonc
{
  "deckode": "0.1.0",
  "meta": { "title": "My Talk", "aspectRatio": "16:9" },
  "slides": [
    {
      "id": "s1",
      "layout": "blank",
      "elements": [
        {
          "id": "e1",
          "type": "text",
          "content": "# Hello **Deckode**",
          "position": { "x": 120, "y": 280 },
          "size": { "w": 720, "h": 120 }
        }
      ]
    }
  ]
}
```

## Tech Stack

- **React 19** + TypeScript
- **Vite** dev server
- **Tailwind CSS v4**
- **Zustand** + Immer for state
- **@dnd-kit** for drag-and-drop
- **Monaco Editor** for JSON editing
- **Framer Motion** for animations
- **KaTeX** for math rendering

## Scripts

| Command             | Description              |
| ------------------- | ------------------------ |
| `npm run dev`     | Start dev server         |
| `npm run build`   | Production build         |
| `npm run preview` | Preview production build |
| `npm run lint`    | Run ESLint               |

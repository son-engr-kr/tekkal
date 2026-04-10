import { SchemaType } from "@google/generative-ai";
import type { DeckodeTool } from "./geminiClient";

export const deckodeTools: DeckodeTool[] = [
  {
    name: "read_deck",
    description:
      "Read a summary of the current deck (slide IDs, titles, element counts). Use read_slide for full details of a specific slide. Only call this if the deck state was NOT already provided in your system prompt.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "read_slide",
    description:
      "Read the full details of a specific slide including all elements with their positions, sizes, and content. Use this when you need to inspect or modify a particular slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "The slide ID to read, e.g. 's1'" },
      },
      required: ["slideId"],
    },
  },
  {
    name: "add_slide",
    description:
      "Add a new slide to the deck. Provide the full slide object with id, elements array, and optional fields like background, notes, animations.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slide: {
          type: SchemaType.OBJECT,
          description: "The slide object to add",
          properties: {
            id: { type: SchemaType.STRING, description: "Unique slide ID, e.g. 's3'" },
            background: {
              type: SchemaType.OBJECT,
              properties: {
                color: { type: SchemaType.STRING },
                image: { type: SchemaType.STRING },
              },
            },
            notes: { type: SchemaType.STRING, description: "Speaker notes" },
            elements: {
              type: SchemaType.ARRAY,
              description: "Array of element objects",
              items: { type: SchemaType.OBJECT, properties: {} },
            },
          },
          required: ["id", "elements"],
        },
        afterSlideId: {
          type: SchemaType.STRING,
          description: "Insert after this slide ID. If omitted, appends at end.",
        },
      },
      required: ["slide"],
    },
  },
  {
    name: "update_slide",
    description:
      "Update an existing slide's properties (background, notes, transition). Does NOT modify elements — use update_element for that.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "ID of the slide to update" },
        patch: {
          type: SchemaType.OBJECT,
          description: "Partial slide fields to update",
          properties: {
            background: {
              type: SchemaType.OBJECT,
              properties: {
                color: { type: SchemaType.STRING },
                image: { type: SchemaType.STRING },
              },
            },
            notes: { type: SchemaType.STRING },
            hidden: { type: SchemaType.BOOLEAN },
            bookmark: { type: SchemaType.STRING },
          },
        },
      },
      required: ["slideId", "patch"],
    },
  },
  {
    name: "delete_slide",
    description: "Delete a slide by its ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "ID of the slide to delete" },
      },
      required: ["slideId"],
    },
  },
  {
    name: "add_element",
    description:
      "Add an element to a specific slide. The element must include type, id, position {x,y}, size {w,h}, and type-specific fields. Canvas is 960x540.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Target slide ID" },
        element: {
          type: SchemaType.OBJECT,
          description: "The element object with type, id, position, size, and type-specific fields",
          properties: {},
        },
      },
      required: ["slideId", "element"],
    },
  },
  {
    name: "update_element",
    description: "Update an existing element's properties. Provide only the fields to change.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide containing the element" },
        elementId: { type: SchemaType.STRING, description: "Element ID to update" },
        patch: {
          type: SchemaType.OBJECT,
          description: "Partial element fields to update",
          properties: {},
        },
      },
      required: ["slideId", "elementId", "patch"],
    },
  },
  {
    name: "delete_element",
    description: "Delete an element from a slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide containing the element" },
        elementId: { type: SchemaType.STRING, description: "Element ID to delete" },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "read_guide",
    description:
      "Read a specific section of the Deckode guide documentation. The guide index is already in your system prompt — use this to fetch detailed specs for element types, animations, theme, etc. Available sections: 01-overview, 02-slide-splitting, 03a-schema-deck, 03b-schema-elements, 04a-elem-text-code, 04b-elem-media, 04c-elem-shape, 04d-elem-tikz, 04e-elem-diagrams, 04f-elem-table-mermaid, 04g-elem-scene3d, 04h-elem-scene3d-examples, 05-animations, 06-theme, 07-slide-features, 08a-guidelines, 08b-style-preferences, 09-example",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        section: { type: SchemaType.STRING, description: "Section filename, e.g. '04c-elem-shape' or '05-animations'" },
      },
      required: ["section"],
    },
  },
  {
    name: "create_deck",
    description:
      "Create a complete new deck, replacing the current one. Use only for full deck generation from scratch.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deck: {
          type: SchemaType.OBJECT,
          description: "Complete deck object with deckode version, meta, theme, and slides",
          properties: {},
        },
      },
      required: ["deck"],
    },
  },
  {
    name: "read_element",
    description:
      "Read the full JSON of a single element. Cheaper than read_slide when you only need one element. Prefer this over read_slide when modifying a specific element you already know by ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide containing the element" },
        elementId: { type: SchemaType.STRING, description: "Element ID to read" },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "move_element",
    description:
      "Move an element to new x/y coordinates. Either x or y (or both) may be provided. Use this instead of update_element for pure position changes — it is safer and more explicit. Canvas is 960x540.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
        x: { type: SchemaType.NUMBER, description: "New x coordinate (optional)" },
        y: { type: SchemaType.NUMBER, description: "New y coordinate (optional)" },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "resize_element",
    description:
      "Resize an element. Optionally specify an anchor (defaults to top-left) so the element stays centered or right-aligned during resize. Canvas is 960x540.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
        w: { type: SchemaType.NUMBER, description: "New width (optional)" },
        h: { type: SchemaType.NUMBER, description: "New height (optional)" },
        anchor: {
          type: SchemaType.STRING,
          description: "Resize anchor: top-left | center | top-right | bottom-left | bottom-right. Default top-left.",
        },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "align_elements",
    description:
      "Align multiple elements on a slide along a single axis (left, center, right, top, middle, bottom). The reference is the bounding box of the selected elements. NEVER compute alignment coordinates manually — call this tool.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementIds: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Element IDs to align (at least 2)",
        },
        alignment: {
          type: SchemaType.STRING,
          description: "left | center | right | top | middle | bottom",
        },
      },
      required: ["slideId", "elementIds", "alignment"],
    },
  },
  {
    name: "distribute_elements",
    description:
      "Distribute elements evenly along the horizontal or vertical axis. Requires at least 3 elements. Spacing is computed from the leftmost/topmost and rightmost/bottommost elements.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementIds: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        axis: { type: SchemaType.STRING, description: "horizontal | vertical" },
      },
      required: ["slideId", "elementIds", "axis"],
    },
  },
  {
    name: "find_elements",
    description:
      "Search for elements across the deck by type, text content, or slide range. Returns a list of matches as { slideId, elementId, type, preview }. Use this to locate elements without dumping every slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        type: {
          type: SchemaType.STRING,
          description: "Element type filter (e.g. 'image', 'text'). Optional.",
        },
        textContains: {
          type: SchemaType.STRING,
          description: "Substring to match in text or code element content. Case-insensitive. Optional.",
        },
        slideRange: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.NUMBER },
          description: "Inclusive [startIndex, endIndex] of slides to search (1-based). Optional.",
        },
      },
    },
  },
  {
    name: "get_slide_outline",
    description:
      "Return a compact one-line-per-element outline of a slide: id, type, position, size, and short content preview. Cheaper than read_slide and ideal when you only need to reason about layout.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
      },
      required: ["slideId"],
    },
  },
  {
    name: "validate_deck",
    description:
      "Run structural validation on the current deck (unique IDs, in-bounds positions, required fields). Returns a list of issues. Call this as a self-check before finishing a generation or modification task.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "duplicate_slide",
    description:
      "Duplicate an existing slide with new unique element IDs. The new slide is inserted after the source slide. Prefer this over add_slide when creating a slide similar to an existing one.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Source slide ID to duplicate" },
        newSlideId: {
          type: SchemaType.STRING,
          description: "ID for the new slide. Must be unique.",
        },
      },
      required: ["slideId", "newSlideId"],
    },
  },
  {
    name: "bring_to_front",
    description:
      "Raise an element to the top of the slide's z-order so it renders above all other elements. Useful when text is hidden behind a shape or image.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "send_to_back",
    description:
      "Lower an element to the bottom of the slide's z-order so it renders behind all other elements. Useful for background shapes or images.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "set_speaker_notes",
    description:
      "Set or replace the speaker notes (the slide.notes field) for a slide. Notes support [step:N]...[/step] markers tied to onClick animations.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        notes: { type: SchemaType.STRING, description: "Full markdown notes content" },
      },
      required: ["slideId", "notes"],
    },
  },
  {
    name: "set_deck_meta",
    description:
      "Update top-level deck metadata (title, author, aspectRatio). Provide only the fields to change. Does not touch slides or theme.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        author: { type: SchemaType.STRING },
        aspectRatio: { type: SchemaType.STRING, description: "16:9 or 4:3" },
      },
    },
  },
  {
    name: "generate_image_caption",
    description:
      "Generate an AI caption for a specific image element and wait for the result. Caches the caption into the element's aiSummary so future reads and deck summaries carry the description. Use when you need to understand an image's content before deciding how to modify the slide, and you cannot wait for the lazy background caption to complete.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "apply_style_to_all",
    description:
      "Apply a style patch to every element matching the filter in one shot. Use for deck-wide consistency operations like unifying heading colors, changing body font, or setting a common shape stroke. The style patch is shallow-merged into each matched element's style object.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        filter: {
          type: SchemaType.OBJECT,
          description: "Which elements to target",
          properties: {
            type: { type: SchemaType.STRING, description: "Element type filter, e.g. 'text', 'shape', 'image'" },
            slideRange: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: "Inclusive [startIndex, endIndex] 1-based slide range. Optional.",
            },
            minFontSize: {
              type: SchemaType.NUMBER,
              description: "For text elements only: only match elements with style.fontSize >= this value. Useful for 'all headings'.",
            },
            maxFontSize: {
              type: SchemaType.NUMBER,
              description: "For text elements only: only match elements with style.fontSize <= this value. Useful for 'all body text'.",
            },
          },
        },
        stylePatch: {
          type: SchemaType.OBJECT,
          description: "Shallow-merged into element.style. Fields must be valid for the targeted element type.",
          properties: {},
        },
      },
      required: ["filter", "stylePatch"],
    },
  },
  {
    name: "check_overlaps",
    description:
      "Detect overlapping element bounding boxes on a slide. Returns pairs that intersect so AI can decide whether the overlap is intentional (e.g. shape+text grouping) or an accidental layout bug.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
      },
      required: ["slideId"],
    },
  },
  {
    name: "check_contrast",
    description:
      "Check WCAG contrast ratio for text elements against the slide background. Returns elements with ratio < 4.5 (AA standard). Use for accessibility review.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
      },
      required: ["slideId"],
    },
  },
  {
    name: "lint_slide",
    description:
      "Run combined design quality checks on a slide: overlaps, contrast, out-of-bounds elements, empty text, and missing titles. Returns all issues found. Use as a self-check before finalizing a slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
      },
      required: ["slideId"],
    },
  },
  {
    name: "snapshot",
    description:
      "Save the current deck state under a label for later restore. Useful as a safety checkpoint before a risky multi-step edit. Snapshots are in-memory and cleared on page reload.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        label: { type: SchemaType.STRING, description: "Label to identify this snapshot" },
      },
      required: ["label"],
    },
  },
  {
    name: "restore",
    description:
      "Restore the deck to a previously saved snapshot by label. Discards all changes made since the snapshot was taken. Use only when an edit went wrong and you need to start over.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        label: { type: SchemaType.STRING, description: "Snapshot label to restore" },
      },
      required: ["label"],
    },
  },
  {
    name: "list_snapshots",
    description: "List all saved snapshot labels in this session.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "undo",
    description:
      "Undo the most recent deck change via the editor's temporal history. Complements snapshot/restore: undo walks back one step, restore jumps to a named checkpoint.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "redo",
    description: "Redo the most recently undone deck change.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "merge_slides",
    description:
      "Merge multiple slides into a single target slide. Elements from source slides are appended to the target, with y-offset adjustments to stack them vertically. Source slides are deleted after merge. Useful for consolidating outlines into a single summary slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        targetSlideId: { type: SchemaType.STRING, description: "Slide that will receive the merged content" },
        sourceSlideIds: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Slides whose elements will be moved into the target. The target itself may be omitted from this list.",
        },
      },
      required: ["targetSlideId", "sourceSlideIds"],
    },
  },
  {
    name: "split_slide",
    description:
      "Split a slide at a pivot element. Elements at and after the pivot are moved into a new slide inserted after the source. Useful when a slide has accumulated too much content and needs to be broken up.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Source slide to split" },
        pivotElementId: { type: SchemaType.STRING, description: "First element that should move to the new slide" },
        newSlideId: { type: SchemaType.STRING, description: "ID for the new slide" },
      },
      required: ["slideId", "pivotElementId", "newSlideId"],
    },
  },
  {
    name: "change_z_order",
    description:
      "Move an element up or down in the slide's element order by a relative delta. Positive delta moves toward the front, negative toward the back. Use bring_to_front / send_to_back for extreme positions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
        delta: { type: SchemaType.NUMBER, description: "Positions to shift. +1 = one step toward front, -1 = one step toward back." },
      },
      required: ["slideId", "elementId", "delta"],
    },
  },
  {
    name: "list_slide_titles",
    description:
      "Return a compact list of every slide's ID and extracted title. The cheapest way to understand overall deck structure — use this before read_deck when you only need the table of contents.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "search_text",
    description:
      "Search the deck for a substring across text element content, code content, image alt/caption, and optionally speaker notes. Returns matching locations so you can read or modify them without dumping whole slides.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: "Substring to match. Case-insensitive." },
        includeNotes: { type: SchemaType.BOOLEAN, description: "Also search slide.notes. Default false." },
      },
      required: ["query"],
    },
  },
  {
    name: "count_elements",
    description:
      "Return counts of elements by type across the deck or within a slide range. Useful for deck-level statistics like 'how many images do I have' without reading every slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideRange: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.NUMBER },
          description: "Inclusive [startIndex, endIndex] 1-based slide range. Optional — defaults to whole deck.",
        },
      },
    },
  },
  {
    name: "duplicate_element",
    description:
      "Duplicate an existing element on the same slide with a small offset. Useful when building repeated layouts (e.g., several icons or buttons). The new element gets a fresh unique ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING, description: "Element to duplicate" },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "reorder_slides",
    description:
      "Apply a new slide ordering to the deck. Provide the full list of slide IDs in the desired order. Any slide ID omitted from the list is left out (rejected). For a deterministic outcome always pass every slide ID exactly once.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Slide IDs in the desired order.",
        },
      },
      required: ["order"],
    },
  },
  {
    name: "move_slide",
    description:
      "Move a single slide to a new index. Prefer this over reorder_slides when relocating just one slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        toIndex: { type: SchemaType.NUMBER, description: "0-based target position" },
      },
      required: ["slideId", "toIndex"],
    },
  },
  {
    name: "set_slide_background",
    description:
      "Set or replace the background of a slide. Accepts a color, an image src, or both. Does not touch elements or notes.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        color: { type: SchemaType.STRING, description: "CSS color (e.g., '#0f172a'). Optional." },
        image: { type: SchemaType.STRING, description: "Image src path. Optional." },
      },
      required: ["slideId"],
    },
  },
  {
    name: "apply_theme",
    description:
      "Shallow-merge a patch into the deck theme (colors, fonts, per-element-type defaults). Use for deck-wide aesthetic changes. Only known top-level theme buckets (slide, text, code, shape, image, video, tikz, mermaid, table, scene3d) are accepted; unknown keys are ignored.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        themePatch: {
          type: SchemaType.OBJECT,
          description: "Partial theme object. Each key is a bucket (slide, text, code, etc.) mapped to that bucket's style fields.",
          properties: {},
        },
      },
      required: ["themePatch"],
    },
  },
  {
    name: "set_image_alt",
    description:
      "Set or replace the alt text on an image element. Cheaper and more explicit than update_element for this common operation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
        alt: { type: SchemaType.STRING, description: "Short accessibility description of the image" },
      },
      required: ["slideId", "elementId", "alt"],
    },
  },
  {
    name: "add_comment",
    description:
      "Attach a comment to a slide, optionally anchored to a specific element. Comments persist on the deck and can be categorized.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide the comment belongs to" },
        text: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING, description: "Optional element the comment is about" },
        category: {
          type: SchemaType.STRING,
          description: "One of: content, design, bug, todo, question, done",
        },
      },
      required: ["slideId", "text"],
    },
  },
  {
    name: "resolve_comment",
    description:
      "Mark a comment as done by flipping its category to 'done'. Use when the work the comment describes has been completed.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        commentId: { type: SchemaType.STRING },
      },
      required: ["slideId", "commentId"],
    },
  },
  {
    name: "crop_image",
    description:
      "Non-destructively crop an image element by setting the style.crop fractions (top/right/bottom/left, each 0-1 representing the fraction cropped from that edge). The renderer applies clip-path inset so the original image asset is preserved and the crop can be undone at any time.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING },
        elementId: { type: SchemaType.STRING },
        top: { type: SchemaType.NUMBER, description: "Fraction (0-1) cropped from top edge. Default 0." },
        right: { type: SchemaType.NUMBER, description: "Fraction (0-1) cropped from right edge. Default 0." },
        bottom: { type: SchemaType.NUMBER, description: "Fraction (0-1) cropped from bottom edge. Default 0." },
        left: { type: SchemaType.NUMBER, description: "Fraction (0-1) cropped from left edge. Default 0." },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "diff_against_snapshot",
    description:
      "Compare the current deck to a previously saved snapshot and return a structural diff summary: slides added/removed/modified and element counts. Useful as a self-check after a multi-step edit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        label: { type: SchemaType.STRING, description: "Snapshot label to diff against" },
      },
      required: ["label"],
    },
  },
];

// ── Project file reference tools (only available when a project is @mentioned) ──

export const projectFileTools: DeckodeTool[] = [
  {
    name: "list_project_files",
    description:
      "List files in a registered reference project directory. Returns relative file paths. Use to discover available source files before reading them.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        projectName: { type: SchemaType.STRING, description: "Name of the registered project" },
        path: { type: SchemaType.STRING, description: "Subdirectory path to list (optional, defaults to root)" },
      },
      required: ["projectName"],
    },
  },
  {
    name: "read_project_file",
    description:
      "Read the contents of a file from a registered reference project. Returns the file text content (max 100KB).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        projectName: { type: SchemaType.STRING, description: "Name of the registered project" },
        filePath: { type: SchemaType.STRING, description: "Relative file path within the project" },
      },
      required: ["projectName", "filePath"],
    },
  },
];

const READ_TOOL_NAMES = new Set([
  "read_deck",
  "read_slide",
  "read_guide",
  "read_element",
  "get_slide_outline",
  "find_elements",
]);

const REVIEWER_WRITE_TOOL_NAMES = new Set([
  "update_element",
  "update_slide",
  "delete_element",
  "move_element",
  "resize_element",
  "align_elements",
  "distribute_elements",
  "validate_deck",
]);

export const plannerTools: DeckodeTool[] = deckodeTools.filter((t) => READ_TOOL_NAMES.has(t.name));

export const generatorTools: DeckodeTool[] = deckodeTools; // all tools (includes read_guide)

export const reviewerTools: DeckodeTool[] = deckodeTools.filter(
  (t) => READ_TOOL_NAMES.has(t.name) || REVIEWER_WRITE_TOOL_NAMES.has(t.name),
);

export const writerTools: DeckodeTool[] = deckodeTools.filter(
  (t) => READ_TOOL_NAMES.has(t.name) || t.name === "update_slide",
);

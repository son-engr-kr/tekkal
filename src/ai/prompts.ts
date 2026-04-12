import type { Deck, Slide, SlideElement, TextElement, ImageElement, VideoElement, ShapeElement, CodeElement } from "@/types/deck";
import { GUIDE_INDEX, readGuide } from "./guides";

const TITLE_PREVIEW_LENGTH = 80;
const HINT_PREVIEW_LENGTH = 50;

/**
 * Extract a slide title using a layered heuristic.
 * Priority: markdown # heading > largest fontSize text > topmost text > first text element.
 * Returns null when no text element exists.
 */
export function extractSlideTitle(slide: Slide): string | null {
  const texts = slide.elements.filter((e): e is TextElement => e.type === "text");
  if (texts.length === 0) return null;

  const headed = texts.find((t) => /^\s*#\s+/.test(t.content));
  if (headed) return stripMarkdownHeading(headed.content);

  const sortedByFontSize = [...texts].sort(
    (a, b) => (b.style?.fontSize ?? 0) - (a.style?.fontSize ?? 0),
  );
  const largest = sortedByFontSize[0]!;
  const allSameSize = sortedByFontSize.every(
    (t) => (t.style?.fontSize ?? 0) === (largest.style?.fontSize ?? 0),
  );
  if (!allSameSize) return firstLine(largest.content);

  const sortedByY = [...texts].sort((a, b) => a.position.y - b.position.y);
  return firstLine(sortedByY[0]!.content);
}

function stripMarkdownHeading(content: string): string {
  const firstLineRaw = content.split("\n", 1)[0] ?? "";
  return firstLineRaw.replace(/^\s*#+\s*/, "").trim().slice(0, TITLE_PREVIEW_LENGTH);
}

function firstLine(content: string): string {
  return (content.split("\n", 1)[0] ?? "").trim().slice(0, TITLE_PREVIEW_LENGTH);
}

/**
 * One-line semantic hint per element so the Planner can reason about a slide
 * without calling read_slide. Image/video hints surface alt + aiSummary so the
 * deck summary is meaningful even when slides are media-heavy.
 */
function elementHint(element: SlideElement): string {
  switch (element.type) {
    case "text": {
      const content = (element as TextElement).content.replace(/\s+/g, " ").trim();
      return `text: "${content.slice(0, HINT_PREVIEW_LENGTH)}${content.length > HINT_PREVIEW_LENGTH ? "…" : ""}"`;
    }
    case "image": {
      const img = element as ImageElement;
      const summary = img.aiSummary ?? img.caption ?? img.description ?? img.alt;
      return summary ? `image[${truncate(summary, HINT_PREVIEW_LENGTH)}]` : `image[no alt — UNDESCRIBED]`;
    }
    case "video": {
      const vid = element as VideoElement;
      return vid.alt ? `video[${truncate(vid.alt, HINT_PREVIEW_LENGTH)}]` : `video[no alt]`;
    }
    case "shape": {
      const sh = element as ShapeElement;
      return `shape[${sh.shape}]`;
    }
    case "code": {
      const code = element as CodeElement;
      return `code[${code.language}, ${code.content.split("\n").length} lines]`;
    }
    default:
      return element.type;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Shared context shape — matches ContextBarSnapshot in pipeline.ts (defined here to avoid circular deps)
export interface PromptContext {
  currentSlide: { slideId: string; slideIndex: number; title: string } | null;
  elements: Array<{ elementId: string; slideId: string; type: string; label: string }>;
  projectNames: string[];
}

/**
 * Build the "Attached Context" section for AI system prompts.
 * @param forPlanner — if true, omit tool instructions (planner outputs JSON, doesn't call tools)
 */
export function buildContextSection(ctx: PromptContext | undefined, forPlanner = false): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.currentSlide) {
    parts.push(`- User is viewing Slide ${ctx.currentSlide.slideIndex + 1} [${ctx.currentSlide.slideId}]: "${ctx.currentSlide.title}"`);
  }

  if (ctx.elements.length > 0) {
    const elList = ctx.elements
      .map((e) => `${e.elementId} (${e.type}: "${e.label}")`)
      .join(", ");
    parts.push(`- User selected elements: ${elList}`);
  }

  if (ctx.projectNames.length > 0) {
    parts.push(`- Reference projects available: ${ctx.projectNames.map((n) => `@${n}`).join(", ")}`);
    if (forPlanner) {
      parts.push(`  You have list_project_files and read_project_file tools available when projects are attached. Use them to explore project contents if the user asks.`);
    } else {
      parts.push(`  Use list_project_files and read_project_file tools with these project names to access their source code when relevant to the user's request.`);
    }
  }

  if (parts.length === 0) return "";
  return `\n## User's Attached Context\n${parts.join("\n")}\n`;
}

// Layer 1: Role definition
// Layer 2: Guide index (tekkal-guide.md) — lightweight for planner/reviewer/writer
// Layer 3: Current state
// Layer 4: Design guidelines + style reference (from guide files)
// Layer 5: Style context (for notes agent)
// Layer 6: User request (injected at call time)
// Layer 7: Constraints (from guide files)

// Lightweight index for agents that just need to know what's available
const GUIDE_OVERVIEW = GUIDE_INDEX;

// Pre-loaded essential schema for the generator — avoids wasting iterations on read_guide
function getGeneratorSchema(): string {
  return [
    readGuide("03a-schema-deck"),
    readGuide("03b-schema-elements"),
    readGuide("04a-elem-text-code"),
    readGuide("04c-elem-shape"),
    readGuide("04d-elem-tikz"),
    readGuide("04e-elem-diagrams"),
    readGuide("05-animations"),
    readGuide("08a-guidelines"),
    readGuide("08c-visual-style"),
    readGuide("08d-layout-templates"),
  ].join("\n\n---\n\n");
}

// Loaded from guide files — single source of truth in docs/guide/
const CONSTRAINTS = readGuide("08a-guidelines");

// Content Agent schema: text, code, table elements
function getContentAgentSchema(): string {
  return [
    readGuide("03a-schema-deck"),
    readGuide("03b-schema-elements"),
    readGuide("04a-elem-text-code"),
    readGuide("04f-elem-table-mermaid"),
    readGuide("05-animations"),
    readGuide("08a-guidelines"),
    readGuide("08c-visual-style"),
    readGuide("08d-layout-templates"),
  ].join("\n\n---\n\n");
}

// Visual Agent schema: shapes, arrows, TikZ, diagrams
function getVisualAgentSchema(): string {
  return [
    readGuide("03b-schema-elements"),
    readGuide("04c-elem-shape"),
    readGuide("04d-elem-tikz"),
    readGuide("04e-elem-diagrams"),
    readGuide("08a-guidelines"),
    readGuide("08c-visual-style"),
    readGuide("08d-layout-templates"),
  ].join("\n\n---\n\n");
}

export function buildPlannerPrompt(deck: Deck | null, context?: PromptContext): string {
  const state = deck
    ? `\n## Current Deck State\nTitle: "${deck.meta.title}"\nSlides: ${deck.slides.length}\n${deck.slides.map((s, i) => `  ${i + 1}. [${s.id}] ${s.elements.filter((e) => e.type === "text").map((e) => (e as { content: string }).content.slice(0, 60)).join(" | ") || "(no text)"} ${s.notes ? "(has notes)" : ""}`).join("\n")}\n`
    : "\n## Current Deck State\nNo deck loaded (will create new).\n";

  const contextSection = buildContextSection(context, true);

  return `## Role
You are the Planner agent for TEKKAL, a JSON-based slide platform. Your job is to:
1. Classify the user's intent (create, modify, notes, review, chat)
2. For "create" intent: generate a detailed slide-by-slide outline
3. For other intents: describe what actions are needed

${GUIDE_OVERVIEW}

You have a read_guide tool to fetch detailed documentation sections listed above. Use it when you need specifics about element types, animations, or guidelines.
${state}${contextSection}
## Output Format
Respond with a JSON object (no markdown code fences):
{
  "intent": "create" | "modify" | "notes" | "review" | "chat" | "style_inquiry",
  "plan": {
    "topic": "presentation topic",
    "audience": "target audience",
    "slideCount": number,
    "slides": [
      {
        "id": "s1",
        "title": "slide title",
        "type": "title | content | code | diagram | comparison | summary",
        "template": "t-title-a (optional — recommended layout template ID from 08d)",
        "keyPoints": ["point 1", "point 2"],
        "elementTypes": ["text", "shape", "table", "code"]
      }
    ]
  },
  "reasoning": "brief explanation of your classification and plan"
}

For "chat" intent, just provide:
{ "intent": "chat", "response": "your helpful answer", "reasoning": "..." }

For "modify" intent:
{ "intent": "modify", "actions": ["description of each modification"], "reasoning": "..." }

For "notes" intent:
{ "intent": "notes", "reasoning": "..." }

For "review" intent:
{ "intent": "review", "reasoning": "..." }

Important: For "create", always include a title slide first and plan diagrams using shape elements (not mermaid/tikz).

## Reference Project Queries
When the user has attached a reference project and asks about its contents or code, you have list_project_files and read_project_file tools available. Use them to explore the project, then classify the intent and respond appropriately. For exploratory questions ("what's inside?"), use "chat" intent and include your findings in the response.

## Layout Templates
Available templates (from guide 08d-layout-templates): t-title-a, t-title-b, t-section, t-three-metric, t-card-gallery, t-triple-image, t-image-annotated, t-two-image, t-image-table, t-code-panel, t-math, t-hero-stat, t-timeline.
For each slide in the plan, optionally include a "template" field with the recommended template ID. Downstream agents will use this as a layout reference.

## Style Preferences (MANDATORY for new decks)
Before creating a new deck, you MUST check whether the user has already specified their style preferences in the conversation history.

If preferences are NOT present, return:
{ "intent": "style_inquiry", "response": "I need your style preferences before creating the deck.", "reasoning": "User wants to create a new deck but has not specified style preferences." }

The UI will show an interactive form for the user to pick their choices. After they respond, you will receive the preferences and can proceed with "create" intent.

If the user HAS already specified preferences (in previous messages), proceed directly with "create" intent. Include the chosen preferences in the plan's "reasoning" field so downstream agents can apply them.

Once preferences are chosen, apply them consistently to all subsequent slides without asking again. If adding slides to an **existing deck**, infer the style from existing slides instead of asking.
`;
}

export function buildGeneratorPrompt(deck: Deck | null, context?: PromptContext): string {
  const state = deck ? formatDeckState(deck, { anchorSlideId: context?.currentSlide?.slideId }) : "No deck loaded.";
  const contextSection = buildContextSection(context);
  const schema = getGeneratorSchema();

  return `## Role
You are the Generator agent for TEKKAL. You create and modify slides by calling tools. You receive an approved plan and execute it precisely.

${schema}

## Current Deck State
${state}
${contextSection}

## Instructions
- You have a read_guide tool to fetch detailed specs for any element type, animations, theme, etc. Use it before creating unfamiliar element types (tikz, scene3d, table, etc.).
- The current deck state is already provided above. Do NOT call read_deck unless you need to verify changes you just made.
- Use read_slide only if you need full element details for a specific slide you're modifying.
- Execute the plan by calling the appropriate tools (add_slide, add_element, update_slide, etc.)
- Create slides one at a time with ALL elements included in the slide object
- ALWAYS include presenter notes in every slide (notes field) — describe what the presenter should say
- Use the style guide colors, fonts, and layout patterns consistently
- If the plan includes a "template" field, use the layout template from guide 08d as a starting point — match element positions, sizes, and palette
- For diagrams: build with shape (rectangle, arrow) + text elements, grouped with groupId
- Code elements: show only the essential 5-8 lines that illustrate the concept — never paste entire files (hard limit: 25 lines)
- KaTeX math: use SINGLE backslash for ALL commands (\pi, \sum, \mathbf{x}, \alpha). NEVER double-backslash (\\pi is wrong). For bold math use \mathbf{} or \boldsymbol{} — NOT \bm{} (unsupported in KaTeX). Multi-line equations need \begin{aligned}...\end{aligned}
- FORBIDDEN element types: "mermaid", "iframe", "audio", "animation" — NEVER use these
- Allowed media types: "image" (src path to local asset), "video" (YouTube URL via url field)
- Element positioning: ensure no two elements overlap (check x/y/w/h of all other elements before placing)
- Element IDs MUST be globally unique across ALL slides. Use slide-scoped IDs: for slide s1 use "s1-e1", "s1-e2"...; for slide s2 use "s2-e1", "s2-e2"... Never reuse an ID that appears in any other slide.
- After creating all slides, briefly confirm what was created

## Animations (MANDATORY)
Apply the user's chosen animation style to EVERY content slide (non-title):

rich: Include an "animations" array in the slide object with onClick + fadeIn for each non-title element. Example for a slide with elements s2-e2, s2-e3, s2-e4:
\`\`\`json
"animations": [
  { "target": "s2-e2", "effect": "fadeIn", "trigger": "onClick", "duration": 300 },
  { "target": "s2-e3", "effect": "fadeIn", "trigger": "withPrevious", "duration": 300 },
  { "target": "s2-e4", "effect": "fadeIn", "trigger": "onClick", "duration": 300 }
]
\`\`\`
Use onClick for each main reveal point, withPrevious for elements that should appear together with the previous.

minimal: Add only one onEnter fadeIn for the slide (no onClick). No step markers in notes.

none: No animations array. No step markers in notes.

## Presenter Notes Format
Write notes that help the presenter deliver the content:
- 2-4 sentences per slide
- Professional, confident tone
- ONLY use [step:N]...[/step] markers when the slide has onClick animations. Count the onClick animations in the slide's animations array — that number MUST equal the number of [step:N] markers. No onClick animations = no step markers.
- Include key talking points and transitions to the next slide
`;
}

const ANIMATIONS_SECTION = `## Animations (MANDATORY)
Apply the user's chosen animation style to EVERY content slide (non-title):

rich: Include an "animations" array in the slide object with onClick + fadeIn for each non-title element.
Use onClick for each main reveal point, withPrevious for elements that appear together with the previous.

minimal: Add only one onEnter fadeIn for the slide (no onClick). No step markers in notes.

none: No animations array. No step markers in notes.`;

const NOTES_SECTION = `## Presenter Notes Format
Write notes that help the presenter deliver the content:
- 2-4 sentences per slide
- Professional, confident tone
- ONLY use [step:N]...[/step] markers when the slide has onClick animations. The number of [step:N] markers MUST exactly match the number of onClick animations. No onClick animations = no step markers.
- Include key talking points and transitions to the next slide`;

export function buildContentAgentPrompt(deck: Deck | null, context?: PromptContext): string {
  const state = deck ? formatDeckState(deck, { anchorSlideId: context?.currentSlide?.slideId }) : "No deck loaded.";
  const contextSection = buildContextSection(context);
  const schema = getContentAgentSchema();

  return `## Role
You are the Content Agent for TEKKAL. You create text, code, and table elements for slides.
You are one part of a two-agent system: after you create the slide structure, the Visual Agent will add shapes, diagrams, and TikZ elements.

${schema}

## Current Deck State
${state}
${contextSection}

## Instructions
- If the plan includes a "template" field, refer to the layout template from guide 08d-layout-templates for element positions, sizes, and styles. Use it as a starting point and adapt the content.
- Create the slide with add_slide, including ALL text, code, and table elements
- For this slide, use text elements for: title, bullet points, labels, captions, descriptions
- For code slides, use the code element type with appropriate language — show only 5-8 key lines, no full files
- For data slides, use the table element type (MUST include columns and rows arrays)
- Element IDs must be slide-scoped: for slide s1 use "s1-e1", "s1-e2", etc.
- ALWAYS include presenter notes (notes field) in the slide
- Do NOT add shapes, TikZ, scene3d, or diagrams — the Visual Agent will handle those
- If the slide plan says "diagram", "shape", "tikz", or "scene3d" in elementTypes:
  - Use a SPLIT LAYOUT: left column (x:0–480) for text/code/table, right column (x:480–960) for the diagram placeholder
  - OR top/bottom split: text in top half (y:0–250), diagram in bottom half (y:260–540) — only if no code element
  - Add one placeholder element: { id: "[slideId]-diagram-placeholder", type: "text", position: {x:490, y:80}, size: {w:440, h:380}, content: "[Diagram placeholder — Visual Agent will fill this area]" }
  - Keep ALL text/code/table elements strictly within x:0–480 when using split layout
- If NO visual elements needed: elements may use the full 960×540 canvas
- FORBIDDEN element types: "mermaid", "iframe", "audio", "animation" — NEVER use these
- Allowed media types: "image" (src path to local asset), "video" (YouTube URL via url field)
- After adding the slide, briefly confirm what was created

${ANIMATIONS_SECTION}

${NOTES_SECTION}
`;
}

export function buildVisualAgentPrompt(deck: Deck | null, context?: PromptContext): string {
  const state = deck ? formatDeckState(deck, { anchorSlideId: context?.currentSlide?.slideId }) : "No deck loaded.";
  const contextSection = buildContextSection(context);
  const schema = getVisualAgentSchema();

  return `## Role
You are the Visual Agent for TEKKAL. You add shapes, arrows, TikZ diagrams, and visual decorations to existing slides.
The Content Agent has already created the slide with text/code/table elements. Your job is to enhance it visually.

${schema}

## Current Deck State
${state}
${contextSection}

## Instructions
- Call read_slide FIRST to inspect existing elements, their positions, and IDs before adding anything
- Add shape (rectangle, arrow, ellipse) elements to create diagrams and flow charts
- For mathematical diagrams, use tikz elements (MUST include \\path bounding box)
- Group related shapes with the same groupId
- Arrow/line elements MUST have style.waypoints (at least 2 points) — NEVER set rotation on arrows
- Element IDs must be slide-scoped and not conflict with existing IDs on this slide
- CRITICAL layout: Content Agent places text/code/table in the LEFT column (x:0–480). Place ALL visual elements in the RIGHT column (x:480–960, y:80–460). Canvas is 960×540.
- If a slide already has a tikz element, do NOT add another tikz to the same slide
- FIRST: call read_slide to find any element with id ending in "-diagram-placeholder". Delete it with delete_element BEFORE adding visual elements. This is mandatory.
- After deleting the placeholder, fill the right column (x:490, y:80, w:440, h:380) with your diagram/tikz/scene3d
- FORBIDDEN element types: "mermaid", "iframe", "audio", "animation" — NEVER use these
- Allowed media types: "image" (src path to local asset), "video" (YouTube URL via url field)
- Use add_element to add each visual element to the slide
- After adding all visual elements, briefly confirm what was created

## Common Diagram Patterns
- Flow chart: rectangle shapes for boxes + arrow shapes for connections, all grouped
- Comparison: two rectangle shapes side by side, text labels inside
- Process: horizontal arrow with rectangle steps above/below it
`;
}

export function buildReviewerPrompt(deck: Deck | null): string {
  const state = deck ? formatDeckState(deck) : "No deck loaded.";

  return `## Role
You are the Reviewer agent for TEKKAL. You validate the current deck for structural and design issues.

${GUIDE_OVERVIEW}

## Current Deck State
${state}

## Validation Checklist
These items mirror the canonical validateDeck rules. Any issue you
"fix" must correspond to one of these checks. Do not invent issues
that are not in this list, and do not proactively add or rewrite
content that validateDeck did not flag.

1. All slide IDs are unique
2. All element IDs are unique across the deck
3. Required fields present (type, id, position, size on every element)
4. Positions within bounds (0-960 for x, 0-540 for y)
5. Elements don't overflow canvas (x+w <= 960, y+h <= 540)
6. Text elements have non-empty content
7. Every slide has at least one element; slides with notes but
   no elements are an interrupted-generation signal — fix by
   adding the planned content, not by removing the notes
8. Image/video src and slide.background.image start with
   ./assets/, /assets/, http(s)://, or data: — bare filenames
   silently render as nothing
9. No overlapping elements that would obscure content
10. Grouped elements (box + label) share the same groupId
11. Reasonable font sizes (not too small < 10, not too large > 72)
12. No mermaid, iframe, audio, or animation elements; image/video types are allowed
13. Line/arrow elements have style.waypoints (at least 2 {x, y}
    points) and NO rotation field
14. TikZ elements include a bounding box (\\path rectangle)
15. Step markers in notes: 1-indexed (never [step:0]), the
    highest N must not exceed the slide's onClick animation count,
    and the total marker count matches the onClick count
16. No Markdown ** inside KaTeX math delimiters (use \\mathbf{} instead)
17. No line-break \\\\ in text content outside a \\begin{env}...\\end{env} block

## Instructions
- You have a read_guide tool to fetch detailed documentation. Use read_guide("08a-guidelines") to review common pitfalls before validating.
- The current deck state is already provided above. Only call read_slide if you need full details for a specific slide.
- Run validate_deck to get the authoritative issue list. Fix ONLY
  the issues validate_deck reports. Do not make proactive edits
  beyond that list — stylistic rewrites and "while I'm here"
  changes make the review report inconsistent with the pipeline's
  post-fix re-validation count.
- For fixable issues, use update_element or update_slide — NEVER call add_slide (slides already exist).
- Report findings as a summary whose count exactly matches the
  issues validate_deck reported.

## Output Format
After fixing any issues, respond with a summary:
"Reviewed N slides. Fixed M of the K issues validate_deck reported. [Details of any remaining issues]"
`;
}

export function buildWriterPrompt(deck: Deck | null): string {
  const existingNotes = deck
    ? deck.slides
        .filter((s) => s.notes)
        .map((s) => `[${s.id}]: ${s.notes}`)
        .join("\n")
    : "";

  const styleContext = existingNotes
    ? `\n## Existing Notes Style\nThe user has these existing speaker notes. Match their style, tone, and length:\n${existingNotes}\n`
    : "\n## No existing notes found. Use a professional, conversational tone. Keep notes concise (2-4 sentences per slide).\n";

  const state = deck ? formatDeckState(deck) : "No deck loaded.";

  return `## Role
You are the Writer agent for TEKKAL. You generate speaker notes that match the user's existing writing style.

${GUIDE_OVERVIEW}

## Current Deck State
${state}
${styleContext}

## Instructions
- You have a read_guide tool. Use read_guide("07-slide-features") for details on [step:N] markers and presenter notes format.
- Analyze existing notes for: sentence length, tone (formal/casual), structure (bullet vs paragraph), vocabulary level
- Generate notes for slides that lack them (or regenerate all if asked)
- Use update_slide to set the notes field for each slide
- Notes should help the presenter deliver the content effectively
- If slides have animations, use [step:N]...[/step] markers (closing tag is REQUIRED):
  [step:1]First click reveals...[/step]
  [step:2]Next, the diagram shows...[/step]
- Include key talking points, transitions to next slide, and emphasis markers
- Professional, confident tone that acknowledges complexity without being condescending

${CONSTRAINTS}
`;
}

export interface FormatDeckStateOptions {
  /** Slide ID the user is currently focused on. Triggers sliding-window mode when set. */
  anchorSlideId?: string;
  /** Number of slides on each side of the anchor that get full element hints. Default 2. */
  windowRadius?: number;
  /** Minimum slide count before sliding-window trimming kicks in. Default 8. */
  windowThreshold?: number;
}

/**
 * Compact deck summary — avoids dumping full element details into every prompt.
 *
 * Sliding-window mode: when the deck has at least `windowThreshold` slides AND
 * an `anchorSlideId` is provided, only slides within ±`windowRadius` of the
 * anchor get expanded element hints. Distant slides collapse to a single
 * title-only line. This keeps prompts bounded for large decks while preserving
 * full local context where the user is working.
 */
export function formatDeckState(deck: Deck, opts: FormatDeckStateOptions = {}): string {
  const lines: string[] = [
    `Title: "${deck.meta.title}" | Author: ${deck.meta.author ?? "N/A"} | Aspect: ${deck.meta.aspectRatio}`,
    `Theme background: ${deck.theme?.slide?.background?.color ?? "default"}`,
    `Slides (${deck.slides.length}):`,
  ];

  const radius = opts.windowRadius ?? 2;
  const threshold = opts.windowThreshold ?? 8;
  const anchorIdx = opts.anchorSlideId
    ? deck.slides.findIndex((s) => s.id === opts.anchorSlideId)
    : -1;
  const useWindow = anchorIdx >= 0 && deck.slides.length >= threshold;
  const windowStart = useWindow ? Math.max(0, anchorIdx - radius) : 0;
  const windowEnd = useWindow ? Math.min(deck.slides.length - 1, anchorIdx + radius) : deck.slides.length - 1;

  if (useWindow) {
    lines.push(
      `(sliding-window mode: detailed view around slide ${anchorIdx + 1}/${deck.slides.length}, radius ${radius})`,
    );
  }

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i]!;
    const inWindow = !useWindow || (i >= windowStart && i <= windowEnd);
    const title = extractSlideTitle(slide);
    const titleLabel = title ? ` "${title}"` : " <no title>";
    const flags = `${slide.notes ? " [has notes]" : ""}${slide.hidden ? " [hidden]" : ""}`;

    if (inWindow) {
      lines.push(
        `  [${slide.id}]${titleLabel} — ${slide.elements.length} elements${flags}`,
      );
      if (slide.elements.length > 0) {
        const hints = slide.elements.map((e) => `${e.id}=${elementHint(e)}`);
        lines.push(`    elements: ${hints.join(" | ")}`);
      }
    } else {
      // Title-only line for distant slides
      lines.push(`  [${slide.id}]${titleLabel} (${slide.elements.length} el)${flags}`);
    }
  }

  return lines.join("\n");
}

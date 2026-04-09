/**
 * Deckode AI pipeline CLI test script.
 * Usage: GEMINI_API_KEY=xxx node scripts/test-pipeline.mjs
 *
 * Replicates the planner + generator flow from src/ai/pipeline.ts in
 * standalone Node.js (no Vite/React imports).
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GUIDE_DIR = path.join(ROOT, "docs", "guide");
const GUIDE_INDEX_FILE = path.join(ROOT, "docs", "deckode-guide.md");

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Gemini SDK (CJS-compatible import via require to avoid ESM interop issues)
// ---------------------------------------------------------------------------
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MODEL = "gemini-2.5-flash";
const MAX_GENERATOR_ITERATIONS = 25;

// ---------------------------------------------------------------------------
// Programmatic media injection — images/video added directly, bypassing AI
// imageZone: the pixel region the injected media occupies — content agents are
// told to avoid this zone so they don't place elements that will later conflict.
// ---------------------------------------------------------------------------
const SLIDE_MEDIA = {
  s1: [
    {
      id: "s1-rl-lecture",
      type: "video",
      src: "https://www.youtube.com/watch?v=2pWv7GOvuf0",
      position: { x: 240, y: 230 },
      size: { w: 480, h: 270 },
      controls: true,
      style: { borderRadius: 8, objectFit: "contain" },
    },
  ],
  s3: [
    {
      id: "s3-value-heatmap",
      type: "image",
      src: "./assets/rl/value-heatmap.png",
      alt: "Optimal V*(s) heatmap on a 5x5 grid world",
      position: { x: 510, y: 90 },
      size: { w: 420, h: 236 },
      style: { borderRadius: 8, objectFit: "contain" },
    },
  ],
  s5: [
    {
      id: "s5-convergence",
      type: "image",
      src: "./assets/rl/convergence.png",
      alt: "Reward convergence: Q-Learning, SARSA, DQN",
      // Center of slide, between top math and bottom code
      // image is 16:9; w:604 h:340 fits 120px top + 340 + 80px bottom = 540
      position: { x: 178, y: 120 },
      size: { w: 604, h: 340 },
      style: { borderRadius: 8, objectFit: "contain" },
    },
  ],
  s6: [
    {
      id: "s6-q-table",
      type: "image",
      src: "./assets/rl/q-table.png",
      alt: "Q-value evolution bar chart during training",
      position: { x: 10, y: 100 },
      size: { w: 470, h: 265 },
      style: { borderRadius: 8, objectFit: "contain" },
    },
  ],
};

// Set of all injected media element IDs — protected from deletion/hiding by reviewers
const INJECTED_IDS = new Set(
  Object.values(SLIDE_MEDIA).flat().map((m) => m.id)
);

/**
 * Content zone constraints for slides with programmatic media injection.
 * These are passed to the Content Agent so it avoids placing elements
 * in regions that will be occupied by injected images/video.
 */
const SLIDE_MEDIA_CONSTRAINTS = {
  s1: "VIDEO INJECTION: A video (480×270) will be injected at x:240, y:230. Do NOT place elements in that zone. Title/subtitle should be at y:40-180 only.",
  s3: "IMAGE INJECTION: A heatmap image (420×236) will be injected at x:510, y:90. Leave the entire RIGHT column (x≥490) EMPTY — do not add any elements there, not even a placeholder.",
  s5: "IMAGE INJECTION: A convergence plot (604×340) will be injected at x:178, y:120. Keep elements ABOVE y:110 (equation) OR BELOW y:475 (code) ONLY. Do not place anything in y:110-480 range.",
  s6: "IMAGE INJECTION: A Q-table bar chart (470×265) will be injected at x:10, y:100. Keep left column (x<490) elements ABOVE y:90 or BELOW y:375 only — title at top, caption/text below y:380.",
};

const TEST_PROMPT = `Create a 7-slide presentation on Reinforcement Learning. Use EVERY element type and feature available.

Pre-generated plot images are available — you MUST include them as image elements where specified:
- ./assets/rl/convergence.png  — Q-Learning / SARSA / DQN reward convergence curves (960x540)
- ./assets/rl/value-heatmap.png — Optimal V*(s) heatmap on a 5x5 grid world (960x540)
- ./assets/rl/policy-gradient.png — Policy loss and entropy curves for REINFORCE vs PPO (960x540)
- ./assets/rl/q-table.png — Q-value bar chart at Init / Mid / Final training (960x540)

Slide 1 (Title): Title "Reinforcement Learning: From Theory to Practice". Subtitle: KaTeX display math $\\max_\\pi \\mathbb{E}\\left[\\sum_{t=0}^{\\infty} \\gamma^t r_t\\right]$. A video element will be injected programmatically — do NOT add any image or video element here, and do NOT add any placeholder. Add bookmark "intro".

Slide 2 (MDP Framework): Left half: flow diagram using shape+text+arrow elements showing the Agent-Environment loop (Agent -> Action -> Environment -> Reward+State -> Agent) with grouped elements. Right half: table of MDP components (State S, Action A, Transition T(s'|s,a), Reward R(s,a), Discount gamma) with KaTeX in cells. onClick animations reveal each loop component step by step. Presenter notes with [step:N] markers.

Slide 3 (Value Functions & Bellman): Left column: KaTeX display equations for $V^\\pi(s)$, $Q^\\pi(s,a)$, and Bellman optimality $$V^*(s) = \\max_a \\sum_{s'} p(s'|s,a)\\left[r + \\gamma V^*(s')\\right]$$. Comparison table of V(s) vs Q(s,a) below. Right column: leave space — the heatmap image will be injected programmatically (do NOT add any placeholder for it). Visual agent should add highlight box shapes (colored stroke rectangles) to emphasize Bellman terms.

Slide 4 (Policy Gradient): Left column: KaTeX policy gradient theorem $$\\nabla_\\theta J(\\theta) = \\mathbb{E}_\\pi\\left[\\nabla_\\theta \\log \\pi_\\theta(a|s) \\cdot Q^\\pi(s,a)\\right]$$ and code block (max 10 lines) showing minimal PyTorch REINFORCE update. Right column: TikZ 3-layer neural network (3 inputs at left, 4 hidden in middle, 2 outputs at right) with all edges drawn and column labels. Bounding box must be set correctly. Add bookmark "policy-gradient".

Slide 5 (Q-Learning & Convergence): Top (y:0-140): Q-learning update rule in KaTeX $$Q(s,a) \\leftarrow Q(s,a) + \\alpha\\left[r + \\gamma \\max_{a'} Q(s',a') - Q(s,a)\\right]$$. Bottom (y:480+): code snippet (max 10 lines) of Q-learning update loop. Middle area (y:150-470): convergence plot image will be injected programmatically — do NOT add any placeholder there. Full-width layout (no split). onClick animations to progressively reveal math -> code.

Slide 6 (Q-Table & 3D Value Surface): Left column (x:0-480): the Q-table bar chart image will be injected programmatically — leave left column empty (do NOT add any placeholder). Add only: title text and one text caption with KaTeX $Q^*(s_{\\text{goal-1}}, \\cdot)$ in the left column. Right column: scene3d element (w:440, h:380) showing a 3D value surface with a peak at goal state and axis labels. Add bookmark "q-table".

Slide 7 (Summary & Timeline): Full comparison table of RL algorithms — Q-Learning, SARSA, PPO, DQN — columns: Algorithm | Type | Function Approx | Sample Efficiency | Key Advantage. Below: shape-based horizontal timeline (rectangles + arrows) showing RL evolution: Q-Learning (1989) -> DQN (2013) -> A3C (2016) -> PPO (2017) -> SAC (2018). fadeIn animations for progressive reveal. Add bookmark "summary".

General: Every slide must have presenter notes. Slides with onClick animations need [step:N] markers in notes matching the animation count. Use slide transitions. All image elements must use the exact src paths listed above.`;

// ── OLD PROMPT (kept for reference) ──────────────────────────────────────────
// Create a 7-slide presentation on Reinforcement Learning...
// (replaced with image/video-rich version above)

const STYLE_PREFS = {
  theme: "light",
  animations: "rich",
  highlightBoxes: true,
  notesTone: "narrative",
};

// ---------------------------------------------------------------------------
// Guide helpers (filesystem equivalents of src/ai/guides.ts)
// ---------------------------------------------------------------------------

const GUIDE_SECTION_FILES = {
  "01-overview": "01-overview.md",
  "02-slide-splitting": "02-slide-splitting.md",
  "03a-schema-deck": "03a-schema-deck.md",
  "03b-schema-elements": "03b-schema-elements.md",
  "04a-elem-text-code": "04a-elem-text-code.md",
  "04b-elem-media": "04b-elem-media.md",
  "04c-elem-shape": "04c-elem-shape.md",
  "04d-elem-tikz": "04d-elem-tikz.md",
  "04e-elem-diagrams": "04e-elem-diagrams.md",
  "04f-elem-table-mermaid": "04f-elem-table-mermaid.md",
  "04g-elem-scene3d": "04g-elem-scene3d.md",
  "04h-elem-scene3d-examples": "04h-elem-scene3d-examples.md",
  "05-animations": "05-animations.md",
  "06-theme": "06-theme.md",
  "07-slide-features": "07-slide-features.md",
  "08a-guidelines": "08a-guidelines.md",
  "08b-style-preferences": "08b-style-preferences.md",
  "08c-visual-style": "08c-visual-style.md",
  "08d-layout-templates": "08d-layout-templates.md",
  "09-example": "09-example.md",
};

function readGuide(section) {
  const normalized = section.replace(/\.md$/, "");
  for (const [key, filename] of Object.entries(GUIDE_SECTION_FILES)) {
    if (key === normalized || key.startsWith(normalized)) {
      try {
        return readFileSync(path.join(GUIDE_DIR, filename), "utf8");
      } catch {
        return `[Guide file not found: ${filename}]`;
      }
    }
  }
  return `[Section "${section}" not found]`;
}

function readGuideIndex() {
  return readFileSync(GUIDE_INDEX_FILE, "utf8");
}

// ---------------------------------------------------------------------------
// Prompt builders (mirrors src/ai/prompts.ts, no deck state for creation)
// ---------------------------------------------------------------------------

function getGeneratorSchema() {
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

function buildPlannerPrompt() {
  const guideOverview = readGuideIndex();
  return `## Role
You are the Planner agent for Deckode, a JSON-based slide platform. Your job is to:
1. Classify the user's intent (create, modify, notes, review, chat)
2. For "create" intent: generate a detailed slide-by-slide outline
3. For other intents: describe what actions are needed

${guideOverview}

## Current Deck State
No deck loaded (will create new).

## Output Format
Respond with a JSON object (no markdown code fences). Keep it concise — one short line per slide:
{
  "intent": "create",
  "plan": {
    "topic": "presentation topic",
    "audience": "target audience",
    "slideCount": number,
    "slides": [
      { "id": "s1", "title": "slide title", "type": "title", "elementTypes": ["text", "video"] },
      { "id": "s2", "title": "slide title", "type": "content", "elementTypes": ["shape", "table"] }
    ]
  },
  "reasoning": "one sentence"
}

Important: For "create", always include a title slide first and plan diagrams using shape elements (not mermaid/tikz).

## Layout Templates
Available templates (from guide 08d-layout-templates): t-title-a, t-title-b, t-section, t-three-metric, t-card-gallery, t-triple-image, t-image-annotated, t-two-image, t-image-table, t-code-panel, t-math, t-hero-stat, t-timeline.
For each slide in the plan, include a "template" field with the recommended template ID. Downstream agents will use this as a layout reference.
`;
}

const ANIMATIONS_SECTION = `## Animations (MANDATORY)
Apply the chosen animation style to EVERY content slide (non-title):

rich: Include an "animations" array in the slide object with onClick + fadeIn for each non-title element.
Use onClick for each main reveal point, withPrevious for elements that appear together with the previous.

minimal: Add only one onEnter fadeIn for the slide (no onClick). No step markers in notes.

none: No animations array. No step markers in notes.

## Style Preferences
- Theme: ${STYLE_PREFS.theme}
- Animations: ${STYLE_PREFS.animations}
- Highlight Boxes: ${STYLE_PREFS.highlightBoxes ? "yes" : "no"}
- Presenter Notes Tone: ${STYLE_PREFS.notesTone}`;

const NOTES_SECTION = `## Presenter Notes Format
Write notes that help the presenter deliver the content:
- 2-4 sentences per slide
- Professional, confident tone
- ONLY use [step:N]...[/step] markers when the slide has onClick animations. The number of [step:N] markers MUST exactly match the number of onClick animations. No onClick animations = no step markers.
- Include key talking points and transitions to the next slide`;

function getContentAgentSchema() {
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

function getVisualAgentSchema() {
  return [
    readGuide("03b-schema-elements"),
    readGuide("04c-elem-shape"),
    readGuide("04d-elem-tikz"),
    readGuide("04e-elem-diagrams"),
    readGuide("04g-elem-scene3d"),
    readGuide("08a-guidelines"),
    readGuide("08c-visual-style"),
    readGuide("08d-layout-templates"),
  ].join("\n\n---\n\n");
}

function buildContentAgentPrompt(currentDeckState) {
  const schema = getContentAgentSchema();
  const state = currentDeckState ?? "No deck loaded.";
  return `## Role
You are the Content Agent for Deckode. You create text, code, and table elements for slides.
After you create the slide structure, the Visual Agent will add shapes, diagrams, and TikZ elements.

${schema}

## Current Deck State
${state}

## Spatial Planning Tools
You have two tools to avoid size guessing:
- \`apply_layout("two_column")\` → returns left={x:20,y:80,w:440,h:420} and right zones
- \`measure_text(content, fontSize)\` → returns {estimatedW, estimatedH} — use for accurate text sizing

## Instructions
- If the plan includes a "template" field, refer to the layout template from guide 08d-layout-templates for element positions, sizes, and styles. Use it as a starting point and adapt the content.
- MANDATORY: Every slide MUST have a title as the FIRST text element:
  - Content slides: fontSize 18, color "#1A2B48", bold (**title**), position (x:40, y:20)
  - Title slides: fontSize 36, color "#1A2B48", bold, position (x:80, y:90 or per template)
- Font sizes MUST be consistent across ALL slides: title=18 (or 36 for title slide), body=12-14, subtitle=14, metadata=9-10
- Use ONLY these colors: #1A2B48, #5B9BD5, #BDD7EE, #E7E6E6, #F2F2F2, #A68966, #333333, #8899AA, #AABBCC, #ffffff. No other hex values.
- Create the slide with add_slide, including ALL text, code, and table elements
- Use text elements for: title, bullet points, labels, captions, descriptions
- For code slides, use the code element type with appropriate language — show only 5-8 key lines, no full files
- For data slides, use the table element type (MUST include columns and rows arrays)
- Element IDs must be slide-scoped: for slide s1 use "s1-e1", "s1-e2", etc.
- ALWAYS include presenter notes (notes field) in the slide
- Do NOT add shapes, TikZ, scene3d, or diagrams — the Visual Agent will handle those
- Do NOT add image or video elements — they are injected programmatically after generation
- Text sizing: call measure_text(content, fontSize) to get accurate h. Min h:30 for 1-line text. Never guess h:20 for multi-word text.
- If the slide plan says "diagram", "shape", "tikz", or "scene3d" in elementTypes:
  - Call apply_layout("two_column") to confirm zone coordinates
  - Place ALL text/code/table strictly within LEFT zone: x:20-460 (w≤440)
  - Add one placeholder: { id: "[slideId]-diagram-placeholder", type: "text", position: {x:490, y:80}, size: {w:440, h:380}, content: "[Diagram placeholder]" }
  - The placeholder marks the right column for the Visual Agent
- If NO visual elements: elements may use the full 960×540 canvas
- FORBIDDEN element types: "mermaid", "iframe", "audio", "animation" — NEVER use these
- After adding the slide, briefly confirm what was created

${ANIMATIONS_SECTION}

${NOTES_SECTION}
`;
}

function buildVisualAgentPrompt(currentDeckState) {
  const schema = getVisualAgentSchema();
  const state = currentDeckState ?? "No deck loaded.";
  return `## Role
You are the Visual Agent for Deckode. You add shapes, arrows, TikZ diagrams, scene3d, and visual decorations to existing slides.
The Content Agent has already placed text/code/table elements in the LEFT column (x:0-480). Your job is to fill the RIGHT column with visuals.

${schema}

## Current Deck State
${state}

## Spatial Planning Tools (USE THESE — do not guess coordinates)

You have 4 spatial tools that eliminate coordinate guessing:

| Tool | Purpose | When to use |
|------|---------|------------|
| \`get_slide_summary(slideId)\` | See exact (x,y,w,h) of every element | First call — understand occupied space |
| \`apply_layout(layout_type)\` | Get zone coordinates for standard layouts | Get right column: apply_layout("two_column") |
| \`find_position(slideId, w, h, hint)\` | Guaranteed non-overlapping position | When exact fit matters |
| \`measure_text(content, fontSize)\` | Estimate text element size | Before adding text labels |

## Mandatory Layout Process

**Step 1 — Inspect**: call \`get_slide_summary("SLIDE_ID")\`
  → See existing element positions. Note what x/y range is occupied.

**Step 2 — Get zones**: call \`apply_layout("two_column")\`
  → Returns: left={x:20,y:80,w:440,h:420}, right={x:500,y:80,w:440,h:420}
  → Your target zone is **right**: start x:500, y:80, max w:440, max h:420

**Step 3 — Compute element size**:
  Think: "My TikZ/diagram needs w:440, h:380 → position={x:500, y:80}" ✓
  Or call: \`find_position("SLIDE_ID", 440, 380, "right_column")\` for exact fit

**Step 4 — Delete placeholder** (mandatory):
  Find element with id ending in "-diagram-placeholder" → call delete_element

**Step 5 — Add element**: call add_element with coordinates from step 2/3

### Chain-of-thought example (follow this pattern):
\`\`\`
I need to add a TikZ neural network to slide s4.

Step 1 — get_slide_summary("s4"):
  title (20,20) 920×50
  equation-text (20,90) 440×80
  code (20,200) 440×200
  placeholder (490,80) 440×380  ← will delete

Step 2 — apply_layout("two_column"):
  right: {x:500, y:80, w:440, h:420}

Step 3 — TikZ needs w:440, h:380 → position=(500, 80), fits within right zone ✓

Step 4 — delete_element("s4", "s4-diagram-placeholder")

Step 5 — add_element("s4", tikz at x:500, y:80, w:440, h:380)
\`\`\`

## Size Reference Card
| Element type | Typical size | Typical position |
|-------------|-------------|-----------------|
| TikZ full-column | w:440, h:380 | right column: (500, 80) |
| TikZ compact | w:440, h:280 | right column: (500, 130) |
| Shape box (medium) | w:140, h:50 | varies by diagram |
| Shape box (small) | w:100, h:40 | varies |
| Arrow (horizontal) | w:60, h:20, waypoints:[{x:0,y:0},{x:60,y:0}] | between boxes |
| Arrow (vertical) | w:20, h:50, waypoints:[{x:0,y:0},{x:0,y:50}] | between boxes |
| scene3d | w:280-440, h:220-380 | right column |

## Element Rules
- If a slide already has a tikz element, do NOT add another tikz
- Arrow/line elements MUST have style.waypoints (≥2 points) — NEVER set rotation on arrows
- Element IDs must be slide-scoped and not conflict with existing IDs
- FORBIDDEN types: "mermaid", "video", "iframe", "audio" — NEVER use these
- Group related shapes with the same groupId
- Use ONLY these colors: #1A2B48, #5B9BD5, #BDD7EE, #E7E6E6, #F2F2F2, #A68966, #333333, #8899AA, #AABBCC, #ffffff. No other hex values.
- For shape fills use #E7E6E6, for strokes use #E7E6E6 or #5B9BD5, for text labels use #5B9BD5 or #1A2B48

## TikZ Quality Standards
- ALWAYS include \\path (minX,minY) rectangle (maxX,maxY) bounding box as the FIRST statement
- Bounding box must tightly contain all nodes: verify min/max coords after writing nodes
- Use [scale=1.4] so nodes are not tiny
- Neural networks — use EXACTLY this coordinate scheme:
  - 3 input nodes at (0,2),(0,0),(0,-2) labeled $x_1$,$x_2$,$x_3$
  - 4 hidden nodes at (2.5,1.5),(2.5,0.5),(2.5,-0.5),(2.5,-1.5)
  - 2 output nodes at (5,0.75),(5,-0.75) labeled $a_1$,$a_2$
  - Node style: [circle, draw=blue!60, fill=blue!10, minimum size=0.7cm]
  - Draw ALL input→hidden + hidden→output edges with \\draw[->,gray!70]
  - Column labels: \\node[above] at (x,top+0.3) {Label};
- All nodes must fit INSIDE the bounding box
- NEVER use \\foreach with inline \\node (e.g., \\foreach \\i in {1,...,3} \\node ...) — this crashes TikZ.
  Instead, write each node explicitly: \\node (i1) at (0,2) {}; \\node (i2) at (0,0) {}; \\node (i3) at (0,-2) {};
- NEVER use arithmetic in coordinates like (2.5-\\i*0.3). Use literal numbers only.
- NEVER use \\foreach at all — always enumerate nodes and edges explicitly.

## Arrow Routing — use make_arrow (REQUIRED for connecting elements)

**NEVER manually compute arrow waypoints.** Use make_arrow instead:

\`\`\`
// Bad: manually setting waypoints
add_element({shape:"arrow", position:{x:200,y:60}, size:{w:100,h:2}, style:{waypoints:[...]}})

// Good: make_arrow automatically adds the arrow and returns a confirmation
make_arrow("s2", "s2-agent-box", "s2-env-box")
// → Arrow is already on the slide. DO NOT call add_element after this.
\`\`\`

Steps to connect two elements with an arrow:
1. Ensure both elements exist (check get_slide_summary)
2. Call make_arrow(slideId, fromId, toId) — the arrow is AUTOMATICALLY ADDED
3. Do NOT call add_element — make_arrow already added it

## Common Diagram Patterns
- Flow chart: rectangle shapes for boxes → make_arrow to connect them
- Comparison: two rectangles side by side with text labels inside (same groupId)
- Timeline: row of rectangles → make_arrow between each (groupId="timeline")
- Agent-Environment loop: add boxes first, then use make_arrow for each connection
`;
}

function buildGeneratorPrompt() {
  const schema = getGeneratorSchema();
  return `## Role
You are the Generator agent for Deckode. You create and modify slides by calling tools. You receive an approved plan and execute it precisely.

${schema}

## Current Deck State
No deck loaded.

## Coordinate Reference (Canvas: 960×540)
\`\`\`
Common layout — two_column:
  title bar:   x:20  y:20  w:920 h:55     (full width)
  left column: x:20  y:90  w:440 h:420    (text/code/table)
  right column: x:500 y:80  w:440 h:420   (shapes/diagrams/TikZ)

Centering:
  Element w:400 on canvas → x = (960-400)/2 = 280
  Element h:200 on canvas → y = (540-200)/2 = 170

Standard shapes (flow chart, left column):
  Box large:  w:200 h:60,  Box medium: w:140 h:50,  Box small: w:100 h:40
  Arrow (→):  w:60 h:20, waypoints:[{x:0,y:0},{x:60,y:0}]
  Arrow (↓):  w:20 h:50, waypoints:[{x:0,y:0},{x:0,y:50}]
\`\`\`

## Instructions
- You have a read_guide tool to fetch detailed specs for any element type, animations, theme, etc.
- Execute the plan by calling the appropriate tools (add_slide, add_element, update_slide, etc.)
- Create slides one at a time with ALL elements included in the slide object
- ALWAYS include presenter notes in every slide (notes field) — describe what the presenter should say
- Use ONLY the Analytical Insight palette: #1A2B48, #5B9BD5, #BDD7EE, #E7E6E6, #F2F2F2, #A68966, #333333, #8899AA, #AABBCC, #ffffff. No other hex values.
- If the plan includes a "template" field, use the layout template from guide 08d as a starting point — match element positions, sizes, and palette
- For diagrams: build with shape (rectangle, arrow) + text elements, grouped with groupId
- Element IDs MUST be globally unique across ALL slides. Use slide-scoped IDs: for slide s1 use "s1-e1", "s1-e2"...; for slide s2 use "s2-e1", "s2-e2"... Never reuse an ID that appears in any other slide.
- After creating all slides, briefly confirm what was created

${ANIMATIONS_SECTION}

${NOTES_SECTION}
`;
}

// ---------------------------------------------------------------------------
// Tool declarations (mirrors src/ai/tools.ts but using plain objects for Node.js)
// ---------------------------------------------------------------------------

const TOOL_DECLARATIONS = [
  {
    name: "add_slide",
    description:
      "Add a new slide to the deck. Provide the full slide object with id, elements array, and optional fields like background, notes, animations.",
    parameters: {
      type: "object",
      properties: {
        slide: {
          type: "object",
          description: "The slide object to add",
          properties: {
            id: { type: "string", description: "Unique slide ID, e.g. 's3'" },
            background: {
              type: "object",
              properties: {
                color: { type: "string" },
                image: { type: "string" },
              },
            },
            notes: { type: "string", description: "Speaker notes" },
            elements: {
              type: "array",
              description: "Array of element objects",
              items: { type: "object", properties: {} },
            },
          },
          required: ["id", "elements"],
        },
        afterSlideId: {
          type: "string",
          description: "Insert after this slide ID. If omitted, appends at end.",
        },
      },
      required: ["slide"],
    },
  },
  {
    name: "update_slide",
    description:
      "Update an existing slide's properties (background, notes, transition). Does NOT modify elements.",
    parameters: {
      type: "object",
      properties: {
        slideId: { type: "string", description: "ID of the slide to update" },
        patch: {
          type: "object",
          description: "Partial slide fields to update",
          properties: {
            background: {
              type: "object",
              properties: {
                color: { type: "string" },
                image: { type: "string" },
              },
            },
            notes: { type: "string" },
            hidden: { type: "boolean" },
            bookmark: { type: "string" },
          },
        },
      },
      required: ["slideId", "patch"],
    },
  },
  {
    name: "add_element",
    description:
      "Add an element to a specific slide. The element must include type, id, position {x,y}, size {w,h}, and type-specific fields. Canvas is 960x540.",
    parameters: {
      type: "object",
      properties: {
        slideId: { type: "string", description: "Target slide ID" },
        element: {
          type: "object",
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
      type: "object",
      properties: {
        slideId: { type: "string", description: "Slide containing the element" },
        elementId: { type: "string", description: "Element ID to update" },
        patch: {
          type: "object",
          description: "Partial element fields to update",
          properties: {},
        },
      },
      required: ["slideId", "elementId", "patch"],
    },
  },
  {
    name: "read_guide",
    description:
      "Read a specific section of the Deckode guide documentation. Available sections: 01-overview, 02-slide-splitting, 03a-schema-deck, 03b-schema-elements, 04a-elem-text-code, 04b-elem-media, 04c-elem-shape, 04d-elem-tikz, 04e-elem-diagrams, 04f-elem-table-mermaid, 04g-elem-scene3d, 04h-elem-scene3d-examples, 05-animations, 06-theme, 07-slide-features, 08a-guidelines, 08b-style-preferences, 08c-visual-style, 08d-layout-templates, 09-example",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description: "Section filename, e.g. '04c-elem-shape' or '05-animations'",
        },
      },
      required: ["section"],
    },
  },
  {
    name: "get_slide_summary",
    description:
      "Get a compact summary of a slide's elements with exact positions and sizes (x, y, w, h). Use this FIRST before placing any element to understand what space is occupied and available.",
    parameters: {
      type: "object",
      properties: {
        slideId: { type: "string", description: "Slide ID to summarize (e.g. 's3')" },
      },
      required: ["slideId"],
    },
  },
  {
    name: "find_position",
    description:
      "Find a guaranteed non-overlapping (x, y) position for a new element of given width and height. Always use this instead of guessing coordinates — it scans the slide for free space and returns exact pixel coordinates.",
    parameters: {
      type: "object",
      properties: {
        slideId: { type: "string", description: "Slide ID to check" },
        w: { type: "number", description: "Width of the element to place (px)" },
        h: { type: "number", description: "Height of the element to place (px)" },
        hint: {
          type: "string",
          enum: ["right_column", "left_column", "center", "top", "bottom", "top_right", "top_left", "auto"],
          description: "Preferred area. Use 'right_column' for visual/diagram elements, 'left_column' for text/code. Default: 'auto'",
        },
      },
      required: ["slideId", "w", "h"],
    },
  },
  {
    name: "apply_layout",
    description:
      "Return coordinates for a named layout template. No side effects — just returns zone definitions ({x, y, w, h}) you can use directly as element positions. Call this to get the standard coordinates for common layouts.",
    parameters: {
      type: "object",
      properties: {
        layout_type: {
          type: "string",
          enum: ["two_column", "title_content", "three_panel", "split_75_25", "hero", "title_slide", "stacked", "full"],
          description: "Layout template name. 'two_column' is the most common: left=text/code, right=visual/diagram.",
        },
      },
      required: ["layout_type"],
    },
  },
  {
    name: "measure_text",
    description:
      "Estimate the pixel width and height needed for a text element. Use this to set accurate element sizes instead of guessing h:40 for unknown text lengths.",
    parameters: {
      type: "object",
      properties: {
        content:   { type: "string", description: "Text content (use \\n for line breaks)" },
        font_size: { type: "number", description: "Font size in px (e.g. 14, 18, 24)" },
        max_w:     { type: "number", description: "Max width before text wraps. Default 920." },
      },
      required: ["content", "font_size"],
    },
  },
  {
    name: "make_arrow",
    description:
      "Add a correctly-routed arrow between two existing elements on the slide. The arrow is AUTOMATICALLY ADDED to the slide — do NOT call add_element afterward. Returns a confirmation message with the arrow's id and position. ALWAYS use this instead of manually computing arrow waypoints.",
    parameters: {
      type: "object",
      properties: {
        slideId:     { type: "string", description: "Slide ID (e.g. 's2')" },
        fromId:      { type: "string", description: "Source element ID" },
        toId:        { type: "string", description: "Target element ID" },
        id:          { type: "string", description: "Optional ID for the new arrow element" },
        color:       { type: "string", description: "Stroke color (CSS hex, default '#64748b')" },
        strokeWidth: { type: "number", description: "Line width in px (default 2)" },
        arrowHead:   { type: "string", enum: ["end", "start", "both", "none"], description: "Which end(s) get arrowhead. Default 'end'." },
        style:       { type: "string", enum: ["L-bend", "straight"], description: "Routing style. 'L-bend' (default) = one corner turn. 'straight' = direct line." },
      },
      required: ["slideId", "fromId", "toId"],
    },
  },
];

// ---------------------------------------------------------------------------
// In-memory deck state
// ---------------------------------------------------------------------------

/** @type {{ slides: Array<{id: string, elements: Array<any>, notes?: string, background?: any, animations?: any}>, meta?: any }} */
const deck = { slides: [] };

// ---------------------------------------------------------------------------
// Local tool executor
// ---------------------------------------------------------------------------

function sanitizeToolArgs(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeToolArgs(item);
    return;
  }
  for (const key of ["content", "notes"]) {
    if (typeof obj[key] === "string") {
      obj[key] = obj[key].replace(/\\n/g, "\n");
    }
  }
  // Fix double-escaped LaTeX commands in text elements (\\bm → \bm, \\pi → \pi)
  if (obj.type === "text" && typeof obj.content === "string") {
    obj.content = obj.content.replace(/\\\\([a-zA-Z]+)/g, "\\$1");
  }
  // Auto-add waypoints to arrows missing them
  if (obj.shape === "arrow" && obj.style && obj.size) {
    if (!obj.style.waypoints) {
      const { w, h } = obj.size;
      obj.style.waypoints =
        h > w ? [{ x: 0, y: 0 }, { x: 0, y: h }] : [{ x: 0, y: 0 }, { x: w, y: 0 }];
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") sanitizeToolArgs(val);
  }
}

function executeTool(name, args) {
  sanitizeToolArgs(args);

  switch (name) {
    case "read_guide": {
      return readGuide(args.section);
    }
    case "add_slide": {
      const slide = args.slide;
      if (!slide.elements) slide.elements = [];
      // Reject duplicate slide IDs — reviewer/visual agents must use update_slide instead
      if (deck.slides.some((s) => s.id === slide.id)) {
        return `ERROR: Slide "${slide.id}" already exists. Use update_slide or add_element to modify it. Do NOT call add_slide again.`;
      }
      // Auto-fix elements with missing type field
      for (const el of slide.elements) {
        if (!el.type) {
          if (el.content && typeof el.content === "string") el.type = "text";
          else if (el.src) el.type = "image";
          else if (el.shape) el.type = "shape";
          else if (el.scene) el.type = "scene3d";
          else if (el.columns || el.rows) el.type = "table";
        }
        // Auto-fix code element minimum height (20px per line + padding)
        if (el.type === "code" && typeof el.content === "string") {
          const lines = el.content.split("\n").length;
          const minH = lines * 20 + 30;
          if (!el.size) el.size = {};
          if (!el.size.h || el.size.h < minH) {
            console.log(`  [fix] Code ${el.id}: h ${el.size.h} → ${minH} (${lines} lines)`);
            el.size.h = minH;
          }
        }
        // Auto-fix text element minimum height
        if (el.type === "text" && el.size && el.size.h && el.size.h < 20) {
          const fontSize = el.style?.fontSize ?? 16;
          el.size.h = Math.max(el.size.h, Math.ceil(fontSize * 1.6));
        }
      }
      // Insert after specified slide, or append
      if (args.afterSlideId) {
        const idx = deck.slides.findIndex((s) => s.id === args.afterSlideId);
        if (idx !== -1) {
          deck.slides.splice(idx + 1, 0, slide);
          return `Slide "${slide.id}" inserted after "${args.afterSlideId}" with ${slide.elements.length} elements.`;
        }
      }
      deck.slides.push(slide);
      return `Slide "${slide.id}" added with ${slide.elements.length} elements.`;
    }
    case "update_slide": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
      Object.assign(slide, args.patch);
      return `Slide "${args.slideId}" updated.`;
    }
    case "add_element": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
      // Reject animation objects — they belong in slide.animations, not elements
      if (args.element?.type === "animation") {
        return `ERROR: Do not add animation objects via add_element. Use update_slide with an "animations" array on the slide instead.`;
      }
      // Reject duplicate element IDs — prevents infinite delete loops in reviewers
      if (args.element?.id) {
        for (const s of deck.slides) {
          if ((s.elements ?? []).some((e) => e.id === args.element.id)) {
            return `ERROR: Element ID "${args.element.id}" already exists in slide "${s.id}". Use a unique ID (e.g., append "-2" or change the suffix).`;
          }
        }
      }
      // Auto-fix missing type
      const el = args.element;
      if (!el.type) {
        if (el.content && typeof el.content === "string") el.type = "text";
        else if (el.src) el.type = "image";
        else if (el.shape) el.type = "shape";
        else if (el.scene) el.type = "scene3d";
      }
      // Auto-fix TikZ backslash escaping: \node → \\node was JSON-unescaped to \n + ode
      if (el.type === "tikz" && typeof el.content === "string") {
        el.content = fixTikzBackslashes(el.content);
      }
      // Auto-fix code element minimum height
      if (el.type === "code" && typeof el.content === "string") {
        const lines = el.content.split("\n").length;
        const minH = lines * 20 + 30;
        if (!el.size) el.size = {};
        if (!el.size.h || el.size.h < minH) el.size.h = minH;
      }
      slide.elements.push(el);
      return `Element "${el.id}" added to slide "${args.slideId}".`;
    }
    case "update_element": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
      const el = slide.elements.find((e) => e.id === args.elementId);
      if (!el) return `Element "${args.elementId}" not found in slide "${args.slideId}".`;
      // Protect injected media from destructive updates (hidden, size:0, etc.)
      if (INJECTED_IDS.has(args.elementId) && (args.patch?.hidden || args.patch?.size?.w === 0 || args.patch?.size?.h === 0)) {
        return `ERROR: "${args.elementId}" is an injected media element and cannot be hidden or resized to 0. Delete the overlapping AI element instead.`;
      }
      Object.assign(el, args.patch);
      return `Element "${args.elementId}" updated.`;
    }
    case "delete_element": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
      // Protect injected media elements from deletion
      if (INJECTED_IDS.has(args.elementId)) {
        return `ERROR: "${args.elementId}" is an injected media element and cannot be deleted. Delete the overlapping AI element instead.`;
      }
      const idx = slide.elements.findIndex((e) => e.id === args.elementId);
      if (idx === -1) return `Element "${args.elementId}" not found in slide "${args.slideId}".`;
      slide.elements.splice(idx, 1);
      return `Element "${args.elementId}" deleted from slide "${args.slideId}".`;
    }
    case "delete_slide": {
      const idx = deck.slides.findIndex((s) => s.id === args.slideId);
      if (idx === -1) return `Slide "${args.slideId}" not found.`;
      deck.slides.splice(idx, 1);
      return `Slide "${args.slideId}" deleted.`;
    }
    case "get_slide_summary": {
      return getSlideSummary(args.slideId);
    }
    case "find_position": {
      const fp = findFreePosition(args.slideId, args.w, args.h, args.hint ?? "auto");
      if (fp.error) return `find_position: ${fp.error}`;
      return JSON.stringify({
        x: fp.x, y: fp.y,
        note: `Place your element at position:{x:${fp.x}, y:${fp.y}}`,
      });
    }
    case "apply_layout": {
      const layout = LAYOUT_ZONES[args.layout_type];
      if (!layout) {
        return `Unknown layout "${args.layout_type}". Available: ${Object.keys(LAYOUT_ZONES).join(", ")}`;
      }
      return JSON.stringify({ layout_type: args.layout_type, ...layout }, null, 2);
    }
    case "measure_text": {
      return estimateTextSize(args.content, args.font_size ?? 14, args.max_w ?? 920);
    }
    case "make_arrow": {
      return makeArrow(args.slideId, args.fromId, args.toId, {
        id: args.id,
        color: args.color,
        strokeWidth: args.strokeWidth,
        arrowHead: args.arrowHead,
        style: args.style,
      });
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// Gemini call wrappers
// ---------------------------------------------------------------------------

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // Fall back to .env file at D:\northeastern\NEU_courses\IE5374-Applied_Generative_AI\.env
  const envPath = path.resolve(ROOT, "..", ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^Gemini_api_key\s*=\s*(.+)/i);
      if (m) return m[1].trim();
    }
  }
  throw new Error("GEMINI_API_KEY not set and not found in ../.env (Gemini_api_key=...)");
}

function getGeminiClient() {
  return new GoogleGenerativeAI(loadApiKey());
}

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? 0;
      if ((status === 503 || status === 429) && attempt < maxRetries) {
        const wait = attempt * 15000;
        console.log(`  [retry] ${status} error — waiting ${wait/1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

async function callGeminiOnce(systemInstruction, message) {
  return withRetry(async () => {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction,
      generationConfig: { maxOutputTokens: 16384 },
    });
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage(message);
    const response = result.response;
    return response.text?.() ?? "";
  });
}

async function callGeminiWithTools(systemInstruction, message) {
  const client = getGeminiClient();
  const geminiTools = [{ functionDeclarations: TOOL_DECLARATIONS }];
  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction,
    tools: geminiTools,
  });

  let history = [];
  let currentMessage = message;
  let iterations = 0;
  let toolCallsMade = false;
  // Track key "commit" actions vs pure planning tools
  let mainActionCalled = false;  // add_slide or add_element called
  let measureTextCalls = 0;      // count of measure_text calls this session

  console.log("\n[Generator] Starting tool-use loop...");

  while (iterations < MAX_GENERATOR_ITERATIONS) {
    iterations++;
    const chat = model.startChat({ history });
    const result = await withRetry(() => chat.sendMessage(currentMessage));
    const response = result.response;

    const functionCalls = response.functionCalls?.() ?? [];
    let text = "";
    try {
      text = response.text?.() ?? "";
    } catch {
      // text() throws when function calls are present in some SDK versions
      text = "";
    }

    console.log(
      `  [iter ${iterations}] text=${text.length}chars, tools=${functionCalls.length}`,
    );

    if (functionCalls.length === 0) {
      // Nudge if no tools called yet and it's early in the conversation (handles both text-only and empty responses)
      if (!toolCallsMade && iterations <= 2) {
        const nudgeReason = text ? "responded with text only" : "returned empty response";
        console.log(`  Model ${nudgeReason} — nudging to use tools...`);
        history = [
          ...history,
          { role: "user", parts: [{ text: currentMessage }] },
          { role: "model", parts: [{ text: text || "Processing..." }] },
        ];
        currentMessage =
          "You must call the provided tools to complete this task. Do not describe what you would do — actually call the tools now (add_slide, add_element, update_slide, update_element, delete_element, find_position, apply_layout, measure_text, etc.).";
        continue;
      }
      console.log("  Generator finished.");
      return text;
    }

    toolCallsMade = true;
    const toolResults = [];

    for (const fc of functionCalls) {
      if (fc.name === "read_guide") {
        console.log(`  [guide] Reading ${fc.args?.section}...`);
      } else {
        console.log(`  -> ${fc.name}(${JSON.stringify(fc.args ?? {}).slice(0, 120)})`);
      }
      // Track commit actions vs pure planning tools
      if (["add_slide", "add_element", "update_element", "delete_element", "update_slide"].includes(fc.name)) mainActionCalled = true;
      if (fc.name === "measure_text") measureTextCalls++;
      try {
        const result = executeTool(fc.name, fc.args ?? {});
        toolResults.push(`${fc.name} result: ${result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ! ${fc.name} failed: ${msg}`);
        toolResults.push(`${fc.name} ERROR: ${msg}. Try a different approach.`);
      }
    }

    // Advance history
    history = [
      ...history,
      { role: "user", parts: [{ text: currentMessage }] },
      { role: "model", parts: [{ text: text || "Calling tools..." }] },
    ];

    // Build continuation message — escalate if stuck in planning loop
    let continMsg = `Tool results:\n${toolResults.join("\n")}\n\nContinue executing the plan. If all done, provide a brief summary.`;
    if (!mainActionCalled && iterations >= 4) {
      continMsg = `Tool results:\n${toolResults.join("\n")}\n\n⚠️ COMMIT NOW: You have made ${iterations} iterations without adding any slide or element. STOP planning and call add_slide or add_element immediately with your current best estimates. No more measure_text or apply_layout calls.`;
      console.log(`  [nudge] Escalating: ${iterations} iters without commit action`);
    } else if (!mainActionCalled && measureTextCalls >= 5) {
      continMsg = `Tool results:\n${toolResults.join("\n")}\n\n⚠️ STOP MEASURING: You have called measure_text ${measureTextCalls} times. You have enough size data. Call add_slide or add_element NOW.`;
      console.log(`  [nudge] measure_text called ${measureTextCalls}x — pushing to commit`);
    }
    currentMessage = continMsg;
  }

  return "Reached maximum iterations. Some actions may be incomplete.";
}

// ---------------------------------------------------------------------------
// JSON repair utility for truncated planner output
// ---------------------------------------------------------------------------

function repairTruncatedJson(text) {
  // Remove trailing incomplete token (unterminated string, key, or value)
  let s = text.trimEnd();

  // Drop everything after the last complete comma-separated item or closing bracket/brace
  // Strategy: walk and track open structures, then close them
  const stack = [];
  let inString = false;
  let escape = false;
  let lastSafePos = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') {
      inString = !inString;
      if (!inString) lastSafePos = i + 1; // just closed a string
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") { stack.push(c === "{" ? "}" : "]"); continue; }
    if (c === "}" || c === "]") {
      if (stack.length && stack[stack.length - 1] === c) { stack.pop(); lastSafePos = i + 1; }
      continue;
    }
    if ((c === "," || c === ":") && !inString) lastSafePos = i;
  }

  // Truncate to last safe position and close open structures
  let repaired = s.slice(0, lastSafePos).trimEnd();
  // Remove trailing comma or colon
  repaired = repaired.replace(/[,:]$/, "");
  // Close open structures in reverse
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i];
  return repaired;
}

async function runPlanner(userMessage) {
  console.log("\n[Planner] Analyzing intent and creating plan...");
  const systemPrompt = buildPlannerPrompt();

  const prefsText = [
    `Theme: ${STYLE_PREFS.theme}`,
    `Animations: ${STYLE_PREFS.animations}`,
    `Highlight Boxes: ${STYLE_PREFS.highlightBoxes ? "yes" : "no"}`,
    `Presenter Notes Tone: ${STYLE_PREFS.notesTone}`,
  ].join("\n");

  const enrichedMessage = `${userMessage}\n\nStyle Preferences (already confirmed by user):\n${prefsText}\n\nProceed directly with "create" intent.`;

  const rawText = await callGeminiOnce(systemPrompt, enrichedMessage);
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    // Try to repair truncated JSON by closing open structures
    const repaired = repairTruncatedJson(text);
    try {
      plan = JSON.parse(repaired);
      console.log("  (repaired truncated JSON)");
    } catch {
      throw new Error(`Planner returned invalid JSON:\n${rawText.slice(0, 400)}`);
    }
  }

  console.log(`  Intent: ${plan.intent}`);
  if (plan.plan) {
    console.log(`  Slides planned: ${plan.plan.slideCount}`);
    console.log(`  Topic: ${plan.plan.topic}`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Generator stage
// ---------------------------------------------------------------------------

/** Build a single fix instruction line for the reviewer agent */
function buildFixLine(iss) {
  const loc = `[${iss.ref}]`;
  if (iss.message.includes("Forbidden element type")) {
    // Extract element ID from ref (format: slideId/elementId)
    const elementId = iss.ref.split("/")[1];
    return `- CRITICAL ${loc} ${iss.message} — call delete_element(slideId, "${elementId}") to remove it immediately`;
  }
  if (iss.message.includes("overlap")) {
    // If one of the overlapping elements is injected media, instruct to delete the OTHER element
    const elementId = iss.ref.split("/")[1];
    if (INJECTED_IDS.has(elementId)) {
      return `- ${iss.level} ${loc} ${iss.message} — "${elementId}" is a protected injected media element. Delete the overlapping AI element instead.`;
    }
    return `- ${iss.level} ${loc} ${iss.message} — call update_element with the suggested position, or delete_element if no space`;
  }
  if (iss.message.includes("lines")) {
    return `- ${iss.level} ${loc} ${iss.message} — trim to at most 25 lines`;
  }
  return `- ${iss.level} ${loc} ${iss.message}`;
}

/** Returns a compact deck state summary for agent prompts — includes positions for spatial awareness */
function formatDeckState() {
  if (deck.slides.length === 0) return "No deck loaded.";
  const lines = [`Canvas: ${CANVAS_W}×${CANVAS_H}. Slides (${deck.slides.length}):`];
  for (const slide of deck.slides) {
    const types = [...new Set(slide.elements.map((e) => e.type))].join(", ");
    lines.push(`  [${slide.id}] ${slide.elements.length} elements (${types})${slide.notes ? " [has notes]" : ""}`);
    for (const el of slide.elements) {
      if (el.position && el.size) {
        const h = el.size.h ?? "?";
        const label =
          el.type === "text"  ? ` "${(el.content ?? "").replace(/\n.*/u, "").slice(0, 28)}"` :
          el.type === "shape" ? ` (${el.shape})` :
          el.type === "code"  ? ` (${el.language ?? "code"})` :
          el.type === "image" ? ` ${(el.src ?? "").split("/").pop()}` : "";
        const grp = el.groupId ? ` [g:${el.groupId}]` : "";
        lines.push(`    ${el.id}[${el.type}${label}] (${el.position.x},${el.position.y}) ${el.size.w}×${h}${grp}`);
      } else {
        lines.push(`    ${el.id}[${el.type}]`);
      }
    }
  }
  return lines.join("\n");
}

async function runGenerator(plan) {
  console.log("\n[Generator] Starting slide-by-slide generation...");

  // No slide plan (modify intent) — single call fallback
  if (!plan.plan?.slides) {
    const systemPrompt = buildGeneratorPrompt();
    const planMessage = `Execute these modifications:\n${(plan.actions ?? []).join("\n")}`;
    await callGeminiWithTools(systemPrompt, planMessage);
    await runAnimationFix(buildGeneratorPrompt());
    return;
  }

  const slides = plan.plan.slides;
  console.log(`  ${slides.length} slides planned.`);

  for (let i = 0; i < slides.length; i++) {
    const slidePlan = slides[i];
    console.log(`\n[Generator] [${i + 1}/${slides.length}] Slide: "${slidePlan.title}" (${slidePlan.id})`);

    const VISUAL_TYPES = ["shape", "arrow", "tikz", "diagram", "scene3d"];
    const needsVisuals = (slidePlan.elementTypes ?? []).some((t) => VISUAL_TYPES.includes(t));

    // Phase 1: Generation (retry only if slide was not created at all)
    const MAX_GEN_ATTEMPTS = 2;
    for (let genAttempt = 1; genAttempt <= MAX_GEN_ATTEMPTS; genAttempt++) {
      // Skip if slide already exists from a previous gen attempt
      if (deck.slides.find((s) => s.id === slidePlan.id)) break;

      const currentState = formatDeckState();
      console.log(`  [content] gen attempt ${genAttempt}/${MAX_GEN_ATTEMPTS}`);
      const contentPrompt = buildContentAgentPrompt(currentState);
      // Pre-compute layout context so agent doesn't have to reason about zones
      const needsViz = (slidePlan.elementTypes ?? []).some((t) =>
        ["shape", "arrow", "tikz", "diagram", "scene3d"].includes(t)
      );
      const layoutHint = needsViz
        ? `Layout: two_column — place ALL text/code/table in left zone (x:20, y:80, w:440, h:420). Right zone (x:500, y:80, w:440, h:420) is RESERVED for Visual Agent.`
        : `Layout: full canvas — elements may use the full 960×540 area.`;
      // Pass media injection constraints so content agent avoids those regions
      const mediaConstraint = SLIDE_MEDIA_CONSTRAINTS[slidePlan.id]
        ? `\n⚠️ PROGRAMMATIC MEDIA INJECTION — ${SLIDE_MEDIA_CONSTRAINTS[slidePlan.id]}`
        : "";
      const contentMessage = `Create ONLY this one slide (do not create other slides):
${JSON.stringify(slidePlan, null, 2)}

${layoutHint}${mediaConstraint}

Style: ${plan.reasoning ?? JSON.stringify(STYLE_PREFS)}
Element IDs must be scoped to this slide: "${slidePlan.id}-e1", "${slidePlan.id}-e2", etc.

Layout planning steps (follow in order):
1. ${needsViz ? `Call apply_layout("two_column") to confirm left/right zone coords` : `Use full canvas layout`}
2. Call measure_text(content, fontSize) for any text element to get accurate height
3. Call add_slide with ALL content elements placed in the ${needsViz ? "left column (x≤460)" : "full canvas"}
4. Confirm what was created`;

      await callGeminiWithTools(contentPrompt, contentMessage);
    }

    // --- Visual Agent (only if slide was created and visual elements needed) ---
    if (needsVisuals && deck.slides.find((s) => s.id === slidePlan.id)) {
      // Programmatically remove placeholder element before Visual Agent runs
      const slideBeforeVisual = deck.slides.find((s) => s.id === slidePlan.id);
      if (slideBeforeVisual) {
        // Find placeholder by ID pattern OR by content containing "[Diagram"
        const placeholders = slideBeforeVisual.elements.filter(
          (e) => e.id.includes("placeholder") || (e.type === "text" && e.content?.includes("[Diagram"))
        );
        for (const ph of placeholders) {
          const result = executeTool("delete_element", { slideId: slidePlan.id, elementId: ph.id });
          console.log(`  [cleanup] Deleted placeholder: ${result}`);
        }
      }

      const visualTypes = (slidePlan.elementTypes ?? []).filter((t) =>
        ["shape", "arrow", "tikz", "diagram", "scene3d"].includes(t)
      );
      console.log(`  [visual] Adding ${visualTypes.join("/")} to ${slidePlan.id}...`);
      const elemsBefore = deck.slides.find((s) => s.id === slidePlan.id)?.elements.length ?? 0;
      // Pre-compute slide summary and layout zones to provide context upfront
      const preSlideSummary = getSlideSummary(slidePlan.id);
      const rightZone = LAYOUT_ZONES.two_column.right; // {x:500, y:80, w:440, h:420}
      const visualPrompt = buildVisualAgentPrompt(formatDeckState());
      const visualMessage = `Add visual element(s) to slide ${slidePlan.id}.

Required element types: ${visualTypes.join(", ")}
Slide plan: ${JSON.stringify(slidePlan, null, 2)}

## Current slide state (from get_slide_summary):
${preSlideSummary}

## Layout zones (from apply_layout("two_column")):
  left:  x:20  y:80 w:440 h:420  ← already filled by Content Agent
  right: x:${rightZone.x} y:${rightZone.y} w:${rightZone.w} h:${rightZone.h}  ← YOUR TARGET ZONE

## Your layout plan (think through this before calling tools):
1. The right column zone is (${rightZone.x}, ${rightZone.y}) size ${rightZone.w}×${rightZone.h}
2. What element type do I need? → ${visualTypes[0]}
3. What size fits in the right zone? → w:440, h:380 (leave 20px bottom margin)
4. Exact position → x:${rightZone.x}, y:${rightZone.y}
5. Or call find_position("${slidePlan.id}", 440, 380, "right_column") for confirmed non-overlapping coords

## MANDATORY STEPS:
1. Find and delete placeholder: check slide state above for element id ending in "-diagram-placeholder", call delete_element("${slidePlan.id}", placeholder_id)
2. Call add_element with your computed coordinates — target the right column (x≥490)
3. Do NOT exit without calling add_element at least once
4. If you need exact non-overlapping coords, call find_position BEFORE add_element`;
      await callGeminiWithTools(visualPrompt, visualMessage);

      // If visual agent added nothing, retry once with a stricter prompt
      const elemsAfter = deck.slides.find((s) => s.id === slidePlan.id)?.elements.length ?? 0;
      if (elemsAfter === elemsBefore) {
        console.log(`  [visual] WARNING: no elements added — retrying with strict prompt...`);
        const retryMsg = `Slide ${slidePlan.id} needs ${visualTypes.join("/")} element(s) but none were added. Call add_element NOW with a ${visualTypes[0]} element at position x:490 y:80 size w:440 h:380. Do not read the slide again — just add the element.`;
        await callGeminiWithTools(visualPrompt, retryMsg);
      }
    }

    // Phase 2: Fix pass — validate and send issues to reviewer (generation does NOT re-run)
    const createdSlide = deck.slides.find((s) => s.id === slidePlan.id);
    if (!createdSlide) {
      console.log(`  ✗ Slide ${slidePlan.id} was not created — skipping`);
    } else {
      const MAX_FIX_PASSES = 2;
      for (let fixPass = 1; fixPass <= MAX_FIX_PASSES; fixPass++) {
        const slide = deck.slides.find((s) => s.id === slidePlan.id);
        applyOverflowFix(slide);

        const slideIssues = validateDeck([slide]);
        const criticals = slideIssues.filter((iss) => iss.level === "CRITICAL");
        const overlapWarnings = slideIssues.filter(
          (iss) => iss.level === "WARNING" && iss.message.includes("overlap"),
        );
        if (criticals.length === 0 && overlapWarnings.length === 0) {
          console.log(`  ✓ Slide ${slidePlan.id} passed validation`);
          break;
        }
        const issueList = [...criticals, ...overlapWarnings];
        console.log(`  ✗ ${criticals.length} critical, ${overlapWarnings.length} overlap warnings (fix pass ${fixPass}/${MAX_FIX_PASSES})`);
        for (const c of issueList) console.log(`    [${c.ref}] ${c.message}`);

        if (fixPass < MAX_FIX_PASSES) {
          const fixLines = issueList.map((iss) => buildFixLine(iss)).join("\n");
          const reviewMsg = `Fix issues in slide ${slidePlan.id}. Use update_element to move elements, or delete_element to remove forbidden types:\n${fixLines}`;
          console.log(`  [reviewer] Sending ${issueList.length} issue(s) to agent...`);
          await callGeminiWithTools(buildGeneratorPrompt(), reviewMsg);
        }
      }
    }
  }

  console.log(`\n  Collected ${deck.slides.length} slides.`);

  // Global overflow fix pass
  for (const slide of deck.slides) applyOverflowFix(slide);

  // Inject pre-defined image/video elements (bypasses AI for known media slots)
  console.log("\n[MediaInject] Injecting pre-defined images and videos...");
  for (const slideId of Object.keys(SLIDE_MEDIA)) {
    injectSlideMedia(slideId);
  }

  // Fix grouped element alignment (snap text labels to center of shapes)
  console.log("[Align] Fixing grouped text alignment...");
  for (const slide of deck.slides) {
    fixGroupedAlignment(slide.id);
  }

  // Animation correction pass
  await runAnimationFix(buildGeneratorPrompt());

  // Global reviewer pass — fix any remaining CRITICAL / overlap issues across all slides
  await runGlobalReviewerPass();
}

/**
 * Programmatically move any element that significantly overlaps with the injected
 * media to a non-overlapping position. Stacks displaced elements to avoid
 * secondary overlaps between relocated elements.
 */
function relocateOverlapping(slide, mediaEl) {
  const mx = mediaEl.position.x, my = mediaEl.position.y;
  const mw = mediaEl.size.w;
  const mh = mediaEl.size.h ?? Math.round(mw / 1.778);
  const mx2 = mx + mw, my2 = my + mh;

  // Track next available y for stacking below-media and above-media separately
  let nextBelowY = my2 + 10;
  let nextAboveY = my - 10; // will subtract element height before use

  // Helper: does candidate rect overlap any element already on the slide?
  function overlapsExisting(cx, cy, cw, ch) {
    for (const other of slide.elements) {
      if (!other.position || !other.size?.w) continue;
      const ow = Math.min(cx + cw, other.position.x + other.size.w) - Math.max(cx, other.position.x);
      const oh = Math.min(cy + ch, other.position.y + (other.size.h ?? 40)) - Math.max(cy, other.position.y);
      if (ow > 5 && oh > 5) return true;
    }
    return false;
  }

  for (const el of slide.elements) {
    if (el.id === mediaEl.id) continue;
    if (!el.position || !el.size?.w) continue;

    const ex = el.position.x, ey = el.position.y;
    const ew = el.size.w, eh = el.size.h ?? 40;

    const ow = Math.min(mx2, ex + ew) - Math.max(mx, ex);
    const oh = Math.min(my2, ey + eh) - Math.max(my, ey);
    if (ow <= 10 || oh <= 10) continue;

    const pct = (ow * oh) / (ew * eh);
    if (pct < 0.15) continue;

    // Determine best destination column: prefer same x-region as element
    // For right-column media: try left of media first, else stack below
    // For left-column media: try right of media first, else stack below
    const inSameColumn = (ex >= mx - 20 && ex < mx2 + 20);

    const candidates = [];
    if (mx > 400) {
      // Media in right half → prefer left column
      candidates.push({ x: Math.max(0, mx - ew - 20), y: ey });
    } else {
      // Media in left half → prefer right column
      candidates.push({ x: Math.min(960 - ew, mx2 + 20), y: ey });
    }
    // Stack below media (with vertical packing)
    candidates.push({ x: inSameColumn ? ex : mx, y: nextBelowY });
    // Stack above media
    candidates.push({ x: inSameColumn ? ex : mx, y: nextAboveY - eh });

    let placed = false;
    for (const c of candidates) {
      if (c.x < 0 || c.y < 0 || c.x + ew > 960 || c.y + eh > 540) continue;
      // No overlap with media
      const cow = Math.min(mx2, c.x + ew) - Math.max(mx, c.x);
      const coh = Math.min(my2, c.y + eh) - Math.max(my, c.y);
      if (cow > 5 && coh > 5) continue; // still overlaps media
      // No overlap with any other existing element (catches scene3d etc.)
      if (overlapsExisting(c.x, c.y, ew, eh)) continue;

      console.log(`  [media] Relocated ${el.id} (${ex},${ey}) → (${c.x},${c.y})`);
      el.position = { x: c.x, y: c.y };
      // Advance stacking cursor if we used below/above slot
      if (c.y >= my2) nextBelowY = c.y + eh + 6;
      if (c.y < my) nextAboveY = c.y - 6;
      placed = true;
      break;
    }
    if (!placed) {
      // Last resort: force-clip element to not overlap media
      // If element is in same x-zone, shrink it or cap its bottom
      if (ey < my && ey + eh > my) {
        const newH = my - ey - 10;
        if (newH >= 20) {
          console.log(`  [media] Clipped ${el.id} height ${eh}→${newH} to avoid overlap`);
          el.size = { ...el.size, h: newH };
        }
      } else {
        console.log(`  [media] WARNING: could not relocate ${el.id} — no valid position found`);
      }
    }
  }
}

/**
 * Inject predefined image/video elements into a slide, removing any AI-created
 * placeholder text elements, then relocating any conflicting elements directly.
 */
function injectSlideMedia(slideId) {
  const config = SLIDE_MEDIA[slideId];
  if (!config) return;
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return;

  // Remove text elements whose id contains "placeholder" (AI-created stubs)
  slide.elements = slide.elements.filter((e) => {
    if (e.type === "text" && e.id.toLowerCase().includes("placeholder")) {
      console.log(`  [media] Removed placeholder: ${e.id}`);
      return false;
    }
    return true;
  });

  // Inject each predefined media element (idempotent — remove first if exists)
  for (const media of config) {
    const idx = slide.elements.findIndex((e) => e.id === media.id);
    if (idx >= 0) slide.elements.splice(idx, 1);
    slide.elements.push({ ...media });
    console.log(`  [media] Injected ${media.type}: ${media.id} at (${media.position.x},${media.position.y}) src="${media.src}"`);

    // Programmatically relocate any element that overlaps with this media — no AI
    relocateOverlapping(slide, media);
  }
}

/**
 * Post-process: center text labels inside their paired shape within the same groupId.
 * Fixes AI-generated timeline/flowchart diagrams where labels are slightly off-center.
 */
function fixGroupedAlignment(slideId) {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return;

  // Collect box-shapes (non-arrow rectangles/ellipses) and texts by groupId
  const boxByGroup = {};
  const textByGroup = {};
  for (const el of slide.elements) {
    if (!el.groupId) continue;
    if (el.type === "shape" && !el.style?.waypoints) {
      // Only register first box per group
      if (!boxByGroup[el.groupId]) boxByGroup[el.groupId] = el;
    }
    if (el.type === "text") {
      if (!textByGroup[el.groupId]) textByGroup[el.groupId] = el;
    }
  }

  let fixed = 0;
  for (const gid of Object.keys(boxByGroup)) {
    const box = boxByGroup[gid];
    const txt = textByGroup[gid];
    if (!txt) continue;

    // Snap text to center of its box
    const cx = box.position.x + Math.floor(box.size.w / 2) - Math.floor(txt.size.w / 2);
    const cy = box.position.y + Math.floor(box.size.h / 2) - Math.floor(txt.size.h / 2);
    if (txt.position.x !== cx || txt.position.y !== cy) {
      txt.position = { x: cx, y: cy };
      // Ensure text uses center alignment
      if (!txt.style) txt.style = {};
      txt.style.textAlign = "center";
      txt.style.verticalAlign = "middle";
      fixed++;
    }
  }
  if (fixed > 0) console.log(`  [align] Fixed ${fixed} label(s) in ${slideId}`);
}

/**
 * Programmatic post-processing: remove elements that are completely buried under
 * a larger element (100% overlap). These are unrecoverable by the AI reviewer
 * and should just be deleted. Also removes elements with delete:true set by
 * agents that incorrectly tried to delete via update_element.
 */
function purgeFullyOverlappedElements() {
  let totalPurged = 0;
  for (const slide of deck.slides) {
    const measurable = (slide.elements ?? []).filter(
      (e) => e.position && e.size?.w > 5 && (e.size?.h ?? 0) > 5
    );
    const toDelete = new Set();

    // Delete elements explicitly marked for deletion by agents
    for (const el of slide.elements ?? []) {
      if (el.delete === true) {
        toDelete.add(el.id);
        console.log(`  [purge] Removing delete-marked element ${el.id} from ${slide.id}`);
      }
    }

    // Delete smaller elements that are 95%+ covered by a larger element
    // EXCEPT:
    //   - text/code/table on top of a shape (intentional label-inside-box)
    //   - image/video elements (always intentional — never purge injected media)
    const CONTENT_TYPES = new Set(["text", "code", "table"]);
    const PROTECTED_TYPES = new Set(["image", "video"]);
    for (let a = 0; a < measurable.length; a++) {
      for (let b = a + 1; b < measurable.length; b++) {
        const ea = measurable[a], eb = measurable[b];
        if (toDelete.has(ea.id) || toDelete.has(eb.id)) continue;
        if (ea.groupId && ea.groupId === eb.groupId) continue;
        const ax2 = ea.position.x + ea.size.w, ay2 = ea.position.y + (ea.size.h ?? 40);
        const bx2 = eb.position.x + eb.size.w, by2 = eb.position.y + (eb.size.h ?? 40);
        const ow = Math.min(ax2, bx2) - Math.max(ea.position.x, eb.position.x);
        const oh = Math.min(ay2, by2) - Math.max(ea.position.y, eb.position.y);
        if (ow <= 0 || oh <= 0) continue;
        const areaA = ea.size.w * (ea.size.h ?? 40);
        const areaB = eb.size.w * (eb.size.h ?? 40);
        const [smaller, larger] = areaA <= areaB ? [ea, eb] : [eb, ea];
        const smallerArea = Math.min(areaA, areaB);
        const pct = (ow * oh) / smallerArea;
        // Never purge image/video — they are always intentionally placed
        if (PROTECTED_TYPES.has(smaller.type)) continue;
        // Skip if content (text/code/table) is on top of a shape — intentional label inside box
        const isContentOnShape = CONTENT_TYPES.has(smaller.type) && larger.type === "shape";
        if (isContentOnShape) continue;
        // Only purge if 95%+ covered AND larger is significantly bigger
        if (pct >= 0.95 && Math.max(areaA, areaB) / Math.min(areaA, areaB) >= 1.5) {
          toDelete.add(smaller.id);
          console.log(`  [purge] ${smaller.id} (${smaller.type}) fully covered by ${larger.id} — removing from ${slide.id}`);
        }
      }
    }

    if (toDelete.size > 0) {
      slide.elements = slide.elements.filter((e) => !toDelete.has(e.id));
      totalPurged += toDelete.size;
    }
  }
  if (totalPurged > 0) {
    console.log(`  [purge] Removed ${totalPurged} unreachable element(s)`);
  }
  return totalPurged;
}

async function runGlobalReviewerPass() {
  // First: programmatic cleanup of fully-overlapped and delete-marked elements
  purgeFullyOverlappedElements();

  const allIssues = validateDeck(deck.slides);
  const criticals = allIssues.filter((iss) => iss.level === "CRITICAL");
  const overlapWarnings = allIssues.filter(
    (iss) => iss.level === "WARNING" && iss.message.includes("overlap"),
  );
  const remaining = [...criticals, ...overlapWarnings];
  if (remaining.length === 0) return;

  console.log(`\n[GlobalReviewer] ${criticals.length} critical, ${overlapWarnings.length} overlap warnings — running fix pass...`);
  for (const iss of remaining) console.log(`  [${iss.ref}] ${iss.message}`);

  const MAX_GLOBAL_PASSES = 3;
  let passIssues = remaining;
  for (let pass = 1; pass <= MAX_GLOBAL_PASSES; pass++) {
    // Group by slide
    const bySlide = {};
    for (const iss of passIssues) {
      const slideId = iss.ref?.split("/")?.[0] ?? "unknown";
      (bySlide[slideId] ??= []).push(iss);
    }

    for (const [slideId, issues] of Object.entries(bySlide)) {
      const fixLines = issues.map((iss) => buildFixLine(iss)).join("\n");
      const slideSummary = getSlideSummary(slideId);
      const msg = `Fix layout issues in slide ${slideId}. NEVER call add_slide or measure_text.

Current slide state (use this — no need to call get_slide_summary again):
${slideSummary}

Fixing strategy — pick ONE action and call it immediately:
- OVERLAP: call find_position("${slideId}", smallerW, smallerH, "hint") → then update_element({position:{x,y}}) to move it
- "delete it" / "resize": call delete_element("${slideId}", elementId) to remove the problematic element
- Forbidden type: call delete_element("${slideId}", elementId) immediately
- Do NOT call measure_text — just use the sizes shown in the slide state above
- NEVER delete or hide injected media elements (IDs starting with "s1-rl-", "s3-value-", "s5-convergence", "s6-q-table"). If they overlap with AI-generated elements, delete the AI element instead.

Issues to fix:
${fixLines}

Call a fix tool NOW (find_position, update_element, or delete_element).`;
      console.log(`  [reviewer pass ${pass}] Fixing slide ${slideId} (${issues.length} issue(s))...`);
      await callGeminiWithTools(buildGeneratorPrompt(), msg);
    }

    // Re-check
    const afterIssues = validateDeck(deck.slides);
    const afterCriticals = afterIssues.filter((iss) => iss.level === "CRITICAL");
    const afterOverlap = afterIssues.filter((iss) => iss.level === "WARNING" && iss.message.includes("overlap"));
    console.log(`  After pass ${pass}: ${afterCriticals.length} critical, ${afterOverlap.length} overlap warnings remaining.`);
    passIssues = [...afterCriticals, ...afterOverlap];
    if (passIssues.length === 0) break;
  }
}

/**
 * Restore backslashes in TikZ content lost during JSON parsing.
 * JSON \n → LF(0x0A), \t → TAB(0x09), \f → FF(0x0C), \b → BS(0x08), \r → CR(0x0D)
 * These appear as control chars before LaTeX command continuations.
 */
function fixTikzBackslashes(content) {
  let result = content
    // \n (LF) prefix — \node, \normalsize, \newcommand, \noindent, \null
    .replace(/\x0aode(?=[\[{\s(;,])/g, "\\node")
    .replace(/\x0aormalsize(?=[\s{])/g, "\\normalsize")
    .replace(/\x0aewcommand(?=[\s{[\\])/g, "\\newcommand")
    .replace(/\x0aoindent/g, "\\noindent")
    // \f (FF) prefix — \foreach, \fill, \filldraw
    .replace(/\x0coreach(?=[\s{[\\])/g, "\\foreach")
    .replace(/\x0cilldraw(?=[\s{[\\])/g, "\\filldraw")
    .replace(/\x0cill(?=[\s{[\\(])/g, "\\fill")
    // \t (TAB) prefix — \tikzset, \textbf, \textrm, \the
    .replace(/\x09ikzset(?=[\s{[\\])/g, "\\tikzset")
    .replace(/\x09extbf(?=[\s{[\\{])/g, "\\textbf")
    .replace(/\x09extrm(?=[\s{[\\{])/g, "\\textrm")
    .replace(/\x09he(?=[\s{[\\])/g, "\\the")
    // \b (BS) prefix — \begin, \bar, \bold
    .replace(/\x08egin(?=[\s{[\\])/g, "\\begin")
    .replace(/\x08old(?=[\s{[\\])/g, "\\bold")
    .replace(/\x08ar(?=[\s{[\\])/g, "\\bar")
    // \r (CR) prefix — \relax, \right, \renewcommand
    .replace(/\x0delax(?=[\s{[\\])/g, "\\relax")
    .replace(/\x0dight(?=[\s{[\\])/g, "\\right")
    .replace(/\x0denewcommand(?=[\s{[\\])/g, "\\renewcommand");

  // Expand \foreach \VAR in {list} \CMD[...] (VARNAME) at ... into explicit statements
  // This is the most common AI-generated pattern that crashes TikZ
  result = expandForeachStatements(result);

  // Evaluate arithmetic in TikZ coordinates: (2.5-(1*1.2/4)-0.2) → (2.2)
  // Matches coordinate pairs like (expr, expr) where expr contains digits and operators
  result = result.replace(/\(([0-9][0-9.+\-*/() ]+)\)/g, (_m, expr) => {
    // Only evaluate if it contains an operator (not just a plain number)
    if (!/[+\-*/]/.test(expr) || /[a-zA-Z\\]/.test(expr)) return _m;
    try {
      const val = Function(`"use strict"; return (${expr})`)();
      if (typeof val === "number" && isFinite(val)) {
        return `(${Math.round(val * 1000) / 1000})`;
      }
    } catch { /* not evaluable — leave as-is */ }
    return _m;
  });

  return result;
}

/**
 * Expand simple \foreach loops into explicit statements.
 * Handles: \foreach \i in {1,...,N} \node[opts] (name\i) at (x,y) {label};
 * and:     \foreach \i in {1,...,N} \foreach \j in {1,...,M} \draw (a\i) -- (b\j);
 */
function expandForeachStatements(tikz) {
  const lines = tikz.split("\n");
  const result = [];
  // new RegExp is used because regex literal /\foreach/ interprets \f as form-feed
  const singleRe = new RegExp(
    "^(\\s*)" +
    "\\\\foreach\\s+\\\\(\\w+)\\s+in\\s+\\{([^}]+)\\}\\s+" +
    "(\\\\(?:node|draw|fill|filldraw|path).+;)" +
    "\\s*$",
  );
  const nestedRe = new RegExp(
    "^(\\s*)" +
    "\\\\foreach\\s+\\\\(\\w+)\\s+in\\s+\\{([^}]+)\\}\\s+" +
    "\\\\foreach\\s+\\\\(\\w+)\\s+in\\s+\\{([^}]+)\\}\\s+" +
    "(\\\\(?:draw|node|fill|path).+;)" +
    "\\s*$",
  );
  for (const line of lines) {
    // Nested \foreach first (more specific)
    const m2 = line.match(nestedRe);
    if (m2) {
      const [, indent, v1, l1, v2, l2, body] = m2;
      const items1 = expandList(l1.trim());
      const items2 = expandList(l2.trim());
      const v1re = new RegExp("\\\\" + v1 + "(?![a-zA-Z])", "g");
      const v2re = new RegExp("\\\\" + v2 + "(?![a-zA-Z])", "g");
      for (const a of items1) {
        for (const b of items2) {
          result.push(indent + body.replace(v1re, String(a)).replace(v2re, String(b)));
        }
      }
      continue;
    }
    // Single \foreach
    const m = line.match(singleRe);
    if (m) {
      const [, indent, varName, listStr, body] = m;
      const items = expandList(listStr.trim());
      const varRe = new RegExp("\\\\" + varName + "(?![a-zA-Z])", "g");
      for (const val of items) {
        result.push(indent + body.replace(varRe, String(val)));
      }
      continue;
    }
    result.push(line);
  }
  return result.join("\n");
}

function expandList(listStr) {
  const rangeMatch = listStr.match(/^(\d+)\s*,\s*\.\.\.\s*,\s*(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  return listStr.split(",").map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Programmatic layout tools — reduce AI burden for spatial reasoning
// ---------------------------------------------------------------------------

const CANVAS_W = 960;
const CANVAS_H = 540;

/**
 * Predefined layout zone templates.
 * apply_layout() returns one of these — no slide state required.
 */
const LAYOUT_ZONES = {
  two_column: {
    description: "Left column for text/code/table (0-480), right column for visuals (490-960)",
    left:  { x: 20,  y: 80, w: 440, h: 420 },
    right: { x: 500, y: 80, w: 440, h: 420 },
  },
  title_content: {
    description: "Title bar at top, main content area below",
    title:   { x: 20, y: 20,  w: 920, h: 70 },
    content: { x: 20, y: 110, w: 920, h: 400 },
  },
  three_panel: {
    description: "Three equal vertical panels",
    left:   { x: 20,  y: 80, w: 280, h: 420 },
    center: { x: 320, y: 80, w: 300, h: 420 },
    right:  { x: 640, y: 80, w: 300, h: 420 },
  },
  split_75_25: {
    description: "Large main area (75%) + narrow side panel (25%)",
    main: { x: 20,  y: 80, w: 660, h: 420 },
    side: { x: 700, y: 80, w: 240, h: 420 },
  },
  hero: {
    description: "Large central visual with caption bar below",
    main:    { x: 20, y: 60,  w: 920, h: 380 },
    caption: { x: 20, y: 460, w: 920, h: 60 },
  },
  title_slide: {
    description: "Centered title/subtitle layout for opening slide",
    title:    { x: 80,  y: 140, w: 800, h: 100 },
    subtitle: { x: 120, y: 260, w: 720, h: 60 },
    content:  { x: 120, y: 340, w: 720, h: 140 },
  },
  stacked: {
    description: "Full-width title + three stacked content rows",
    title: { x: 20, y: 20,  w: 920, h: 60 },
    row1:  { x: 20, y: 100, w: 920, h: 120 },
    row2:  { x: 20, y: 240, w: 920, h: 120 },
    row3:  { x: 20, y: 380, w: 920, h: 140 },
  },
  full: {
    description: "Full canvas content area",
    content: { x: 20, y: 80, w: 920, h: 420 },
  },
};

/**
 * Find a non-overlapping (x, y) position for an element of size (w, h).
 * Scans the preferred hint area first, then falls back to full canvas scan.
 * @returns {{ x: number, y: number } | { error: string }}
 */
function findFreePosition(slideId, w, h, hint = "auto") {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return { error: `Slide "${slideId}" not found` };

  const occupied = (slide.elements ?? [])
    .filter((e) => e.position && e.size?.w > 5 && (e.size?.h ?? 0) > 5)
    .map((e) => ({
      x: e.position.x,
      y: e.position.y,
      x2: e.position.x + e.size.w,
      y2: e.position.y + (e.size.h ?? 40),
    }));

  function noConflict(cx, cy) {
    if (cx < 0 || cy < 0 || cx + w > CANVAS_W || cy + h > CANVAS_H) return false;
    for (const o of occupied) {
      if (cx < o.x2 && cx + w > o.x && cy < o.y2 && cy + h > o.y) return false;
    }
    return true;
  }

  const STEP = 20;
  const hintRanges = {
    right_column: { xs: 490, xe: CANVAS_W - 10, ys: 60,  ye: CANVAS_H - 10 },
    left_column:  { xs: 10,  xe: 480,            ys: 60,  ye: CANVAS_H - 10 },
    top:          { xs: 10,  xe: CANVAS_W - 10,  ys: 10,  ye: 200 },
    bottom:       { xs: 10,  xe: CANVAS_W - 10,  ys: 340, ye: CANVAS_H - 10 },
    top_right:    { xs: 490, xe: CANVAS_W - 10,  ys: 10,  ye: 300 },
    top_left:     { xs: 10,  xe: 480,            ys: 10,  ye: 300 },
    center: {
      xs: Math.max(10, Math.floor((CANVAS_W - w) / 2) - 40),
      xe: Math.min(CANVAS_W - 10, Math.floor((CANVAS_W - w) / 2) + 40),
      ys: Math.max(10, Math.floor((CANVAS_H - h) / 2) - 40),
      ye: Math.min(CANVAS_H - 10, Math.floor((CANVAS_H - h) / 2) + 40),
    },
    auto: { xs: 10, xe: CANVAS_W - 10, ys: 10, ye: CANVAS_H - 10 },
  };

  const range = hintRanges[hint] ?? hintRanges.auto;

  // Priority 1: scan hint area in reading order (top-left → bottom-right)
  const seen = new Set();
  const candidates = [];
  for (let y = range.ys; y + h <= range.ye + STEP; y += STEP) {
    for (let x = range.xs; x + w <= range.xe + STEP; x += STEP) {
      const key = `${x},${y}`;
      if (!seen.has(key)) { seen.add(key); candidates.push({ x, y }); }
    }
  }
  // Priority 2: full canvas fallback
  for (let y = 10; y + h <= CANVAS_H - 10; y += STEP) {
    for (let x = 10; x + w <= CANVAS_W - 10; x += STEP) {
      const key = `${x},${y}`;
      if (!seen.has(key)) { seen.add(key); candidates.push({ x, y }); }
    }
  }

  for (const c of candidates) {
    if (noConflict(c.x, c.y)) return { x: c.x, y: c.y };
  }
  return { error: `No free space found for ${w}×${h} — consider resizing or removing elements` };
}

/**
 * Get a compact JSON summary of a slide's elements with positions.
 */
function getSlideSummary(slideId) {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return JSON.stringify({ error: `Slide "${slideId}" not found` });

  const elements = (slide.elements ?? []).map((e) => {
    const label =
      e.type === "text"    ? (e.content ?? "").replace(/\n.*/u, "").slice(0, 40) :
      e.type === "shape"   ? (e.shape ?? "shape") :
      e.type === "tikz"    ? "TikZ diagram" :
      e.type === "image"   ? (e.src ?? "image").split("/").pop() :
      e.type === "video"   ? (e.src ?? "video").slice(0, 30) :
      e.type === "code"    ? `code (${e.language ?? "?"})` :
      e.type === "table"   ? `table ${(e.columns ?? []).length} cols` :
      e.type === "scene3d" ? "3D scene" : e.type;
    return {
      id: e.id,
      type: e.type,
      x: e.position?.x ?? null,
      y: e.position?.y ?? null,
      w: e.size?.w ?? null,
      h: e.size?.h ?? null,
      groupId: e.groupId ?? undefined,
      label,
    };
  });

  const totalArea = elements
    .filter((e) => e.w != null && e.h != null)
    .reduce((s, e) => s + e.w * e.h, 0);
  const freePct = Math.round(Math.max(0, 100 - (totalArea / (CANVAS_W * CANVAS_H)) * 100));

  return JSON.stringify({
    slideId,
    canvas: `${CANVAS_W}×${CANVAS_H}`,
    elementCount: elements.length,
    elements,
    freeAreaPct: freePct,
    tip: "Call find_position(slideId, w, h, hint) to get guaranteed non-overlapping coordinates",
  }, null, 2);
}

/**
 * Estimate text element dimensions based on content and font size.
 * Returns estimated {w, h} — use to set element sizes instead of guessing.
 */
function estimateTextSize(content, fontSize, maxW = 920) {
  const avgCharW = fontSize * 0.52;  // approximate for sans-serif
  const lineH    = Math.ceil(fontSize * 1.55);
  const hPad     = 16;
  const vPad     = 10;

  const paragraphs = (content ?? "").split(/\n/);
  let totalLines = 0;
  let contentW   = 0;

  for (const para of paragraphs) {
    if (para.length === 0) { totalLines++; continue; }
    const paraW = para.length * avgCharW;
    if (paraW <= maxW - hPad) {
      totalLines++;
      contentW = Math.max(contentW, paraW);
    } else {
      const linesNeeded = Math.ceil(paraW / (maxW - hPad));
      totalLines += linesNeeded;
      contentW = maxW - hPad;
    }
  }

  return JSON.stringify({
    estimatedW: Math.min(Math.ceil(contentW) + hPad, maxW),
    estimatedH: totalLines * lineH + vPad,
    lines: totalLines,
    fontSize,
    note: "±15% accuracy. Add ~20% margin to height for safety.",
  });
}

/**
 * Compute arrow waypoints between two named elements on a slide.
 * Returns an arrow element definition with auto-computed waypoints.
 *
 * Strategy:
 *   1. Find bounding boxes of fromId and toId on the slide.
 *   2. Pick the nearest edge pair (e.g., right edge of from → left edge of to).
 *   3. Produce a 2-segment L-shaped polyline: start → bend → end.
 *   4. The returned element can be passed directly to add_element.
 */
function makeArrow(slideId, fromId, toId, opts = {}) {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return JSON.stringify({ error: `Slide ${slideId} not found` });

  const fromEl = (slide.elements ?? []).find((e) => e.id === fromId);
  const toEl   = (slide.elements ?? []).find((e) => e.id === toId);
  if (!fromEl) return JSON.stringify({ error: `Element ${fromId} not found on ${slideId}` });
  if (!toEl)   return JSON.stringify({ error: `Element ${toId} not found on ${slideId}` });

  const fPos = fromEl.position ?? { x: 0, y: 0 };
  const fSz  = fromEl.size ?? { w: 80, h: 40 };
  const tPos = toEl.position ?? { x: 0, y: 0 };
  const tSz  = toEl.size ?? { w: 80, h: 40 };

  // Center points
  const fCx = fPos.x + fSz.w / 2;
  const fCy = fPos.y + (fSz.h ?? 40) / 2;
  const tCx = tPos.x + tSz.w / 2;
  const tCy = tPos.y + (tSz.h ?? 40) / 2;

  // Pick exit/entry edges based on relative positions
  const dx = tCx - fCx;
  const dy = tCy - fCy;

  let startX, startY, endX, endY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Primarily horizontal: exit right/left edge, enter left/right edge
    if (dx >= 0) {
      startX = fPos.x + fSz.w;  startY = fCy;
      endX   = tPos.x;           endY   = tCy;
    } else {
      startX = fPos.x;           startY = fCy;
      endX   = tPos.x + tSz.w;  endY   = tCy;
    }
  } else {
    // Primarily vertical: exit bottom/top edge, enter top/bottom edge
    if (dy >= 0) {
      startX = fCx;              startY = fPos.y + (fSz.h ?? 40);
      endX   = tCx;              endY   = tPos.y;
    } else {
      startX = fCx;              startY = fPos.y;
      endX   = tCx;              endY   = tPos.y + (tSz.h ?? 40);
    }
  }

  // Build L-shaped waypoints relative to arrow element top-left
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const maxX = Math.max(startX, endX);
  const maxY = Math.max(startY, endY);
  const arrowW = Math.max(maxX - minX, 2);
  const arrowH = Math.max(maxY - minY, 2);

  // Waypoints relative to element top-left corner
  const wx0 = startX - minX;
  const wy0 = startY - minY;
  const wx1 = endX   - minX;
  const wy1 = endY   - minY;

  // Midpoint bend (L-shape) — degenerate to straight line when start/end share an axis
  let waypoints;
  if (opts.style === "straight" || (wx0 === wx1) || (wy0 === wy1)) {
    // Straight line (vertical, horizontal, or explicit straight)
    waypoints = [
      { x: wx0, y: wy0 },
      { x: wx1, y: wy1 },
    ];
  } else {
    // L-bend: horizontal then vertical
    waypoints = [
      { x: wx0, y: wy0 },
      { x: wx1, y: wy0 },
      { x: wx1, y: wy1 },
    ];
  }

  // Generate unique ID
  const existingIds = new Set((slide.elements ?? []).map((e) => e.id));
  let arrowId = opts.id ?? `${slideId}-arrow-${fromId.replace(/.*-/, "")}-${toId.replace(/.*-/, "")}`;
  let suffix = 1;
  while (existingIds.has(arrowId)) arrowId = `${arrowId}-${suffix++}`;

  const arrowEl = {
    id: arrowId,
    type: "shape",
    shape: "arrow",
    position: { x: Math.round(minX), y: Math.round(minY) },
    size: { w: Math.round(arrowW), h: Math.round(arrowH) },
    style: {
      stroke: opts.color ?? "#64748b",
      strokeWidth: opts.strokeWidth ?? 2,
      arrowHead: opts.arrowHead ?? "end",
      waypoints: waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    },
  };

  // Auto-add to slide — caller does NOT need to call add_element separately
  slide.elements.push(arrowEl);

  return `Arrow added: id="${arrowId}" from ${fromId} to ${toId}. position=(${arrowEl.position.x},${arrowEl.position.y}) size=${arrowEl.size.w}x${arrowEl.size.h}. Do NOT call add_element for this arrow — it is already on the slide.`;
}

/** Clamp element sizes so they fit within the 960x540 canvas. */
function applyOverflowFix(slide) {
  for (const el of slide.elements ?? []) {
    if (!el.position || !el.size) continue;
    let { x, y } = el.position;
    let { w, h } = el.size;
    // If element overflows bottom, try moving it up first (preserving size)
    if (y + h > 540) {
      const needed = y + h - 540;
      const canShift = Math.min(needed, y); // don't go above y=0
      el.position.y = y - canShift;
      y = el.position.y;
      // If still overflows, clip height
      if (y + h > 540) el.size.h = Math.max(10, 540 - y);
    }
    if (x + w > 960) {
      const needed = x + w - 960;
      const canShift = Math.min(needed, x);
      el.position.x = x - canShift;
      x = el.position.x;
      if (x + w > 960) el.size.w = Math.max(10, 960 - x);
    }
    if (x < 0) { el.size.w = Math.max(10, el.size.w + x); el.position.x = 0; }
    if (y < 0) { el.size.h = Math.max(10, el.size.h + y); el.position.y = 0; }
  }
}

/**
 * Programmatically resolve element overlaps by nudging the smaller element
 * to the nearest valid non-overlapping position.
 * Returns the number of elements moved.
 */
function resolveOverlaps(slide) {
  const CANVAS_W = 960, CANVAS_H = 540, GAP = 10;
  const VISUAL = ["shape"];
  const CONTENT = ["text", "table", "code"];

  // Mutable position map for cascade-safe iteration
  const pos = new Map(
    (slide.elements ?? []).filter((e) => e.position).map((e) => [e.id, { ...e.position }])
  );
  const siz = new Map(
    (slide.elements ?? []).filter((e) => e.size).map((e) => [e.id, { ...e.size }])
  );
  const measurable = (slide.elements ?? []).filter(
    (e) => e.position && e.size && e.size.w > 5 && e.size.h > 5
  );

  let totalFixed = 0;

  for (let iter = 0; iter < 5; iter++) {
    let fixedThisRound = 0;

    for (let a = 0; a < measurable.length; a++) {
      for (let b = a + 1; b < measurable.length; b++) {
        const ea = measurable[a], eb = measurable[b];
        if (ea.groupId && ea.groupId === eb.groupId) continue;
        if (
          (VISUAL.includes(ea.type) && CONTENT.includes(eb.type)) ||
          (CONTENT.includes(ea.type) && VISUAL.includes(eb.type))
        ) continue;

        const pA = pos.get(ea.id), pB = pos.get(eb.id);
        const sA = siz.get(ea.id), sB = siz.get(eb.id);
        if (!pA || !pB || !sA || !sB) continue;

        const ow = Math.min(pA.x + sA.w, pB.x + sB.w) - Math.max(pA.x, pB.x);
        const oh = Math.min(pA.y + sA.h, pB.y + sB.h) - Math.max(pA.y, pB.y);
        if (ow <= 20 || oh <= 20) continue;

        const areaA = sA.w * sA.h, areaB = sB.w * sB.h;
        const pct = (ow * oh) / Math.min(areaA, areaB);
        const isLabelOnBox = pct > 0.9 && Math.max(areaA, areaB) / Math.min(areaA, areaB) > 3;
        const isAnnotation = Math.max(areaA, areaB) / Math.min(areaA, areaB) > 4;
        if (isLabelOnBox || isAnnotation || pct <= 0.15) continue;

        // Move the smaller element
        const moveB = areaA >= areaB;
        const [largerP, largerS, smallerId, smallerP, smallerS] = moveB
          ? [pA, sA, eb.id, pB, sB]
          : [pB, sB, ea.id, pA, sA];

        const candidates = [
          { x: largerP.x + largerS.w + GAP, y: smallerP.y },
          { x: smallerP.x, y: largerP.y + largerS.h + GAP },
          { x: largerP.x - smallerS.w - GAP, y: smallerP.y },
          { x: smallerP.x, y: largerP.y - smallerS.h - GAP },
        ].filter((p) => p.x >= 0 && p.y >= 0 && p.x + smallerS.w <= CANVAS_W && p.y + smallerS.h <= CANVAS_H);

        if (candidates.length === 0) continue;

        const best = candidates.reduce((a, c) =>
          Math.hypot(a.x - smallerP.x, a.y - smallerP.y) < Math.hypot(c.x - smallerP.x, c.y - smallerP.y) ? a : c
        );

        pos.set(smallerId, best);
        // Mutate the element in-place (test script uses mutable objects)
        const el = slide.elements.find((e) => e.id === smallerId);
        if (el) el.position = best;
        fixedThisRound++;
      }
    }

    totalFixed += fixedThisRound;
    if (fixedThisRound === 0) break;
  }

  return totalFixed;
}

/**
 * Programmatic animation fix — guaranteed safety net after AI animation fix.
 * Ensures onClick animation count exactly matches [step:N] marker count.
 * Adds missing onClick animations or trims excess ones deterministically.
 */
function fixAnimationsProgrammatic() {
  let fixed = 0;
  for (const slide of deck.slides) {
    const stepCount = ((slide.notes ?? "").match(/\[step:\d+\]/g) ?? []).length;
    const onClickAnims = (slide.animations ?? []).filter((a) => a.trigger === "onClick");
    const onClickCount = onClickAnims.length;
    if (stepCount === onClickCount) continue;

    // Non-title eligible targets (avoid header text elements)
    const targets = (slide.elements ?? [])
      .filter((e) => !(e.type === "text" && (e.content ?? "").match(/^#{1,3}\s|^\*\*.*\*\*$/)))
      .map((e) => e.id);
    if (targets.length === 0) continue;

    if (stepCount > onClickCount) {
      const toAdd = stepCount - onClickCount;
      if (!slide.animations) slide.animations = [];
      for (let i = 0; i < toAdd; i++) {
        const targetId = targets[i % targets.length];
        slide.animations.push({ target: targetId, effect: "fadeIn", trigger: "onClick", duration: 300 });
      }
      console.log(`  [animFix:prog] ${slide.id}: added ${toAdd} onClick (${onClickCount}→${stepCount} to match steps)`);
    } else {
      // Trim excess onClick animations — keep first stepCount, remove rest
      let kept = 0;
      slide.animations = slide.animations.filter((a) => {
        if (a.trigger !== "onClick") return true;
        kept++;
        return kept <= stepCount;
      });
      console.log(`  [animFix:prog] ${slide.id}: trimmed ${onClickCount - stepCount} excess onClick (${onClickCount}→${stepCount})`);
    }
    fixed++;
  }
  if (fixed > 0) console.log(`  [animFix:prog] Fixed ${fixed} slide(s)`);
  return fixed;
}

async function runAnimationFix(systemPrompt) {
  const mismatches = deck.slides.filter((s) => {
    const stepCount = ((s.notes ?? "").match(/\[step:\d+\]/g) ?? []).length;
    const onClickCount = (s.animations ?? []).filter((a) => a.trigger === "onClick").length;
    return stepCount > 0 && onClickCount !== stepCount;
  });

  if (mismatches.length === 0) {
    console.log("\n[AnimationFix] No mismatches — skipping.");
    return;
  }

  console.log(`\n[AnimationFix] Fixing ${mismatches.length} slides with step marker mismatches...`);

  const fixLines = mismatches.map((s) => {
    const stepCount = ((s.notes ?? "").match(/\[step:\d+\]/g) ?? []).length;
    const onClickCount = (s.animations ?? []).filter((a) => a.trigger === "onClick").length;
    const elemIds = s.elements.filter((e) => e.type !== "text" || !e.content?.startsWith("#")).map((e) => e.id);
    return `- Slide "${s.id}": ${stepCount} step markers, ${onClickCount} onClick animations. Non-title element IDs: ${elemIds.join(", ")}`;
  });

  const fixMessage = `CRITICAL FIX REQUIRED: The following slides have [step:N] markers in presenter notes but wrong onClick animation count:
${fixLines.join("\n")}

Rules:
- Each [step:N] marker = exactly ONE onClick animation. No exceptions.
- 3 step markers → 3 onClick animations. 4 step markers → 4 onClick animations.
- Do NOT use withPrevious — every animation must be onClick.
- Target any non-title elements (as many as needed, pick from the IDs listed).
- If fewer IDs than steps, reuse IDs (multiple steps can target the same element).

Call update_slide for EACH slide listed. Set the animations array to have EXACTLY as many onClick entries as step markers.

Example — slide "s2" with 3 step markers and elements s2-e2, s2-e3, s2-e4:
  update_slide("s2", { animations: [
    { target: "s2-e2", effect: "fadeIn", trigger: "onClick", duration: 300 },
    { target: "s2-e3", effect: "fadeIn", trigger: "onClick", duration: 300 },
    { target: "s2-e4", effect: "fadeIn", trigger: "onClick", duration: 300 }
  ]})

Do this NOW for all slides listed above.`;

  await callGeminiWithTools(systemPrompt, fixMessage);

  // Programmatic safety net: fix any remaining mismatches the AI missed
  fixAnimationsProgrammatic();
  console.log("  [AnimationFix] Done.");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @typedef {{ level: "CRITICAL" | "WARNING", ref: string, message: string }} Issue */

function validateDeck(slides) {
  /** @type {Issue[]} */
  const issues = [];

  // Collect all element IDs globally
  /** @type {Map<string, string>} elementId -> "slideId/elemId" */
  const globalElementIds = new Map();

  /** @type {Set<string>} */
  const slideIds = new Set();

  for (const slide of slides) {
    // Check 12: Duplicate slide IDs
    if (slideIds.has(slide.id)) {
      issues.push({
        level: "WARNING",
        ref: slide.id,
        message: `Duplicate slide ID "${slide.id}"`,
      });
    }
    slideIds.add(slide.id);

    // Count onClick animations in notes (for check 9)
    const notes = slide.notes ?? "";
    const stepMarkers = (notes.match(/\[step:\d+\]/g) ?? []).length;
    let onClickCount = 0;

    // Check 13: Forbidden element types
    const FORBIDDEN_TYPES = ["mermaid", "iframe", "audio", "animation"];
    for (const el of slide.elements ?? []) {
      if (FORBIDDEN_TYPES.includes(el.type)) {
        issues.push({
          level: "CRITICAL",
          ref: `${slide.id}/${el.id}`,
          message: `Forbidden element type "${el.type}" — use shape+text for diagrams, code for code`,
        });
      }
    }

    // Check 14: Element overlap (>15% area overlap between non-grouped elements)
    const measurable = (slide.elements ?? []).filter((e) => e.position && e.size && e.size.w > 5 && e.size.h > 5);
    for (let a = 0; a < measurable.length; a++) {
      for (let b = a + 1; b < measurable.length; b++) {
        const ea = measurable[a], eb = measurable[b];
        if (ea.groupId && ea.groupId === eb.groupId) continue;
        const ax2 = ea.position.x + ea.size.w, ay2 = ea.position.y + ea.size.h;
        const bx2 = eb.position.x + eb.size.w, by2 = eb.position.y + eb.size.h;
        const ow = Math.min(ax2, bx2) - Math.max(ea.position.x, eb.position.x);
        const oh = Math.min(ay2, by2) - Math.max(ea.position.y, eb.position.y);
        if (ow > 20 && oh > 20) {
          const areaA = ea.size.w * ea.size.h;
          const areaB = eb.size.w * eb.size.h;
          const pct = (ow * oh) / Math.min(areaA, areaB);
          // Skip label-on-box: smaller nearly fully inside larger (ratio > 3x)
          const isLabelOnBox = pct > 0.9 && Math.max(areaA, areaB) / Math.min(areaA, areaB) > 3;
          // Skip shape+text/table overlaps — shapes are always decorative/intentional (highlight boxes, borders)
          const VISUAL = ["shape"];
          const CONTENT = ["text", "table", "code"];
          const isShapeOnContent = (VISUAL.includes(ea.type) && CONTENT.includes(eb.type)) ||
                                   (CONTENT.includes(ea.type) && VISUAL.includes(eb.type));
          // Skip small element on much larger (ratio > 4x) — label-in-box or annotation
          const isAnnotation = Math.max(areaA, areaB) / Math.min(areaA, areaB) > 4;
          if (!isLabelOnBox && !isShapeOnContent && !isAnnotation) {
            const [larger, smaller] = areaA >= areaB ? [ea, eb] : [eb, ea];
            const candidateX = larger.position.x + larger.size.w + 10;
            let suggestion;
            if (candidateX + smaller.size.w <= 960) {
              suggestion = `move "${smaller.id}" to x:${candidateX} y:${smaller.position.y}`;
            } else {
              const candidateY = larger.position.y + larger.size.h + 10;
              if (candidateY + smaller.size.h <= 540) {
                suggestion = `move "${smaller.id}" to x:${smaller.position.x} y:${candidateY} (stack below "${larger.id}")`;
              } else {
                suggestion = `resize "${smaller.id}" to w:${Math.floor((960 - larger.position.x) / 2 - 10)} or delete it — no room right or below "${larger.id}"`;
              }
            }
            const coordsA = `${ea.position.x},${ea.position.y} ${ea.size.w}×${ea.size.h}`;
            const coordsB = `${eb.position.x},${eb.position.y} ${eb.size.w}×${eb.size.h}`;
            if (pct > 0.5) {
              issues.push({
                level: "CRITICAL",
                ref: `${slide.id}/${ea.id}`,
                message: `"${ea.id}"(${coordsA}) and "${eb.id}"(${coordsB}) overlap ${Math.round(pct*100)}% — ${suggestion}`,
              });
            } else if (pct > 0.15) {
              issues.push({
                level: "WARNING",
                ref: `${slide.id}/${ea.id}`,
                message: `"${ea.id}"(${coordsA}) and "${eb.id}"(${coordsB}) overlap ${Math.round(pct*100)}% — ${suggestion}`,
              });
            }
          }
        }
      }
    }

    for (const el of slide.elements ?? []) {
      const ref = `${slide.id}/${el.id}`;

      // Check 1: Duplicate element IDs
      if (globalElementIds.has(el.id)) {
        issues.push({
          level: "CRITICAL",
          ref,
          message: `Duplicate element ID "${el.id}" (also in ${globalElementIds.get(el.id)})`,
        });
      } else {
        globalElementIds.set(el.id, ref);
      }

      // Check 2: Table missing columns/rows
      if (el.type === "table") {
        if (!Array.isArray(el.columns) || el.columns.length === 0) {
          issues.push({
            level: "CRITICAL",
            ref,
            message: `Table element missing or empty "columns" array`,
          });
        }
        if (!Array.isArray(el.rows) || el.rows.length === 0) {
          issues.push({
            level: "CRITICAL",
            ref,
            message: `Table element missing or empty "rows" array`,
          });
        }
      }

      // Check 3: Arrow/line with rotation
      if (
        el.type === "shape" &&
        (el.shape === "arrow" || el.shape === "line") &&
        el.rotation != null
      ) {
        issues.push({
          level: "CRITICAL",
          ref,
          message: `Arrow/line shape has "rotation" field set (causes assert fail)`,
        });
      }

      // Check 4: Element overflow
      if (el.position && el.size) {
        const { x, y } = el.position;
        const { w, h } = el.size;
        if (x + w > 960) {
          issues.push({
            level: "CRITICAL",
            ref,
            message: `Element overflows canvas: x(${x}) + w(${w}) = ${x + w} > 960`,
          });
        }
        if (y + h > 540) {
          issues.push({
            level: "CRITICAL",
            ref,
            message: `Element overflows canvas: y(${y}) + h(${h}) = ${y + h} > 540`,
          });
        }
      }

      // Check 5: \\ in text content (outside TikZ)
      if (el.type === "text" && typeof el.content === "string") {
        if (el.content.includes("\\\\")) {
          issues.push({
            level: "WARNING",
            ref,
            message: `Text content contains "\\\\" (LaTeX line break outside TikZ — may break rendering)`,
          });
        }
        // Check 6: ** inside $...$
        const mathRegion = el.content.match(/\$[^$]+\$/g) ?? [];
        for (const m of mathRegion) {
          if (m.includes("**")) {
            issues.push({
              level: "WARNING",
              ref,
              message: `"**" found inside KaTeX math delimiter "$...$": ${m.slice(0, 60)}`,
            });
          }
        }
        // Check 8: Font size out of range
        const fontSize = el.style?.fontSize;
        if (fontSize != null && (fontSize < 9 || fontSize > 72)) {
          issues.push({
            level: "WARNING",
            ref,
            message: `Font size ${fontSize} is outside recommended range [10, 72]`,
          });
        }
      }

      // Check 7: Code element > 25 lines
      if (el.type === "code" && typeof el.content === "string") {
        const lines = el.content.split("\n").length;
        if (lines > 25) {
          issues.push({
            level: "WARNING",
            ref,
            message: `Code block has ${lines} lines (max recommended 25)`,
          });
        }
      }

      // Check 10b: scene3d orbitControls in slide context
      if (el.type === "scene3d" && el.scene?.orbitControls === true) {
        issues.push({
          level: "WARNING",
          ref,
          message: `scene3d has orbitControls:true — this grabs mouse events and breaks slide navigation`,
        });
      }

      // Check 10: TikZ missing \path bounding box
      if (el.type === "tikz" && typeof el.content === "string") {
        if (!el.content.includes("\\path")) {
          issues.push({
            level: "WARNING",
            ref,
            message: `TikZ element content missing "\\\\path" bounding box (content will be clipped)`,
          });
        }
      }

      // Check 11: Arrow/line missing waypoints
      if (
        el.type === "shape" &&
        (el.shape === "arrow" || el.shape === "line") &&
        (!el.style?.waypoints || el.style.waypoints.length < 2)
      ) {
        issues.push({
          level: "WARNING",
          ref,
          message: `Arrow/line shape missing "style.waypoints" (at least 2 points required)`,
        });
      }

    }

    // Count onClick animations at slide level (animations is slide-level, not element-level)
    const slideAnimations = slide.animations ?? [];
    for (const anim of slideAnimations) {
      if (anim.trigger === "onClick" || anim.trigger === "on_click") {
        onClickCount++;
      }
    }

    // Check 9: Step marker count != onClick animation count
    if (stepMarkers !== onClickCount) {
      issues.push({
        level: "WARNING",
        ref: slide.id,
        message: `Step markers in notes (${stepMarkers}) != onClick animations (${onClickCount})`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function buildReport(slides, issues, timestamp) {
  const totalElements = slides.reduce((sum, s) => sum + (s.elements?.length ?? 0), 0);
  const criticals = issues.filter((i) => i.level === "CRITICAL");
  const warnings = issues.filter((i) => i.level === "WARNING");
  const result = criticals.length === 0 ? "PASS" : "FAIL";

  const lines = [
    "=== DECKODE TEST PIPELINE REPORT ===",
    `Generated: ${timestamp}`,
    `Slides: ${slides.length}`,
    `Elements: ${totalElements}`,
    "",
    `CRITICAL ISSUES (${criticals.length}):`,
  ];

  if (criticals.length === 0) {
    lines.push("  (none)");
  } else {
    for (const issue of criticals) {
      lines.push(`  [${issue.ref}] ${issue.message}`);
    }
  }

  lines.push("");
  lines.push(`WARNINGS (${warnings.length}):`);

  if (warnings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const issue of warnings) {
      lines.push(`  [${issue.ref}] ${issue.message}`);
    }
  }

  lines.push("");
  lines.push(`RESULT: ${result}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Copy pre-generated test assets (images) into a project directory's assets/ folder.
 * This mirrors what a user does when they paste images into a Deckode project.
 * @param {string} projectDir — absolute path to the project directory (e.g., projects/test52)
 */
function copyTestAssetsToProject(projectDir) {
  const { copyFileSync, readdirSync } = require("fs");
  const TEST_ASSETS_DIR = path.resolve(
    __dirname, "..", "..", "final_project", "slides_test_assets"
  );
  const destAssetsDir = path.join(projectDir, "assets");

  if (!existsSync(TEST_ASSETS_DIR)) {
    console.log(`[assets] Test assets dir not found: ${TEST_ASSETS_DIR} — skipping copy`);
    return;
  }

  function copyDir(src, dest) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDir(TEST_ASSETS_DIR, destAssetsDir);
  console.log(`[assets] Copied test assets into project: ${destAssetsDir}`);
}

async function main() {
  const timestamp = new Date().toISOString();
  console.log("=== Deckode CLI Test Pipeline ===");
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Prompt: ${TEST_PROMPT}`);

  // Step 1: Planner
  const plan = await runPlanner(TEST_PROMPT);

  // Step 2: Generator (populates `deck.slides` via local tool execution)
  await runGenerator(plan);

  // Step 3: Save output — find next available testNN folder
  const projectsDir = path.join(__dirname, "..", "projects");
  let testNum = 1;
  while (existsSync(path.join(projectsDir, `test${testNum}`))) testNum++;
  const testDir = path.join(projectsDir, `test${testNum}`);
  mkdirSync(testDir, { recursive: true });

  const outputPath = path.join(testDir, "deck.json");
  const deckOutput = {
    deckode: "1.0",
    meta: {
      title: plan.plan?.topic ?? "Reinforcement Learning Basics",
      author: "test-pipeline",
      aspectRatio: "16:9",
    },
    theme: {
      slide: {
        background: { color: "#ffffff" },
        color: "#1e293b",
      },
    },
    slides: deck.slides,
  };
  writeFileSync(outputPath, JSON.stringify(deckOutput, null, 2), "utf8");
  console.log(`\n[Output] Deck saved to ${outputPath} (test${testNum})`);

  // Step 3b: Copy test asset images into the project's assets/ folder
  copyTestAssetsToProject(testDir);

  // Step 4: Validate
  console.log("\n[Validation] Running checks...");
  const issues = validateDeck(deck.slides);
  const criticals = issues.filter((i) => i.level === "CRITICAL");
  const warnings = issues.filter((i) => i.level === "WARNING");
  console.log(`  Critical issues: ${criticals.length}`);
  console.log(`  Warnings: ${warnings.length}`);

  // Step 5: Build and print report
  const report = buildReport(deck.slides, issues, timestamp);
  console.log("\n" + report);

  // Save report
  const reportPath = path.join(testDir, "test-report.txt");
  writeFileSync(reportPath, report, "utf8");
  console.log(`\n[Report] Saved to ${reportPath}`);

  // Exit code
  if (criticals.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

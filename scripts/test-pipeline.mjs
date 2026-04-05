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

const TEST_PROMPT = `Create a 7-slide presentation on Reinforcement Learning with the following requirements. Use EVERY element type and feature available:

Slide 1 (Title): Title slide with the presentation title "Reinforcement Learning: From Theory to Practice", subtitle with KaTeX math showing the RL objective $\\max_\\pi \\mathbb{E}\\left[\\sum_{t=0}^{\\infty} \\gamma^t r_t\\right]$. Add a bookmark "Title".

Slide 2 (MDP Framework): Build a flow diagram using native shape+text+arrow elements showing the Agent-Environment loop (Agent → Action → Environment → State/Reward → Agent). Use grouped elements (box + label). Include a table summarizing MDP components (State S, Action A, Transition T, Reward R, Discount γ) with descriptions and mathematical notation in KaTeX. Add onClick animations to reveal each part step by step.

Slide 3 (Value Functions): Dense math slide with KaTeX display equations for V(s), Q(s,a), and the Bellman equation $$V^\\pi(s) = \\sum_a \\pi(a|s) \\sum_{s',r} p(s',r|s,a)[r + \\gamma V^\\pi(s')]$$. Use highlight boxes (red-stroke rectangles) with onClick fadeIn to emphasize key terms. Include a comparison table of V(s) vs Q(s,a) properties.

Slide 4 (Policy Gradient): Use a TikZ element to draw a neural network architecture showing the policy network (input: state → hidden layers → output: action probabilities). Include the policy gradient theorem in KaTeX: $$\\nabla_\\theta J(\\theta) = \\mathbb{E}_\\pi\\left[\\nabla_\\theta \\log \\pi_\\theta(a|s) \\cdot Q^\\pi(s,a)\\right]$$. Add a code block showing a PyTorch policy gradient implementation (5-6 lines).

Slide 5 (Q-Learning Algorithm): Show the Q-learning update rule in KaTeX display math. Build a grid-world diagram using shape elements (colored rectangles for start/goal/obstacles, arrows for optimal policy). Use onClick animations to show the agent learning step by step. Include a small code snippet of the Q-learning update.

Slide 6 (3D Value Surface): Use a scene3d element to visualize a 3D value function surface over a 2D state space — a smooth surface with a peak at the goal state. Add axis labels. Include text explaining what the surface represents, with KaTeX notation for $V^*(s_1, s_2)$.

Slide 7 (Summary): Create a summary slide with a comparison table of RL algorithms (Q-Learning, SARSA, PPO, DQN) showing their type (on/off-policy), function approximation, and key advantage. Add a shape-based timeline diagram showing the evolution of RL methods. Use fadeIn animations for progressive reveal.

General: Every slide must have presenter notes with [step:N] markers matching onClick animations. Use transitions between slides. Add bookmarks to key slides.`;

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
Respond with a JSON object (no markdown code fences):
{
  "intent": "create",
  "plan": {
    "topic": "presentation topic",
    "audience": "target audience",
    "slideCount": number,
    "slides": [
      {
        "id": "s1",
        "title": "slide title",
        "type": "title | content | code | diagram | comparison | summary",
        "keyPoints": ["point 1", "point 2"],
        "elementTypes": ["text", "shape", "table", "code"]
      }
    ]
  },
  "reasoning": "brief explanation of your classification and plan"
}

Important: For "create", always include a title slide first and plan diagrams using shape elements (not mermaid/tikz).
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

## Instructions
- Create the slide with add_slide, including ALL text, code, and table elements
- Use text elements for: title, bullet points, labels, captions, descriptions
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
- If NO visual elements needed: elements may use the full 960x540 canvas
- FORBIDDEN element types: "mermaid", "video", "iframe", "audio" — NEVER use these
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
The Content Agent has already created the slide with text/code/table elements. Your job is to enhance it visually.

${schema}

## Current Deck State
${state}

## Instructions
- Call read_slide FIRST to inspect existing elements, their positions (x/y/w/h), and IDs
- Add shape (rectangle, arrow, ellipse) elements to create diagrams and flow charts
- For mathematical diagrams, use tikz elements (MUST include \\path bounding box)
- For 3D visualizations, use scene3d elements
- Group related shapes with the same groupId
- Arrow/line elements MUST have style.waypoints (at least 2 points) — NEVER set rotation on arrows
- Element IDs must be slide-scoped and not conflict with existing IDs on this slide
- CRITICAL layout: Content Agent places text/code/table in the LEFT column (x:0-480). Place ALL visual elements in the RIGHT column (x:490-930, y:80-460). Canvas is 960x540.
- If a slide already has a tikz element, do NOT add another tikz to the same slide
- FIRST: call read_slide to find any element with id ending in "-diagram-placeholder". Delete it with delete_element BEFORE adding visual elements. This is mandatory.
- After deleting the placeholder, fill the right column (x:490, y:80, w:440, h:380) with your diagram/tikz/scene3d
- FORBIDDEN element types: "mermaid", "video", "iframe", "audio" — NEVER use these
- Use add_element to add each visual element to the slide
- After adding all visual elements, briefly confirm what was created

## Common Diagram Patterns
- Flow chart: rectangle shapes for boxes + arrow shapes for connections, all grouped
- Comparison: two rectangle shapes side by side, text labels inside
- Process: horizontal arrow with rectangle steps above/below it
`;
}

function buildGeneratorPrompt() {
  const schema = getGeneratorSchema();
  return `## Role
You are the Generator agent for Deckode. You create and modify slides by calling tools. You receive an approved plan and execute it precisely.

${schema}

## Current Deck State
No deck loaded.

## Instructions
- You have a read_guide tool to fetch detailed specs for any element type, animations, theme, etc. Use it before creating unfamiliar element types (tikz, scene3d, table, etc.).
- Execute the plan by calling the appropriate tools (add_slide, add_element, update_slide, etc.)
- Create slides one at a time with ALL elements included in the slide object
- ALWAYS include presenter notes in every slide (notes field) — describe what the presenter should say
- Use the style guide colors, fonts, and layout patterns consistently
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
      "Read a specific section of the Deckode guide documentation. Available sections: 01-overview, 02-slide-splitting, 03a-schema-deck, 03b-schema-elements, 04a-elem-text-code, 04b-elem-media, 04c-elem-shape, 04d-elem-tikz, 04e-elem-diagrams, 04f-elem-table-mermaid, 04g-elem-scene3d, 04h-elem-scene3d-examples, 05-animations, 06-theme, 07-slide-features, 08a-guidelines, 08b-style-preferences, 09-example",
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
      // Auto-fix TikZ backslash escaping: \node → \\node was JSON-unescaped to \n + ode
      if (args.element?.type === "tikz" && typeof args.element.content === "string") {
        args.element.content = fixTikzBackslashes(args.element.content);
      }
      slide.elements.push(args.element);
      return `Element "${args.element.id}" added to slide "${args.slideId}".`;
    }
    case "update_element": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
      const el = slide.elements.find((e) => e.id === args.elementId);
      if (!el) return `Element "${args.elementId}" not found in slide "${args.slideId}".`;
      Object.assign(el, args.patch);
      return `Element "${args.elementId}" updated.`;
    }
    case "delete_element": {
      const slide = deck.slides.find((s) => s.id === args.slideId);
      if (!slide) return `Slide "${args.slideId}" not found.`;
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
    const model = client.getGenerativeModel({ model: MODEL, systemInstruction });
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
      if (!toolCallsMade && iterations <= 2 && text) {
        console.log("  Model responded with text only — nudging to use tools...");
        history = [
          ...history,
          { role: "user", parts: [{ text: currentMessage }] },
          { role: "model", parts: [{ text }] },
        ];
        currentMessage =
          "Now execute the plan by calling the provided tools (add_slide, add_element, etc.). Do not just describe what you would do — actually call the tools.";
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
    currentMessage = `Tool results:\n${toolResults.join("\n")}\n\nContinue executing the plan. If all done, provide a brief summary.`;
  }

  return "Reached maximum iterations. Some actions may be incomplete.";
}

// ---------------------------------------------------------------------------
// Planner stage
// ---------------------------------------------------------------------------

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
    throw new Error(`Planner returned invalid JSON:\n${rawText.slice(0, 400)}`);
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
    return `- ${iss.level} ${loc} ${iss.message} — call update_element with the suggested position`;
  }
  if (iss.message.includes("lines")) {
    return `- ${iss.level} ${loc} ${iss.message} — trim to at most 25 lines`;
  }
  return `- ${iss.level} ${loc} ${iss.message}`;
}

/** Returns a compact deck state summary for agent prompts */
function formatDeckState() {
  if (deck.slides.length === 0) return "No deck loaded.";
  const lines = [`Slides (${deck.slides.length}):`];
  for (const slide of deck.slides) {
    const types = [...new Set(slide.elements.map((e) => e.type))].join(", ");
    const existingIds = slide.elements.map((e) => e.id).join(", ");
    lines.push(`  [${slide.id}] ${slide.elements.length} elements (${types})${slide.notes ? " [has notes]" : ""}`);
    if (existingIds) lines.push(`    IDs: ${existingIds}`);
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
      const contentMessage = `Create ONLY this one slide (do not create other slides):
${JSON.stringify(slidePlan, null, 2)}

Style: ${plan.reasoning ?? JSON.stringify(STYLE_PREFS)}
Element IDs must be scoped to this slide: "${slidePlan.id}-e1", "${slidePlan.id}-e2", etc.
After calling add_slide, briefly confirm.`;

      await callGeminiWithTools(contentPrompt, contentMessage);
    }

    // --- Visual Agent (only if slide was created and visual elements needed) ---
    if (needsVisuals && deck.slides.find((s) => s.id === slidePlan.id)) {
      // Programmatically remove placeholder element before Visual Agent runs
      const slideBeforeVisual = deck.slides.find((s) => s.id === slidePlan.id);
      if (slideBeforeVisual) {
        const placeholder = slideBeforeVisual.elements.find((e) => e.id.endsWith("-placeholder"));
        if (placeholder) {
          const result = executeTool("delete_element", { slideId: slidePlan.id, elementId: placeholder.id });
          console.log(`  [cleanup] Deleted placeholder: ${result}`);
        }
      }

      const visualTypes = (slidePlan.elementTypes ?? []).filter((t) =>
        ["shape", "arrow", "tikz", "diagram", "scene3d"].includes(t)
      );
      console.log(`  [visual] Adding ${visualTypes.join("/")} to ${slidePlan.id}...`);
      const visualPrompt = buildVisualAgentPrompt(formatDeckState());
      const visualMessage = `REQUIRED: Add visual element(s) to slide ${slidePlan.id}. You MUST call add_element at least once. Do not finish without adding a visual element.

Required element types for this slide: ${visualTypes.join(", ")}
Slide plan: ${JSON.stringify(slidePlan, null, 2)}

Steps:
1. Call read_slide("${slidePlan.id}") to see existing elements
2. Add the required visual element(s) in the RIGHT column: x:490, y:80, w:440, h:380
3. Do NOT create duplicate IDs. Use unique IDs like "${slidePlan.id}-visual-1"`;
      await callGeminiWithTools(visualPrompt, visualMessage);
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

  // Animation correction pass
  await runAnimationFix(buildGeneratorPrompt());
}

/**
 * Restore backslashes in TikZ content lost during JSON parsing.
 * JSON \n → LF(0x0A), \t → TAB(0x09), \f → FF(0x0C), \b → BS(0x08), \r → CR(0x0D)
 * These appear as control chars before LaTeX command continuations.
 */
function fixTikzBackslashes(content) {
  return content
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
}

/** Clamp element sizes so they fit within the 960x540 canvas. */
function applyOverflowFix(slide) {
  for (const el of slide.elements ?? []) {
    if (!el.position || !el.size) continue;
    const { x, y } = el.position;
    const { w, h } = el.size;
    if (x + w > 960) el.size.w = Math.max(10, 960 - x);
    if (y + h > 540) el.size.h = Math.max(10, 540 - y);
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
    const FORBIDDEN_TYPES = ["mermaid", "video", "iframe", "audio"];
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
            const suggestX = Math.min(960 - smaller.size.w, larger.position.x + larger.size.w + 10);
            const coordsA = `${ea.position.x},${ea.position.y} ${ea.size.w}×${ea.size.h}`;
            const coordsB = `${eb.position.x},${eb.position.y} ${eb.size.w}×${eb.size.h}`;
            const suggestion = `move "${smaller.id}" to x:${suggestX} y:${smaller.position.y}`;
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
        if (fontSize != null && (fontSize < 10 || fontSize > 72)) {
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

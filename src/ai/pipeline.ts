import type { Deck, Slide, SlideElement } from "@/types/deck";
import { useDeckStore } from "@/stores/deckStore";
import { callGemini, buildFunctionDeclarations, type GeminiModel, type DeckodeTool, getModelForAgent } from "./geminiClient";
import { buildPlannerPrompt, buildGeneratorPrompt, buildContentAgentPrompt, buildVisualAgentPrompt, buildReviewerPrompt, buildWriterPrompt } from "./prompts";
import { generatorTools, reviewerTools, writerTools } from "./tools";
import { readGuide } from "./guides";
import { validateDeck, buildFixInstructions } from "./validation";
import type { Content } from "@google/generative-ai";

// ---------- Types ----------

export type PipelineIntent = "create" | "modify" | "notes" | "review" | "chat" | "style_inquiry";

export interface SlidePlan {
  id: string;
  title: string;
  type: string;
  keyPoints: string[];
  elementTypes: string[];
}

export interface PlanResult {
  intent: PipelineIntent;
  plan?: {
    topic: string;
    audience: string;
    slideCount: number;
    slides: SlidePlan[];
  };
  actions?: string[];
  response?: string;
  reasoning: string;
}

export interface StylePreferences {
  theme: "dark" | "light" | "custom";
  customColors?: { background: string; text: string; accent: string };
  animations: "rich" | "minimal" | "none";
  highlightBoxes: boolean;
  notesTone: "narrative" | "telegraphic" | "scripted";
}

export interface PipelineCallbacks {
  onStageChange: (stage: string) => void;
  onLog: (message: string) => void;
  onPlanReady: (plan: PlanResult) => Promise<boolean>; // returns true if approved
  onStyleInquiry: () => Promise<StylePreferences>; // returns user's style choices
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
}

// ---------- Tool Execution ----------

/**
 * Restore backslashes in TikZ content lost during JSON parsing.
 * JSON \n → LF(0x0A), \t → TAB(0x09), \f → FF(0x0C), \b → BS(0x08), \r → CR(0x0D)
 * e.g. "\node" in JSON string → LF + "ode" after parsing
 */
function fixTikzBackslashes(content: string): string {
  return content
    // \n (LF 0x0A) prefix
    .replace(/\x0aode(?=[\[{\s(;,])/g, "\\node")
    .replace(/\x0aormalsize(?=[\s{])/g, "\\normalsize")
    .replace(/\x0aewcommand(?=[\s{[\\])/g, "\\newcommand")
    .replace(/\x0aoindent/g, "\\noindent")
    // \f (FF 0x0C) prefix
    .replace(/\x0coreach(?=[\s{[\\])/g, "\\foreach")
    .replace(/\x0cilldraw(?=[\s{[\\])/g, "\\filldraw")
    .replace(/\x0cill(?=[\s{[\\(])/g, "\\fill")
    // \t (TAB 0x09) prefix
    .replace(/\x09ikzset(?=[\s{[\\])/g, "\\tikzset")
    .replace(/\x09extbf(?=[\s{[\\{])/g, "\\textbf")
    .replace(/\x09extrm(?=[\s{[\\{])/g, "\\textrm")
    .replace(/\x09he(?=[\s{[\\])/g, "\\the")
    // \b (BS 0x08) prefix
    .replace(/\x08egin(?=[\s{[\\])/g, "\\begin")
    .replace(/\x08old(?=[\s{[\\])/g, "\\bold")
    .replace(/\x08ar(?=[\s{[\\])/g, "\\bar")
    // \r (CR 0x0D) prefix
    .replace(/\x0delax(?=[\s{[\\])/g, "\\relax")
    .replace(/\x0dight(?=[\s{[\\])/g, "\\right")
    .replace(/\x0denewcommand(?=[\s{[\\])/g, "\\renewcommand");
}

/** Fix literal \n sequences in text content and auto-add missing waypoints to arrows */
function sanitizeToolArgs(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeToolArgs(item);
    return;
  }
  const rec = obj as Record<string, unknown>;
  // Fix literal \n in string fields commonly containing text
  for (const key of ["content", "notes"]) {
    if (typeof rec[key] === "string") {
      rec[key] = (rec[key] as string).replace(/\\n/g, "\n");
    }
  }
  // Fix double-escaped LaTeX commands in text elements (agent writes \\bm → should be \bm)
  // Only applies to text type — TikZ and code content must not be modified here
  if (rec.type === "text" && typeof rec.content === "string") {
    rec.content = (rec.content as string).replace(/\\\\([a-zA-Z]+)/g, "\\$1");
  }
  // Auto-add waypoints to arrows that are missing them
  if (rec.shape === "arrow" && rec.style && rec.size) {
    const style = rec.style as Record<string, unknown>;
    const size = rec.size as { w: number; h: number };
    if (!style.waypoints) {
      // Horizontal arrow by default; vertical if h > w
      if (size.h > size.w) {
        style.waypoints = [{ x: 0, y: 0 }, { x: 0, y: size.h }];
      } else {
        style.waypoints = [{ x: 0, y: 0 }, { x: size.w, y: 0 }];
      }
    }
  }
  // Recurse into nested objects/arrays
  for (const val of Object.values(rec)) {
    if (val && typeof val === "object") sanitizeToolArgs(val);
  }
}

function executeTool(name: string, args: Record<string, unknown>): string {
  // Sanitize text content and fix missing arrow waypoints
  sanitizeToolArgs(args);

  const store = useDeckStore.getState();
  const deck = store.deck;

  switch (name) {
    case "read_guide": {
      const section = args.section as string;
      return readGuide(section);
    }
    case "read_deck": {
      if (!deck) return "No deck loaded.";
      // Return summary only — use read_slide for details
      const summary = {
        title: deck.meta.title,
        author: deck.meta.author,
        slideCount: deck.slides.length,
        slides: deck.slides.map((s) => ({
          id: s.id,
          elementCount: s.elements.length,
          elementTypes: [...new Set(s.elements.map((e) => e.type))],
          hasNotes: !!s.notes,
          firstText: s.elements.find((e) => e.type === "text")
            ? (s.elements.find((e) => e.type === "text") as { content: string }).content.slice(0, 60)
            : null,
        })),
      };
      return JSON.stringify(summary, null, 2);
    }
    case "read_slide": {
      const slideId = args.slideId as string;
      if (!deck) return "No deck loaded.";
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      return JSON.stringify(slide, null, 2);
    }
    case "create_deck": {
      const newDeck = args.deck as Deck;
      store.replaceDeck(newDeck);
      return `Deck created with ${newDeck.slides.length} slides.`;
    }
    case "add_slide": {
      const slide = args.slide as Slide;
      // Reject duplicate slide IDs — reviewer/visual agents must use update_slide instead
      if (deck?.slides.some((s) => s.id === slide.id)) {
        return `ERROR: Slide "${slide.id}" already exists. Use update_slide or add_element to modify it. Do NOT call add_slide again.`;
      }
      const afterSlideId = args.afterSlideId as string | undefined;
      let afterIndex: number | undefined;
      if (afterSlideId && deck) {
        const idx = deck.slides.findIndex((s) => s.id === afterSlideId);
        if (idx !== -1) afterIndex = idx;
      }
      store.addSlide(slide, afterIndex);
      return `Slide "${slide.id}" added with ${slide.elements.length} elements.`;
    }
    case "update_slide": {
      const slideId = args.slideId as string;
      const patch = args.patch as Partial<Slide>;
      store.updateSlide(slideId, patch);
      return `Slide "${slideId}" updated.`;
    }
    case "delete_slide": {
      const slideId = args.slideId as string;
      store.deleteSlide(slideId);
      return `Slide "${slideId}" deleted.`;
    }
    case "add_element": {
      const slideId = args.slideId as string;
      const element = args.element as SlideElement & { type?: string; content?: string };
      // Reject animation objects added as elements — they belong in slide.animations array
      if ((element as { type?: string }).type === "animation") {
        return `ERROR: Do not add animation objects via add_element. Use update_slide with an "animations" array on the slide instead.`;
      }
      // Auto-fix TikZ backslash escaping lost during JSON parsing (\node → newline + "ode")
      if (element.type === "tikz" && typeof element.content === "string") {
        element.content = fixTikzBackslashes(element.content);
      }
      store.addElement(slideId, element);
      return `Element "${element.id}" added to slide "${slideId}".`;
    }
    case "update_element": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const patch = args.patch as Partial<SlideElement>;
      store.updateElement(slideId, elementId, patch);
      return `Element "${elementId}" updated.`;
    }
    case "delete_element": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      store.deleteElement(slideId, elementId);
      return `Element "${elementId}" deleted from slide "${slideId}".`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------- Agent Call with Tool Loop ----------

async function callAgentWithTools(
  model: GeminiModel,
  systemPrompt: string,
  tools: DeckodeTool[],
  message: string,
  history: Content[],
  onLog: (msg: string) => void,
): Promise<string> {
  const geminiTools = buildFunctionDeclarations(tools);
  let currentHistory = [...history];
  let currentMessage = message;
  let iterations = 0;
  let toolCallsMade = false;
  const maxIterations = 20;

  while (iterations < maxIterations) {
    iterations++;
    const response = await callGemini({
      model,
      systemInstruction: systemPrompt,
      history: currentHistory,
      tools: geminiTools,
      message: currentMessage,
    });

    onLog(`  [iter ${iterations}] text=${response.text.length}chars, tools=${response.functionCalls.length}`);

    if (response.functionCalls.length === 0) {
      // If no tool calls have been made yet, nudge the model to use tools.
      if (!toolCallsMade && iterations <= 2 && response.text) {
        onLog("Model responded with text only, nudging to use tools...");
        currentHistory = [
          ...currentHistory,
          { role: "user", parts: [{ text: currentMessage }] },
          { role: "model", parts: [{ text: response.text }] },
        ];
        currentMessage = "Now execute the plan by calling the provided tools (add_slide, add_element, etc.). Do not just describe what you would do — actually call the tools.";
        continue;
      }
      return response.text;
    }

    // Execute each function call and build function response
    toolCallsMade = true;
    const functionResponses: string[] = [];
    for (const fc of response.functionCalls) {
      if (fc.name === "read_guide") {
        onLog(`[guide] Reading ${fc.args.section}...`);
      } else {
        onLog(`  → ${fc.name}(${JSON.stringify(fc.args).slice(0, 120)}...)`);
      }
      try {
        const result = executeTool(fc.name, fc.args);
        functionResponses.push(`${fc.name} result: ${result}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onLog(`  ✗ ${fc.name} failed: ${errMsg}`);
        functionResponses.push(`${fc.name} ERROR: ${errMsg}. Try a different approach.`);
      }
    }

    // Add to history and continue
    currentHistory = [
      ...currentHistory,
      { role: "user", parts: [{ text: currentMessage }] },
      { role: "model", parts: [{ text: response.text || "Calling tools..." }] },
    ];
    currentMessage = `Tool results:\n${functionResponses.join("\n")}\n\nContinue executing the plan. If all done, provide a summary.`;
  }

  return "Reached maximum iterations. Some actions may be incomplete.";
}

// ---------- Pipeline Stages ----------

async function runPlanner(
  userMessage: string,
  cb: PipelineCallbacks,
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<PlanResult | null> {
  cb.onStageChange("plan");
  cb.onLog("Analyzing intent and creating plan...");

  const deck = useDeckStore.getState().deck;
  const prompt = buildPlannerPrompt(deck);

  // Convert chat history to Gemini Content format
  const history: Content[] = (chatHistory ?? []).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  const response = await callGemini({
    model: getModelForAgent("planner"),
    systemInstruction: prompt,
    history,
    message: userMessage,
  });

  try {
    // Clean response text - remove markdown code fences if present
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    return JSON.parse(text) as PlanResult;
  } catch {
    cb.onError(`Planner returned invalid JSON: ${response.text.slice(0, 200)}`);
    return null;
  }
}

async function runGenerator(
  plan: PlanResult,
  cb: PipelineCallbacks,
): Promise<string> {
  cb.onStageChange("generate");

  // Modify intent: single call (no slide plan available)
  if (!plan.plan?.slides || plan.intent === "modify") {
    cb.onLog("Generating modifications...");
    const deck = useDeckStore.getState().deck;
    const prompt = buildGeneratorPrompt(deck);
    const planMessage = `Execute these modifications:\n${plan.actions?.join("\n")}`;
    return callAgentWithTools(getModelForAgent("generator"), prompt, generatorTools, planMessage, [], cb.onLog);
  }

  // Create intent: slide-by-slide loop
  const slides = plan.plan.slides;
  cb.onLog(`Generating ${slides.length} slides one by one...`);

  for (let i = 0; i < slides.length; i++) {
    const slidePlan = slides[i]!;
    cb.onLog(`[${i + 1}/${slides.length}] Generating slide: "${slidePlan.title}"`);

    const idPrefix = `${slidePlan.id}`;
    const slideContext = `Slide ${i + 1} of ${slides.length}. Style: ${plan.reasoning}. Element IDs must be scoped: "${idPrefix}-e1", "${idPrefix}-e2", etc.`;

    // Phase 1: Generation — retry only if slide was not created at all
    const maxGenAttempts = 2;
    for (let genAttempt = 1; genAttempt <= maxGenAttempts; genAttempt++) {
      const existingDeck = useDeckStore.getState().deck;
      if (existingDeck?.slides.some((s) => s.id === slidePlan.id)) break; // already created

      const currentDeck = useDeckStore.getState().deck;
      const contentPrompt = buildContentAgentPrompt(currentDeck);
      const contentMessage = `Create ONLY this one slide (do not create other slides):
${JSON.stringify(slidePlan, null, 2)}

${slideContext}
After calling add_slide, briefly confirm.`;

      cb.onLog(`  [content] Creating text/code/table elements... (gen ${genAttempt}/${maxGenAttempts})`);
      await callAgentWithTools(getModelForAgent("generator"), contentPrompt, generatorTools, contentMessage, [], cb.onLog);
    }

    // --- Visual Agent: runs once after generation ---
    const needsVisuals = slidePlan.elementTypes?.some((t) =>
      ["shape", "arrow", "tikz", "diagram", "scene3d"].includes(t),
    );
    const deckAfterGen = useDeckStore.getState().deck;
    if (needsVisuals && deckAfterGen?.slides.some((s) => s.id === slidePlan.id)) {
      const placeholderSlide = deckAfterGen.slides.find((s) => s.id === slidePlan.id);
      if (placeholderSlide) {
        const placeholder = placeholderSlide.elements.find((e) => e.id.endsWith("-placeholder"));
        if (placeholder) {
          useDeckStore.getState().deleteElement(slidePlan.id, placeholder.id);
          cb.onLog(`  [cleanup] Deleted placeholder ${placeholder.id}`);
        }
      }
      const deckForVisual = useDeckStore.getState().deck;
      const visualTypes = slidePlan.elementTypes?.filter((t) =>
        ["shape", "arrow", "tikz", "diagram", "scene3d"].includes(t),
      ) ?? [];
      cb.onLog(`  [visual] Adding ${visualTypes.join("/")} to ${slidePlan.id}...`);
      const visualPrompt = buildVisualAgentPrompt(deckForVisual);
      const visualMessage = `REQUIRED: Add visual element(s) to slide ${slidePlan.id}. You MUST call add_element at least once. Do not finish without adding a visual element.

Required element types for this slide: ${visualTypes.join(", ")}
Slide plan: ${JSON.stringify(slidePlan, null, 2)}
${slideContext}

Steps:
1. Call read_slide("${slidePlan.id}") to see existing elements
2. Add the required visual element(s) in the RIGHT column: x:490, y:80, w:440, h:380
3. Do NOT create duplicate IDs. Use unique IDs like "${slidePlan.id}-visual-1"`;
      await callAgentWithTools(getModelForAgent("generator"), visualPrompt, generatorTools, visualMessage, [], cb.onLog);
    }

    // Phase 2: Fix pass — reviewer only, generation does NOT re-run
    const maxFixPasses = 2;
    for (let fixPass = 1; fixPass <= maxFixPasses; fixPass++) {
      const updatedDeck = useDeckStore.getState().deck;
      if (!updatedDeck) break;
      const slide = updatedDeck.slides.find((s) => s.id === slidePlan.id);
      if (!slide) {
        cb.onLog(`  ✗ Slide ${slidePlan.id} was not created`);
        break;
      }

      // Programmatic overflow clamp
      const deckStore = useDeckStore.getState();
      for (const el of slide.elements) {
        if (!el.position || !el.size) continue;
        const overflowX = el.position.x + el.size.w - 960;
        const overflowY = el.position.y + el.size.h - 540;
        if (overflowX > 0) deckStore.updateElement(slidePlan.id, el.id, { size: { w: Math.max(10, el.size.w - overflowX), h: el.size.h } });
        if (overflowY > 0) deckStore.updateElement(slidePlan.id, el.id, { size: { w: el.size.w, h: Math.max(10, el.size.h - overflowY) } });
      }

      const refreshedDeck = useDeckStore.getState().deck;
      const refreshedSlide = refreshedDeck?.slides.find((s) => s.id === slidePlan.id) ?? slide;
      const slideResult = validateDeck({ ...updatedDeck, slides: [refreshedSlide] });
      const criticals = slideResult.issues.filter((iss) => iss.severity === "error");
      const overlapWarnings = slideResult.issues.filter(
        (iss) => iss.severity === "warning" && iss.message.includes("overlap"),
      );
      if (criticals.length === 0 && overlapWarnings.length === 0) {
        cb.onLog(`  ✓ Slide ${slidePlan.id} passed validation`);
        break;
      }
      const issueCount = criticals.length + overlapWarnings.length;
      cb.onLog(`  ✗ ${issueCount} issue(s) (${criticals.length} critical, ${overlapWarnings.length} overlap warnings) — fix pass ${fixPass}/${maxFixPasses}`);
      if (fixPass < maxFixPasses) {
        const fixInstructions = buildFixInstructions(slideResult);
        const fixPrompt = buildReviewerPrompt(updatedDeck);
        await callAgentWithTools(
          getModelForAgent("reviewer"),
          fixPrompt,
          reviewerTools,
          `Fix issues in slide ${slidePlan.id} only. Use update_element to reposition, delete_element to remove forbidden types:\n${fixInstructions}`,
          [],
          cb.onLog,
        );
      }
    }
  }

  return `Generated ${slides.length} slides with per-slide validation.`;
}

async function runReviewer(cb: PipelineCallbacks): Promise<string> {
  cb.onStageChange("review");
  cb.onLog("Reviewing deck for issues...");

  const deck = useDeckStore.getState().deck;
  if (!deck) return "No deck to review.";

  // Local validation first
  const localResult = validateDeck(deck);
  const fixInstructions = buildFixInstructions(localResult);

  if (localResult.issues.length === 0) {
    cb.onLog("Local validation passed — no issues found.");
    return "All validation checks passed. No issues found.";
  }

  cb.onLog(`Found ${localResult.issues.length} issues. Running AI reviewer...`);
  const prompt = buildReviewerPrompt(deck);
  const message = fixInstructions
    ? `Review the deck and address these issues:\n${fixInstructions}`
    : "Review the deck for any issues.";

  return callAgentWithTools(
    getModelForAgent("reviewer"),
    prompt,
    reviewerTools,
    message,
    [],
    cb.onLog,
  );
}

async function runWriter(
  userMessage: string,
  cb: PipelineCallbacks,
): Promise<string> {
  cb.onStageChange("notes");
  cb.onLog("Generating speaker notes...");

  const deck = useDeckStore.getState().deck;
  const prompt = buildWriterPrompt(deck);

  return callAgentWithTools(
    getModelForAgent("writer"),
    prompt,
    writerTools,
    userMessage,
    [],
    cb.onLog,
  );
}

// ---------- Main Pipeline ----------

export async function runPipeline(
  userMessage: string,
  cb: PipelineCallbacks,
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  try {
    // Stage 1: Plan
    const plan = await runPlanner(userMessage, cb, chatHistory);
    if (!plan) return;

    // Direct chat response — no pipeline needed
    if (plan.intent === "chat") {
      cb.onComplete(plan.response ?? plan.reasoning);
      return;
    }

    // Style inquiry — show UI form, then re-run planner with preferences
    if (plan.intent === "style_inquiry") {
      const prefs = await cb.onStyleInquiry();
      const prefsText = [
        `Theme: ${prefs.theme}${prefs.customColors ? ` (bg: ${prefs.customColors.background}, text: ${prefs.customColors.text}, accent: ${prefs.customColors.accent})` : ""}`,
        `Animations: ${prefs.animations}`,
        `Highlight Boxes: ${prefs.highlightBoxes ? "yes" : "no"}`,
        `Presenter Notes Tone: ${prefs.notesTone}`,
      ].join("\n");
      const enrichedMessage = `${userMessage}\n\nStyle Preferences:\n${prefsText}`;
      const updatedHistory = [
        ...(chatHistory ?? []),
        { role: "user" as const, content: userMessage },
        { role: "assistant" as const, content: plan.response ?? "What are your style preferences?" },
        { role: "user" as const, content: `My style preferences:\n${prefsText}` },
      ];
      // Re-run pipeline with preferences included
      return runPipeline(enrichedMessage, cb, updatedHistory);
    }

    // Notes-only path
    if (plan.intent === "notes") {
      const result = await runWriter(userMessage, cb);
      cb.onComplete(result);
      return;
    }

    // Review-only path
    if (plan.intent === "review") {
      const result = await runReviewer(cb);
      cb.onComplete(result);
      return;
    }

    // Create / Modify path — approval gate
    if (plan.intent === "create" || plan.intent === "modify") {
      const approved = await cb.onPlanReady(plan);
      if (!approved) {
        cb.onComplete("Plan rejected by user.");
        return;
      }

      // Stage 2: Generate
      const genResult = await runGenerator(plan, cb);
      cb.onLog(genResult);

      // Stage 3: Review
      const reviewResult = await runReviewer(cb);

      cb.onComplete(`Generation complete. ${reviewResult}`);
    }
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : String(err));
  }
}

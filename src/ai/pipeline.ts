import type { Deck, Slide, SlideElement } from "@/types/deck";
import { useDeckStore } from "@/stores/deckStore";
import { callGemini, buildFunctionDeclarations, type GeminiModel, type DeckodeTool, getModelForAgent } from "./geminiClient";
import { buildPlannerPrompt, buildGeneratorPrompt, buildReviewerPrompt, buildWriterPrompt } from "./prompts";
import { generatorTools, reviewerTools, writerTools } from "./tools";
import { validateDeck, buildFixInstructions } from "./validation";
import type { Content } from "@google/generative-ai";

// ---------- Types ----------

export type PipelineIntent = "create" | "modify" | "notes" | "review" | "chat";

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

export interface PipelineCallbacks {
  onStageChange: (stage: string) => void;
  onLog: (message: string) => void;
  onPlanReady: (plan: PlanResult) => Promise<boolean>; // returns true if approved
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
}

// ---------- Tool Execution ----------

function executeTool(name: string, args: Record<string, unknown>): string {
  const store = useDeckStore.getState();
  const deck = store.deck;

  switch (name) {
    case "read_deck": {
      return JSON.stringify(deck, null, 2);
    }
    case "create_deck": {
      const newDeck = args.deck as Deck;
      store.replaceDeck(newDeck);
      return `Deck created with ${newDeck.slides.length} slides.`;
    }
    case "add_slide": {
      const slide = args.slide as Slide;
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
      const element = args.element as SlideElement;
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

    if (response.functionCalls.length === 0) {
      return response.text;
    }

    // Execute each function call and build function response
    const functionResponses: string[] = [];
    for (const fc of response.functionCalls) {
      onLog(`  → ${fc.name}(${JSON.stringify(fc.args).slice(0, 120)}...)`);
      const result = executeTool(fc.name, fc.args);
      functionResponses.push(`${fc.name} result: ${result}`);
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
): Promise<PlanResult | null> {
  cb.onStageChange("plan");
  cb.onLog("Analyzing intent and creating plan...");

  const deck = useDeckStore.getState().deck;
  const prompt = buildPlannerPrompt(deck);

  const response = await callGemini({
    model: getModelForAgent("planner"),
    systemInstruction: prompt,
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
  cb.onLog("Generating slides...");

  const deck = useDeckStore.getState().deck;
  const prompt = buildGeneratorPrompt(deck);

  const planMessage = plan.plan
    ? `Execute this approved plan:\n${JSON.stringify(plan.plan, null, 2)}`
    : `Execute these modifications:\n${plan.actions?.join("\n")}`;

  return callAgentWithTools(
    getModelForAgent("generator"),
    prompt,
    generatorTools,
    planMessage,
    [],
    cb.onLog,
  );
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
    ? `Review the deck and fix these issues:\n${fixInstructions}`
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
): Promise<void> {
  try {
    // Stage 1: Plan
    const plan = await runPlanner(userMessage, cb);
    if (!plan) return;

    // Direct chat response — no pipeline needed
    if (plan.intent === "chat") {
      cb.onComplete(plan.response ?? plan.reasoning);
      return;
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

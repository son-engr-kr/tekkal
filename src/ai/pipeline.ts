import type { Deck, Slide, SlideElement, ImageElement } from "@/types/deck";
import { useDeckStore } from "@/stores/deckStore";
import { callGemini, buildFunctionDeclarations, type GeminiModel, type TekkalTool, getModelForAgent } from "./geminiClient";
import { buildPlannerPrompt, buildGeneratorPrompt, buildContentAgentPrompt, buildVisualAgentPrompt, buildReviewerPrompt, buildWriterPrompt, extractSlideTitle, type PromptContext } from "./prompts";
import { generatorTools, reviewerTools, writerTools, plannerTools, projectFileTools } from "./tools";
import { useProjectRefStore } from "@/stores/projectRefStore";
import { readGuide } from "./guides";
import { validateDeck, buildFixInstructions } from "./validation";
import { downscaleImage } from "@/utils/imageDownscale";
import { scheduleImageCaptionForced, captionImageNow } from "./imageCaption";
import type { Content, Part } from "@google/generative-ai";

const MAX_ATTACHED_IMAGES = 3;

/**
 * In-memory snapshot map for the snapshot/restore tools. Labels are
 * user-provided so the AI agent can create meaningful checkpoints like
 * "before-tikz-rewrite" and roll back on its own. Cleared on reload.
 */
const snapshots = new Map<string, Deck>();

/**
 * Parse a markdown outline into (title, body) blocks. Each top-level '#'
 * heading starts a new block; all content until the next '#' (at column 0,
 * not '##' or '###') becomes the body. Deeper headings (##, ###) are left
 * inside the body where renderMarkdown will handle them as sub-headings.
 */
export function parseOutline(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split("\n");
  const blocks: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      if (current) blocks.push(current);
      current = { title: h1[1]!.trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ title: b.title, body: b.body.join("\n") }));
}

/**
 * WCAG relative luminance for an sRGB color. Input accepts #rgb, #rrggbb,
 * or the literal "transparent". Unknown strings fall back to assuming
 * white, which is the conservative choice for contrast checks.
 */
function relativeLuminance(color: string): number {
  const hex = parseHexColor(color);
  if (!hex) return 1;
  const srgb = hex.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
}

function parseHexColor(color: string): [number, number, number] | null {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "transparent") return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

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

export type ContextBarSnapshot = PromptContext;

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

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
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
          title: extractSlideTitle(s),
          elementCount: s.elements.length,
          elementTypes: [...new Set(s.elements.map((e) => e.type))],
          hasNotes: !!s.notes,
        })),
      };
      return JSON.stringify(summary, null, 2);
    }
    case "read_slide": {
      const slideId = args.slideId as string;
      if (!deck) return "No deck loaded.";
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      // Lazy caption trigger: kick off background captioning for any images
      // lacking aiSummary. The returned JSON still has empty aiSummary for
      // this read, but the next read will see the generated caption.
      for (const el of slide.elements) {
        if (el.type === "image" && !(el as { aiSummary?: string }).aiSummary) {
          scheduleImageCaptionForced(slideId, el.id);
        }
      }
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
    case "read_element": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const element = slide.elements.find((e) => e.id === elementId);
      if (!element) return `Element "${elementId}" not found in slide "${slideId}".`;
      // Lazy caption trigger for image elements without aiSummary.
      if (element.type === "image" && !(element as { aiSummary?: string }).aiSummary) {
        scheduleImageCaptionForced(slideId, elementId);
      }
      return JSON.stringify(element, null, 2);
    }
    case "move_element": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!element) return `ERROR: Element "${elementId}" not found in slide "${slideId}".`;
      const newX = typeof args.x === "number" ? args.x : element.position.x;
      const newY = typeof args.y === "number" ? args.y : element.position.y;
      store.updateElement(slideId, elementId, { position: { x: newX, y: newY } });
      return `Element "${elementId}" moved to (${newX}, ${newY}).`;
    }
    case "resize_element": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!element) return `ERROR: Element "${elementId}" not found in slide "${slideId}".`;
      const oldW = (element.size as { w?: number }).w ?? 0;
      const oldH = (element.size as { h?: number }).h ?? 0;
      const newW = typeof args.w === "number" ? args.w : oldW;
      const newH = typeof args.h === "number" ? args.h : oldH;
      const anchor = (args.anchor as string | undefined) ?? "top-left";
      let newX = element.position.x;
      let newY = element.position.y;
      const dw = newW - oldW;
      const dh = newH - oldH;
      switch (anchor) {
        case "center":
          newX -= dw / 2;
          newY -= dh / 2;
          break;
        case "top-right":
          newX -= dw;
          break;
        case "bottom-left":
          newY -= dh;
          break;
        case "bottom-right":
          newX -= dw;
          newY -= dh;
          break;
      }
      store.updateElement(slideId, elementId, {
        position: { x: newX, y: newY },
        size: { ...element.size, w: newW, h: newH },
      });
      return `Element "${elementId}" resized to ${newW}x${newH} (anchor: ${anchor}).`;
    }
    case "align_elements": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementIds = args.elementIds as string[];
      const alignment = args.alignment as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const targets = elementIds
        .map((id) => slide.elements.find((e) => e.id === id))
        .filter((e): e is SlideElement => !!e);
      if (targets.length < 2) {
        return `ERROR: align_elements needs at least 2 valid elements. Got ${targets.length}.`;
      }
      const boxes = targets.map((e) => ({
        id: e.id,
        x: e.position.x,
        y: e.position.y,
        w: (e.size as { w?: number }).w ?? 0,
        h: (e.size as { h?: number }).h ?? 0,
      }));
      const minX = Math.min(...boxes.map((b) => b.x));
      const maxX = Math.max(...boxes.map((b) => b.x + b.w));
      const minY = Math.min(...boxes.map((b) => b.y));
      const maxY = Math.max(...boxes.map((b) => b.y + b.h));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      for (const b of boxes) {
        let nx = b.x;
        let ny = b.y;
        switch (alignment) {
          case "left": nx = minX; break;
          case "right": nx = maxX - b.w; break;
          case "center": nx = centerX - b.w / 2; break;
          case "top": ny = minY; break;
          case "bottom": ny = maxY - b.h; break;
          case "middle": ny = centerY - b.h / 2; break;
          default:
            return `ERROR: Unknown alignment "${alignment}". Use left|center|right|top|middle|bottom.`;
        }
        store.updateElement(slideId, b.id, { position: { x: nx, y: ny } });
      }
      return `Aligned ${boxes.length} elements (${alignment}) on slide "${slideId}".`;
    }
    case "distribute_elements": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementIds = args.elementIds as string[];
      const axis = args.axis as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const targets = elementIds
        .map((id) => slide.elements.find((e) => e.id === id))
        .filter((e): e is SlideElement => !!e);
      if (targets.length < 3) {
        return `ERROR: distribute_elements needs at least 3 valid elements. Got ${targets.length}.`;
      }
      const items = targets.map((e) => ({
        id: e.id,
        x: e.position.x,
        y: e.position.y,
        w: (e.size as { w?: number }).w ?? 0,
        h: (e.size as { h?: number }).h ?? 0,
      }));
      if (axis === "horizontal") {
        items.sort((a, b) => a.x - b.x);
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const totalW = items.reduce((sum, it) => sum + it.w, 0);
        const span = last.x + last.w - first.x;
        const gap = (span - totalW) / (items.length - 1);
        let cursor = first.x;
        for (const it of items) {
          store.updateElement(slideId, it.id, { position: { x: cursor, y: it.y } });
          cursor += it.w + gap;
        }
      } else if (axis === "vertical") {
        items.sort((a, b) => a.y - b.y);
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const totalH = items.reduce((sum, it) => sum + it.h, 0);
        const span = last.y + last.h - first.y;
        const gap = (span - totalH) / (items.length - 1);
        let cursor = first.y;
        for (const it of items) {
          store.updateElement(slideId, it.id, { position: { x: it.x, y: cursor } });
          cursor += it.h + gap;
        }
      } else {
        return `ERROR: Unknown axis "${axis}". Use horizontal|vertical.`;
      }
      return `Distributed ${items.length} elements (${axis}) on slide "${slideId}".`;
    }
    case "find_elements": {
      if (!deck) return "No deck loaded.";
      const filterType = args.type as string | undefined;
      const textContains = (args.textContains as string | undefined)?.toLowerCase();
      const slideRange = args.slideRange as [number, number] | undefined;
      const startIdx = slideRange ? Math.max(0, slideRange[0] - 1) : 0;
      const endIdx = slideRange ? Math.min(deck.slides.length, slideRange[1]) : deck.slides.length;
      const matches: Array<{ slideId: string; elementId: string; type: string; preview: string }> = [];
      for (let i = startIdx; i < endIdx; i++) {
        const slide = deck.slides[i]!;
        for (const el of slide.elements) {
          if (filterType && el.type !== filterType) continue;
          let preview = "";
          if (el.type === "text" || el.type === "code") {
            preview = (el as { content: string }).content.slice(0, 60);
            if (textContains && !preview.toLowerCase().includes(textContains)) continue;
          } else if (el.type === "image") {
            preview = (el as { alt?: string }).alt ?? "<no alt>";
            if (textContains && !preview.toLowerCase().includes(textContains)) continue;
          } else {
            if (textContains) continue;
          }
          matches.push({ slideId: slide.id, elementId: el.id, type: el.type, preview });
        }
      }
      return JSON.stringify({ matchCount: matches.length, matches }, null, 2);
    }
    case "get_slide_outline": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const outline = slide.elements.map((e) => {
        const w = (e.size as { w?: number }).w ?? 0;
        const h = (e.size as { h?: number }).h ?? 0;
        let preview = "";
        if (e.type === "text" || e.type === "code") {
          preview = (e as { content: string }).content.slice(0, 50).replace(/\s+/g, " ");
        } else if (e.type === "image") {
          preview = (e as { alt?: string }).alt ?? "";
        }
        return `${e.id} ${e.type} pos=(${e.position.x},${e.position.y}) size=(${w}x${h})${preview ? ` "${preview}"` : ""}`;
      });
      return outline.join("\n");
    }
    case "validate_deck": {
      if (!deck) return "No deck loaded.";
      const result = validateDeck(deck);
      if (result.issues.length === 0) return "OK: deck passes structural validation.";
      return `Found ${result.issues.length} issue(s):\n${result.issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
    }
    case "bring_to_front": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      store.bringToFront(slideId, elementId);
      return `Element "${elementId}" raised to front on slide "${slideId}".`;
    }
    case "send_to_back": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      store.sendToBack(slideId, elementId);
      return `Element "${elementId}" sent to back on slide "${slideId}".`;
    }
    case "set_speaker_notes": {
      const slideId = args.slideId as string;
      const notes = args.notes as string;
      store.updateSlide(slideId, { notes });
      return `Speaker notes set on slide "${slideId}" (${notes.length} chars).`;
    }
    case "set_deck_meta": {
      if (!deck) return "No deck loaded.";
      const patch: Partial<Deck["meta"]> = {};
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.author === "string") patch.author = args.author;
      if (args.aspectRatio === "16:9" || args.aspectRatio === "4:3") {
        patch.aspectRatio = args.aspectRatio;
      }
      if (Object.keys(patch).length === 0) {
        return "ERROR: set_deck_meta called with no recognized fields. Use title, author, or aspectRatio.";
      }
      store.replaceDeck({ ...deck, meta: { ...deck.meta, ...patch } });
      return `Deck meta updated: ${Object.keys(patch).join(", ")}.`;
    }
    case "generate_image_caption": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const summary = await captionImageNow(slideId, elementId);
      if (summary === null) {
        return `ERROR: could not caption element "${elementId}" on slide "${slideId}". Possible reasons: no API key, element missing, image src unreachable, or permanently failed prior attempt.`;
      }
      return `Caption for "${elementId}": ${summary}`;
    }
    case "apply_style_to_all": {
      if (!deck) return "No deck loaded.";
      const filter = (args.filter as Record<string, unknown>) ?? {};
      const stylePatch = (args.stylePatch as Record<string, unknown>) ?? {};
      const filterType = filter.type as string | undefined;
      const slideRange = filter.slideRange as [number, number] | undefined;
      const minFontSize = filter.minFontSize as number | undefined;
      const maxFontSize = filter.maxFontSize as number | undefined;
      const startIdx = slideRange ? Math.max(0, slideRange[0] - 1) : 0;
      const endIdx = slideRange ? Math.min(deck.slides.length, slideRange[1]) : deck.slides.length;
      let updated = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const slide = deck.slides[i]!;
        for (const el of slide.elements) {
          if (filterType && el.type !== filterType) continue;
          if (el.type === "text" && (minFontSize !== undefined || maxFontSize !== undefined)) {
            const fs = (el as { style?: { fontSize?: number } }).style?.fontSize ?? 0;
            if (minFontSize !== undefined && fs < minFontSize) continue;
            if (maxFontSize !== undefined && fs > maxFontSize) continue;
          }
          const currentStyle = (el as { style?: Record<string, unknown> }).style ?? {};
          store.updateElement(slide.id, el.id, {
            style: { ...currentStyle, ...stylePatch },
          } as Partial<SlideElement>);
          updated++;
        }
      }
      return `Updated style on ${updated} element(s).`;
    }
    case "check_overlaps": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const boxes = slide.elements.map((e) => ({
        id: e.id,
        type: e.type,
        x: e.position.x,
        y: e.position.y,
        w: (e.size as { w?: number }).w ?? 0,
        h: (e.size as { h?: number }).h ?? 0,
        groupId: (e as { groupId?: string }).groupId,
      }));
      const overlaps: Array<{ a: string; b: string; reason: string }> = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const intersects =
            a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          if (!intersects) continue;
          // Grouped elements intentionally overlap — skip
          if (a.groupId && a.groupId === b.groupId) continue;
          overlaps.push({ a: a.id, b: b.id, reason: `${a.type} and ${b.type} bounding boxes intersect` });
        }
      }
      if (overlaps.length === 0) return `No overlaps on slide "${slideId}".`;
      return `Found ${overlaps.length} overlap(s):\n${overlaps.map((o) => `- ${o.a} ↔ ${o.b} (${o.reason})`).join("\n")}`;
    }
    case "check_contrast": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const slideBg =
        (slide.background as { color?: string } | undefined)?.color ??
        (deck.theme?.slide?.background as { color?: string } | undefined)?.color ??
        "#0f172a";
      const issues: string[] = [];
      for (const el of slide.elements) {
        if (el.type !== "text") continue;
        const color = (el as { style?: { color?: string } }).style?.color ?? "#ffffff";
        const ratio = contrastRatio(color, slideBg);
        if (ratio < 4.5) {
          issues.push(`- ${el.id}: ${color} on ${slideBg} → ratio ${ratio.toFixed(2)} (WCAG AA requires ≥ 4.5)`);
        }
      }
      if (issues.length === 0) return `All text on slide "${slideId}" passes WCAG AA contrast.`;
      return `Low-contrast text on slide "${slideId}":\n${issues.join("\n")}`;
    }
    case "lint_slide": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const problems: string[] = [];
      // Out-of-bounds
      for (const el of slide.elements) {
        const w = (el.size as { w?: number }).w ?? 0;
        const h = (el.size as { h?: number }).h ?? 0;
        if (el.position.x < 0 || el.position.y < 0 || el.position.x + w > 960 || el.position.y + h > 540) {
          problems.push(`${el.id}: out of 960x540 bounds at (${el.position.x},${el.position.y}) ${w}x${h}`);
        }
      }
      // Empty text
      for (const el of slide.elements) {
        if (el.type === "text" && !(el as { content: string }).content.trim()) {
          problems.push(`${el.id}: empty text element`);
        }
      }
      // Missing title
      const hasTitle = slide.elements.some(
        (e) => e.type === "text" && /^\s*#\s+/.test((e as { content: string }).content),
      );
      if (!hasTitle) problems.push(`no '#'-prefixed title element`);
      // Overlaps (reuse logic, but inline for speed)
      const boxes = slide.elements.map((e) => ({
        id: e.id,
        type: e.type,
        x: e.position.x,
        y: e.position.y,
        w: (e.size as { w?: number }).w ?? 0,
        h: (e.size as { h?: number }).h ?? 0,
        groupId: (e as { groupId?: string }).groupId,
      }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.groupId && a.groupId === b.groupId) continue;
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
            problems.push(`overlap: ${a.id} ↔ ${b.id}`);
          }
        }
      }
      // Contrast (text only)
      const slideBg =
        (slide.background as { color?: string } | undefined)?.color ??
        (deck.theme?.slide?.background as { color?: string } | undefined)?.color ??
        "#0f172a";
      for (const el of slide.elements) {
        if (el.type !== "text") continue;
        const color = (el as { style?: { color?: string } }).style?.color ?? "#ffffff";
        const ratio = contrastRatio(color, slideBg);
        if (ratio < 4.5) {
          problems.push(`low contrast: ${el.id} ratio ${ratio.toFixed(2)}`);
        }
      }
      if (problems.length === 0) return `lint_slide "${slideId}": OK (${slide.elements.length} elements).`;
      return `lint_slide "${slideId}" found ${problems.length} issue(s):\n${problems.map((p) => `- ${p}`).join("\n")}`;
    }
    case "snapshot": {
      if (!deck) return "No deck loaded.";
      const label = args.label as string;
      snapshots.set(label, JSON.parse(JSON.stringify(deck)));
      return `Snapshot "${label}" saved (${deck.slides.length} slides).`;
    }
    case "restore": {
      const label = args.label as string;
      const saved = snapshots.get(label);
      if (!saved) return `ERROR: Snapshot "${label}" not found. Available: ${[...snapshots.keys()].join(", ") || "(none)"}`;
      store.replaceDeck(JSON.parse(JSON.stringify(saved)));
      return `Restored snapshot "${label}" (${saved.slides.length} slides).`;
    }
    case "list_snapshots": {
      if (snapshots.size === 0) return "No snapshots.";
      return `Snapshots: ${[...snapshots.keys()].join(", ")}`;
    }
    case "undo": {
      const temporal = useDeckStore.temporal.getState();
      if (temporal.pastStates.length === 0) return "Nothing to undo.";
      temporal.undo();
      return `Undid last change. ${temporal.pastStates.length} step(s) remain in history.`;
    }
    case "redo": {
      const temporal = useDeckStore.temporal.getState();
      if (temporal.futureStates.length === 0) return "Nothing to redo.";
      temporal.redo();
      return `Redid change. ${temporal.futureStates.length} redo step(s) remain.`;
    }
    case "merge_slides": {
      if (!deck) return "No deck loaded.";
      const targetId = args.targetSlideId as string;
      const sourceIds = (args.sourceSlideIds as string[]).filter((id) => id !== targetId);
      const target = deck.slides.find((s) => s.id === targetId);
      if (!target) return `ERROR: target slide "${targetId}" not found.`;
      const sources = sourceIds
        .map((id) => deck.slides.find((s) => s.id === id))
        .filter((s): s is Slide => !!s);
      if (sources.length === 0) return `ERROR: no valid source slides.`;
      // Compute base y-offset: start below existing target elements
      let baseY = target.elements.reduce(
        (max, el) => Math.max(max, el.position.y + ((el.size as { h?: number }).h ?? 0)),
        0,
      );
      baseY += 20;
      const usedIds = new Set<string>(target.elements.map((e) => e.id));
      for (const s of deck.slides) for (const el of s.elements) usedIds.add(el.id);
      const mergedElements: SlideElement[] = [...target.elements];
      for (const src of sources) {
        const srcMinY = src.elements.length > 0
          ? Math.min(...src.elements.map((e) => e.position.y))
          : 0;
        const srcMaxY = src.elements.length > 0
          ? Math.max(...src.elements.map((e) => e.position.y + ((e.size as { h?: number }).h ?? 0)))
          : 0;
        const dy = baseY - srcMinY;
        for (const el of src.elements) {
          let newId = `${el.id}_from_${src.id}`;
          let suffix = 2;
          while (usedIds.has(newId)) newId = `${el.id}_from_${src.id}_${suffix++}`;
          usedIds.add(newId);
          mergedElements.push({
            ...el,
            id: newId,
            position: { x: el.position.x, y: el.position.y + dy },
          });
        }
        baseY += (srcMaxY - srcMinY) + 20;
      }
      store.updateSlide(targetId, { elements: mergedElements });
      for (const src of sources) store.deleteSlide(src.id);
      return `Merged ${sources.length} slide(s) into "${targetId}" (${mergedElements.length} elements total).`;
    }
    case "split_slide": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const pivotId = args.pivotElementId as string;
      const newSlideId = args.newSlideId as string;
      const sourceIdx = deck.slides.findIndex((s) => s.id === slideId);
      if (sourceIdx === -1) return `ERROR: slide "${slideId}" not found.`;
      if (deck.slides.some((s) => s.id === newSlideId)) {
        return `ERROR: new slide ID "${newSlideId}" already exists.`;
      }
      const source = deck.slides[sourceIdx]!;
      const pivotIdx = source.elements.findIndex((e) => e.id === pivotId);
      if (pivotIdx === -1) return `ERROR: pivot element "${pivotId}" not found on slide "${slideId}".`;
      const keepElements = source.elements.slice(0, pivotIdx);
      const movedElements = source.elements.slice(pivotIdx);
      if (keepElements.length === 0 || movedElements.length === 0) {
        return `ERROR: split would leave one side empty. Choose a pivot that keeps at least one element on each side.`;
      }
      // Rename moved elements to avoid ID conflicts across slides
      const usedIds = new Set<string>();
      for (const s of deck.slides) for (const el of s.elements) usedIds.add(el.id);
      for (const el of keepElements) usedIds.add(el.id);
      const renamed = movedElements.map((el) => {
        let newId = `${el.id}_${newSlideId}`;
        let suffix = 2;
        while (usedIds.has(newId)) newId = `${el.id}_${newSlideId}_${suffix++}`;
        usedIds.add(newId);
        return { ...el, id: newId };
      });
      store.updateSlide(slideId, { elements: keepElements });
      const newSlide: Slide = {
        id: newSlideId,
        elements: renamed,
        notes: source.notes,
      };
      store.addSlide(newSlide, sourceIdx);
      return `Split "${slideId}" at "${pivotId}". Kept ${keepElements.length} elements; moved ${renamed.length} to new slide "${newSlideId}".`;
    }
    case "change_z_order": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const delta = args.delta as number;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const fromIdx = slide.elements.findIndex((e) => e.id === elementId);
      if (fromIdx === -1) return `Element "${elementId}" not found in slide "${slideId}".`;
      const toIdx = Math.max(0, Math.min(slide.elements.length - 1, fromIdx + delta));
      if (toIdx === fromIdx) return `Element "${elementId}" already at the requested z-order.`;
      store.moveElementOrder(slideId, fromIdx, toIdx);
      return `Element "${elementId}" z-order: ${fromIdx} -> ${toIdx}.`;
    }
    case "list_slide_titles": {
      if (!deck) return "No deck loaded.";
      const titles = deck.slides.map((s, i) => {
        const title = extractSlideTitle(s) ?? "<no title>";
        return `${i + 1}. [${s.id}] ${title}`;
      });
      return titles.join("\n");
    }
    case "search_text": {
      if (!deck) return "No deck loaded.";
      const query = (args.query as string).toLowerCase();
      const includeNotes = args.includeNotes as boolean | undefined;
      if (!query) return "ERROR: empty query.";
      const matches: Array<{ slideId: string; location: string; snippet: string }> = [];
      for (const slide of deck.slides) {
        if (includeNotes && slide.notes && slide.notes.toLowerCase().includes(query)) {
          const idx = slide.notes.toLowerCase().indexOf(query);
          matches.push({
            slideId: slide.id,
            location: "notes",
            snippet: slide.notes.slice(Math.max(0, idx - 20), idx + query.length + 20),
          });
        }
        for (const el of slide.elements) {
          let haystack = "";
          let where = "";
          if (el.type === "text" || el.type === "code") {
            haystack = (el as { content: string }).content;
            where = `${el.id} (${el.type})`;
          } else if (el.type === "image") {
            const img = el as { alt?: string; caption?: string };
            haystack = `${img.alt ?? ""} ${img.caption ?? ""}`;
            where = `${el.id} (image alt/caption)`;
          }
          if (haystack.toLowerCase().includes(query)) {
            const idx = haystack.toLowerCase().indexOf(query);
            matches.push({
              slideId: slide.id,
              location: where,
              snippet: haystack.slice(Math.max(0, idx - 20), idx + query.length + 20).replace(/\s+/g, " "),
            });
          }
        }
      }
      if (matches.length === 0) return `No matches for "${query}".`;
      return `${matches.length} match(es):\n${matches.map((m) => `- [${m.slideId}] ${m.location}: "${m.snippet}"`).join("\n")}`;
    }
    case "count_elements": {
      if (!deck) return "No deck loaded.";
      const slideRange = args.slideRange as [number, number] | undefined;
      const startIdx = slideRange ? Math.max(0, slideRange[0] - 1) : 0;
      const endIdx = slideRange ? Math.min(deck.slides.length, slideRange[1]) : deck.slides.length;
      const counts: Record<string, number> = {};
      let total = 0;
      for (let i = startIdx; i < endIdx; i++) {
        for (const el of deck.slides[i]!.elements) {
          counts[el.type] = (counts[el.type] ?? 0) + 1;
          total++;
        }
      }
      const scope = slideRange ? `slides ${slideRange[0]}-${slideRange[1]}` : "whole deck";
      const breakdown = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `  ${type}: ${n}`)
        .join("\n");
      return `${total} elements across ${scope}:\n${breakdown}`;
    }
    case "duplicate_element": {
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      store.duplicateElement(slideId, elementId);
      return `Element "${elementId}" duplicated on slide "${slideId}".`;
    }
    case "reorder_slides": {
      if (!deck) return "No deck loaded.";
      const order = args.order as string[];
      if (order.length !== deck.slides.length) {
        return `ERROR: reorder_slides expected ${deck.slides.length} IDs, got ${order.length}. Pass every slide ID exactly once.`;
      }
      const existingIds = new Set(deck.slides.map((s) => s.id));
      for (const id of order) {
        if (!existingIds.has(id)) return `ERROR: unknown slide ID "${id}".`;
      }
      if (new Set(order).size !== order.length) {
        return `ERROR: reorder_slides contains duplicate slide IDs.`;
      }
      const reordered = order.map((id) => deck.slides.find((s) => s.id === id)!);
      store.replaceDeck({ ...deck, slides: reordered });
      return `Reordered ${order.length} slides.`;
    }
    case "move_slide": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const toIndex = args.toIndex as number;
      const fromIndex = deck.slides.findIndex((s) => s.id === slideId);
      if (fromIndex === -1) return `ERROR: slide "${slideId}" not found.`;
      const clamped = Math.max(0, Math.min(deck.slides.length - 1, toIndex));
      if (clamped === fromIndex) return `Slide "${slideId}" already at index ${clamped}.`;
      store.moveSlide(fromIndex, clamped);
      return `Slide "${slideId}" moved ${fromIndex} -> ${clamped}.`;
    }
    case "set_slide_background": {
      const slideId = args.slideId as string;
      const bg: { color?: string; image?: string } = {};
      if (typeof args.color === "string") bg.color = args.color;
      if (typeof args.image === "string") bg.image = args.image;
      if (Object.keys(bg).length === 0) {
        return `ERROR: set_slide_background needs at least color or image.`;
      }
      store.updateSlide(slideId, { background: bg });
      return `Background set on slide "${slideId}" (${Object.keys(bg).join(", ")}).`;
    }
    case "apply_theme": {
      const themePatch = args.themePatch as Record<string, unknown>;
      if (!themePatch || typeof themePatch !== "object") {
        return `ERROR: themePatch must be an object.`;
      }
      const allowedBuckets = new Set([
        "slide", "text", "code", "shape", "image", "video",
        "tikz", "mermaid", "table", "scene3d",
      ]);
      const filtered: Record<string, unknown> = {};
      const rejected: string[] = [];
      for (const [k, v] of Object.entries(themePatch)) {
        if (allowedBuckets.has(k) && v && typeof v === "object") {
          filtered[k] = v;
        } else {
          rejected.push(k);
        }
      }
      if (Object.keys(filtered).length === 0) {
        return `ERROR: no valid theme buckets in patch. Allowed: ${[...allowedBuckets].join(", ")}.`;
      }
      store.updateTheme(filtered as Parameters<typeof store.updateTheme>[0]);
      const note = rejected.length > 0 ? ` (rejected: ${rejected.join(", ")})` : "";
      return `Theme updated: ${Object.keys(filtered).join(", ")}${note}.`;
    }
    case "set_image_alt": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const alt = args.alt as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!element || element.type !== "image") {
        return `ERROR: element "${elementId}" on slide "${slideId}" is not an image.`;
      }
      store.updateElement(slideId, elementId, { alt } as Partial<SlideElement>);
      return `Alt text set on "${elementId}": "${alt.slice(0, 60)}${alt.length > 60 ? "..." : ""}".`;
    }
    case "add_comment": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const text = args.text as string;
      const elementId = args.elementId as string | undefined;
      const category = args.category as string | undefined;
      const validCategories = ["content", "design", "bug", "todo", "question", "done"] as const;
      const finalCategory = category && (validCategories as readonly string[]).includes(category)
        ? (category as typeof validCategories[number])
        : undefined;
      const comment = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        elementId,
        category: finalCategory,
        createdAt: Date.now(),
      };
      store.addComment(slideId, comment);
      return `Comment "${comment.id}" added to slide "${slideId}"${elementId ? ` (element ${elementId})` : ""}.`;
    }
    case "resolve_comment": {
      const slideId = args.slideId as string;
      const commentId = args.commentId as string;
      store.updateComment(slideId, commentId, { category: "done" });
      return `Comment "${commentId}" marked done.`;
    }
    case "crop_image": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const elementId = args.elementId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!element || element.type !== "image") {
        return `ERROR: element "${elementId}" on slide "${slideId}" is not an image.`;
      }
      const clamp = (v: unknown): number => {
        const n = typeof v === "number" ? v : 0;
        return Math.max(0, Math.min(0.95, n));
      };
      const crop = {
        top: clamp(args.top),
        right: clamp(args.right),
        bottom: clamp(args.bottom),
        left: clamp(args.left),
      };
      if (crop.top + crop.bottom >= 1 || crop.left + crop.right >= 1) {
        return `ERROR: crop would leave zero visible area. Ensure top+bottom < 1 and left+right < 1.`;
      }
      const currentStyle = (element as { style?: Record<string, unknown> }).style ?? {};
      store.updateElement(slideId, elementId, {
        style: { ...currentStyle, crop },
      } as Partial<SlideElement>);
      return `Cropped "${elementId}": top ${crop.top} right ${crop.right} bottom ${crop.bottom} left ${crop.left}.`;
    }
    case "diff_against_snapshot": {
      if (!deck) return "No deck loaded.";
      const label = args.label as string;
      const saved = snapshots.get(label);
      if (!saved) return `ERROR: snapshot "${label}" not found.`;
      const savedSlideIds = new Set(saved.slides.map((s) => s.id));
      const currentSlideIds = new Set(deck.slides.map((s) => s.id));
      const added = [...currentSlideIds].filter((id) => !savedSlideIds.has(id));
      const removed = [...savedSlideIds].filter((id) => !currentSlideIds.has(id));
      const modified: string[] = [];
      for (const slide of deck.slides) {
        const prior = saved.slides.find((s) => s.id === slide.id);
        if (!prior) continue;
        if (JSON.stringify(prior) !== JSON.stringify(slide)) {
          const priorN = prior.elements.length;
          const nowN = slide.elements.length;
          modified.push(`${slide.id} (${priorN} -> ${nowN} elements)`);
        }
      }
      const lines = [
        `Diff vs snapshot "${label}":`,
        `  added slides: ${added.length === 0 ? "none" : added.join(", ")}`,
        `  removed slides: ${removed.length === 0 ? "none" : removed.join(", ")}`,
        `  modified slides: ${modified.length === 0 ? "none" : modified.join(", ")}`,
      ];
      return lines.join("\n");
    }
    case "add_animation": {
      const slideId = args.slideId as string;
      const target = args.target as string;
      const effect = args.effect as string;
      const trigger = args.trigger as string;
      const duration = typeof args.duration === "number" ? args.duration : undefined;
      const delay = typeof args.delay === "number" ? args.delay : undefined;
      const validEffects = [
        "fadeIn", "fadeOut", "slideInLeft", "slideInRight", "slideInUp", "slideInDown",
        "scaleIn", "scaleOut", "typewriter", "scene3dStep", "playVideo",
      ];
      const validTriggers = ["onEnter", "onClick", "onKey", "afterPrevious", "withPrevious"];
      if (!validEffects.includes(effect)) {
        return `ERROR: unknown effect "${effect}". Valid: ${validEffects.join(", ")}.`;
      }
      if (!validTriggers.includes(trigger)) {
        return `ERROR: unknown trigger "${trigger}". Valid: ${validTriggers.join(", ")}.`;
      }
      const animation = {
        target,
        effect: effect as Parameters<typeof store.addAnimation>[1]["effect"],
        trigger: trigger as Parameters<typeof store.addAnimation>[1]["trigger"],
        ...(duration !== undefined ? { duration } : {}),
        ...(delay !== undefined ? { delay } : {}),
      };
      store.addAnimation(slideId, animation);
      return `Animation added to slide "${slideId}": ${trigger} ${effect} on ${target}.`;
    }
    case "update_animation": {
      const slideId = args.slideId as string;
      const index = args.index as number;
      const patch = args.patch as Record<string, unknown>;
      store.updateAnimation(slideId, index, patch as Parameters<typeof store.updateAnimation>[2]);
      return `Animation [${index}] on slide "${slideId}" patched.`;
    }
    case "delete_animation": {
      const slideId = args.slideId as string;
      const index = args.index as number;
      store.deleteAnimation(slideId, index);
      return `Animation [${index}] deleted from slide "${slideId}".`;
    }
    case "reorder_animations": {
      const slideId = args.slideId as string;
      const fromIndex = args.fromIndex as number;
      const toIndex = args.toIndex as number;
      store.moveAnimation(slideId, fromIndex, toIndex);
      return `Animation moved from [${fromIndex}] to [${toIndex}] on slide "${slideId}".`;
    }
    case "list_animations": {
      if (!deck) return "No deck loaded.";
      const slideId = args.slideId as string;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return `Slide "${slideId}" not found.`;
      const anims = slide.animations ?? [];
      if (anims.length === 0) return `No animations on slide "${slideId}".`;
      const lines = anims.map((a, i) => {
        const timing = [
          a.delay !== undefined ? `delay ${a.delay}ms` : null,
          a.duration !== undefined ? `duration ${a.duration}ms` : null,
        ].filter(Boolean).join(" ");
        return `  [${i}] ${a.trigger} ${a.effect} -> ${a.target}${timing ? ` (${timing})` : ""}`;
      });
      return `${anims.length} animation(s) on slide "${slideId}":\n${lines.join("\n")}`;
    }
    case "import_outline": {
      if (!deck) return "No deck loaded. Use create_deck first.";
      const markdown = args.markdown as string;
      const mode = (args.mode as string) ?? "append";
      const parsed = parseOutline(markdown);
      if (parsed.length === 0) {
        return `ERROR: outline contained no top-level '# heading' slides.`;
      }
      // Build Slide objects
      const existingSlideIds = new Set(
        mode === "replace" ? [] : deck.slides.map((s) => s.id),
      );
      const newSlides: Slide[] = parsed.map((block, i) => {
        let baseId = `imported-${Date.now()}-${i + 1}`;
        while (existingSlideIds.has(baseId)) baseId += "_";
        existingSlideIds.add(baseId);
        const titleEl: SlideElement = {
          id: `${baseId}-title`,
          type: "text",
          content: `# ${block.title}`,
          position: { x: 60, y: 40 },
          size: { w: 840, h: 80 },
          style: { fontSize: 36, color: "#f8fafc" },
        } as SlideElement;
        const elements: SlideElement[] = [titleEl];
        if (block.body.trim()) {
          elements.push({
            id: `${baseId}-body`,
            type: "text",
            content: block.body.trim(),
            position: { x: 60, y: 140 },
            size: { w: 840, h: 360 },
            style: { fontSize: 22, color: "#e2e8f0" },
          } as SlideElement);
        }
        return { id: baseId, elements };
      });
      if (mode === "replace") {
        store.replaceDeck({ ...deck, slides: newSlides });
      } else {
        for (const slide of newSlides) store.addSlide(slide);
      }
      return `Imported ${newSlides.length} slide(s) in '${mode}' mode.`;
    }
    case "duplicate_slide": {
      if (!deck) return "No deck loaded.";
      const sourceId = args.slideId as string;
      const newId = args.newSlideId as string;
      const sourceIdx = deck.slides.findIndex((s) => s.id === sourceId);
      if (sourceIdx === -1) return `ERROR: source slide "${sourceId}" not found.`;
      if (deck.slides.some((s) => s.id === newId)) {
        return `ERROR: new slide ID "${newId}" already exists.`;
      }
      const source = deck.slides[sourceIdx]!;
      const usedElementIds = new Set<string>();
      for (const s of deck.slides) for (const el of s.elements) usedElementIds.add(el.id);
      const cloned: Slide = JSON.parse(JSON.stringify(source));
      cloned.id = newId;
      cloned.elements = cloned.elements.map((el) => {
        const baseId = el.id.replace(/_\d+$/, "");
        let candidate = `${baseId}_${newId}`;
        let suffix = 2;
        while (usedElementIds.has(candidate)) {
          candidate = `${baseId}_${newId}_${suffix++}`;
        }
        usedElementIds.add(candidate);
        return { ...el, id: candidate };
      });
      store.addSlide(cloned, sourceIdx);
      return `Slide "${newId}" duplicated from "${sourceId}" with ${cloned.elements.length} elements.`;
    }
    case "list_project_files": {
      const projectName = args.projectName as string;
      const path = args.path as string | undefined;
      const files = await useProjectRefStore.getState().listFiles(projectName, path);
      return JSON.stringify(files, null, 2);
    }
    case "read_project_file": {
      const projectName = args.projectName as string;
      const filePath = args.filePath as string;
      const content = await useProjectRefStore.getState().readFile(projectName, filePath);
      return content;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------- Multimodal helpers ----------

/**
 * Build Gemini Part[] for image elements attached via the Context Bar.
 * Looks up each attached image element in the deck, downscales it, and returns
 * inlineData parts. Limited to MAX_ATTACHED_IMAGES to keep token cost bounded.
 *
 * Returns an empty array when no image elements are attached. Errors during
 * downscaling are logged and skipped — a missing image should not block the
 * pipeline.
 */
async function buildAttachedImageParts(
  context: ContextBarSnapshot | undefined,
  deck: Deck | null,
  onLog: (msg: string) => void,
): Promise<Part[]> {
  if (!context || !deck) return [];
  const imageRefs = context.elements.filter((e) => e.type === "image").slice(0, MAX_ATTACHED_IMAGES);
  if (imageRefs.length === 0) return [];

  const parts: Part[] = [];
  for (const ref of imageRefs) {
    const slide = deck.slides.find((s) => s.id === ref.slideId);
    const element = slide?.elements.find((el) => el.id === ref.elementId);
    if (!element || element.type !== "image") continue;
    const img = element as ImageElement;
    try {
      const downscaled = await downscaleImage(img.src);
      parts.push({
        inlineData: {
          mimeType: downscaled.mimeType,
          data: downscaled.base64,
        },
      });
      onLog(`[multimodal] attached ${ref.elementId} (${downscaled.width}x${downscaled.height}, ${(downscaled.bytes / 1024).toFixed(0)}KB ${downscaled.mimeType})`);
    } catch (err) {
      onLog(`[multimodal] skipped ${ref.elementId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return parts;
}

/** Wrap a text message and optional image parts into a single Part[] payload. */
function buildMessagePayload(text: string, imageParts: Part[]): string | Part[] {
  if (imageParts.length === 0) return text;
  return [{ text }, ...imageParts];
}

/** Normalize a message (string or Part[]) into Part[] for history entries. */
function messagePartsForHistory(message: string | Part[]): Part[] {
  if (typeof message === "string") return [{ text: message }];
  return message;
}

// ---------- Agent Call with Tool Loop ----------

async function callAgentWithTools(
  model: GeminiModel,
  systemPrompt: string,
  tools: TekkalTool[],
  message: string,
  history: Content[],
  onLog: (msg: string) => void,
  initialImageParts: Part[] = [],
): Promise<string> {
  const geminiTools = buildFunctionDeclarations(tools);
  let currentHistory = [...history];
  let currentMessage: string | Part[] = buildMessagePayload(message, initialImageParts);
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
          { role: "user", parts: messagePartsForHistory(currentMessage) },
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
        const result = await executeTool(fc.name, fc.args);
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
      { role: "user", parts: messagePartsForHistory(currentMessage) },
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
  context?: ContextBarSnapshot,
): Promise<PlanResult | null> {
  cb.onStageChange("plan");
  cb.onLog("Analyzing intent and creating plan...");

  const deck = useDeckStore.getState().deck;
  const prompt = buildPlannerPrompt(deck, context);

  // Convert chat history to Gemini Content format
  const history: Content[] = (chatHistory ?? []).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));
  // Gemini requires history to start with "user" role — drop leading model messages
  while (history.length > 0 && history[0]!.role !== "user") {
    history.shift();
  }

  // If projects are referenced, give planner access to project file tools
  // so it can answer questions about project contents directly
  const hasProjects = context?.projectNames && context.projectNames.length > 0;
  const imageParts = await buildAttachedImageParts(context, deck, cb.onLog);
  let responseText: string;

  if (hasProjects) {
    const tools = [...plannerTools, ...projectFileTools];
    responseText = await callAgentWithTools(
      getModelForAgent("planner"),
      prompt,
      tools,
      userMessage,
      history,
      cb.onLog,
      imageParts,
    );
  } else {
    const response = await callGemini({
      model: getModelForAgent("planner"),
      systemInstruction: prompt,
      history,
      message: buildMessagePayload(userMessage, imageParts),
    });
    responseText = response.text;
  }

  try {
    // Clean response text - remove markdown code fences if present
    let text = responseText.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    return JSON.parse(text) as PlanResult;
  } catch {
    // When planner used tools (e.g. project file listing), it may return
    // free-form text instead of JSON. Wrap it as a "chat" intent response.
    if (hasProjects && responseText.trim().length > 0) {
      return {
        intent: "chat" as PipelineIntent,
        response: responseText.trim(),
        reasoning: "Planner explored reference project and returned a direct response.",
      };
    }
    cb.onError(`Planner returned invalid JSON: ${responseText.slice(0, 200)}`);
    return null;
  }
}

async function runGenerator(
  plan: PlanResult,
  cb: PipelineCallbacks,
  context?: ContextBarSnapshot,
): Promise<string> {
  cb.onStageChange("generate");

  const hasProjects = context?.projectNames && context.projectNames.length > 0;
  const tools = hasProjects ? [...generatorTools, ...projectFileTools] : generatorTools;

  // Modify intent: single call (no slide plan available)
  if (!plan.plan?.slides || plan.intent === "modify") {
    cb.onLog("Generating modifications...");
    const deck = useDeckStore.getState().deck;
    const prompt = buildGeneratorPrompt(deck, context);
    const planMessage = `Execute these modifications:\n${plan.actions?.join("\n")}`;
    const imageParts = await buildAttachedImageParts(context, deck, cb.onLog);
    return callAgentWithTools(
      getModelForAgent("generator"),
      prompt,
      tools,
      planMessage,
      [],
      cb.onLog,
      imageParts,
    );
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
      const contentPrompt = buildContentAgentPrompt(currentDeck, context);
      const contentMessage = `Create ONLY this one slide (do not create other slides):
${JSON.stringify(slidePlan, null, 2)}

${slideContext}
After calling add_slide, briefly confirm.`;

      cb.onLog(`  [content] Creating text/code/table elements... (gen ${genAttempt}/${maxGenAttempts})`);
      await callAgentWithTools(getModelForAgent("generator"), contentPrompt, tools, contentMessage, [], cb.onLog);
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
      const visualPrompt = buildVisualAgentPrompt(deckForVisual, context);
      const visualMessage = `REQUIRED: Add visual element(s) to slide ${slidePlan.id}. You MUST call add_element at least once. Do not finish without adding a visual element.

Required element types for this slide: ${visualTypes.join(", ")}
Slide plan: ${JSON.stringify(slidePlan, null, 2)}
${slideContext}

Steps:
1. Call read_slide("${slidePlan.id}") to see existing elements
2. Add the required visual element(s) in the RIGHT column: x:490, y:80, w:440, h:380
3. Do NOT create duplicate IDs. Use unique IDs like "${slidePlan.id}-visual-1"`;
      await callAgentWithTools(getModelForAgent("generator"), visualPrompt, tools, visualMessage, [], cb.onLog);
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

  const aiResponse = await callAgentWithTools(
    getModelForAgent("reviewer"),
    prompt,
    reviewerTools,
    message,
    [],
    cb.onLog,
  );

  // Post-fix re-validation guarantees we never report success without
  // verifying the reviewer actually resolved what it was asked to fix.
  // The reviewer can also call validate_deck during its tool loop, but
  // a forced final check is the authoritative answer.
  const postDeck = useDeckStore.getState().deck;
  if (!postDeck) return aiResponse;
  const postResult = validateDeck(postDeck);
  const before = localResult.issues.length;
  const after = postResult.issues.length;
  if (after === 0) {
    cb.onLog(`Post-fix validation: all ${before} issues resolved.`);
    return `${aiResponse}\n\n[validation] All ${before} issue(s) resolved.`;
  }
  const remaining = postResult.issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n");
  if (after < before) {
    cb.onLog(`Post-fix validation: ${before - after} of ${before} resolved, ${after} remaining.`);
    return `${aiResponse}\n\n[validation] ${before - after} of ${before} resolved. Remaining:\n${remaining}`;
  }
  cb.onLog(`Post-fix validation: ${after} issues remain (no net improvement).`);
  return `${aiResponse}\n\n[validation] ${after} issue(s) still present:\n${remaining}`;
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
  context?: ContextBarSnapshot,
): Promise<void> {
  try {
    // Stage 1: Plan
    const plan = await runPlanner(userMessage, cb, chatHistory, context);
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
      return runPipeline(enrichedMessage, cb, updatedHistory, context);
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
      const genResult = await runGenerator(plan, cb, context);
      cb.onLog(genResult);

      // Stage 3: Review
      const reviewResult = await runReviewer(cb);

      cb.onComplete(`Generation complete. ${reviewResult}`);
    }
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : String(err));
  }
}

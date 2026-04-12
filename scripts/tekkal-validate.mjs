#!/usr/bin/env node
// TEKKAL standalone deck.json validator.
//
// Usage:   node tekkal-validate.mjs <path-to-deck.json>
// Exit:    0 when valid, 1 when any error is found.
//
// This file is intentionally self-contained — no imports from the
// TEKKAL src/ tree. It is copied verbatim into agentic-tool project
// folders that do not have the TEKKAL repo checked out, so it must
// run on a stock Node.js install with no dependencies beyond the
// standard library.
//
// The check set is the union of src/ai/validation.ts and the
// extended checks in scripts/test-pipeline.mjs. Critical checks
// (CRITICAL severity, exit 1) cover the failure modes that crash
// the renderer or strip user content. WARN findings are reported
// but do not flip the exit code.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import process from "node:process";

const CANVAS_W = 960;
const CANVAS_H = 540;
const FORBIDDEN_TYPES = new Set(["mermaid", "iframe", "audio", "animation"]);

// Element types whose content is meaningful to render.
const VISUAL_TYPES = new Set(["shape"]);
const CONTENT_TYPES = new Set(["text", "table", "code"]);

// Asset paths the FsAccess and Vite adapters know how to resolve.
// Bare filenames or absent ./assets/ prefix render as nothing — the
// failure is silent because resolveAssetUrl rejects and useAssetUrl
// catches. Caught here as an error so the AI fix loop has a signal.
// Must stay in lockstep with src/ai/validation.ts VALID_ASSET_PATH_RE.
const VALID_ASSET_PATH_RE = /^(\.\/assets\/|\/assets\/|https?:\/\/|data:)/;

function fail(msg) {
  // Internal invariant violation in the validator itself — fail loud.
  // This is NOT how user-deck findings get reported; those go through
  // pushFinding() so they appear in the report and drive the exit code.
  throw new Error(`tekkal-validate internal error: ${msg}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────
// Finding accumulator
// ─────────────────────────────────────────────────────────────────

class FindingList {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(path, message) {
    this.errors.push({ path, message });
  }

  warn(path, message) {
    this.warnings.push({ path, message });
  }

  hasErrors() {
    return this.errors.length > 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// Top-level deck shape
// ─────────────────────────────────────────────────────────────────

function validateDeckShape(deck, findings) {
  if (!isPlainObject(deck)) {
    findings.error("(root)", "deck.json root must be a JSON object");
    return false;
  }
  if (!isPlainObject(deck.meta)) {
    findings.error("meta", "Missing or non-object `meta` field");
  } else {
    if (typeof deck.meta.title !== "string" || deck.meta.title.length === 0) {
      findings.error("meta.title", "Missing or empty title");
    }
    if (
      deck.meta.aspectRatio !== undefined &&
      deck.meta.aspectRatio !== "16:9" &&
      deck.meta.aspectRatio !== "4:3"
    ) {
      findings.warn(
        "meta.aspectRatio",
        `Unexpected aspectRatio "${deck.meta.aspectRatio}" — only "16:9" and "4:3" are rendered`,
      );
    }
  }
  if (!Array.isArray(deck.slides)) {
    findings.error("slides", "Missing or non-array `slides` field");
    return false;
  }
  if (deck.slides.length === 0) {
    findings.warn("slides", "Deck has zero slides");
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Per-element checks
// ─────────────────────────────────────────────────────────────────

function validateElement(el, slideIdx, elIdx, slideId, seenElementIds, findings) {
  const elPath = `slides[${slideIdx}].elements[${elIdx}]`;

  if (!isPlainObject(el)) {
    findings.error(elPath, "Element is not an object");
    return;
  }

  // ── id ──
  if (typeof el.id !== "string" || el.id.length === 0) {
    findings.error(`${elPath}.id`, "Missing or empty element id");
  } else {
    const prior = seenElementIds.get(el.id);
    if (prior) {
      findings.error(
        `${elPath}.id`,
        `Duplicate element id "${el.id}" — already used at ${prior}`,
      );
    } else {
      seenElementIds.set(el.id, `${elPath} (slide "${slideId}")`);
    }
  }

  // ── type ──
  if (typeof el.type !== "string" || el.type.length === 0) {
    findings.error(`${elPath}.type`, "Missing required `type` field");
    return;
  }
  if (FORBIDDEN_TYPES.has(el.type)) {
    findings.error(
      `${elPath}.type`,
      `Forbidden element type "${el.type}" — not supported by the renderer (use shape+text for diagrams, code for code)`,
    );
  }

  // ── position / size ──
  if (!isPlainObject(el.position)) {
    findings.error(`${elPath}.position`, "Missing or non-object `position` field");
  } else {
    if (typeof el.position.x !== "number" || typeof el.position.y !== "number") {
      findings.error(
        `${elPath}.position`,
        "position.x and position.y must be numbers",
      );
    }
  }
  if (!isPlainObject(el.size)) {
    findings.warn(`${elPath}.size`, "Missing or non-object `size` field");
  } else {
    if (typeof el.size.w !== "number" || typeof el.size.h !== "number") {
      findings.error(`${elPath}.size`, "size.w and size.h must be numbers");
    }
    if (
      isPlainObject(el.position) &&
      typeof el.position.x === "number" &&
      typeof el.size.w === "number"
    ) {
      if (el.position.x + el.size.w > CANVAS_W) {
        findings.warn(
          `${elPath}`,
          `Element overflows right edge: x(${el.position.x}) + w(${el.size.w}) = ${el.position.x + el.size.w} > ${CANVAS_W}`,
        );
      }
    }
    if (
      isPlainObject(el.position) &&
      typeof el.position.y === "number" &&
      typeof el.size.h === "number"
    ) {
      if (el.position.y + el.size.h > CANVAS_H) {
        findings.warn(
          `${elPath}`,
          `Element overflows bottom edge: y(${el.position.y}) + h(${el.size.h}) = ${el.position.y + el.size.h} > ${CANVAS_H}`,
        );
      }
    }
  }

  // ── shape ──
  if (el.type === "shape") {
    if (typeof el.shape !== "string" || el.shape.length === 0) {
      findings.error(`${elPath}.shape`, "shape element missing `shape` discriminator");
    } else if (el.shape === "line" || el.shape === "arrow") {
      // rotation is forbidden — direction must come from waypoints
      if (el.rotation !== undefined && el.rotation !== null && el.rotation !== 0) {
        findings.error(
          `${elPath}.rotation`,
          `${el.shape} shape has rotation field — direction must come from style.waypoints, not rotation (renderer asserts and crashes)`,
        );
      }
      // waypoints must live under style.waypoints as an array of {x, y}
      if (el.waypoints !== undefined) {
        findings.error(
          `${elPath}.waypoints`,
          `${el.shape} shape has top-level waypoints — must be nested under style.waypoints`,
        );
      }
      const wp = el.style && el.style.waypoints;
      if (!Array.isArray(wp) || wp.length < 2) {
        findings.error(
          `${elPath}.style.waypoints`,
          `${el.shape} shape requires style.waypoints as an array of at least 2 {x, y} points`,
        );
      } else {
        for (let i = 0; i < wp.length; i++) {
          const pt = wp[i];
          if (!isPlainObject(pt) || typeof pt.x !== "number" || typeof pt.y !== "number") {
            findings.error(
              `${elPath}.style.waypoints[${i}]`,
              `Waypoint must be an object {x: number, y: number} — got ${JSON.stringify(pt)}`,
            );
          }
        }
      }
    }
  }

  // ── image ──
  if (el.type === "image") {
    if (typeof el.src !== "string" || el.src.length === 0) {
      // Detect the common Gemini-CLI mistake: `url` instead of `src`
      if (typeof el.url === "string") {
        findings.error(
          `${elPath}.src`,
          `image element uses url instead of src — rename "url" to "src" (got "${el.url}")`,
        );
      } else {
        findings.error(`${elPath}.src`, "image element missing `src` field");
      }
    } else if (!VALID_ASSET_PATH_RE.test(el.src)) {
      findings.error(
        `${elPath}.src`,
        `image element src "${el.src}" must start with ./assets/, /assets/, http(s)://, or data: — bare filenames render as nothing`,
      );
    }
  }

  // ── video ──
  if (el.type === "video") {
    if (typeof el.src !== "string" || el.src.length === 0) {
      if (typeof el.url === "string") {
        findings.error(
          `${elPath}.src`,
          `video element uses url instead of src — rename "url" to "src" (got "${el.url}")`,
        );
      } else {
        findings.error(`${elPath}.src`, "video element missing `src` field");
      }
    } else if (!VALID_ASSET_PATH_RE.test(el.src)) {
      findings.error(
        `${elPath}.src`,
        `video element src "${el.src}" must start with ./assets/, /assets/, http(s)://, or data: — bare filenames render as nothing`,
      );
    }
  }

  // ── code ──
  if (el.type === "code") {
    if (typeof el.language !== "string" || el.language.length === 0) {
      findings.error(`${elPath}.language`, "code element missing `language` field");
    }
    if (typeof el.content !== "string") {
      findings.error(`${elPath}.content`, "code element missing `content` string");
    } else {
      const lineCount = el.content.split("\n").length;
      if (lineCount > 12) {
        findings.error(
          `${elPath}.content`,
          `code element has ${lineCount} lines — keep code blocks at 12 lines or fewer`,
        );
      }
    }
  }

  // ── table ──
  if (el.type === "table") {
    if (!Array.isArray(el.columns) || el.columns.length === 0) {
      findings.error(`${elPath}.columns`, "table element missing or empty `columns` array");
    }
    if (!Array.isArray(el.rows) || el.rows.length === 0) {
      findings.error(`${elPath}.rows`, "table element missing or empty `rows` array");
    }
  }

  // ── text ──
  if (el.type === "text") {
    if (typeof el.content !== "string") {
      findings.error(`${elPath}.content`, "text element missing `content` string");
    } else {
      // Strip \begin{...}...\end{...} blocks where \\ is valid (aligned, array, etc.)
      const stripped = el.content.replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, "");
      if (/\\\\/.test(stripped)) {
        findings.warn(
          `${elPath}.content`,
          "text element contains \\\\ outside a LaTeX environment — use \\begin{aligned} for multi-line math, single \\ for commands like \\pi",
        );
      }
      // **bold** inside $...$ math
      const mathRegions = el.content.match(/\$[^$\n]+\$/g) || [];
      for (const region of mathRegions) {
        if (region.includes("**")) {
          findings.warn(
            `${elPath}.content`,
            `text element has **bold** inside math: ${region.slice(0, 60)} (use \\mathbf{} instead)`,
          );
        }
      }
      const fontSize =
        isPlainObject(el.style) && typeof el.style.fontSize === "number"
          ? el.style.fontSize
          : undefined;
      if (fontSize !== undefined && (fontSize < 9 || fontSize > 72)) {
        findings.warn(
          `${elPath}.style.fontSize`,
          `font size ${fontSize} outside recommended [10, 72]`,
        );
      }
    }
  }

  // ── tikz ──
  if (el.type === "tikz") {
    if (typeof el.content !== "string") {
      findings.error(`${elPath}.content`, "tikz element missing `content` string");
    } else {
      // The content needs an explicit bounding box so the renderer can size it.
      // Both \path ... rectangle and \useasboundingbox ... rectangle satisfy this.
      const hasPath = el.content.includes("\\path");
      const hasRectangle = el.content.includes("rectangle");
      if (!hasPath || !hasRectangle) {
        findings.warn(
          `${elPath}.content`,
          "tikz element missing explicit bounding box (`\\path ... rectangle (...)` or `\\useasboundingbox ... rectangle (...)`); content may be clipped",
        );
      }
    }
  }

  // ── scene3d ──
  if (el.type === "scene3d") {
    if (!isPlainObject(el.scene)) {
      findings.error(`${elPath}.scene`, "scene3d element missing `scene` object");
    } else if (el.scene.orbitControls === true) {
      findings.warn(
        `${elPath}.scene.orbitControls`,
        "scene3d has orbitControls:true — grabs mouse events and breaks slide navigation",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Per-slide checks
// ─────────────────────────────────────────────────────────────────

function validateSlide(slide, slideIdx, seenSlideIds, seenElementIds, findings) {
  const slidePath = `slides[${slideIdx}]`;

  if (!isPlainObject(slide)) {
    findings.error(slidePath, "Slide is not an object");
    return;
  }

  if (typeof slide.id !== "string" || slide.id.length === 0) {
    findings.error(`${slidePath}.id`, "Missing or empty slide id");
  } else {
    if (seenSlideIds.has(slide.id)) {
      findings.error(`${slidePath}.id`, `Duplicate slide id "${slide.id}"`);
    }
    seenSlideIds.add(slide.id);
  }

  if (!Array.isArray(slide.elements)) {
    findings.error(`${slidePath}.elements`, "Missing or non-array `elements` field");
    return;
  }

  // Empty slide. Either bare-empty or notes-without-elements
  // (interrupted generation — the model wrote presenter notes but
  // never came back to add visible content). The notes-only case
  // gets a stronger message because it is essentially never
  // legitimate. This was the api3_1 benchmark deck failure mode.
  if (slide.elements.length === 0) {
    const notesText = typeof slide.notes === "string" ? slide.notes.trim() : "";
    const idLabel = slide.id || `(unnamed slide ${slideIdx})`;
    if (notesText.length > 0) {
      findings.error(
        `${slidePath}`,
        `Slide "${idLabel}" has presenter notes but no visible elements — looks like generation was interrupted; add the planned content elements (e.g. a "# Title" text element) before the slide can render`,
      );
    } else {
      findings.error(
        `${slidePath}`,
        `Slide "${idLabel}" has zero elements — add at least one text element with a "# Title" heading, or remove the slide if intentional`,
      );
    }
  }

  // Slide background image path format. Same rules as image/video
  // src — bare filenames render as nothing.
  const slideBg = isPlainObject(slide.background) ? slide.background : null;
  if (
    slideBg &&
    typeof slideBg.image === "string" &&
    slideBg.image.length > 0 &&
    !VALID_ASSET_PATH_RE.test(slideBg.image)
  ) {
    findings.error(
      `${slidePath}.background.image`,
      `Slide background image "${slideBg.image}" must start with ./assets/, /assets/, http(s)://, or data:`,
    );
  }

  for (let i = 0; i < slide.elements.length; i++) {
    validateElement(
      slide.elements[i],
      slideIdx,
      i,
      slide.id || `(unnamed slide ${slideIdx})`,
      seenElementIds,
      findings,
    );
  }

  // Slide-level overlap pass — runs the same exemption logic the
  // editor uses (shape-on-content allowed, label-on-box allowed,
  // intentional groupId stacking allowed). Anything else is reported
  // as a warning so the agent gets a chance to nudge it.
  const measurable = slide.elements.filter(
    (e) =>
      isPlainObject(e) &&
      isPlainObject(e.position) &&
      isPlainObject(e.size) &&
      typeof e.size.w === "number" &&
      typeof e.size.h === "number" &&
      e.size.w > 5 &&
      e.size.h > 5,
  );
  for (let a = 0; a < measurable.length; a++) {
    for (let b = a + 1; b < measurable.length; b++) {
      const ea = measurable[a];
      const eb = measurable[b];
      const ga = ea.groupId;
      const gb = eb.groupId;
      if (ga && ga === gb) continue;
      const ow =
        Math.min(ea.position.x + ea.size.w, eb.position.x + eb.size.w) -
        Math.max(ea.position.x, eb.position.x);
      const oh =
        Math.min(ea.position.y + ea.size.h, eb.position.y + eb.size.h) -
        Math.max(ea.position.y, eb.position.y);
      if (ow <= 20 || oh <= 20) continue;
      const areaA = ea.size.w * ea.size.h;
      const areaB = eb.size.w * eb.size.h;
      const pct = (ow * oh) / Math.min(areaA, areaB);
      const isShapeOnContent =
        (VISUAL_TYPES.has(ea.type) && CONTENT_TYPES.has(eb.type)) ||
        (CONTENT_TYPES.has(ea.type) && VISUAL_TYPES.has(eb.type));
      if (isShapeOnContent) continue;
      const ratio = Math.max(areaA, areaB) / Math.min(areaA, areaB);
      const isLabelOnBox = pct > 0.9 && ratio > 3;
      const isAnnotation = ratio > 4;
      if (isLabelOnBox || isAnnotation) continue;
      if (pct > 0.5) {
        findings.error(
          `${slidePath}.elements[${slide.elements.indexOf(ea)}]`,
          `Element "${ea.id}" overlaps "${eb.id}" by ${Math.round(pct * 100)}% — move or resize one`,
        );
      } else if (pct > 0.15) {
        findings.warn(
          `${slidePath}.elements[${slide.elements.indexOf(ea)}]`,
          `Element "${ea.id}" overlaps "${eb.id}" by ${Math.round(pct * 100)}%`,
        );
      }
    }
  }

  // Step markers in notes
  if (typeof slide.notes === "string" && slide.notes.length > 0) {
    const rawMatches = slide.notes.match(/\[step:(\d+)\]/g) || [];
    const stepNumbers = rawMatches.map((m) => {
      const match = /\[step:(\d+)\]/.exec(m);
      return match ? parseInt(match[1], 10) : NaN;
    });
    const onClickCount = Array.isArray(slide.animations)
      ? slide.animations.filter((a) => isPlainObject(a) && a.trigger === "onClick").length
      : 0;
    const idLabel = slide.id || `(unnamed slide ${slideIdx})`;

    // [step:0] is semantically wrong: activeStep starts at 0
    // meaning "before any click", so a [step:0] segment flashes on
    // initial render and disappears after the first click — the
    // opposite of the "highlight from click N onward" intent.
    // Steps are 1-indexed to match the N-th onClick animation.
    if (stepNumbers.includes(0)) {
      findings.error(
        `${slidePath}.notes`,
        `Slide "${idLabel}" uses [step:0] — step markers are 1-indexed. Use [step:1] for the first onClick animation, [step:2] for the second, etc.`,
      );
    }

    // Any referenced step index must have a corresponding onClick
    // animation. Steps beyond onClickCount never fire.
    if (stepNumbers.length > 0) {
      const maxStep = Math.max(...stepNumbers);
      if (maxStep > onClickCount) {
        findings.error(
          `${slidePath}.notes`,
          `Slide "${idLabel}" references [step:${maxStep}] but only ${onClickCount} onClick animation(s) exist — the step will never fire. Either add another onClick animation or renumber the markers to fit`,
        );
      }
    }

    // Total marker count vs onClick count (original check).
    if (rawMatches.length > 0 && rawMatches.length !== onClickCount) {
      findings.warn(
        `${slidePath}.notes`,
        `Step marker count (${rawMatches.length}) does not match onClick animation count (${onClickCount})`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Report formatting
// ─────────────────────────────────────────────────────────────────

function formatReport(findings, filePath, deck) {
  const lines = [];
  lines.push(`tekkal-validate: ${filePath}`);
  if (deck && Array.isArray(deck.slides)) {
    const totalEls = deck.slides.reduce(
      (s, sl) => s + (Array.isArray(sl.elements) ? sl.elements.length : 0),
      0,
    );
    lines.push(`  ${deck.slides.length} slides, ${totalEls} elements`);
  }
  lines.push("");

  lines.push(`ERRORS (${findings.errors.length}):`);
  if (findings.errors.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of findings.errors) {
      lines.push(`  ${f.path} — ${f.message}`);
    }
  }
  lines.push("");

  lines.push(`WARNINGS (${findings.warnings.length}):`);
  if (findings.warnings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of findings.warnings) {
      lines.push(`  ${f.path} — ${f.message}`);
    }
  }
  lines.push("");

  lines.push(`RESULT: ${findings.hasErrors() ? "FAIL" : "PASS"}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1) {
    console.error("Usage: node tekkal-validate.mjs <path-to-deck.json>");
    process.exit(2);
  }
  const filePath = resolvePath(argv[0]);

  let raw;
  // I/O boundary — fall through to a structured error so the user
  // sees the file path that broke instead of an opaque ENOENT trace.
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`tekkal-validate: cannot read ${filePath}: ${e.message}`);
    process.exit(2);
  }

  let deck;
  try {
    deck = JSON.parse(raw);
  } catch (e) {
    console.error(`tekkal-validate: ${filePath} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  const findings = new FindingList();
  const ok = validateDeckShape(deck, findings);
  if (ok) {
    const seenSlideIds = new Set();
    const seenElementIds = new Map();
    for (let i = 0; i < deck.slides.length; i++) {
      validateSlide(deck.slides[i], i, seenSlideIds, seenElementIds, findings);
    }
  }

  const report = formatReport(findings, filePath, deck);
  console.log(report);
  process.exit(findings.hasErrors() ? 1 : 0);
}

// Sanity assert: this script must run as a Node ESM module.
if (typeof process === "undefined" || typeof process.exit !== "function") {
  fail("expected to run under Node.js");
}

main();

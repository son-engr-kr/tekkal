import type { Deck, Slide } from "@/types/deck";

export interface ValidationIssue {
  severity: "error" | "warning";
  slideId?: string;
  elementId?: string;
  message: string;
  autoFixable: boolean;
}

/**
 * Asset paths the FsAccess and Vite adapters know how to resolve.
 * Anything else (bare filename, OS path, missing leading slash) hits
 * an assert deeper in resolveAssetUrl that gets swallowed by
 * useAssetUrl, leaving the image silently absent at render time —
 * exactly the failure mode the api3_1 benchmark deck hit. Both
 * validators (this one + scripts/tekkal-validate.mjs) must keep
 * this in lockstep.
 */
const VALID_ASSET_PATH_RE = /^(\.\/assets\/|\/assets\/|https?:\/\/|data:)/;

export interface ValidationResult {
  issues: ValidationIssue[];
  fixed: number;
}

export function validateDeck(deck: Deck): ValidationResult {
  const issues: ValidationIssue[] = [];
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();

  for (const slide of deck.slides) {
    // Duplicate slide ID
    if (slideIds.has(slide.id)) {
      issues.push({
        severity: "error",
        slideId: slide.id,
        message: `Duplicate slide ID: "${slide.id}"`,
        autoFixable: false,
      });
    }
    slideIds.add(slide.id);

    // Empty slide. Either bare-empty (no elements at all) or
    // notes-without-elements (interrupted generation — the model
    // wrote presenter notes but never came back to add the visible
    // content). The notes-only case is reported with a stronger
    // message because it is essentially never legitimate.
    if (slide.elements.length === 0) {
      const hasNotes = typeof slide.notes === "string" && slide.notes.trim().length > 0;
      if (hasNotes) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          message: `Slide "${slide.id}" has presenter notes but no visible elements — looks like generation was interrupted; add the planned content elements (e.g. a "# Title" text element) before the slide can render`,
          autoFixable: false,
        });
      } else {
        issues.push({
          severity: "error",
          slideId: slide.id,
          message: `Slide "${slide.id}" has zero elements — add at least one text element with a "# Title" heading, or remove the slide if intentional`,
          autoFixable: false,
        });
      }
    }

    // Slide background image path format. Same rules as image/video
    // src — bare filenames render as nothing.
    const slideBg = slide.background as { image?: unknown } | undefined;
    if (slideBg && typeof slideBg.image === "string" && slideBg.image.length > 0) {
      if (!VALID_ASSET_PATH_RE.test(slideBg.image)) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          message: `Slide background image "${slideBg.image}" must start with ./assets/, /assets/, http(s)://, or data:`,
          autoFixable: false,
        });
      }
    }

    // Forbidden element types (not supported / cause rendering issues)
    const FORBIDDEN_TYPES = ["mermaid", "iframe", "audio", "animation"];
    for (const el of slide.elements) {
      if (FORBIDDEN_TYPES.includes(el.type)) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          elementId: el.id,
          message: `Forbidden element type "${el.type}" — use shape+text for diagrams, code for code`,
          autoFixable: false,
        });
      }
    }

    // Overlap detection: check all pairs with significant area
    const measurableEls = slide.elements.filter(
      (e) => e.position && e.size && e.size.w > 5 && e.size.h > 5,
    );
    for (let a = 0; a < measurableEls.length; a++) {
      for (let b = a + 1; b < measurableEls.length; b++) {
        const ea = measurableEls[a]!;
        const eb = measurableEls[b]!;
        // Skip if they share a groupId (intentionally stacked)
        const gaGroup = (ea as { groupId?: string }).groupId;
        const gbGroup = (eb as { groupId?: string }).groupId;
        if (gaGroup && gaGroup === gbGroup) continue;
        const ax1 = ea.position.x, ay1 = ea.position.y;
        const ax2 = ax1 + ea.size.w,  ay2 = ay1 + ea.size.h;
        const bx1 = eb.position.x, by1 = eb.position.y;
        const bx2 = bx1 + eb.size.w,  by2 = by1 + eb.size.h;
        const overlapW = Math.min(ax2, bx2) - Math.max(ax1, bx1);
        const overlapH = Math.min(ay2, by2) - Math.max(ay1, by1);
        if (overlapW > 20 && overlapH > 20) {
          const areaA = ea.size.w * ea.size.h;
          const areaB = eb.size.w * eb.size.h;
          const overlapArea = overlapW * overlapH;
          const overlapPct = overlapArea / Math.min(areaA, areaB);
          // Skip label-on-box: smaller nearly fully inside larger (ratio > 3x)
          const isLabelOnBox = overlapPct > 0.9 && Math.max(areaA, areaB) / Math.min(areaA, areaB) > 3;
          // Skip shape+text/table overlaps — shapes are always decorative/intentional
          const eaType = (ea as { type?: string }).type;
          const ebType = (eb as { type?: string }).type;
          const VISUAL = ["shape"];
          const CONTENT = ["text", "table", "code"];
          const isShapeOnContent = (VISUAL.includes(eaType ?? "") && CONTENT.includes(ebType ?? "")) ||
                                   (CONTENT.includes(eaType ?? "") && VISUAL.includes(ebType ?? ""));
          // Skip small element on much larger (ratio > 4x) — label-in-box or annotation
          const isAnnotation = Math.max(areaA, areaB) / Math.min(areaA, areaB) > 4;
          if (!isLabelOnBox && !isShapeOnContent && !isAnnotation) {
            // Compute a suggested target position
            const areaA = ea.size.w * ea.size.h;
            const areaB = eb.size.w * eb.size.h;
            const [larger, smaller] = areaA >= areaB ? [ea, eb] : [eb, ea];
            const candidateX = larger.position.x + larger.size.w + 10;
            const fitsRight = candidateX + smaller.size.w <= 960;
            let suggestion: string;
            if (fitsRight) {
              suggestion = `move "${smaller.id}" to x:${candidateX} y:${smaller.position.y} (right of "${larger.id}")`;
            } else {
              // Can't fit right — suggest stacking below
              const candidateY = larger.position.y + larger.size.h + 10;
              if (candidateY + smaller.size.h <= 540) {
                suggestion = `move "${smaller.id}" to x:${smaller.position.x} y:${candidateY} (below "${larger.id}")`;
              } else {
                suggestion = `resize "${smaller.id}" to w:${Math.floor((960 - larger.position.x) / 2 - 10)} or delete it — no room beside/below "${larger.id}"`;
              }
            }
            const coordsA = `${ax1},${ay1} ${ea.size.w}×${ea.size.h}`;
            const coordsB = `${bx1},${by1} ${eb.size.w}×${eb.size.h}`;
            if (overlapPct > 0.5) {
              issues.push({
                severity: "error",
                slideId: slide.id,
                elementId: ea.id,
                message: `Elements "${ea.id}"(${coordsA}) and "${eb.id}"(${coordsB}) overlap ${Math.round(overlapPct * 100)}% — ${suggestion}`,
                autoFixable: false,
              });
            } else if (overlapPct > 0.15) {
              issues.push({
                severity: "warning",
                slideId: slide.id,
                elementId: ea.id,
                message: `Elements "${ea.id}"(${coordsA}) and "${eb.id}"(${coordsB}) overlap ${Math.round(overlapPct * 100)}% — ${suggestion}`,
                autoFixable: false,
              });
            }
          }
        }
      }
    }

    for (const el of slide.elements) {
      // Duplicate element ID
      if (elementIds.has(el.id)) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          elementId: el.id,
          message: `Duplicate element ID: "${el.id}"`,
          autoFixable: false,
        });
      }
      elementIds.add(el.id);

      // Missing required fields
      if (!(el as unknown as Record<string, unknown>).type) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          elementId: el.id,
          message: "Element missing type",
          autoFixable: false,
        });
      }
      if (!el.position || el.position.x === undefined || el.position.y === undefined) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          elementId: el.id,
          message: "Element missing position",
          autoFixable: false,
        });
        continue;
      }
      if (!el.size || !el.size.w || !el.size.h) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          elementId: el.id,
          message: "Element has zero or missing size",
          autoFixable: true,
        });
      }

      // Position out of bounds
      if (el.position.x < 0 || el.position.y < 0) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          elementId: el.id,
          message: `Element position negative: (${el.position.x}, ${el.position.y})`,
          autoFixable: true,
        });
      }

      // Overflow canvas
      if (el.position.x + el.size.w > 960) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          elementId: el.id,
          message: `Element overflows right edge: x(${el.position.x}) + w(${el.size.w}) = ${el.position.x + el.size.w} > 960`,
          autoFixable: true,
        });
      }
      if (el.position.y + el.size.h > 540) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          elementId: el.id,
          message: `Element overflows bottom edge: y(${el.position.y}) + h(${el.size.h}) = ${el.position.y + el.size.h} > 540`,
          autoFixable: true,
        });
      }

      // image/video src format. Must resolve through useAssetUrl —
      // bare filenames or absent ./assets/ prefix render as nothing
      // and the failure is silent (resolveAssetUrl rejects, useAssetUrl
      // catches). Caught here as an error so the AI fix loop has a
      // signal to act on.
      if (el.type === "image" || el.type === "video") {
        const src = (el as { src?: unknown }).src;
        if (typeof src !== "string" || src.length === 0) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            elementId: el.id,
            message: `${el.type} element missing src field`,
            autoFixable: false,
          });
        } else if (!VALID_ASSET_PATH_RE.test(src)) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            elementId: el.id,
            message: `${el.type} element src "${src}" must start with ./assets/, /assets/, http(s)://, or data:`,
            autoFixable: false,
          });
        }
      }

      // Arrow/line with rotation field (causes assert fail in renderer)
      if (el.type === "shape") {
        const shape = el as { shape?: string; rotation?: unknown };
        if ((shape.shape === "arrow" || shape.shape === "line") && shape.rotation !== undefined) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            elementId: el.id,
            message: `Arrow/line element has rotation field (must be removed — use waypoints instead)`,
            autoFixable: false,
          });
        }
      }

      // TikZ missing bounding box \path ... rectangle
      if (el.type === "tikz") {
        const tikz = el as { content?: string };
        if (tikz.content && !tikz.content.includes("\\path") && !tikz.content.includes("rectangle")) {
          issues.push({
            severity: "warning",
            slideId: slide.id,
            elementId: el.id,
            message: "TikZ element missing bounding box (\\path ... rectangle)",
            autoFixable: false,
          });
        }
      }

      // Text: double backslash outside LaTeX environments (invalid in KaTeX — causes parse error)
      if (el.type === "text") {
        const txt = el as { content?: string };
        if (txt.content) {
          // Strip \begin{...}...\end{...} blocks where \\ is valid (aligned, array, etc.)
          const contentWithoutEnvs = txt.content.replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, "");
          if (/\\\\/.test(contentWithoutEnvs)) {
            issues.push({
              severity: "warning",
              slideId: slide.id,
              elementId: el.id,
              message: "Text element contains \\\\ outside a LaTeX environment (use \\\\begin{aligned} for multi-line math, or single \\\\ for commands like \\\\pi)",
              autoFixable: false,
            });
          }
        }
        // Bold markers inside math delimiters
        if (txt.content && /\$[^$]*\*\*[^$]*\$/.test(txt.content)) {
          issues.push({
            severity: "warning",
            slideId: slide.id,
            elementId: el.id,
            message: "Text element has **bold** inside $math$ (use \\mathbf{} instead)",
            autoFixable: false,
          });
        }
      }

      // Code element: too many lines
      if (el.type === "code") {
        const code = el as { content?: string };
        if (code.content) {
          const lineCount = code.content.split("\n").length;
          if (lineCount > 25) {
            issues.push({
              severity: "warning",
              slideId: slide.id,
              elementId: el.id,
              message: `Code element has ${lineCount} lines (max 25 recommended)`,
              autoFixable: false,
            });
          }
        }
      }

      // Empty text content
      if (el.type === "text" && !(el as { content: string }).content?.trim()) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          elementId: el.id,
          message: "Text element has empty content",
          autoFixable: false,
        });
      }

      // Font size sanity
      if (el.type === "text") {
        const fontSize = (el as { style?: { fontSize?: number } }).style?.fontSize;
        if (fontSize !== undefined) {
          if (fontSize < 10) {
            issues.push({
              severity: "warning",
              slideId: slide.id,
              elementId: el.id,
              message: `Font size too small: ${fontSize}`,
              autoFixable: true,
            });
          }
          if (fontSize > 72) {
            issues.push({
              severity: "warning",
              slideId: slide.id,
              elementId: el.id,
              message: `Font size too large: ${fontSize}`,
              autoFixable: true,
            });
          }
        }
      }

      // Table: missing or empty columns/rows (causes PropertyPanel crash)
      if (el.type === "table") {
        const tbl = el as { columns?: unknown; rows?: unknown };
        if (!Array.isArray(tbl.columns) || tbl.columns.length === 0) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            elementId: el.id,
            message: "Table element missing or empty columns array",
            autoFixable: false,
          });
        }
        if (!Array.isArray(tbl.rows) || tbl.rows.length === 0) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            elementId: el.id,
            message: "Table element missing or empty rows array",
            autoFixable: false,
          });
        }
      }
    }

    // Step markers in notes
    if (typeof slide.notes === "string" && slide.notes.length > 0) {
      const stepMatches = [...slide.notes.matchAll(/\[step:(\d+)\]/g)];
      const stepNumbers = stepMatches.map((m) => parseInt(m[1]!, 10));
      const onClickCount = Array.isArray(slide.animations)
        ? slide.animations.filter((a) => a.trigger === "onClick").length
        : 0;

      // [step:0] is wrong: activeStep starts at 0 meaning "before
      // any click", so a [step:0] segment is briefly highlighted on
      // initial render and then hidden once the user clicks — the
      // opposite of the intended "highlight from click N onward"
      // semantics. Steps are 1-indexed to match the N-th onClick.
      if (stepNumbers.includes(0)) {
        issues.push({
          severity: "error",
          slideId: slide.id,
          message: `Slide "${slide.id}" uses [step:0] — step markers are 1-indexed. Use [step:1] for the first onClick animation, [step:2] for the second, etc.`,
          autoFixable: false,
        });
      }

      // Any referenced step index must correspond to an onClick
      // animation that actually exists on this slide. Steps beyond
      // the onClick count never fire and the text stays dark forever.
      if (stepNumbers.length > 0) {
        const maxStep = Math.max(...stepNumbers);
        if (maxStep > onClickCount) {
          issues.push({
            severity: "error",
            slideId: slide.id,
            message: `Slide "${slide.id}" references [step:${maxStep}] but only ${onClickCount} onClick animation(s) exist — the step will never fire. Either add another onClick animation or renumber the markers to fit`,
            autoFixable: false,
          });
        }
      }

      // Total marker count vs onClick count (the original check).
      if (stepMatches.length > 0 && stepMatches.length !== onClickCount) {
        issues.push({
          severity: "warning",
          slideId: slide.id,
          message: `Step marker count (${stepMatches.length}) does not match onClick animation count (${onClickCount})`,
          autoFixable: false,
        });
      }
    }
  }

  return { issues, fixed: 0 };
}

export function buildFixInstructions(result: ValidationResult): string {
  if (result.issues.length === 0) return "";

  const lines: string[] = [];

  for (const i of result.issues) {
    const loc = i.elementId ? `[${i.slideId}/${i.elementId}]` : `[${i.slideId}]`;
    if (i.autoFixable) {
      if (i.message.includes("overflows right")) {
        lines.push(`- FIX ${loc} Reduce width or move left to fit within 960px`);
      } else if (i.message.includes("overflows bottom")) {
        lines.push(`- FIX ${loc} Reduce height or move up to fit within 540px`);
      } else if (i.message.includes("negative")) {
        lines.push(`- FIX ${loc} Move position to positive coordinates`);
      } else if (i.message.includes("Font size too small")) {
        lines.push(`- FIX ${loc} Increase font size to at least 12`);
      } else if (i.message.includes("Font size too large")) {
        lines.push(`- FIX ${loc} Decrease font size to at most 60`);
      } else if (i.message.includes("zero or missing size")) {
        lines.push(`- FIX ${loc} Set reasonable width and height`);
      } else {
        lines.push(`- FIX ${loc} ${i.message}`);
      }
    } else if (i.severity === "error") {
      lines.push(`- CRITICAL ${loc} ${i.message}`);
    } else if (i.severity === "warning" && i.message.includes("overlap")) {
      lines.push(`- FIX ${loc} ${i.message} — call update_element with the suggested position`);
    } else if (i.severity === "warning" && i.message.includes("lines")) {
      lines.push(`- FIX ${loc} ${i.message} — trim code to at most 25 lines showing only the essential concept`);
    } else if (i.severity === "warning" && i.message.includes("\\\\")) {
      lines.push(`- FIX ${loc} ${i.message} — replace \\\\\\\\cmd with \\\\cmd (single backslash), use \\\\mathbf{} for bold`);
    }
  }

  if (lines.length === 0) return "";
  return `Issues found:\n${lines.join("\n")}`;
}

/**
 * Programmatically resolve element overlaps by nudging the smaller element
 * to the nearest valid non-overlapping position.
 * Applies the same exemption logic as validateDeck (shape-on-content, annotation, label-on-box).
 * Returns the number of elements moved.
 */
export function resolveOverlaps(
  _slideId: string,
  slide: Slide,
  updateFn: (elementId: string, patch: { position: { x: number; y: number } }) => void,
): number {
  const CANVAS_W = 960;
  const CANVAS_H = 540;
  const GAP = 10;

  // Mutable position tracking (separate from store so cascade moves work)
  const pos = new Map<string, { x: number; y: number }>(
    slide.elements
      .filter((e) => e.position)
      .map((e) => [e.id, { x: e.position.x, y: e.position.y }]),
  );
  const siz = new Map<string, { w: number; h: number }>(
    slide.elements
      .filter((e) => e.size)
      .map((e) => [e.id, { w: e.size.w, h: e.size.h }]),
  );

  const measurable = slide.elements.filter(
    (e) => e.position && e.size && e.size.w > 5 && e.size.h > 5,
  );

  const VISUAL = ["shape"];
  const CONTENT = ["text", "table", "code"];

  let totalFixed = 0;

  for (let iter = 0; iter < 5; iter++) {
    let fixedThisRound = 0;

    for (let a = 0; a < measurable.length; a++) {
      for (let b = a + 1; b < measurable.length; b++) {
        const ea = measurable[a]!;
        const eb = measurable[b]!;

        // Same exemptions as validateDeck
        const gaGroup = (ea as { groupId?: string }).groupId;
        const gbGroup = (eb as { groupId?: string }).groupId;
        if (gaGroup && gaGroup === gbGroup) continue;

        const eaType = (ea as { type?: string }).type;
        const ebType = (eb as { type?: string }).type;
        if (
          (VISUAL.includes(eaType ?? "") && CONTENT.includes(ebType ?? "")) ||
          (CONTENT.includes(eaType ?? "") && VISUAL.includes(ebType ?? ""))
        ) continue;

        const pA = pos.get(ea.id);
        const pB = pos.get(eb.id);
        const sA = siz.get(ea.id);
        const sB = siz.get(eb.id);
        if (!pA || !pB || !sA || !sB) continue;

        const ow = Math.min(pA.x + sA.w, pB.x + sB.w) - Math.max(pA.x, pB.x);
        const oh = Math.min(pA.y + sA.h, pB.y + sB.h) - Math.max(pA.y, pB.y);
        if (ow <= 20 || oh <= 20) continue;

        const areaA = sA.w * sA.h;
        const areaB = sB.w * sB.h;
        const pct = (ow * oh) / Math.min(areaA, areaB);

        const isLabelOnBox = pct > 0.9 && Math.max(areaA, areaB) / Math.min(areaA, areaB) > 3;
        const isAnnotation = Math.max(areaA, areaB) / Math.min(areaA, areaB) > 4;
        if (isLabelOnBox || isAnnotation) continue;
        if (pct <= 0.15) continue;

        // Move the smaller element
        const moveB = areaA >= areaB;
        const largerP = moveB ? pA : pB;
        const largerS = moveB ? sA : sB;
        const smallerId = moveB ? eb.id : ea.id;
        const smallerP = moveB ? pB : pA;
        const smallerS = moveB ? sB : sA;

        const candidates = [
          { x: largerP.x + largerS.w + GAP, y: smallerP.y },   // right
          { x: smallerP.x, y: largerP.y + largerS.h + GAP },   // below
          { x: largerP.x - smallerS.w - GAP, y: smallerP.y },  // left
          { x: smallerP.x, y: largerP.y - smallerS.h - GAP },  // above
        ];

        const valid = candidates.filter(
          (p) =>
            p.x >= 0 &&
            p.y >= 0 &&
            p.x + smallerS.w <= CANVAS_W &&
            p.y + smallerS.h <= CANVAS_H,
        );
        if (valid.length === 0) continue;

        const best = valid.reduce((a, c) =>
          Math.hypot(a.x - smallerP.x, a.y - smallerP.y) <
          Math.hypot(c.x - smallerP.x, c.y - smallerP.y)
            ? a : c,
        );

        pos.set(smallerId, best);
        updateFn(smallerId, { position: best });
        fixedThisRound++;
      }
    }

    totalFixed += fixedThisRound;
    if (fixedThisRound === 0) break;
  }

  return totalFixed;
}

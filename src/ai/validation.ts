import type { Deck } from "@/types/deck";

export interface ValidationIssue {
  severity: "error" | "warning";
  slideId?: string;
  elementId?: string;
  message: string;
  autoFixable: boolean;
}

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
    }
  }

  return { issues, fixed: 0 };
}

export function buildFixInstructions(result: ValidationResult): string {
  const fixable = result.issues.filter((i) => i.autoFixable);
  if (fixable.length === 0) return "";

  const lines = fixable.map((i) => {
    if (i.message.includes("overflows right")) {
      return `- [${i.slideId}/${i.elementId}] Reduce width or move left to fit within 960px`;
    }
    if (i.message.includes("overflows bottom")) {
      return `- [${i.slideId}/${i.elementId}] Reduce height or move up to fit within 540px`;
    }
    if (i.message.includes("negative")) {
      return `- [${i.slideId}/${i.elementId}] Move position to positive coordinates`;
    }
    if (i.message.includes("Font size too small")) {
      return `- [${i.slideId}/${i.elementId}] Increase font size to at least 12`;
    }
    if (i.message.includes("Font size too large")) {
      return `- [${i.slideId}/${i.elementId}] Decrease font size to at most 60`;
    }
    if (i.message.includes("zero or missing size")) {
      return `- [${i.slideId}/${i.elementId}] Set reasonable width and height`;
    }
    return `- [${i.slideId}/${i.elementId}] ${i.message}`;
  });

  return `Fix the following issues:\n${lines.join("\n")}`;
}

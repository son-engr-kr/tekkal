import type { ReactNode } from "react";
import { createElement, Fragment } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Minimal Markdown-to-React renderer.
 * Supports: headings, bold, italic, inline code, lists, paragraphs,
 * inline math ($...$), block math ($$...$$).
 *
 * @param mathFontSize - Optional explicit font size (px) for KaTeX math elements.
 *   When provided, adds `style={{ fontSize: "${mathFontSize}px" }}` to math spans/divs.
 *   Useful when the parent element uses a scaled font size that KaTeX cannot inherit.
 */
export function renderMarkdown(source: string, mathFontSize?: number): ReactNode {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;
  let mathBlock: string[] | null = null;

  const mathStyle = mathFontSize !== undefined ? { fontSize: `${mathFontSize}px` } : undefined;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      createElement(
        "ul",
        { key: blockKey++, className: "list-disc pl-6 space-y-1" },
        listItems.map((item, i) => createElement("li", { key: i }, renderInline(item, mathFontSize))),
      ),
    );
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Block math: opening/closing $$
    if (trimmed === "$$") {
      if (mathBlock === null) {
        flushList();
        mathBlock = [];
      } else {
        const latex = mathBlock.join("\n");
        const html = katex.renderToString(latex, { displayMode: true, throwOnError: false });
        blocks.push(
          createElement("div", {
            key: blockKey++,
            className: "my-2 text-center",
            style: mathStyle,
            dangerouslySetInnerHTML: { __html: html },
          }),
        );
        mathBlock = null;
      }
      continue;
    }

    if (mathBlock !== null) {
      mathBlock.push(line);
      continue;
    }

    // Single-line block math: $$...$$
    const singleLineMath = trimmed.match(/^\$\$(.+)\$\$$/);
    if (singleLineMath) {
      flushList();
      const html = katex.renderToString(singleLineMath[1]!, { displayMode: true, throwOnError: false });
      blocks.push(
        createElement("div", {
          key: blockKey++,
          className: "my-2 text-center",
          style: mathStyle,
          dangerouslySetInnerHTML: { __html: html },
        }),
      );
      continue;
    }

    // List item
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
      continue;
    }

    flushList();

    // Empty line
    if (trimmed === "") continue;

    // Heading
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      const text = headingMatch[2]!;
      const tag = `h${level}` as const;
      const sizeClass = { 1: "text-[1.8em] font-bold", 2: "text-[1.4em] font-semibold", 3: "text-[1.1em] font-medium" }[level];
      blocks.push(createElement(tag, { key: blockKey++, className: sizeClass }, renderInline(text, mathFontSize)));
      continue;
    }

    // Paragraph
    blocks.push(createElement("p", { key: blockKey++ }, renderInline(trimmed, mathFontSize)));
  }

  flushList();
  return createElement(Fragment, null, ...blocks);
}

export function renderInline(text: string, mathFontSize?: number): ReactNode {
  const parts: ReactNode[] = [];
  // Combined regex: display math($$), bold(**), italic(*), inline code(`), inline math($)
  // $$...$$ must come before $...$ to avoid misparse as $+($inner$)+$
  const regex = /(\$\$(.+?)\$\$)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|([$](.+?)[$])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partKey = 0;

  const mathStyle = mathFontSize !== undefined ? { fontSize: `${mathFontSize}px` } : undefined;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      // $$...$$ display math inline (e.g. in list items or headings)
      const html = katex.renderToString(match[2], { displayMode: true, throwOnError: false });
      parts.push(
        createElement("span", {
          key: partKey++,
          className: "inline-block align-middle my-1",
          style: mathStyle,
          dangerouslySetInnerHTML: { __html: html },
        }),
      );
    } else if (match[4] !== undefined) {
      parts.push(createElement("strong", { key: partKey++, className: "font-bold" }, match[4]));
    } else if (match[6] !== undefined) {
      parts.push(createElement("em", { key: partKey++, className: "italic" }, match[6]));
    } else if (match[8] !== undefined) {
      parts.push(
        createElement(
          "code",
          { key: partKey++, className: "bg-white/10 px-1.5 py-0.5 rounded text-[0.85em] font-mono" },
          match[8],
        ),
      );
    } else if (match[10] !== undefined) {
      const html = katex.renderToString(match[10], { displayMode: false, throwOnError: false });
      parts.push(
        createElement("span", {
          key: partKey++,
          className: "inline-block align-middle",
          style: mathStyle,
          dangerouslySetInnerHTML: { __html: html },
        }),
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : createElement(Fragment, null, ...parts);
}

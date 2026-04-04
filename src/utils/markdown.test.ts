import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { renderMarkdown, renderInline } from "./markdown";

function toHtml(node: ReturnType<typeof renderMarkdown>): string {
  return renderToStaticMarkup(node as ReactElement);
}

describe("renderMarkdown — mathFontSize", () => {
  describe("block math ($$...$$)", () => {
    it("applies mathFontSize style to single-line block math", () => {
      const html = toHtml(renderMarkdown("$$E = mc^2$$", 20));
      expect(html).toContain("font-size:20px");
    });

    it("applies mathFontSize style to multi-line block math", () => {
      const html = toHtml(renderMarkdown("$$\nE = mc^2\n$$", 20));
      expect(html).toContain("font-size:20px");
    });

    it("omits font-size style when mathFontSize not provided", () => {
      const html = toHtml(renderMarkdown("$$E = mc^2$$"));
      // The math div should render but without inline font-size
      expect(html).not.toContain("font-size:");
    });
  });

  describe("inline math ($...$)", () => {
    it("applies mathFontSize style to inline math span", () => {
      const html = toHtml(renderMarkdown("energy $E = mc^2$ formula", 18));
      expect(html).toContain("font-size:18px");
    });

    it("omits font-size style on inline math when not provided", () => {
      const html = toHtml(renderMarkdown("energy $E = mc^2$ formula"));
      expect(html).not.toContain("font-size:");
    });

    it("applies mathFontSize independently per inline math span", () => {
      const html = toHtml(renderMarkdown("$a$ and $b$", 16));
      const matches = html.match(/font-size:16px/g);
      expect(matches).toHaveLength(2);
    });
  });

  describe("non-math content", () => {
    it("renders paragraphs without font-size", () => {
      const html = toHtml(renderMarkdown("hello world", 20));
      expect(html).not.toContain("font-size:");
    });

    it("renders headings without font-size", () => {
      const html = toHtml(renderMarkdown("# Title", 20));
      expect(html).not.toContain("font-size:");
    });

    it("renders bold/italic without font-size", () => {
      const html = toHtml(renderMarkdown("**bold** and *italic*", 20));
      expect(html).not.toContain("font-size:");
    });
  });
});

describe("renderInline — mathFontSize", () => {
  it("applies mathFontSize to inline math span", () => {
    const node = renderInline("$x^2$", 14);
    const html = renderToStaticMarkup(node as ReactElement);
    expect(html).toContain("font-size:14px");
  });

  it("omits style when mathFontSize not given", () => {
    const node = renderInline("$x^2$");
    const html = renderToStaticMarkup(node as ReactElement);
    expect(html).not.toContain("font-size:");
  });

  it("does not apply font-size to bold or italic spans", () => {
    const node = renderInline("**bold** $x$", 15);
    const html = renderToStaticMarkup(node as ReactElement);
    // font-size should only appear once (on the math span)
    const matches = html.match(/font-size:/g);
    expect(matches).toHaveLength(1);
  });
});

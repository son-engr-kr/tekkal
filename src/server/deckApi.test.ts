import { describe, it, expect } from "vitest";
import { wrapTikzDocument } from "./deckApi";

describe("wrapTikzDocument", () => {
  it("returns document as-is when \\documentclass is already present", () => {
    const input = "\\documentclass{article}\n\\begin{document}foo\\end{document}";
    expect(wrapTikzDocument(input)).toBe(input);
  });

  it("wraps bare TikZ content in standalone document", () => {
    const result = wrapTikzDocument("\\draw (0,0) -- (1,1);");
    expect(result).toContain("\\documentclass[dvisvgm]{standalone}");
    expect(result).toContain("\\begin{document}");
    expect(result).toContain("\\end{document}");
    expect(result).toContain("\\draw (0,0) -- (1,1);");
  });

  it("includes circuitikz package", () => {
    const result = wrapTikzDocument("\\draw (0,0) node[i1] {};");
    expect(result).toContain("\\usepackage{circuitikz}");
  });

  it("includes circuits.ee.IEC TikZ library", () => {
    const result = wrapTikzDocument("\\draw (0,0) to[R] (2,0);");
    expect(result).toContain("circuits.ee.IEC");
  });

  it("includes pgfplots with compat setting", () => {
    const result = wrapTikzDocument("\\begin{axis}\\end{axis}");
    expect(result).toContain("\\usepackage{pgfplots}");
    expect(result).toContain("\\pgfplotsset{compat=1.18}");
  });

  it("includes common TikZ libraries: arrows.meta, positioning, calc, automata", () => {
    const result = wrapTikzDocument("\\node[state] {};");
    const usetikzlibrary = result.match(/\\usetikzlibrary\{([^}]+)\}/)?.[1] ?? "";
    expect(usetikzlibrary).toContain("arrows.meta");
    expect(usetikzlibrary).toContain("positioning");
    expect(usetikzlibrary).toContain("calc");
    expect(usetikzlibrary).toContain("automata");
    expect(usetikzlibrary).toContain("mindmap");
  });

  it("injects custom preamble before \\begin{document}", () => {
    const customPreamble = "\\usepackage{xcolor}";
    const result = wrapTikzDocument("\\node {};", customPreamble);
    const preambleIdx = result.indexOf(customPreamble);
    const beginDocIdx = result.indexOf("\\begin{document}");
    expect(preambleIdx).toBeGreaterThan(-1);
    expect(preambleIdx).toBeLessThan(beginDocIdx);
  });

  it("works with empty custom preamble", () => {
    const result = wrapTikzDocument("\\node {};", "");
    expect(result).toContain("\\begin{document}");
  });
});

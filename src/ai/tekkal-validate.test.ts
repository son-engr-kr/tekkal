/**
 * Drift tests for scripts/tekkal-validate.mjs.
 *
 * The standalone validator duplicates checks from src/ai/validation.ts
 * so it can be copied verbatim into agentic-tool project folders that
 * do not have the TEKKAL repo checked out. Without these tests, the
 * two implementations would silently diverge over time and the
 * benchmark infrastructure would quietly stop catching the failure
 * modes the spec says it must catch.
 *
 * Each test builds a minimal hand-written deck (3-5 elements, just
 * enough to trip one check), writes it to a scratch tmp file, and
 * spawns the validator the same way external CLI tools do. The
 * assertions pin both the exit code and the field path / id mention
 * in the report so an LLM reading the message has enough information
 * to act on it.
 *
 * Spawning the script as a child process is necessary because the
 * .mjs file calls main() and process.exit() at import time and the
 * spec forbids modifying the script. Spawn cost is ~50ms per fixture
 * which is well within the suite's tolerance.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");
const VALIDATOR_PATH = resolve(REPO_ROOT, "scripts", "tekkal-validate.mjs");
const EXAMPLE_DECK_PATH = resolve(REPO_ROOT, "docs", "example-deck.json");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let scratchDir: string;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "tekkal-validate-test-"));
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function runValidator(filePath: string): RunResult {
  // execFileSync throws on non-zero exit. Capture status from the
  // thrown error so we can assert on both pass and fail paths
  // uniformly.
  try {
    const stdout = execFileSync("node", [VALIDATOR_PATH, filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

function runDeck(deck: unknown, name: string): RunResult {
  const filePath = join(scratchDir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(deck, null, 2), "utf8");
  return runValidator(filePath);
}

// ── Minimal builders. Hand-written, just enough to trip one check. ──

interface Pos { x: number; y: number }
interface Sz { w: number; h: number }

function pos(x: number, y: number): Pos { return { x, y }; }
function size(w: number, h: number): Sz { return { w, h }; }

function deckOf(slides: unknown[]): unknown {
  return {
    version: "0.1.0",
    meta: { title: "Test", aspectRatio: "16:9" },
    slides,
  };
}

function slideOf(id: string, elements: unknown[], extras: Record<string, unknown> = {}): unknown {
  return { id, elements, ...extras };
}

function textEl(id: string, content: string, extras: Record<string, unknown> = {}): unknown {
  return {
    id,
    type: "text",
    content,
    position: pos(20, 20),
    size: size(400, 80),
    ...extras,
  };
}

// ─────────────────────────────────────────────────────────────────
// Sanity: example-deck.json must pass cleanly
// ─────────────────────────────────────────────────────────────────

describe("tekkal-validate.mjs sanity", () => {
  it("docs/example-deck.json passes with exit code 0 and zero errors", () => {
    const result = runValidator(EXAMPLE_DECK_PATH);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/RESULT: PASS/);
    expect(result.stdout).toMatch(/ERRORS \(0\)/);
    // Sanity-check the example actually got walked, not silently skipped.
    const exampleSrc = JSON.parse(readFileSync(EXAMPLE_DECK_PATH, "utf8")) as { slides: unknown[] };
    expect(result.stdout).toContain(`${exampleSrc.slides.length} slides`);
  });
});

// ─────────────────────────────────────────────────────────────────
// Drift tests: each fixture trips exactly one documented check
// ─────────────────────────────────────────────────────────────────

describe("tekkal-validate.mjs drift", () => {
  it("flags shape line with top-level waypoints (Gemini-CLI failure shape)", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "line1",
            type: "shape",
            shape: "line",
            position: pos(20, 20),
            size: size(200, 100),
            // Top-level instead of nested under style.waypoints
            waypoints: [{ x: 0, y: 0 }, { x: 200, y: 100 }],
          },
        ]),
      ]),
      "shape-line-toplevel-waypoints",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/RESULT: FAIL/);
    // Field path must point at the top-level waypoints field
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.waypoints/);
    // Message must steer the LLM toward style.waypoints
    expect(result.stdout).toMatch(/style\.waypoints/);
  });

  it("flags shape line with style.waypoints as [[x,y]] tuples instead of {x,y} objects", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "line2",
            type: "shape",
            shape: "line",
            position: pos(20, 20),
            size: size(200, 100),
            style: {
              // Tuple form is the second-most-common LLM mistake after the
              // top-level placement bug. Must be {x, y} objects.
              waypoints: [[0, 0], [200, 100]],
            },
          },
        ]),
      ]),
      "shape-line-tuple-waypoints",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.style\.waypoints\[0\]/);
    // Must explicitly state the {x: number, y: number} requirement
    expect(result.stdout).toMatch(/\{x.*y.*\}/);
  });

  it("flags video element using url field instead of src", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "vid1",
            type: "video",
            url: "https://example.com/clip.mp4",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "video-url-not-src",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
    expect(result.stdout).toMatch(/uses url instead of src/);
  });

  it("flags image element using url field instead of src", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img1",
            type: "image",
            url: "/assets/foo.png",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "image-url-not-src",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
    expect(result.stdout).toMatch(/uses url instead of src/);
  });

  it("flags duplicate element ids across two different slides", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [textEl("e1", "first")]),
        slideOf("s2", [textEl("e1", "second")]),
      ]),
      "duplicate-cross-slide-ids",
    );
    expect(result.exitCode).toBe(1);
    // The second occurrence is the one flagged, with the prior site
    // mentioned in the message so the LLM can find both copies.
    expect(result.stdout).toMatch(/slides\[1\]\.elements\[0\]\.id/);
    expect(result.stdout).toMatch(/Duplicate element id "e1"/);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]/);
  });

  it("flags arrow element carrying a rotation field", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "arr1",
            type: "shape",
            shape: "arrow",
            rotation: 45,
            position: pos(20, 20),
            size: size(200, 100),
            style: { waypoints: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
          },
        ]),
      ]),
      "arrow-with-rotation",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.rotation/);
    // Message must mention waypoints so the LLM knows the fix.
    expect(result.stdout).toMatch(/waypoints/);
  });

  it("warns (not errors) on code element longer than 12 lines — density hint, not schema invariant", () => {
    const longCode = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "code1",
            type: "code",
            language: "python",
            content: longCode,
            position: pos(20, 20),
            size: size(400, 300),
          },
        ]),
      ]),
      "code-too-long",
    );
    // Demoted from error to warning — long code blocks are a density
    // suggestion, not a hard schema invariant. Exit code stays 0.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.content/);
    expect(result.stdout).toMatch(/15 lines/);
  });

  it("flags **bold** inside $...$ math in a text element", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          textEl("t1", "Inline math with **bold**: $E = **mc**^2$ which is wrong"),
        ]),
      ]),
      "text-bold-in-math",
    );
    // Bold-inside-math is severity warning per the canonical
    // validator rule (see src/ai/validation.ts). It still must be
    // surfaced in the report; assert against WARNINGS rather than
    // ERRORS so the test pins the actual severity.
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.content/);
    expect(result.stdout).toMatch(/bold.*math/i);
  });

  it("flags \\\\ line-break sequence in non-math text content", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          // Two backslashes + n is the LLM's most common LaTeX-line-break
          // mistake (it survives JSON encoding as \\\\). The validator
          // strips known math envs first, so the remaining \\ here is
          // genuinely outside an environment.
          textEl("t1", "Free-standing line break: foo \\\\ bar"),
        ]),
      ]),
      "text-backslash-outside-math",
    );
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.content/);
    expect(result.stdout).toMatch(/\\\\/);
  });

  it("flags TikZ element missing the \\path ... rectangle bounding box", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "tk1",
            type: "tikz",
            // No \path and no rectangle anywhere — content will be clipped.
            content: "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}",
            position: pos(20, 20),
            size: size(300, 200),
          },
        ]),
      ]),
      "tikz-missing-bbox",
    );
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.content/);
    expect(result.stdout).toMatch(/bounding box/);
  });

  it("flags image element with bare filename src (api3_1 benchmark failure shape)", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img1",
            type: "image",
            // Bare filename — no ./assets/ prefix. resolveAssetUrl
            // hits an assert that useAssetUrl swallows, so the image
            // is silently absent at render time.
            src: "interference.png",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "image-bare-filename",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
    // Message must list the four legal prefixes so the LLM can fix.
    expect(result.stdout).toMatch(/\.\/assets\//);
    expect(result.stdout).toMatch(/http\(s\)/);
  });

  it("flags image element src missing the assets directory", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img2",
            type: "image",
            // Has a leading slash but no /assets/ — also invalid.
            src: "/images/foo.png",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "image-missing-assets-dir",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
    expect(result.stdout).toMatch(/\/images\/foo\.png/);
  });

  it("flags image element src as an absolute Windows OS path", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img3",
            type: "image",
            src: "C:\\Users\\me\\foo.png",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "image-os-path",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
  });

  it("flags video element src that is a bare filename", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "vid2",
            type: "video",
            src: "clip.mp4",
            position: pos(20, 20),
            size: size(320, 200),
          },
        ]),
      ]),
      "video-bare-filename",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.src/);
    expect(result.stdout).toMatch(/clip\.mp4/);
  });

  it("flags slide background image with bare filename", () => {
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "content")],
          { background: { image: "background.png" } },
        ),
      ]),
      "slide-bg-bare-filename",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.background\.image/);
    expect(result.stdout).toMatch(/background\.png/);
  });

  it("accepts image src with the four legal prefixes", () => {
    const cases = [
      "./assets/foo.png",
      "/assets/proj/foo.png",
      "https://example.com/foo.png",
      "data:image/png;base64,iVBORw0KGgo=",
    ];
    for (const src of cases) {
      const result = runDeck(
        deckOf([
          slideOf("s1", [
            {
              id: "img-ok",
              type: "image",
              src,
              position: pos(20, 20),
              size: size(320, 200),
            },
          ]),
        ]),
        `image-ok-${src.replace(/[^a-z0-9]/gi, "_").slice(0, 20)}`,
      );
      // Path check passes for these prefixes; other checks (overlap,
      // empty slide) are also satisfied because the slide has one
      // image element. Exit 0, no path-related error.
      expect(result.exitCode, `should accept "${src}"`).toBe(0);
      expect(result.stdout).toMatch(/RESULT: PASS/);
    }
  });

  it("flags slide with zero elements (empty slide)", () => {
    const result = runDeck(
      deckOf([slideOf("s1", [])]),
      "empty-slide-no-notes",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]/);
    expect(result.stdout).toMatch(/zero elements/);
    // Suggested fix is in the message
    expect(result.stdout).toMatch(/# Title|remove the slide/);
  });

  it("flags slide with notes but no elements (interrupted generation)", () => {
    // This is the api3_1 s1 failure shape exactly: notes filled in,
    // elements left as []. The validator must produce a stronger,
    // distinct error message so the AI knows it is mid-completion.
    const result = runDeck(
      deckOf([
        slideOf("s1", [], {
          notes: "Welcome to the presentation. This deck covers the basics.",
        }),
      ]),
      "empty-slide-with-notes",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]/);
    // Distinct wording from the no-notes case so the AI's mental
    // model can branch on the right corrective action.
    expect(result.stdout).toMatch(/notes but no visible elements/);
    expect(result.stdout).toMatch(/interrupted/);
  });

  it("accepts slide with at least one element", () => {
    const result = runDeck(
      deckOf([slideOf("s1", [textEl("t1", "content")])]),
      "non-empty-slide",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/RESULT: PASS/);
  });

  it("flags [step:0] in notes (step markers are 1-indexed)", () => {
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "content")],
          {
            notes: "Welcome. [step:0] first click segment [/step] [step:1] second [/step]",
            animations: [
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
            ],
          },
        ),
      ]),
      "step-zero-index",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.notes/);
    expect(result.stdout).toMatch(/1-indexed/);
    expect(result.stdout).toMatch(/\[step:0\]/);
  });

  it("flags a step marker whose index exceeds the onClick animation count", () => {
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "content")],
          {
            notes: "[step:1] a [/step] [step:2] b [/step] [step:3] c [/step]",
            animations: [
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
            ],
          },
        ),
      ]),
      "step-beyond-onclick",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/slides\[0\]\.notes/);
    expect(result.stdout).toMatch(/\[step:3\]/);
    expect(result.stdout).toMatch(/only 2 onClick/);
  });

  it("flags sparse step numbering when max step exceeds onClick count", () => {
    // [step:1][step:2][step:5] with 3 onClicks — the total count
    // matches (3 === 3) so the pre-existing count check would not
    // fire, but step:5 is unreachable. The max-step rule catches it.
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "content")],
          {
            notes: "[step:1] a [/step] [step:2] b [/step] [step:5] c [/step]",
            animations: [
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
            ],
          },
        ),
      ]),
      "step-sparse-max",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[step:5\]/);
    expect(result.stdout).toMatch(/only 3 onClick/);
  });

  it("accepts well-formed 1-indexed step markers matching onClick count", () => {
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "content")],
          {
            notes: "Welcome. [step:1] first [/step] [step:2] second [/step]",
            animations: [
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
            ],
          },
        ),
      ]),
      "step-well-formed",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/RESULT: PASS/);
  });

  it("flags step marker count mismatch with onClick animation count", () => {
    const result = runDeck(
      deckOf([
        slideOf(
          "s1",
          [textEl("t1", "first"), textEl("t2", "second")],
          {
            // Two step markers, but only one onClick animation — mismatch.
            notes: "[step:1] reveal first; [step:2] reveal second",
            animations: [
              { target: "t1", effect: "fadeIn", trigger: "onClick" },
            ],
          },
        ),
      ]),
      "step-vs-onclick-mismatch",
    );
    // Step-vs-onClick mismatch is reported against the slide path,
    // not an individual element. Assert on the slide id.
    expect(result.stdout).toMatch(/slides\[0\]\.notes/);
    expect(result.stdout).toMatch(/Step marker count.*onClick/);
  });

  // ── B2: image alt missing ──────────────────────────────────────────

  it("warns on image element missing alt text", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img1",
            type: "image",
            src: "./assets/example.png",
            position: pos(20, 20),
            size: size(300, 200),
            // No alt field at all
          },
        ]),
      ]),
      "image-missing-alt",
    );
    // alt is a warning, not error — exit stays 0
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/slides\[0\]\.elements\[0\]\.alt/);
    expect(result.stdout).toMatch(/missing `alt`/);
  });

  it("does not warn when image has non-empty alt", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img1",
            type: "image",
            src: "./assets/example.png",
            alt: "A diagram of the system architecture",
            position: pos(20, 20),
            size: size(300, 200),
          },
        ]),
      ]),
      "image-with-alt",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/missing `alt`/);
  });

  // ── B5: off-palette color warning (opt-in) ─────────────────────────

  it("does not check palette when deck.theme.palette is unset", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          textEl("t1", "hello", { style: { color: "#ff0000" } }),
        ]),
      ]),
      "palette-unset",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/outside deck\.theme\.palette/);
  });

  it("warns on colors outside the palette when it is set", () => {
    const d = deckOf([
      slideOf("s1", [
        textEl("t1", "hello", { style: { color: "#ff0000" } }),
      ]),
    ]) as { theme?: unknown };
    d.theme = { palette: ["#1A2B48", "#5B9BD5"] };
    const result = runDeck(d, "palette-outside");
    expect(result.exitCode).toBe(0); // warning, not error
    expect(result.stdout).toMatch(/#ff0000/);
    expect(result.stdout).toMatch(/outside deck\.theme\.palette/);
  });

  it("matches palette colors case-insensitively", () => {
    const d = deckOf([
      slideOf("s1", [
        textEl("t1", "hello", { style: { color: "#1a2b48" } }),
      ]),
    ]) as { theme?: unknown };
    d.theme = { palette: ["#1A2B48"] };
    const result = runDeck(d, "palette-case");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/outside deck\.theme\.palette/);
  });

  // ── B1: overlap false-positive exemptions ──────────────────────────

  it("does not flag fan-out arrows sharing the same origin", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "a1",
            type: "shape",
            shape: "arrow",
            position: pos(100, 100),
            size: size(200, 100),
            style: { waypoints: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
          },
          {
            id: "a2",
            type: "shape",
            shape: "arrow",
            position: pos(100, 100),
            size: size(200, 100),
            style: { waypoints: [{ x: 0, y: 0 }, { x: 200, y: 100 }] },
          },
          // Plus one text so the slide isn't empty (empty-slide error would
          // otherwise hide our signal).
          textEl("t1", "label", { position: pos(50, 50), size: size(80, 30) }),
        ]),
      ]),
      "overlap-fanout-arrows",
    );
    expect(result.stdout).not.toMatch(/overlaps? "/);
  });

  it("does not flag a rectangle fully enclosing an image (frame pattern)", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "frame",
            type: "shape",
            shape: "rectangle",
            position: pos(100, 100),
            size: size(400, 300),
            style: { fill: "transparent", stroke: "#333", strokeWidth: 2 },
          },
          {
            id: "img1",
            type: "image",
            src: "./assets/x.png",
            alt: "contained",
            position: pos(120, 120),
            size: size(360, 260),
          },
        ]),
      ]),
      "overlap-frame-image",
    );
    expect(result.stdout).not.toMatch(/overlaps? "/);
  });

  it("respects allowOverlap:true opt-out", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          textEl("t1", "overlaid", {
            position: pos(0, 0),
            size: size(200, 100),
            allowOverlap: true,
          }),
          textEl("t2", "below", { position: pos(10, 10), size: size(200, 100) }),
        ]),
      ]),
      "overlap-opt-out",
    );
    expect(result.stdout).not.toMatch(/overlaps? "/);
  });

  // ── A2: aspectRatio support ────────────────────────────────────────

  it("accepts size with w + aspectRatio (deriving h)", () => {
    const result = runDeck(
      deckOf([
        slideOf("s1", [
          {
            id: "img1",
            type: "image",
            src: "./assets/x.png",
            alt: "ratio-sized",
            position: pos(100, 100),
            // No h — must be derived from aspectRatio
            size: { w: 400, aspectRatio: 1.778 },
          },
        ]),
      ]),
      "size-aspectratio",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/size\.w and size\.h must be numbers/);
    expect(result.stdout).not.toMatch(/size must specify/);
  });

  // ── $ref resolution ────────────────────────────────────────────────

  it("resolves slides[i].$ref entries before schema checks", () => {
    // Write a main deck with a $ref, and the referenced slide file next
    // to it. The validator must load the ref before running schema
    // checks, otherwise it would report the $ref placeholder as a
    // slide missing id/elements.
    const subDir = join(scratchDir, "ref-test");
    writeFileSync(
      join(scratchDir, "ref-test-dummy.txt"),
      "",
    );
    const slidesDir = join(scratchDir, "slides");
    try { rmSync(slidesDir, { recursive: true, force: true }); } catch { /* ignore */ }
    // Build a subfolder so we can have docs/slides/s100.json next to main.json
    const rootDir = mkdtempSync(join(tmpdir(), "tekkal-ref-test-"));
    try {
      const slidesSubdir = join(rootDir, "slides");
      writeFileSync(join(rootDir, ".keep"), "");
      // Create slides/ directory
      const fs = { mkdirSync: (d: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("node:fs").mkdirSync(d, { recursive: true });
        } catch { /* exists */ }
      } };
      fs.mkdirSync(slidesSubdir);
      // The referenced slide
      writeFileSync(
        join(slidesSubdir, "s100.json"),
        JSON.stringify({
          id: "s100",
          elements: [textEl("t1", "from-ref")],
        }, null, 2),
      );
      // Main deck with $ref
      const mainDeckPath = join(rootDir, "deck.json");
      writeFileSync(
        mainDeckPath,
        JSON.stringify(deckOf([{ $ref: "./slides/s100.json" }]), null, 2),
      );
      const result = runValidator(mainDeckPath);
      // Loader resolved the ref → validator saw a valid slide → PASS
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/RESULT: PASS/);
      // Should not complain about missing slide id/elements
      expect(result.stdout).not.toMatch(/Missing or empty slide id/);
      expect(result.stdout).not.toMatch(/non-array `elements`/);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      try { rmSync(subDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

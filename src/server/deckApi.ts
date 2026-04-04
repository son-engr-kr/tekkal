import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile, execFileSync } from "child_process";
import Ajv2020 from "ajv/dist/2020";
import { generateWizardDeck } from "../utils/projectTemplates";
import { mergeSlideFields } from "../utils/slideMerge";

const DECK_FILENAME = "deck.json";
const PROJECT_DIR = "projects";
const TEMPLATES_DIR = "templates";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

// -- Project-aware path helpers --

function projectsRoot(): string {
  return path.resolve(process.cwd(), PROJECT_DIR);
}

function projectDir(project: string): string {
  return path.resolve(projectsRoot(), project);
}

function deckPath(project: string): string {
  return path.resolve(projectDir(project), DECK_FILENAME);
}

function assetsDir(project: string): string {
  return path.resolve(projectDir(project), "assets");
}

function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function getProjectParam(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  const project = url.searchParams.get("project");
  assert(typeof project === "string" && project.length > 0, "Missing ?project= query parameter");
  assert(isValidProjectName(project), `Invalid project name: ${project}`);
  return project;
}

function loadSchema() {
  const schemaPath = path.resolve(process.cwd(), "src/schema/deck.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile(loadSchema());
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

function readBinaryBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Vite plugin that exposes API endpoints for deck.json operations.
 *
 * All endpoints (except /api/projects, /api/create-project, /api/delete-project)
 * require a `?project=name` query parameter.
 *
 * Editor endpoints:
 *   GET  /api/load-deck?project=name    — Read deck.json
 *   POST /api/save-deck?project=name    — Write deck.json (full replacement)
 *
 * Project management:
 *   GET  /api/projects          — List projects
 *   POST /api/create-project    — Create a new project
 *   POST /api/delete-project    — Delete a project
 *
 * AI tool endpoints (all require ?project=name):
 *   POST /api/ai/create-deck     — Create a new deck (validates against schema)
 *   POST /api/ai/add-slide       — Add a slide to the deck
 *   POST /api/ai/update-slide    — Update a slide by ID
 *   POST /api/ai/delete-slide    — Delete a slide by ID
 *   POST /api/ai/add-element     — Add an element to a slide
 *   POST /api/ai/update-element  — Update an element within a slide
 *   POST /api/ai/delete-element  — Delete an element from a slide
 *   GET  /api/ai/read-deck       — Read the current deck state
 *   POST /api/ai/extract-slide   — Extract an inline slide to an external file
 *   POST /api/ai/inline-slide    — Bring an external slide back inline
 *   GET  /api/ai/tools           — List available AI tools with schemas
 */
/** Cached serialized slide content per project, keyed by slide id */
const slideCache = new Map<string, Map<string, string>>();

export function deckApiPlugin(): Plugin {
  let validate: ReturnType<typeof createValidator>;
  let viteServer: Parameters<NonNullable<Plugin["configureServer"]>>[0];

  /** FNV-1a 32-bit hash (inline — server can't import client utils) */
  function fnv1aHash(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Content hash of the most recent editor save per project */
  const lastSaveHash = new Map<string, number>();
  // slideCache is at module level (above) so saveDeck() can access it
  /** Active fs.watch handles per project */
  const watchers = new Map<string, fs.FSWatcher[]>();

  /** Notify the browser that deck.json was modified by an AI tool */
  function notifyDeckChanged(project: string) {
    viteServer.ws.send({
      type: "custom",
      event: "deckode:deck-changed",
      data: { project },
    });
  }

  function watchProject(project: string) {
    if (watchers.has(project)) return;
    const dp = deckPath(project);
    if (!fs.existsSync(dp)) return;

    const allWatchers: fs.FSWatcher[] = [];
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        // Compare file content hash against last editor save
        const content = fs.readFileSync(dp, "utf-8");
        const hash = fnv1aHash(content);
        if (hash === lastSaveHash.get(project)) return; // our own save
        notifyDeckChanged(project);
      }, 300);
    };

    // Watch deck.json
    const deckWatcher = fs.watch(dp, onChange);
    deckWatcher.on("error", () => unwatchProject(project));
    allWatchers.push(deckWatcher);

    // Watch slides/ directory for external slide file changes
    const slidesDir = path.resolve(projectDir(project), "slides");
    if (fs.existsSync(slidesDir)) {
      const slidesWatcher = fs.watch(slidesDir, onChange);
      slidesWatcher.on("error", () => { /* slides dir may be deleted */ });
      allWatchers.push(slidesWatcher);
    }

    watchers.set(project, allWatchers);
  }

  function unwatchProject(project: string) {
    const w = watchers.get(project);
    if (w) {
      for (const watcher of w) watcher.close();
      watchers.delete(project);
    }
  }

  return {
    name: "deckode-api",
    configureServer(server) {
      viteServer = server;
      validate = createValidator();

      // -- Migrate legacy layouts --
      migrateToProjectDir();

      // -- Serving custom components: /components/{project}/{file}.tsx --

      server.middlewares.use("/components", async (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        const parts = urlPath.replace(/^\//, "").split("/").filter(Boolean);
        if (parts.length < 2) { next(); return; }
        const project = parts[0]!;
        if (!isValidProjectName(project)) { next(); return; }
        const fileName = parts.slice(1).join("/");
        const filePath = path.resolve(projectDir(project), "components", fileName);
        // Path traversal guard
        if (!filePath.startsWith(path.resolve(projectDir(project), "components"))) { next(); return; }
        if (!fs.existsSync(filePath)) { next(); return; }
        const source = fs.readFileSync(filePath, "utf-8");
        const result = await server.pluginContainer.transform(source, filePath);
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache",
        });
        res.end(result.code);
      });

      // -- List custom components: GET /api/list-components?project=name --

      server.middlewares.use("/api/list-components", (req, res) => {
        const project = getProjectParam(req);
        const componentsDir = path.resolve(projectDir(project), "components");
        if (!fs.existsSync(componentsDir)) {
          jsonResponse(res, 200, { components: [] });
          return;
        }
        const entries = fs.readdirSync(componentsDir);
        const components = entries
          .filter((f) => /\.(tsx|jsx)$/.test(f))
          .map((f) => f.replace(/\.(tsx|jsx)$/, ""));
        jsonResponse(res, 200, { components });
      });

      // -- List layouts: GET /api/list-layouts?project=name --

      server.middlewares.use("/api/list-layouts", (req, res) => {
        const project = getProjectParam(req);

        // Merge built-in layouts + project-level layouts (project overrides built-in)
        const builtinDir = path.resolve(process.cwd(), TEMPLATES_DIR, "default", "layouts");
        const projectLayoutDir = path.resolve(projectDir(project), "layouts");

        const layouts = new Map<string, { name: string; title: string }>();

        // Built-in layouts
        if (fs.existsSync(builtinDir)) {
          for (const f of fs.readdirSync(builtinDir)) {
            if (!f.endsWith(".json")) continue;
            const name = f.replace(/\.json$/, "");
            const data = JSON.parse(fs.readFileSync(path.resolve(builtinDir, f), "utf-8"));
            layouts.set(name, { name, title: data.title ?? name });
          }
        }

        // Project-level layouts (override built-in)
        if (fs.existsSync(projectLayoutDir)) {
          for (const f of fs.readdirSync(projectLayoutDir)) {
            if (!f.endsWith(".json")) continue;
            const name = f.replace(/\.json$/, "");
            const data = JSON.parse(fs.readFileSync(path.resolve(projectLayoutDir, f), "utf-8"));
            layouts.set(name, { name, title: data.title ?? name });
          }
        }

        jsonResponse(res, 200, { layouts: Array.from(layouts.values()) });
      });

      // -- Load layout: GET /api/load-layout?project=name&layout=name --

      server.middlewares.use("/api/load-layout", (req, res) => {
        const project = getProjectParam(req);
        const url = new URL(req.url ?? "/", "http://localhost");
        const layoutName = url.searchParams.get("layout");
        assert(typeof layoutName === "string" && layoutName.length > 0, "Missing ?layout= query parameter");
        assert(/^[a-zA-Z0-9_-]+$/.test(layoutName), `Invalid layout name: ${layoutName}`);

        // Project-level layout takes precedence
        const projectLayoutPath = path.resolve(projectDir(project), "layouts", `${layoutName}.json`);
        const builtinLayoutPath = path.resolve(process.cwd(), TEMPLATES_DIR, "default", "layouts", `${layoutName}.json`);

        const layoutPath = fs.existsSync(projectLayoutPath) ? projectLayoutPath : builtinLayoutPath;
        assert(fs.existsSync(layoutPath), `Layout "${layoutName}" not found`);

        const data = JSON.parse(fs.readFileSync(layoutPath, "utf-8"));
        jsonResponse(res, 200, { slide: data.slide });
      });

      // -- Static serving: /assets/{project}/* --

      server.middlewares.use("/assets", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        // URL format: /assets/{project}/{filename}
        // The urlPath here already has /assets stripped, so it starts with /{project}/{filename}
        const parts = urlPath.replace(/^\//, "").split("/").filter(Boolean);
        if (parts.length < 2) { next(); return; }
        const project = parts[0]!;
        if (!isValidProjectName(project)) { next(); return; }
        const relativeFile = parts.slice(1).join("/");
        const dir = assetsDir(project);
        const filePath = path.resolve(dir, relativeFile);
        if (!filePath.startsWith(dir)) { next(); return; }
        if (!fs.existsSync(filePath)) { next(); return; }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext];
        if (!mime) { next(); return; }
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath).pipe(res);
      });

      // -- Upload asset --

      server.middlewares.use("/api/upload-asset", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const contentType = req.headers["content-type"] ?? "";
        assert(
          contentType.startsWith("image/") || contentType.startsWith("video/") || contentType === "application/pdf",
          `Unsupported content type: ${contentType}`,
        );
        const rawFilename = req.headers["x-filename"];
        assert(typeof rawFilename === "string" && rawFilename.length > 0, "Missing X-Filename header");
        const filename = decodeURIComponent(rawFilename);

        const dir = assetsDir(project);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Deduplicate filename
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let finalName = filename;
        let counter = 0;
        while (fs.existsSync(path.resolve(dir, finalName))) {
          counter++;
          finalName = `${base}-${counter}${ext}`;
        }

        const buffer = await readBinaryBody(req);
        fs.writeFileSync(path.resolve(dir, finalName), buffer);
        jsonResponse(res, 200, { url: `./assets/${finalName}` });
      });

      // -- TikZ rendering endpoint --

      server.middlewares.use("/api/render-tikz", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const body = JSON.parse(await readBody(req));
        const { elementId, content, preamble } = body;
        assert(typeof elementId === "string" && elementId.length > 0, "Missing elementId");
        assert(typeof content === "string" && content.length > 0, "Missing content");

        const result = await compileTikz(project, elementId, content, preamble);
        if (result.ok) {
          jsonResponse(res, 200, { ok: true, svgUrl: result.svgUrl });
        } else {
          jsonResponse(res, 200, { ok: false, error: result.error });
        }
      });

      // -- Project management endpoints --

      server.middlewares.use("/api/projects", (_req, res) => {
        const root = projectsRoot();
        if (!fs.existsSync(root)) {
          jsonResponse(res, 200, { projects: [] });
          return;
        }
        const entries = fs.readdirSync(root, { withFileTypes: true });
        const projects = entries
          .filter((e) => e.isDirectory() && fs.existsSync(path.resolve(root, e.name, DECK_FILENAME)))
          .map((e) => {
            const dp = path.resolve(root, e.name, DECK_FILENAME);
            const deck = JSON.parse(fs.readFileSync(dp, "utf-8"));
            return {
              name: e.name,
              title: deck.meta?.title ?? e.name,
            };
          });
        jsonResponse(res, 200, { projects });
      });

      server.middlewares.use("/api/create-project", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const body = JSON.parse(await readBody(req));
        const name: string = body.name;
        assert(typeof name === "string" && isValidProjectName(name), `Invalid project name: ${name}`);
        const dir = projectDir(name);
        if (fs.existsSync(dir)) {
          jsonResponse(res, 409, { error: `Project "${name}" already exists` });
          return;
        }

        fs.mkdirSync(dir, { recursive: true });

        const templateKind: string = body.template ?? "example";
        let deck: any;

        if (templateKind === "wizard" && body.wizard) {
          deck = generateWizardDeck(body.wizard);
        } else if (templateKind === "blank") {
          const blankPath = path.resolve(process.cwd(), TEMPLATES_DIR, "blank", DECK_FILENAME);
          assert(fs.existsSync(blankPath), "Blank template not found");
          deck = JSON.parse(fs.readFileSync(blankPath, "utf-8"));
          if (body.title) {
            deck.meta = deck.meta ?? {};
            deck.meta.title = body.title;
          }
        } else {
          // "example" — current default behavior
          const templatePath = path.resolve(process.cwd(), TEMPLATES_DIR, "default", DECK_FILENAME);
          assert(fs.existsSync(templatePath), "Default template not found");
          deck = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
          if (body.title) {
            deck.meta = deck.meta ?? {};
            deck.meta.title = body.title;
          }
        }

        saveDeck(deckPath(name), deck, name);

        // Create assets directory for the project
        const projectAssetsDir = path.resolve(dir, "assets");
        if (!fs.existsSync(projectAssetsDir)) {
          fs.mkdirSync(projectAssetsDir, { recursive: true });
        }

        // Copy layouts into the project
        const builtinLayoutDir = path.resolve(process.cwd(), TEMPLATES_DIR, "default", "layouts");
        const projectLayoutDir = path.resolve(dir, "layouts");
        if (fs.existsSync(builtinLayoutDir)) {
          fs.cpSync(builtinLayoutDir, projectLayoutDir, { recursive: true });
        }

        // Copy AI discoverability docs
        const docsDir = path.resolve(dir, "docs");
        fs.mkdirSync(docsDir, { recursive: true });

        const guideSource = path.resolve(process.cwd(), "docs", "deckode-guide.md");
        if (fs.existsSync(guideSource)) {
          fs.copyFileSync(guideSource, path.resolve(docsDir, "deckode-guide.md"));
        }
        const guideDir = path.resolve(process.cwd(), "docs", "guide");
        if (fs.existsSync(guideDir)) {
          fs.cpSync(guideDir, path.resolve(docsDir, "guide"), { recursive: true });
        }

        jsonResponse(res, 200, { ok: true, name });
      });

      server.middlewares.use("/api/delete-project", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const body = JSON.parse(await readBody(req));
        const name: string = body.name;
        assert(typeof name === "string" && isValidProjectName(name), `Invalid project name: ${name}`);
        const dir = projectDir(name);
        assert(fs.existsSync(dir), `Project "${name}" not found`);

        fs.rmSync(dir, { recursive: true, force: true });
        jsonResponse(res, 200, { ok: true });
      });

      // -- Editor endpoints --

      server.middlewares.use("/api/load-deck", (req, res) => {
        const project = getProjectParam(req);
        const filePath = deckPath(project);
        if (!fs.existsSync(filePath)) {
          jsonResponse(res, 404, { error: "deck.json not found" });
          return;
        }
        // Migrate legacy absolute asset paths → relative ./assets/... on first load
        rewriteAssetUrls(filePath, project);
        const raw = fs.readFileSync(filePath, "utf-8");
        let deck: any;
        try {
          deck = JSON.parse(raw);
        } catch (e) {
          const msg = e instanceof SyntaxError ? e.message : String(e);
          jsonResponse(res, 422, { error: `Invalid JSON in deck.json: ${msg}` });
          return;
        }
        resolveSlideRefs(deck, path.dirname(filePath));
        // Populate slide cache from loaded deck
        const cache = new Map<string, string>();
        for (const slide of deck.slides) {
          if (slide._ref) {
            const { _ref, ...slideData } = slide;
            cache.set(slideData.id ?? _ref, JSON.stringify(slideData, null, 2));
          }
        }
        slideCache.set(project, cache);
        // Seed hash on first load so conflict detection works after server restart
        if (!lastSaveHash.has(project)) {
          lastSaveHash.set(project, fnv1aHash(raw));
        }
        watchProject(project);
        jsonResponse(res, 200, deck);
      });

      server.middlewares.use("/api/save-deck", async (req, res) => {
        if (req.method !== "POST") {
          jsonResponse(res, 405, { error: "Method not allowed" });
          return;
        }
        const project = getProjectParam(req);
        const body = await readBody(req);
        const deck = JSON.parse(body);
        const dp = deckPath(project);
        const dir = path.dirname(dp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Detect external modifications before writing
        const savedHash = lastSaveHash.get(project);
        if (savedHash !== undefined && fs.existsSync(dp)) {
          const currentContent = fs.readFileSync(dp, "utf-8");
          const currentHash = fnv1aHash(currentContent);
          if (currentHash !== savedHash) {
            // File was modified externally — return current disk version for client-side merge
            // Acknowledge the external change so the retry won't 409 again
            lastSaveHash.set(project, currentHash);
            const result = loadDeck(dp);
            if (result.ok) {
              jsonResponse(res, 409, { conflict: true, deck: result.deck });
              return;
            }
          }
        }

        // Get or create slide cache for this project
        if (!slideCache.has(project)) slideCache.set(project, new Map());
        const cache = slideCache.get(project)!;
        splitSlideRefs(deck, path.dirname(dp), cache);
        const serialized = JSON.stringify(deck, null, 2);
        const hash = fnv1aHash(serialized);
        const prevHash = lastSaveHash.get(project);
        // Set hash BEFORE disk write so fs.watch handler sees our hash
        lastSaveHash.set(project, hash);
        // Skip disk write if content is identical
        if (hash !== prevHash) {
          fs.writeFileSync(dp, serialized, "utf-8");
        }
        jsonResponse(res, 200, { ok: true });
      });

      // -- Git HEAD hash (for diff cache invalidation) --

      server.middlewares.use("/api/git-head-hash", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const absPath = url.searchParams.get("absPath");
        const dir = absPath ? path.resolve(absPath) : projectDir(getProjectParam(req));
        try {
          const hash = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: dir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          jsonResponse(res, 200, { hash });
        } catch {
          jsonResponse(res, 404, { error: "Not a git repository" });
        }
      });

      // -- Git base deck (for diff visualization) --

      server.middlewares.use("/api/git-base-deck", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const absPath = url.searchParams.get("absPath");

        // If absPath is provided (fsAccess mode), use it directly
        // Otherwise fall back to project-based path
        const projDir = absPath ? path.resolve(absPath) : projectDir(getProjectParam(req));
        const dp = absPath ? path.resolve(absPath, DECK_FILENAME) : deckPath(getProjectParam(req));

        // Find git repo that actually tracks this project's files.
        // 1. Check if the project dir itself is a git repo root
        // 2. Otherwise find ancestor repo and verify the file is tracked (not gitignored)
        let gitRoot: string;
        try {
          const found = execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: projDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();

          // If the git root IS the project dir, use it directly
          if (path.resolve(found) === path.resolve(projDir)) {
            gitRoot = found;
          } else {
            // Ancestor repo — verify the file is actually tracked (not gitignored)
            const relCheck = path.relative(found, dp).replace(/\\/g, "/");
            try {
              execFileSync("git", ["ls-files", "--error-unmatch", relCheck], {
                cwd: found,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
              });
              gitRoot = found;
            } catch {
              // File is gitignored or untracked in ancestor repo
              res.writeHead(204).end();
              return;
            }
          }
        } catch {
          res.writeHead(204).end();
          return;
        }

        const relPath = path.relative(gitRoot, dp).replace(/\\/g, "/");
        try {
          const raw = execFileSync("git", ["show", `HEAD:${relPath}`], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          let deck: any;
          try { deck = JSON.parse(raw); } catch { jsonResponse(res, 422, { error: "Invalid JSON in git HEAD" }); return; }
          // Resolve $ref slides from git HEAD
          if (Array.isArray(deck.slides)) {
            for (let i = 0; i < deck.slides.length; i++) {
              const entry = deck.slides[i];
              if (entry.$ref && typeof entry.$ref === "string") {
                const refRelPath = path.relative(gitRoot, path.resolve(path.dirname(dp), entry.$ref)).replace(/\\/g, "/");
                try {
                  const refRaw = execFileSync("git", ["show", `HEAD:${refRelPath}`], {
                    cwd: gitRoot,
                    encoding: "utf-8",
                    stdio: ["pipe", "pipe", "pipe"],
                  });
                  const slide = JSON.parse(refRaw);
                  slide._ref = entry.$ref;
                  deck.slides[i] = slide;
                } catch {
                  // Ref file not in git — skip
                }
              }
            }
          }
          jsonResponse(res, 200, deck);
        } catch {
          jsonResponse(res, 404, { error: "No git history for this file" });
        }
      });

      // -- AI tool: read-deck --

      server.middlewares.use("/api/ai/read-deck", (req, res) => {
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        jsonResponse(res, 200, result.deck);
      });

      // -- AI tool: list tools --

      server.middlewares.use("/api/ai/tools", (_req, res) => {
        jsonResponse(res, 200, AI_TOOLS_MANIFEST);
      });

      // -- AI tool: create-deck --

      server.middlewares.use("/api/ai/create-deck", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const body = await readBody(req);
        const deck = JSON.parse(body);
        const valid = validate(deck);
        if (!valid) {
          jsonResponse(res, 400, { error: "Schema validation failed", details: validate.errors });
          return;
        }
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slides: deck.slides.length });
      });

      // -- AI tool: add-slide --

      server.middlewares.use("/api/ai/add-slide", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slide, afterSlideId } = JSON.parse(await readBody(req));
        assert(slide && typeof slide === "object" && slide.id, "Missing slide object with id");
        assert(Array.isArray(slide.elements), "slide.elements must be an array");

        if (afterSlideId) {
          const idx = deck.slides.findIndex((s: any) => s.id === afterSlideId);
          assert(idx !== -1, `Slide ${afterSlideId} not found`);
          deck.slides.splice(idx + 1, 0, slide);
        } else {
          deck.slides.push(slide);
        }
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId: slide.id, totalSlides: deck.slides.length });
      });

      // -- AI tool: update-slide --

      server.middlewares.use("/api/ai/update-slide", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId, patch } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        assert(patch && typeof patch === "object", "Missing patch object");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        Object.assign(slide, patch, { id: slideId }); // preserve id
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId });
      });

      // -- AI tool: delete-slide --

      server.middlewares.use("/api/ai/delete-slide", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        const idx = deck.slides.findIndex((s: any) => s.id === slideId);
        assert(idx !== -1, `Slide ${slideId} not found`);
        deck.slides.splice(idx, 1);
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, remaining: deck.slides.length });
      });

      // -- AI tool: add-element --

      server.middlewares.use("/api/ai/add-element", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId, element } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        assert(element && typeof element === "object" && element.id, "Missing element object with id");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        slide.elements.push(element);
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId, elementId: element.id, totalElements: slide.elements.length });
      });

      // -- AI tool: update-element --

      server.middlewares.use("/api/ai/update-element", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId, elementId, patch } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        assert(typeof elementId === "string", "Missing elementId");
        assert(patch && typeof patch === "object", "Missing patch object");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        const element = slide.elements.find((e: any) => e.id === elementId);
        assert(element, `Element ${elementId} not found in slide ${slideId}`);
        Object.assign(element, patch, { id: elementId }); // preserve id
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId, elementId });
      });

      // -- AI tool: delete-element --

      server.middlewares.use("/api/ai/delete-element", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId, elementId } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        assert(typeof elementId === "string", "Missing elementId");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        const idx = slide.elements.findIndex((e: any) => e.id === elementId);
        assert(idx !== -1, `Element ${elementId} not found in slide ${slideId}`);
        slide.elements.splice(idx, 1);
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId, remaining: slide.elements.length });
      });

      // -- AI tool: extract-slide --

      server.middlewares.use("/api/ai/extract-slide", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        assert(!slide._ref, `Slide ${slideId} is already external (${slide._ref})`);

        const refPath = `./slides/${slideId}.json`;
        slide._ref = refPath;
        saveDeck(deckPath(project), deck, project);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId, ref: refPath });
      });

      // -- AI tool: inline-slide --

      server.middlewares.use("/api/ai/inline-slide", async (req, res) => {
        if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST only" }); return; }
        const project = getProjectParam(req);
        const result = loadDeck(deckPath(project));
        if (!result.ok) { jsonResponse(res, result.status, { error: result.error }); return; }
        const deck = result.deck;
        const { slideId } = JSON.parse(await readBody(req));
        assert(typeof slideId === "string", "Missing slideId");
        const slide = deck.slides.find((s: any) => s.id === slideId);
        assert(slide, `Slide ${slideId} not found`);
        assert(slide._ref, `Slide ${slideId} is already inline`);

        const refPath = path.resolve(projectDir(project), slide._ref);
        delete slide._ref;
        saveDeck(deckPath(project), deck, project);
        // Remove the external file
        if (fs.existsSync(refPath)) fs.unlinkSync(refPath);
        notifyDeckChanged(project);
        jsonResponse(res, 200, { ok: true, slideId });
      });
    },
  };
}

// -- Helpers --

type LoadDeckResult =
  | { ok: true; deck: any }
  | { ok: false; error: string; status: number };

function loadDeck(filePath: string): LoadDeckResult {
  if (!fs.existsSync(filePath))
    return { ok: false, error: "deck.json not found", status: 404 };
  const raw = fs.readFileSync(filePath, "utf-8");
  let deck: any;
  try {
    deck = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof SyntaxError ? e.message : String(e);
    return { ok: false, error: `Invalid JSON in deck.json: ${msg}`, status: 422 };
  }
  resolveSlideRefs(deck, path.dirname(filePath));
  return { ok: true, deck };
}

function saveDeck(filePath: string, deck: any, project?: string) {
  const projectRoot = path.dirname(filePath);
  // AI tool saves invalidate the slide cache so the editor re-reads from disk
  if (project) slideCache.delete(project);
  splitSlideRefs(deck, projectRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(deck, null, 2);
  // Skip write if deck.json content is identical
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === serialized) return;
  }
  fs.writeFileSync(filePath, serialized, "utf-8");
}

/**
 * Resolve `{ "$ref": "./slides/foo.json" }` entries in deck.slides
 * by reading the referenced file and injecting `_ref` to track origin.
 */
function resolveSlideRefs(deck: any, projectRoot: string): void {
  if (!Array.isArray(deck.slides)) return;
  for (let i = 0; i < deck.slides.length; i++) {
    const entry = deck.slides[i];
    if (entry.$ref && typeof entry.$ref === "string") {
      const refPath = path.resolve(projectRoot, entry.$ref);
      assert(fs.existsSync(refPath), `Slide $ref file not found: ${entry.$ref}`);
      const slide = JSON.parse(fs.readFileSync(refPath, "utf-8"));
      slide._ref = entry.$ref;
      deck.slides[i] = slide;
    }
  }
}

/**
 * For each slide with `_ref`, write it to its external file and replace
 * the slide in-array with `{ "$ref": "..." }`. Mutates the deck object.
 * Only writes slide files whose content actually changed (compared against in-memory cache).
 */
function splitSlideRefs(deck: any, projectRoot: string, cache?: Map<string, string>): void {
  if (!Array.isArray(deck.slides)) return;
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    if (slide._ref && typeof slide._ref === "string") {
      const refPath = path.resolve(projectRoot, slide._ref);
      const refDir = path.dirname(refPath);
      if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
      const { _ref, ...slideData } = slide;
      const serialized = JSON.stringify(slideData, null, 2);
      const slideId = slideData.id ?? _ref;
      const cached = cache?.get(slideId);

      if (cached !== serialized) {
        // Check if the file was modified externally before writing
        if (cached && fs.existsSync(refPath)) {
          const diskContent = fs.readFileSync(refPath, "utf-8");
          if (diskContent !== cached) {
            // External modification detected — merge element by element
            try {
              const diskSlide = JSON.parse(diskContent);
              const baseSlide = JSON.parse(cached);
              const merged = mergeSlideFields(baseSlide, slideData, diskSlide);
              const mergedSerialized = JSON.stringify(merged, null, 2);
              fs.writeFileSync(refPath, mergedSerialized, "utf-8");
              cache?.set(slideId, mergedSerialized);
              deck.slides[i] = { $ref: _ref };
              continue;
            } catch {
              // Merge failed — fall through to overwrite
            }
          }
        }
        fs.writeFileSync(refPath, serialized, "utf-8");
      }
      cache?.set(slideId, serialized);
      deck.slides[i] = { $ref: _ref };
    }
  }
}


function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Migrate legacy layouts into the multi-project structure.
 *
 * Phase 1: root-level deck.json/assets/ → projects/deck.json + projects/assets/
 *          (handled by previous migration, may already be done)
 *
 * Phase 2: flat projects/deck.json → projects/default/deck.json
 *          Also rewrites /assets/foo → /assets/default/foo in element src fields.
 */
function migrateToProjectDir() {
  const root = projectsRoot();
  const cwd = process.cwd();

  // Phase 1: root-level legacy files → projects/
  const legacyDeck = path.resolve(cwd, DECK_FILENAME);
  const legacyAssets = path.resolve(cwd, "assets");

  if (fs.existsSync(legacyDeck) || fs.existsSync(legacyAssets)) {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    if (fs.existsSync(legacyDeck)) {
      // Move to projects/default/ directly (skip the intermediate flat layout)
      const dest = path.resolve(root, "default", DECK_FILENAME);
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(legacyDeck, dest);
      console.log(`[deckode] Migrated ${DECK_FILENAME} → ${PROJECT_DIR}/default/${DECK_FILENAME}`);
    }
    if (fs.existsSync(legacyAssets) && fs.statSync(legacyAssets).isDirectory()) {
      const dest = path.resolve(root, "default", "assets");
      fs.cpSync(legacyAssets, dest, { recursive: true });
      fs.rmSync(legacyAssets, { recursive: true, force: true });
      console.log(`[deckode] Migrated assets/ → ${PROJECT_DIR}/default/assets/`);
    }
    // Rewrite asset URLs in the migrated deck
    rewriteAssetUrls(path.resolve(root, "default", DECK_FILENAME), "default");
    return; // Phase 1 done, skip phase 2
  }

  // Phase 2: flat projects/deck.json → projects/default/deck.json
  const flatDeck = path.resolve(root, DECK_FILENAME);
  const flatAssets = path.resolve(root, "assets");

  if (fs.existsSync(flatDeck)) {
    const defaultDir = path.resolve(root, "default");
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });

    const dest = path.resolve(defaultDir, DECK_FILENAME);
    fs.renameSync(flatDeck, dest);
    console.log(`[deckode] Migrated ${PROJECT_DIR}/${DECK_FILENAME} → ${PROJECT_DIR}/default/${DECK_FILENAME}`);

    if (fs.existsSync(flatAssets) && fs.statSync(flatAssets).isDirectory()) {
      const assetsDest = path.resolve(defaultDir, "assets");
      fs.cpSync(flatAssets, assetsDest, { recursive: true });
      fs.rmSync(flatAssets, { recursive: true, force: true });
      console.log(`[deckode] Migrated ${PROJECT_DIR}/assets/ → ${PROJECT_DIR}/default/assets/`);
    }

    // Rewrite asset URLs: /assets/foo → /assets/default/foo
    rewriteAssetUrls(dest, "default");
  }
}

/** Rewrite /assets/{project}/... → ./assets/... (and bare /assets/file → ./assets/file) */
function rewriteAssetUrls(deckFilePath: string, project: string) {
  if (!fs.existsSync(deckFilePath)) return;
  const raw = fs.readFileSync(deckFilePath, "utf-8");
  // Match src or svgUrl values that start with /assets/
  const rewritten = raw.replace(
    /"(src|svgUrl)"\s*:\s*"\/assets\/([^"]+)"/g,
    (_match, prop, rest) => {
      // Strip the project segment if present: /assets/{project}/foo → ./assets/foo
      if (rest.startsWith(`${project}/`)) {
        return `"${prop}": "./assets/${rest.slice(project.length + 1)}"`;
      }
      // Bare /assets/filename → ./assets/filename
      return `"${prop}": "./assets/${rest}"`;
    },
  );
  if (rewritten !== raw) {
    fs.writeFileSync(deckFilePath, rewritten, "utf-8");
    console.log(`[deckode] Rewrote asset URLs to relative format in ${deckFilePath}`);
  }
}

// -- TikZ compilation pipeline --

export function wrapTikzDocument(content: string, preamble?: string): string {
  if (content.includes("\\documentclass")) return content;
  return [
    "\\documentclass[dvisvgm]{standalone}",
    "\\usepackage{tikz}",
    "\\usepackage{pgfplots}",
    "\\usepackage{circuitikz}",
    "\\pgfplotsset{compat=1.18}",
    "\\usetikzlibrary{arrows,arrows.meta,shapes,shapes.geometric,shapes.symbols,positioning,calc,patterns,decorations.pathmorphing,decorations.markings,matrix,fit,backgrounds,circuits.ee.IEC,circuits.logic.IEC,automata,trees,mindmap}",
    preamble ?? "",
    "\\begin{document}",
    content,
    "\\end{document}",
  ].join("\n");
}

function execPromise(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function parseTexErrors(logContent: string): string {
  const lines = logContent.split("\n");
  const errorLines: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith("!")) {
      capture = true;
      errorLines.push(line);
    } else if (capture) {
      errorLines.push(line);
      if (errorLines.length >= 6) capture = false;
    }
  }
  return errorLines.length > 0 ? errorLines.join("\n") : "Unknown TeX compilation error";
}

let latexAvailable: boolean | null = null;

function checkLatexAvailable(): boolean {
  if (latexAvailable !== null) return latexAvailable;
  try {
    execFileSync("latex", ["--version"], { timeout: 5000, stdio: "ignore" });
    execFileSync("dvisvgm", ["--version"], { timeout: 5000, stdio: "ignore" });
    latexAvailable = true;
  } catch {
    latexAvailable = false;
  }
  return latexAvailable;
}

async function compileTikz(
  project: string,
  elementId: string,
  content: string,
  preamble?: string,
): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }> {
  if (!checkLatexAvailable()) {
    return {
      ok: false,
      error: "LaTeX compiler not found. Install TeX Live (or MiKTeX) and ensure 'latex' and 'dvisvgm' are on your PATH.",
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deckode-tikz-"));

  const texSource = wrapTikzDocument(content, preamble);
  const texFile = path.join(tmpDir, "input.tex");
  fs.writeFileSync(texFile, texSource, "utf-8");

  // Step 1: latex → DVI
  try {
    await execPromise("latex", [
      "--interaction=nonstopmode",
      `-output-directory=${tmpDir}`,
      texFile,
    ], tmpDir);
  } catch (e: any) {
    const logFile = path.join(tmpDir, "input.log");
    const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    const error = parseTexErrors(logContent);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: false, error };
  }

  // Step 2: dvisvgm → SVG
  const dviFile = path.join(tmpDir, "input.dvi");
  const svgTmp = path.join(tmpDir, "output.svg");

  try {
    await execPromise("dvisvgm", [
      "--no-fonts",
      "--exact",
      dviFile,
      "-o", svgTmp,
    ], tmpDir);
  } catch (e: any) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: false, error: `dvisvgm failed: ${(e as any).stderr ?? "unknown error"}` };
  }

  assert(fs.existsSync(svgTmp), "dvisvgm produced no output SVG");

  // Step 3: Copy SVG to project assets
  const tikzDir = path.join(assetsDir(project), "tikz");
  if (!fs.existsSync(tikzDir)) fs.mkdirSync(tikzDir, { recursive: true });

  const destSvg = path.join(tikzDir, `${elementId}.svg`);
  fs.copyFileSync(svgTmp, destSvg);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const svgUrl = `./assets/tikz/${elementId}.svg?v=${Date.now()}`;
  return { ok: true, svgUrl };
}

// -- AI Tools Manifest --

const AI_TOOLS_MANIFEST = {
  name: "deckode",
  description: "AI tools for creating and modifying Deckode slide decks. All endpoints require ?project=name parameter.",
  guide: "/docs/deckode-guide.md",
  schema: "/src/schema/deck.schema.json",
  tools: [
    {
      name: "create-deck",
      method: "POST",
      endpoint: "/api/ai/create-deck?project={name}",
      description: "Create a new deck. Body: full deck.json object. Validates against schema.",
      body: "Deck (full deck.json)",
    },
    {
      name: "add-slide",
      method: "POST",
      endpoint: "/api/ai/add-slide?project={name}",
      description: "Add a slide to the deck.",
      body: '{ "slide": Slide, "afterSlideId"?: string }',
    },
    {
      name: "update-slide",
      method: "POST",
      endpoint: "/api/ai/update-slide?project={name}",
      description: "Update a slide by ID (partial patch).",
      body: '{ "slideId": string, "patch": Partial<Slide> }',
    },
    {
      name: "delete-slide",
      method: "POST",
      endpoint: "/api/ai/delete-slide?project={name}",
      description: "Delete a slide by ID.",
      body: '{ "slideId": string }',
    },
    {
      name: "add-element",
      method: "POST",
      endpoint: "/api/ai/add-element?project={name}",
      description: "Add an element to a slide.",
      body: '{ "slideId": string, "element": Element }',
    },
    {
      name: "update-element",
      method: "POST",
      endpoint: "/api/ai/update-element?project={name}",
      description: "Update an element within a slide (partial patch).",
      body: '{ "slideId": string, "elementId": string, "patch": Partial<Element> }',
    },
    {
      name: "delete-element",
      method: "POST",
      endpoint: "/api/ai/delete-element?project={name}",
      description: "Delete an element from a slide.",
      body: '{ "slideId": string, "elementId": string }',
    },
    {
      name: "read-deck",
      method: "GET",
      endpoint: "/api/ai/read-deck?project={name}",
      description: "Read the current deck state. Returns the full deck.json object.",
      body: null,
    },
    {
      name: "extract-slide",
      method: "POST",
      endpoint: "/api/ai/extract-slide?project={name}",
      description: "Extract an inline slide to an external file (./slides/{slideId}.json) and replace it with a $ref pointer in deck.json.",
      body: '{ "slideId": string }',
    },
    {
      name: "inline-slide",
      method: "POST",
      endpoint: "/api/ai/inline-slide?project={name}",
      description: "Bring an external $ref slide back inline into deck.json and delete the external file.",
      body: '{ "slideId": string }',
    },
  ],
};

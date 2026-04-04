import type { Deck } from "@/types/deck";
import type { FileSystemAdapter, ProjectInfo } from "./types";
import type { NewProjectConfig } from "@/utils/projectTemplates";
import { saveHandle, clearHandle } from "@/utils/handleStore";
import { generateBlankDeck, generateWizardDeck } from "@/utils/projectTemplates";
import { assert } from "@/utils/assert";
import { fnv1aHash } from "@/utils/hash";

// Bundled template data for prod/FS Access mode (no server available)
import exampleDeck from "../../templates/default/deck.json";
import aiGuideText from "../../docs/deckode-guide.md?raw";
import guide01 from "../../docs/guide/01-overview.md?raw";
import guide02 from "../../docs/guide/02-slide-splitting.md?raw";
import guide03a from "../../docs/guide/03a-schema-deck.md?raw";
import guide03b from "../../docs/guide/03b-schema-elements.md?raw";
import guide04a from "../../docs/guide/04a-elem-text-code.md?raw";
import guide04b from "../../docs/guide/04b-elem-media.md?raw";
import guide04c from "../../docs/guide/04c-elem-shape.md?raw";
import guide04d from "../../docs/guide/04d-elem-tikz.md?raw";
import guide04e from "../../docs/guide/04e-elem-diagrams.md?raw";
import guide04f from "../../docs/guide/04f-elem-table-mermaid.md?raw";
import guide04g from "../../docs/guide/04g-elem-scene3d.md?raw";
import guide04h from "../../docs/guide/04h-elem-scene3d-examples.md?raw";
import guide05 from "../../docs/guide/05-animations.md?raw";
import guide06 from "../../docs/guide/06-theme.md?raw";
import guide07 from "../../docs/guide/07-slide-features.md?raw";
import guide08a from "../../docs/guide/08a-guidelines.md?raw";
import guide08b from "../../docs/guide/08b-style-preferences.md?raw";
import guide08c from "../../docs/guide/08c-visual-style.md?raw";
import guide09 from "../../docs/guide/09-example.md?raw";

const BUNDLED_GUIDE_FILES: Record<string, string> = {
  "01-overview.md": guide01,
  "02-slide-splitting.md": guide02,
  "03a-schema-deck.md": guide03a,
  "03b-schema-elements.md": guide03b,
  "04a-elem-text-code.md": guide04a,
  "04b-elem-media.md": guide04b,
  "04c-elem-shape.md": guide04c,
  "04d-elem-tikz.md": guide04d,
  "04e-elem-diagrams.md": guide04e,
  "04f-elem-table-mermaid.md": guide04f,
  "04g-elem-scene3d.md": guide04g,
  "04h-elem-scene3d-examples.md": guide04h,
  "05-animations.md": guide05,
  "06-theme.md": guide06,
  "07-slide-features.md": guide07,
  "08a-guidelines.md": guide08a,
  "08b-style-preferences.md": guide08b,
  "08c-visual-style.md": guide08c,
  "09-example.md": guide09,
};
import layoutBlank from "../../templates/default/layouts/blank.json";
import layoutTitle from "../../templates/default/layouts/title.json";
import layoutTitleContent from "../../templates/default/layouts/title-content.json";
import layoutTwoColumn from "../../templates/default/layouts/two-column.json";
import layoutSectionHeader from "../../templates/default/layouts/section-header.json";
import layoutCodeSlide from "../../templates/default/layouts/code-slide.json";
import layoutImageLeft from "../../templates/default/layouts/image-left.json";

const BUNDLED_LAYOUTS: Record<string, unknown> = {
  "blank": layoutBlank,
  "title": layoutTitle,
  "title-content": layoutTitleContent,
  "two-column": layoutTwoColumn,
  "section-header": layoutSectionHeader,
  "code-slide": layoutCodeSlide,
  "image-left": layoutImageLeft,
};

export class FsAccessAdapter implements FileSystemAdapter {
  readonly mode = "fs-access" as const;
  readonly dirHandle: FileSystemDirectoryHandle;
  private blobUrlCache_ = new Map<string, string>();
  /** Expose cached blob URLs for cross-window sharing (e.g. pop-out audience view). */
  get blobUrlCache(): ReadonlyMap<string, string> {
    return this.blobUrlCache_;
  }
  readonly projectName: string;
  private _lastSaveHash: number | null = null;
  private _slideRefCache = new Map<string, string>();

  /** Check if a slide's content matches the last saved/loaded version (self-save detection) */
  isSlideRefCached(slideId: string, content: string): boolean {
    return this._slideRefCache.get(slideId) === content;
  }

  get lastSaveHash(): number | null {
    return this._lastSaveHash;
  }

  constructor(dirHandle: FileSystemDirectoryHandle) {
    this.dirHandle = dirHandle;
    this.projectName = dirHandle.name;
  }

  static async openDirectory(): Promise<FsAccessAdapter> {
    // showDirectoryPicker is part of the File System Access API (Chrome/Edge)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const showDirectoryPicker = (window as any).showDirectoryPicker as (
      options?: { mode?: "read" | "readwrite" },
    ) => Promise<FileSystemDirectoryHandle>;
    const dirHandle = await showDirectoryPicker({ mode: "readwrite" });
    await saveHandle(dirHandle);
    return new FsAccessAdapter(dirHandle);
  }

  static fromHandle(dirHandle: FileSystemDirectoryHandle): FsAccessAdapter {
    return new FsAccessAdapter(dirHandle);
  }

  /** Remove the persisted handle (call when user explicitly closes project). */
  static forget(): Promise<void> {
    return clearHandle();
  }

  /**
   * Write a new project into the given directory handle.
   * Creates deck.json, layouts/, and docs/ with AI discoverability files.
   *
   * If `config.name` is provided, a subdirectory `{name}/` is created inside
   * `dirHandle` and all files are written there. Returns the actual project
   * directory handle (the subdirectory when name is given, dirHandle otherwise).
   */
  static async writeNewProject(
    dirHandle: FileSystemDirectoryHandle,
    config: NewProjectConfig,
  ): Promise<FileSystemDirectoryHandle> {
    // If a project name is provided, create a subdirectory for the project
    const projectDir = config.name
      ? await dirHandle.getDirectoryHandle(config.name, { create: true })
      : dirHandle;

    // Check for existing deck.json to prevent overwrite
    let exists = true;
    try { await projectDir.getFileHandle("deck.json"); } catch { exists = false; }
    assert(!exists, "This folder already contains a deck.json. Pick an empty folder or remove the existing file.");

    // Generate deck based on template kind
    let deck: Deck;
    if (config.template === "wizard" && config.wizard) {
      deck = generateWizardDeck(config.wizard);
    } else if (config.template === "blank") {
      deck = generateBlankDeck(config.title);
    } else {
      // "example" — use bundled default deck
      deck = JSON.parse(JSON.stringify(exampleDeck)) as Deck;
      if (config.title) {
        deck.meta.title = config.title;
      }
    }

    // Write deck.json
    await writeTextFile(projectDir, "deck.json", JSON.stringify(deck, null, 2));

    // Write layouts/
    const layoutsDir = await projectDir.getDirectoryHandle("layouts", { create: true });
    for (const [name, data] of Object.entries(BUNDLED_LAYOUTS)) {
      await writeTextFile(layoutsDir, `${name}.json`, JSON.stringify(data, null, 2));
    }

    // Write docs/
    const docsDir = await projectDir.getDirectoryHandle("docs", { create: true });
    await writeTextFile(docsDir, "deckode-guide.md", aiGuideText);
    const guideDir = await docsDir.getDirectoryHandle("guide", { create: true });
    for (const [name, content] of Object.entries(BUNDLED_GUIDE_FILES)) {
      await writeTextFile(guideDir, name, content);
    }

    return projectDir;
  }

  async loadDeck(): Promise<Deck> {
    const fileHandle = await this.dirHandle.getFileHandle("deck.json");
    const file = await fileHandle.getFile();
    const text = await file.text();
    let deck: Deck;
    try {
      deck = JSON.parse(text) as Deck;
    } catch (e) {
      const msg = e instanceof SyntaxError ? e.message : String(e);
      throw new Error(`Invalid JSON in deck.json: ${msg}`);
    }
    await this.resolveSlideRefs(deck);
    return deck;
  }

  /** Resolve `{ "$ref": "./slides/foo.json" }` entries by reading from the directory handle.
   *  Also populates _slideRefCache with raw disk content for external change detection.
   *  Missing files are replaced with a placeholder slide instead of throwing. */
  private async resolveSlideRefs(deck: Deck): Promise<void> {
    this._slideRefCache.clear();
    for (let i = 0; i < deck.slides.length; i++) {
      const entry = deck.slides[i] as any;
      if (entry.$ref && typeof entry.$ref === "string") {
        try {
          const refParts = entry.$ref.replace(/^\.\//, "").split("/");
          let dir = this.dirHandle;
          for (let j = 0; j < refParts.length - 1; j++) {
            dir = await dir.getDirectoryHandle(refParts[j]!);
          }
          const fh = await dir.getFileHandle(refParts[refParts.length - 1]!);
          const f = await fh.getFile();
          const rawText = await f.text();
          const slide = JSON.parse(rawText);
          slide._ref = entry.$ref;
          deck.slides[i] = slide;
          const slideId = slide.id ?? entry.$ref;
          this._slideRefCache.set(slideId, rawText);
        } catch {
          console.warn(`[FsAccessAdapter] Missing slide ref: ${entry.$ref}`);
          deck.slides[i] = {
            id: `missing-${i}`,
            _ref: entry.$ref,
            _missing: true,
            elements: [],
          };
        }
      }
    }
  }

  async saveDeck(deck: Deck): Promise<Deck | null> {
    // Detect external modification of deck.json
    if (this._lastSaveHash !== null) {
      try {
        const fileHandle = await this.dirHandle.getFileHandle("deck.json");
        const file = await fileHandle.getFile();
        const currentContent = await file.text();
        const currentHash = fnv1aHash(currentContent);
        if (currentHash !== this._lastSaveHash) {
          const diskDeck = JSON.parse(currentContent) as Deck;
          return diskDeck;
        }
      } catch {
        // File doesn't exist yet — proceed with save
      }
    }

    // Detect external modification of individual $ref slide files
    const externallyModified = await this.checkSlideRefChanges(deck);
    if (externallyModified) {
      // Re-load the full deck from disk and return it for client-side merge
      const diskDeck = await this.loadDeck();
      return diskDeck;
    }

    // Shallow-copy to avoid mutating frozen state (Immer/Zustand)
    const mutableDeck = { ...deck, slides: [...deck.slides] };
    await this.splitSlideRefs(mutableDeck);
    const fileHandle = await this.dirHandle.getFileHandle("deck.json", { create: true });
    const writable = await fileHandle.createWritable();
    const serialized = JSON.stringify(mutableDeck, null, 2);
    this._lastSaveHash = fnv1aHash(serialized);
    await writable.write(serialized);
    await writable.close();
    return null;
  }

  /** Check if any $ref slide files were modified externally since last save/load. */
  private async checkSlideRefChanges(deck: Deck): Promise<boolean> {
    for (const slide of deck.slides) {
      if (!slide._ref || slide._missing) continue;
      const { _ref, ...slideData } = slide as any;
      const slideId = slideData.id ?? _ref;
      const cached = this._slideRefCache.get(slideId);
      if (!cached) continue;

      try {
        const refParts = _ref.replace(/^\.\//, "").split("/");
        let dir: FileSystemDirectoryHandle = this.dirHandle;
        for (let j = 0; j < refParts.length - 1; j++) {
          dir = await dir.getDirectoryHandle(refParts[j]!);
        }
        const fh = await dir.getFileHandle(refParts[refParts.length - 1]!);
        const file = await fh.getFile();
        const diskContent = await file.text();
        if (diskContent !== cached) return true;
      } catch {
        // File doesn't exist — no external change
      }
    }
    return false;
  }

  /** Write slides with `_ref` to their external files and replace them with `{ "$ref": "..." }`. */
  private async splitSlideRefs(deck: Deck): Promise<void> {
    for (let i = 0; i < deck.slides.length; i++) {
      const slide = deck.slides[i]!;
      if (slide._missing) {
        // Preserve the $ref pointer but don't write the missing file
        deck.slides[i] = { $ref: slide._ref } as any;
        continue;
      }
      if (slide._ref) {
        const refParts = slide._ref.replace(/^\.\//, "").split("/");
        let dir = this.dirHandle;
        for (let j = 0; j < refParts.length - 1; j++) {
          dir = await dir.getDirectoryHandle(refParts[j]!, { create: true });
        }
        const { _ref, ...slideData } = slide;
        const serialized = JSON.stringify(slideData, null, 2);
        const slideId = (slideData as any).id ?? _ref;
        const fh = await dir.getFileHandle(refParts[refParts.length - 1]!, { create: true });
        const writable = await fh.createWritable();
        await writable.write(serialized);
        await writable.close();
        this._slideRefCache.set(slideId, serialized);
        deck.slides[i] = { $ref: _ref } as any;
      }
    }
  }

  async listProjects(): Promise<ProjectInfo[]> {
    // Single project = the opened directory
    const deck = await this.loadDeck();
    return [{ name: this.projectName, title: deck.meta.title }];
  }

  async createProject(_name: string, _config: NewProjectConfig): Promise<void> {
    throw new Error("Creating projects is not supported in File System Access mode. Use writeNewProject() instead.");
  }

  async deleteProject(_name: string): Promise<void> {
    throw new Error("Deleting projects is not supported in File System Access mode.");
  }

  async uploadAsset(file: File): Promise<string> {
    const assetsDir = await this.dirHandle.getDirectoryHandle("assets", { create: true });

    // Deduplicate filename
    let name = file.name;
    let counter = 1;
    while (true) {
      try {
        await assetsDir.getFileHandle(name);
        // File exists, generate a new name
        const dot = file.name.lastIndexOf(".");
        const base = dot === -1 ? file.name : file.name.slice(0, dot);
        const ext = dot === -1 ? "" : file.name.slice(dot);
        name = `${base}-${counter}${ext}`;
        counter++;
      } catch {
        // File doesn't exist, use this name
        break;
      }
    }

    const fileHandle = await assetsDir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();

    const storedPath = `./assets/${name}`;
    // Pre-cache the blob URL
    const blob = new Blob([file], { type: file.type });
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrlCache_.set(storedPath, blobUrl);

    return storedPath;
  }

  async resolveAssetUrl(path: string): Promise<string | undefined> {
    const cached = this.blobUrlCache_.get(path);
    if (cached) return cached;

    // Strip query string (dev server adds ?v=timestamp as cache-buster)
    const qIdx = path.indexOf("?");
    const cleanPath = qIdx === -1 ? path : path.slice(0, qIdx);

    // Support both new (./assets/...) and legacy (/assets/{project}/...) formats
    let subParts: string[];
    if (cleanPath.startsWith("./")) {
      // New format: ./assets/subdir/filename
      const parts = cleanPath.slice(2).split("/");
      assert(parts.length >= 2 && parts[0] === "assets", `Invalid asset path: ${path}`);
      subParts = parts.slice(1); // everything after "assets"
    } else {
      // Legacy format: /assets/{project}/subdir/filename
      const parts = cleanPath.replace(/^\//, "").split("/");
      assert(parts.length >= 3, `Invalid asset path: ${path}`);
      subParts = parts.slice(2); // everything after "assets/{projectName}"
    }
    const fileName = subParts.pop()!;
    assert(fileName.length > 0, `Empty filename in asset path: ${path}`);

    // Strip invisible Unicode characters that the FS Access API rejects
    // (e.g. U+200B zero-width space embedded in filenames from browser downloads)
    const stripInvisible = (s: string) => s.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "");

    let dir = await this.dirHandle.getDirectoryHandle("assets");
    for (const sub of subParts) {
      dir = await dir.getDirectoryHandle(stripInvisible(sub));
    }

    const sanitizedName = stripInvisible(fileName);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await dir.getFileHandle(sanitizedName);
    } catch {
      // File not found — return undefined so <img onError> can trigger re-render
      console.warn(
        `[FsAccessAdapter] Asset not found: "${sanitizedName}" (path: "${path}"). ` +
        `The file may have been uploaded via the dev server or deleted.`
      );
      return undefined;
    }
    const file = await fileHandle.getFile();
    const blobUrl = URL.createObjectURL(file);
    this.blobUrlCache_.set(path, blobUrl);
    return blobUrl;
  }

  async listComponents(): Promise<string[]> {
    let componentsDir: FileSystemDirectoryHandle;
    try {
      componentsDir = await this.dirHandle.getDirectoryHandle("components");
    } catch {
      return [];
    }
    const names: string[] = [];
    for await (const [name, handle] of componentsDir as any) {
      if (handle.kind === "file" && /\.(tsx|jsx)$/.test(name)) {
        names.push(name.replace(/\.(tsx|jsx)$/, ""));
      }
    }
    return names;
  }

  async listLayouts(): Promise<{ name: string; title: string }[]> {
    const layouts: { name: string; title: string }[] = [];
    let layoutsDir: FileSystemDirectoryHandle;
    try {
      layoutsDir = await this.dirHandle.getDirectoryHandle("layouts");
    } catch {
      return layouts;
    }
    for await (const [name, handle] of layoutsDir as any) {
      if (handle.kind === "file" && name.endsWith(".json")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        const data = JSON.parse(await file.text());
        const layoutName = name.replace(/\.json$/, "");
        layouts.push({ name: layoutName, title: data.title ?? layoutName });
      }
    }
    return layouts;
  }

  async loadLayout(layoutName: string): Promise<import("@/types/deck").Slide> {
    let layoutsDir: FileSystemDirectoryHandle;
    try {
      layoutsDir = await this.dirHandle.getDirectoryHandle("layouts");
    } catch {
      throw new Error(`[FsAccessAdapter] No layouts/ directory found`);
    }
    const fileHandle = await layoutsDir.getFileHandle(`${layoutName}.json`);
    const file = await fileHandle.getFile();
    const data = JSON.parse(await file.text());
    assert(data.slide, `Layout "${layoutName}" missing "slide" property`);
    return data.slide;
  }

  async renderTikz(
    elementId: string,
    content: string,
    preamble?: string,
  ): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }> {
    const { renderTikzToSvg } = await import("@/utils/tikzjax");
    const svgMarkup = await renderTikzToSvg(content, preamble);

    // Write SVG to assets/tikz/{elementId}.svg
    const assetsDir = await this.dirHandle.getDirectoryHandle("assets", { create: true });
    const tikzDir = await assetsDir.getDirectoryHandle("tikz", { create: true });
    const fileHandle = await tikzDir.getFileHandle(`${elementId}.svg`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(svgMarkup);
    await writable.close();

    // Cache a blob URL for immediate display.
    // Append ?v=timestamp so useAssetUrl detects the change (same element ID
    // produces the same base path, so React's useEffect wouldn't re-fire).
    const basePath = `./assets/tikz/${elementId}.svg`;
    const storedPath = `${basePath}?v=${Date.now()}`;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrlCache_.set(storedPath, blobUrl);

    return { ok: true, svgUrl: storedPath };
  }
}

async function writeTextFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

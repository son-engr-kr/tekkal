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

    return projectDir;
  }

  async loadDeck(): Promise<Deck> {
    const fileHandle = await this.dirHandle.getFileHandle("deck.json");
    const file = await fileHandle.getFile();
    const text = await file.text();
    const deck = JSON.parse(text) as Deck;
    await this.resolveSlideRefs(deck);
    return deck;
  }

  /** Resolve `{ "$ref": "./slides/foo.json" }` entries by reading from the directory handle. */
  private async resolveSlideRefs(deck: Deck): Promise<void> {
    for (let i = 0; i < deck.slides.length; i++) {
      const entry = deck.slides[i] as any;
      if (entry.$ref && typeof entry.$ref === "string") {
        const refParts = entry.$ref.replace(/^\.\//, "").split("/");
        let dir = this.dirHandle;
        for (let j = 0; j < refParts.length - 1; j++) {
          dir = await dir.getDirectoryHandle(refParts[j]!);
        }
        const fh = await dir.getFileHandle(refParts[refParts.length - 1]!);
        const f = await fh.getFile();
        const slide = JSON.parse(await f.text());
        slide._ref = entry.$ref;
        deck.slides[i] = slide;
      }
    }
  }

  async saveDeck(deck: Deck): Promise<void> {
    // Shallow-copy to avoid mutating frozen state (Immer/Zustand)
    const mutableDeck = { ...deck, slides: [...deck.slides] };
    await this.splitSlideRefs(mutableDeck);
    const fileHandle = await this.dirHandle.getFileHandle("deck.json", { create: true });
    const writable = await fileHandle.createWritable();
    const serialized = JSON.stringify(mutableDeck, null, 2);
    await writable.write(serialized);
    await writable.close();
    this._lastSaveHash = fnv1aHash(serialized);
  }

  /** Write slides with `_ref` to their external files and replace them with `{ "$ref": "..." }`. */
  private async splitSlideRefs(deck: Deck): Promise<void> {
    for (let i = 0; i < deck.slides.length; i++) {
      const slide = deck.slides[i]!;
      if (slide._ref) {
        const refParts = slide._ref.replace(/^\.\//, "").split("/");
        let dir = this.dirHandle;
        for (let j = 0; j < refParts.length - 1; j++) {
          dir = await dir.getDirectoryHandle(refParts[j]!, { create: true });
        }
        const { _ref, ...slideData } = slide;
        const fh = await dir.getFileHandle(refParts[refParts.length - 1]!, { create: true });
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(slideData, null, 2));
        await writable.close();
        // Replace in-array with $ref pointer
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

  async resolveAssetUrl(path: string): Promise<string> {
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
      // File not found — it may have been uploaded in dev mode and doesn't
      // exist in this directory. Re-throw with context.
      throw new Error(
        `[FsAccessAdapter] Asset not found: "${sanitizedName}" (path: "${path}"). ` +
        `The file may have been uploaded via the dev server and is not present in the opened folder.`
      );
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

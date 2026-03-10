import type { Deck } from "@/types/deck";
import type { FileSystemAdapter, LayoutInfo, ProjectInfo } from "./types";
import type { NewProjectConfig } from "@/utils/projectTemplates";
import { assert } from "@/utils/assert";

export class ReadOnlyAdapter implements FileSystemAdapter {
  readonly mode = "readonly" as const;
  readonly lastSaveHash: number | null = null;
  readonly projectName: string;

  private deck: Deck;
  private assetBaseUrl: string;
  private assetMap?: Record<string, string>;

  constructor(projectName: string, deck: Deck, assetBaseUrl: string) {
    this.projectName = projectName;
    this.deck = deck;
    this.assetBaseUrl = assetBaseUrl;
  }

  async loadDeck(): Promise<Deck> {
    return this.deck;
  }

  async saveDeck(_deck: Deck): Promise<void> {
    assert(false, "ReadOnlyAdapter: saveDeck is not supported");
  }

  async listProjects(): Promise<ProjectInfo[]> {
    assert(false, "ReadOnlyAdapter: listProjects is not supported");
  }

  async createProject(_name: string, _config: NewProjectConfig): Promise<void> {
    assert(false, "ReadOnlyAdapter: createProject is not supported");
  }

  async deleteProject(_name: string): Promise<void> {
    assert(false, "ReadOnlyAdapter: deleteProject is not supported");
  }

  async uploadAsset(_file: File): Promise<string> {
    assert(false, "ReadOnlyAdapter: uploadAsset is not supported");
  }

  resolveAssetUrl(path: string): string {
    if (this.assetMap?.[path]) return this.assetMap[path]!;
    if (path.startsWith("./assets/")) {
      return `${this.assetBaseUrl}/${path.slice(9)}`;
    }
    return path;
  }

  async renderTikz(
    _elementId: string,
    _content: string,
    _preamble?: string,
  ): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }> {
    return { ok: false, error: "TikZ rendering is not available in read-only mode" };
  }

  async listComponents(): Promise<string[]> {
    return [];
  }

  async listLayouts(): Promise<LayoutInfo[]> {
    return [];
  }

  async loadLayout(_layoutName: string): Promise<import("@/types/deck").Slide> {
    assert(false, "ReadOnlyAdapter: loadLayout is not supported");
  }

  static fromBundled(deck: Deck, assetBaseUrl: string): ReadOnlyAdapter {
    return new ReadOnlyAdapter("demo", deck, assetBaseUrl);
  }

  static fromRemote(name: string, deck: Deck, assetBaseUrl: string): ReadOnlyAdapter {
    return new ReadOnlyAdapter(name, deck, assetBaseUrl);
  }

  /** Create adapter for pop-out windows using pre-resolved asset URLs (e.g. blob URLs). */
  static fromAssetMap(
    projectName: string,
    deck: Deck,
    assetMap: Record<string, string>,
  ): ReadOnlyAdapter {
    const adapter = new ReadOnlyAdapter(projectName, deck, "");
    adapter.assetMap = assetMap;
    return adapter;
  }
}

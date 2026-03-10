import type { Deck } from "@/types/deck";
import type { FileSystemAdapter, ProjectInfo } from "./types";
import type { NewProjectConfig } from "@/utils/projectTemplates";
import { assert } from "@/utils/assert";
import {
  listProjects as apiListProjects,
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  loadDeckFromDisk,
  saveDeckToDisk,
  uploadAsset as apiUploadAsset,
  renderTikz as apiRenderTikz,
  listComponents as apiListComponents,
  listLayouts as apiListLayouts,
  loadLayout as apiLoadLayout,
} from "@/utils/api";

export class ViteApiAdapter implements FileSystemAdapter {
  readonly mode = "vite" as const;
  readonly lastSaveHash: number | null = null;

  constructor(public readonly projectName: string) {}

  async loadDeck(): Promise<Deck> {
    const deck = await loadDeckFromDisk(this.projectName);
    assert(deck !== null, `Failed to load deck for project "${this.projectName}"`);
    return deck;
  }

  async saveDeck(deck: Deck): Promise<void> {
    await saveDeckToDisk(deck, this.projectName);
  }

  async listProjects(): Promise<ProjectInfo[]> {
    return apiListProjects();
  }

  async createProject(name: string, config: NewProjectConfig): Promise<void> {
    await apiCreateProject(name, config);
  }

  async deleteProject(name: string): Promise<void> {
    await apiDeleteProject(name);
  }

  async uploadAsset(file: File): Promise<string> {
    return apiUploadAsset(file, this.projectName);
  }

  resolveAssetUrl(path: string): string {
    // Rewrite ./assets/foo → /assets/{projectName}/foo for the Vite static middleware
    if (path.startsWith("./assets/")) {
      return `/assets/${this.projectName}/${path.slice(9)}`;
    }
    // Legacy /assets/{project}/foo passes through unchanged
    return path;
  }

  async renderTikz(
    elementId: string,
    content: string,
    preamble?: string,
  ): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }> {
    return apiRenderTikz(this.projectName, elementId, content, preamble);
  }

  async listComponents(): Promise<string[]> {
    return apiListComponents(this.projectName);
  }

  async listLayouts() {
    return apiListLayouts(this.projectName);
  }

  async loadLayout(layoutName: string) {
    return apiLoadLayout(this.projectName, layoutName);
  }
}

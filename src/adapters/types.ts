import type { Deck } from "@/types/deck";
import type { NewProjectConfig } from "@/utils/projectTemplates";

export interface ProjectInfo {
  name: string;
  title: string;
}

export interface TikzResult {
  ok: boolean;
  svgUrl?: string;
  error?: string;
}

export interface LayoutInfo {
  name: string;
  title: string;
}

export interface FileSystemAdapter {
  loadDeck(): Promise<Deck>;
  saveDeck(deck: Deck): Promise<void>;
  listProjects(): Promise<ProjectInfo[]>;
  createProject(name: string, config: NewProjectConfig): Promise<void>;
  deleteProject(name: string): Promise<void>;
  uploadAsset(file: File): Promise<string>;
  resolveAssetUrl(path: string): string | Promise<string>;
  renderTikz(
    elementId: string,
    content: string,
    preamble?: string,
  ): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }>;
  listComponents(): Promise<string[]>;
  listLayouts(): Promise<LayoutInfo[]>;
  loadLayout(layoutName: string): Promise<import("@/types/deck").Slide>;
  readonly mode: "vite" | "fs-access" | "readonly";
  readonly projectName: string;
  readonly lastSaveHash: number | null;
}

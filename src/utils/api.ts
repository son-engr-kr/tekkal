import type { Deck } from "@/types/deck";
import type { ProjectInfo } from "@/adapters/types";
import type { NewProjectConfig } from "@/utils/projectTemplates";
import { assert } from "@/utils/assert";

export type { ProjectInfo };

export async function listProjects(): Promise<ProjectInfo[]> {
  const res = await fetch("/api/projects");
  assert(res.ok, `Failed to list projects: ${res.status}`);
  const data = await res.json();
  return data.projects;
}

export async function createProject(name: string, config: NewProjectConfig): Promise<void> {
  const res = await fetch("/api/create-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...config }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to create project: ${res.status}`);
  }
}

export async function deleteProject(name: string): Promise<void> {
  const res = await fetch("/api/delete-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert(res.ok, `Failed to delete project: ${res.status}`);
}

export async function loadDeckFromDisk(project: string): Promise<Deck | null> {
  const res = await fetch(`/api/load-deck?project=${encodeURIComponent(project)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `Failed to load deck: ${res.status}`);
  }
  return res.json() as Promise<Deck>;
}

/**
 * Save deck to disk. Returns null on success, or the current disk Deck on 409
 * conflict (external modification detected — caller should merge and retry).
 */
export async function saveDeckToDisk(deck: Deck, project: string): Promise<Deck | null> {
  const res = await fetch(`/api/save-deck?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deck, null, 2),
  });
  if (res.status === 409) {
    const data = await res.json();
    return data.deck as Deck;
  }
  assert(res.ok, `Failed to save deck: ${res.status}`);
  return null;
}

export async function uploadAsset(file: File, project: string): Promise<string> {
  const res = await fetch(`/api/upload-asset?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  assert(res.ok, `Failed to upload asset: ${res.status}`);
  const data = await res.json();
  return data.url;
}

export async function renderTikz(
  project: string,
  elementId: string,
  content: string,
  preamble?: string,
): Promise<{ ok: true; svgUrl: string } | { ok: false; error: string }> {
  const res = await fetch(`/api/render-tikz?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elementId, content, preamble }),
  });
  assert(res.ok, `Failed to render TikZ: ${res.status}`);
  return res.json();
}

export async function fetchGitHeadHash(project: string, absPath?: string): Promise<string | null> {
  const params = new URLSearchParams();
  if (absPath) {
    params.set("absPath", absPath);
  } else {
    params.set("project", project);
  }
  const res = await fetch(`/api/git-head-hash?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.hash ?? null;
}

export async function loadGitBaseDeck(project: string, absPath?: string): Promise<Deck | null> {
  const params = new URLSearchParams();
  if (absPath) {
    params.set("absPath", absPath);
  } else {
    params.set("project", project);
  }
  const res = await fetch(`/api/git-base-deck?${params.toString()}`);
  if (!res.ok || res.status === 204) return null;
  return res.json() as Promise<Deck>;
}

export async function listComponents(project: string): Promise<string[]> {
  const res = await fetch(`/api/list-components?project=${encodeURIComponent(project)}`);
  assert(res.ok, `Failed to list components: ${res.status}`);
  const data = await res.json();
  return data.components;
}

export async function listLayouts(project: string): Promise<{ name: string; title: string }[]> {
  const res = await fetch(`/api/list-layouts?project=${encodeURIComponent(project)}`);
  assert(res.ok, `Failed to list layouts: ${res.status}`);
  const data = await res.json();
  return data.layouts;
}

export async function loadLayout(project: string, layoutName: string): Promise<any> {
  const res = await fetch(`/api/load-layout?project=${encodeURIComponent(project)}&layout=${encodeURIComponent(layoutName)}`);
  assert(res.ok, `Failed to load layout: ${res.status}`);
  const data = await res.json();
  return data.slide;
}

import { useEffect, useState, useCallback, useRef } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { setStoreAdapter } from "@/stores/deckStore";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { PresenterView } from "@/components/presenter/PresenterView";
import { ViewOnlyPresentation } from "@/components/presenter/ViewOnlyPresentation";
import { ProjectSelector } from "@/components/ProjectSelector";
import { AdapterProvider } from "@/contexts/AdapterContext";
import { ViteApiAdapter } from "@/adapters/viteApi";
import { ReadOnlyAdapter } from "@/adapters/readOnly";
import { loadDeckFromDisk } from "@/utils/api";
import { parseGitHubParam, buildGitHubRawBase, fetchGitHubDeck } from "@/utils/github";
import { restoreHandle } from "@/utils/handleStore";
import type { FileSystemAdapter } from "@/adapters/types";
import { FsAccessAdapter } from "@/adapters/fsAccess";
import type { Deck } from "@/types/deck";
import { assert } from "@/utils/assert";
import { fnv1aHash } from "@/utils/hash";

const IS_DEV = import.meta.env.DEV;

// Eagerly bundle external slide files for the ?demo mode
const demoSlideFiles: Record<string, unknown> = import.meta.glob(
  "../templates/default/slides/*.json",
  { eager: true, import: "default" },
);

/** Resolve $ref entries in a deck using a lookup map keyed by ref path. */
function resolveSlideRefsFromMap(deck: Deck, basePath: string, fileMap: Record<string, unknown>): Deck {
  const resolved = structuredClone(deck);
  for (let i = 0; i < resolved.slides.length; i++) {
    const entry = resolved.slides[i] as any;
    if (entry.$ref && typeof entry.$ref === "string") {
      const key = basePath + entry.$ref.replace("./", "");
      const data = fileMap[key];
      if (data) {
        resolved.slides[i] = data as any;
      }
    }
  }
  return resolved;
}

export function App() {
  const currentProject = useDeckStore((s) => s.currentProject);
  const [adapter, setAdapter] = useState<FileSystemAdapter | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Synchronously detect if we need to auto-open from URL so we can show
  // a loading state immediately and prevent ProjectSelector from mounting.
  const [loading, setLoading] = useState(() => {
    if (!IS_DEV) return false;
    const params = new URLSearchParams(window.location.search);
    return !params.has("demo") && !params.has("gh") && params.has("project");
  });

  // Capture URL params once on mount
  const [isPresentMode] = useState(() => {
    return new URLSearchParams(window.location.search).get("mode") === "present";
  });

  const [isAudiencePopup] = useState(() => {
    const mode = new URLSearchParams(window.location.search).get("mode");
    return mode === "audience" || mode === "presenter";
  });

  // Helper to open a readonly adapter
  const openReadOnly = useCallback((readOnlyAdapter: ReadOnlyAdapter) => {
    setAdapter(readOnlyAdapter);
    setStoreAdapter(readOnlyAdapter);
    readOnlyAdapter.loadDeck().then((deck) => {
      useDeckStore.getState().openProject(readOnlyAdapter.projectName, deck);
    });
  }, []);

  // URL param routing on mount: ?demo, ?gh=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // ?demo → load bundled template deck
    if (params.has("demo")) {
      setLoading(true);
      import("../templates/default/deck.json").then((mod) => {
        const rawDeck = mod.default as unknown as Deck;
        const deck = resolveSlideRefsFromMap(rawDeck, "../templates/default/", demoSlideFiles);
        const assetBaseUrl = import.meta.env.BASE_URL + "demo-assets";
        const readOnlyAdapter = ReadOnlyAdapter.fromBundled(deck, assetBaseUrl);
        openReadOnly(readOnlyAdapter);
        setLoading(false);
      });
      return;
    }

    // ?gh=owner/repo[/path][@branch] → fetch from GitHub
    const ghParam = params.get("gh");
    if (ghParam) {
      setLoading(true);
      const source = parseGitHubParam(ghParam);
      const rawBase = buildGitHubRawBase(source);
      fetchGitHubDeck(source)
        .then((deck) => {
          const name = `${source.owner}/${source.repo}`;
          const readOnlyAdapter = ReadOnlyAdapter.fromRemote(name, deck, rawBase + "/assets");
          openReadOnly(readOnlyAdapter);
          setLoading(false);
        })
        .catch((err) => {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
      return;
    }
  }, [openReadOnly]);

  // In dev mode, auto-open project from URL query param.
  // `loading` is already true (set synchronously in useState) to block ProjectSelector.
  // Tries Vite API first; falls back to IndexedDB FsAccess handle restoration.
  const autoOpenProjectRef = useRef(
    IS_DEV ? new URLSearchParams(window.location.search).get("project") : null,
  );
  useEffect(() => {
    const project = autoOpenProjectRef.current;
    if (!project) return;

    const tryViteApi = async (): Promise<boolean> => {
      const deck = await loadDeckFromDisk(project);
      if (!deck) return false;
      const viteAdapter = new ViteApiAdapter(project);
      setAdapter(viteAdapter);
      setStoreAdapter(viteAdapter);
      useDeckStore.getState().openProject(project, deck);
      return true;
    };

    const tryFsAccessRestore = async (): Promise<boolean> => {
      const handle = await restoreHandle();
      if (!handle) return false;
      const fsAdapter = FsAccessAdapter.fromHandle(handle);
      const deck = await fsAdapter.loadDeck();
      setAdapter(fsAdapter);
      setStoreAdapter(fsAdapter);
      useDeckStore.getState().openProject(fsAdapter.projectName, deck);
      return true;
    };

    tryViteApi()
      .then((ok) => ok || tryFsAccessRestore())
      .catch(() => false)
      .then(() => setLoading(false));
  }, []);

  // Sync URL when project changes (dev mode only).
  // Write ?project= so the auto-open effect can restore on refresh
  // (tries Vite API first, then falls back to IndexedDB FsAccess handle).
  const hadProjectRef = useRef(false);
  useEffect(() => {
    if (!IS_DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo") || params.has("gh")) return;
    if (currentProject) {
      hadProjectRef.current = true;
      params.set("project", currentProject);
      history.replaceState(null, "", `?${params.toString()}`);
    } else if (hadProjectRef.current) {
      history.replaceState(null, "", window.location.pathname);
    }
  }, [currentProject]);

  // HMR: reload deck when deck.json changes on disk (dev mode only)
  useEffect(() => {
    if (!IS_DEV || !import.meta.hot) return;
    const handler = (data: { project: string }) => {
      const state = useDeckStore.getState();
      if (data.project !== state.currentProject || !adapter) return;

      if (!state.isDirty) {
        adapter.loadDeck().then((deck) => {
          useDeckStore.getState().loadDeck(deck);
        });
      } else {
        useDeckStore.getState().setSavePaused(true);
        setExternalChange(true);
      }
    };
    import.meta.hot.on("deckode:deck-changed", handler);
    return () => {
      import.meta.hot!.off("deckode:deck-changed", handler);
    };
  }, [adapter]);

  // Polling: detect external deck.json changes in fs-access mode
  const lastModifiedRef = useRef(0);
  useEffect(() => {
    if (!adapter || adapter.mode !== "fs-access") return;
    const fsAdapter = adapter as FsAccessAdapter;

    const poll = async () => {
      const fileHandle = await fsAdapter.dirHandle.getFileHandle("deck.json");
      const file = await fileHandle.getFile();
      const modified = file.lastModified;

      if (lastModifiedRef.current === 0) {
        lastModifiedRef.current = modified;
        return;
      }

      if (modified === lastModifiedRef.current) return;
      lastModifiedRef.current = modified;

      // Hash-based self-save detection: read file text and compare hash
      const text = await file.text();
      const fileHash = fnv1aHash(text);
      if (fileHash === fsAdapter.lastSaveHash) return; // our own save

      const state = useDeckStore.getState();
      if (!state.isDirty) {
        fsAdapter.loadDeck().then((deck) => {
          useDeckStore.getState().loadDeck(deck);
        });
      } else {
        useDeckStore.getState().setSavePaused(true);
        setExternalChange(true);
      }
    };

    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [adapter]);

  const handleReloadExternal = useCallback(() => {
    if (!adapter) return;
    useDeckStore.getState().setSavePaused(false);
    adapter.loadDeck().then((deck) => {
      useDeckStore.getState().loadDeck(deck);
      setExternalChange(false);
    });
  }, [adapter]);

  const handleKeepMine = useCallback(() => {
    useDeckStore.getState().setSavePaused(false);
    setExternalChange(false);
    useDeckStore.getState().saveToDisk();
  }, []);

  const handleAdapterReady = useCallback((newAdapter: FileSystemAdapter) => {
    setAdapter(newAdapter);
    setStoreAdapter(newAdapter);
  }, []);

  // Clear adapter when project is closed (prod mode)
  useEffect(() => {
    if (!currentProject && !IS_DEV) {
      setAdapter(null);
      setStoreAdapter(null);
    }
  }, [currentProject]);

  // Exit present mode → remove mode=present from URL, re-render as editor
  const handleExitPresent = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("mode");
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    // Force re-render by reloading (simplest approach since isPresentMode is captured once)
    window.location.reload();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-zinc-400">
        Loading deck...
      </div>
    );
  }

  // Load error state
  if (loadError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-red-400 mb-4">Failed to load deck</h1>
          <p className="text-sm text-zinc-400 mb-6">{loadError}</p>
          <button
            onClick={() => {
              history.replaceState(null, "", window.location.pathname);
              window.location.reload();
            }}
            className="px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  // Audience popup without a loaded project: render directly.
  // Deck data arrives via BroadcastChannel sync from the presenter window.
  if (isAudiencePopup && !currentProject) {
    return <PresenterView />;
  }

  if (!currentProject) {
    return (
      <ProjectSelector
        isDevMode={IS_DEV}
        onAdapterReady={handleAdapterReady}
      />
    );
  }

  assert(adapter !== null, "Adapter must be set when a project is open");

  // Present mode (for shared links)
  if (isPresentMode) {
    return (
      <AdapterProvider adapter={adapter}>
        <ViewOnlyPresentation onExit={handleExitPresent} />
      </AdapterProvider>
    );
  }

  return (
    <AdapterProvider adapter={adapter}>
      {externalChange && adapter.mode !== "readonly" && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium shadow-lg">
          <span>deck.json was modified externally</span>
          <button
            onClick={handleReloadExternal}
            className="px-2 py-0.5 rounded bg-white text-amber-700 font-semibold hover:bg-amber-50 transition-colors"
          >
            Reload
          </button>
          <button
            onClick={handleKeepMine}
            className="px-2 py-0.5 rounded bg-amber-700 text-amber-100 hover:bg-amber-800 transition-colors"
          >
            Keep mine
          </button>
        </div>
      )}
      {isAudiencePopup ? <PresenterView /> : <EditorLayout />}
    </AdapterProvider>
  );
}

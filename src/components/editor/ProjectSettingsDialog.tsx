import { useState, useEffect } from "react";

const STORAGE_KEY = "deckode-project-paths";

export function getStoredProjectPath(projectName: string): string | null {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return data[projectName] ?? null;
  } catch {
    return null;
  }
}

function setStoredProjectPath(projectName: string, absPath: string | null) {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (absPath) {
      data[projectName] = absPath;
    } else {
      delete data[projectName];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable
  }
}

export function ProjectSettingsDialog({
  projectName,
  onClose,
  onPathSaved,
}: {
  projectName: string;
  onClose: () => void;
  /** Called after a path is saved, so the caller can trigger re-fetch + enable diff */
  onPathSaved?: () => void;
}) {
  const [pathValue, setPathValue] = useState("");

  useEffect(() => {
    setPathValue(getStoredProjectPath(projectName) ?? "");
  }, [projectName]);

  const handleSave = () => {
    const trimmed = pathValue.trim();
    setStoredProjectPath(projectName, trimmed || null);
    onClose();
    onPathSaved?.();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-5 z-50 w-[480px]">
        <h3 className="text-sm font-semibold text-zinc-200 mb-4">Project Settings</h3>

        <label className="block text-xs text-zinc-400 mb-1">
          Local path <span className="text-zinc-600">(for git diff — optional)</span>
        </label>
        <input
          type="text"
          value={pathValue}
          onChange={(e) => setPathValue(e.target.value)}
          placeholder="e.g. D:\my_projects\my-deck"
          className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-xs border border-zinc-700 focus:border-zinc-500 focus:outline-none font-mono"
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          autoFocus
        />
        <p className="text-[10px] text-zinc-600 mt-1">
          Paste the absolute path to this project folder on disk. Used to show uncommitted git changes.
        </p>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}

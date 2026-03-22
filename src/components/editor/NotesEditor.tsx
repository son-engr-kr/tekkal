import { useState } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { useGitDiff } from "@/hooks/useGitDiff";

interface Props {
  expanded: boolean;
  onToggle: () => void;
  showDiff?: boolean;
}

export function NotesEditor({ expanded, onToggle, showDiff = false }: Props) {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const updateSlide = useDeckStore((s) => s.updateSlide);
  const gitDiff = useGitDiff();
  const [showBase, setShowBase] = useState(false);

  if (!deck) return null;
  const slide = deck.slides[currentSlideIndex];
  if (!slide) return null;

  const currentNotes = slide.notes ?? "";
  const baseNotes = gitDiff?.baseNotes ?? "";
  const notesModified = showDiff && gitDiff.available && currentNotes !== baseNotes;

  return (
    <div className={expanded ? "flex flex-col h-full min-h-0" : ""}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
      >
        <svg
          className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 6 10"
          fill="currentColor"
        >
          <path d="M0 0l6 5-6 5z" />
        </svg>
        Notes
        {notesModified && (
          <span className="ml-1 text-[9px] text-green-500 font-semibold">modified</span>
        )}
      </button>
      {expanded && (
        <div className="flex-1 min-h-0 px-3 pb-2 flex flex-col gap-1">
          <textarea
            className={`w-full flex-1 bg-zinc-800 text-zinc-200 rounded px-2 py-1.5 text-xs border focus:outline-none resize-none ${
              notesModified ? "border-green-600 focus:border-green-500" : "border-zinc-700 focus:border-blue-500"
            }`}
            value={currentNotes}
            placeholder="Presenter notes..."
            onChange={(e) => updateSlide(slide.id, { notes: e.target.value })}
          />
          {notesModified && (
            <div>
              <button
                onClick={() => setShowBase(!showBase)}
                className="text-[10px] text-green-600 hover:text-green-400 transition-colors"
              >
                {showBase ? "Hide original" : "Show original"}
              </button>
              {showBase && (
                <div className="mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-500 whitespace-pre-wrap max-h-24 overflow-y-auto">
                  {baseNotes || <span className="italic">empty</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

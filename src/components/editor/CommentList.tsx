import { useState, useRef, useEffect } from "react";
import { useDeckStore } from "@/stores/deckStore";
import type { Comment, CommentCategory } from "@/types/deck";
import { FieldLabel } from "./fields";
import { useGitDiff } from "@/hooks/useGitDiff";

const CATEGORIES: { value: CommentCategory; label: string; color: string }[] = [
  { value: "content", label: "Content", color: "#f59e0b" },
  { value: "design", label: "Design", color: "#8b5cf6" },
  { value: "bug", label: "Bug", color: "#ef4444" },
  { value: "todo", label: "Todo", color: "#3b82f6" },
  { value: "question", label: "Question", color: "#10b981" },
  { value: "done", label: "Done", color: "#6b7280" },
];

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.value, c]));

// Stable author colors derived from name hash
const AUTHOR_COLORS = [
  "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981", "#ef4444",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];

function authorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length]!;
}

interface Props {
  slideId: string;
  elementId?: string;
}

export function CommentList({ slideId, elementId }: Props) {
  const deck = useDeckStore((s) => s.deck);
  const addComment = useDeckStore((s) => s.addComment);
  const updateComment = useDeckStore((s) => s.updateComment);
  const deleteComment = useDeckStore((s) => s.deleteComment);
  const selectElement = useDeckStore((s) => s.selectElement);
  const gitDiff = useGitDiff();

  const slide = deck?.slides.find((s) => s.id === slideId);
  const allComments = slide?.comments ?? [];

  // Build comment diff map: commentId -> "added" | "modified" | "removed"
  const commentDiffMap = new Map<string, string>();
  if (gitDiff.available && gitDiff.baseComments) {
    const baseMap = new Map((gitDiff.baseComments as Comment[]).map((c) => [c.id, c]));
    for (const c of allComments) {
      if (!baseMap.has(c.id)) {
        commentDiffMap.set(c.id, "added");
      } else if (JSON.stringify(baseMap.get(c.id)) !== JSON.stringify(c)) {
        commentDiffMap.set(c.id, "modified");
      }
    }
  }

  const [showDone, setShowDone] = useState(false);

  // Filter: element view shows only that element's comments; slide view shows all
  const scopedComments = elementId
    ? allComments.filter((c) => c.elementId === elementId)
    : [...allComments].sort((a, b) => a.createdAt - b.createdAt);
  const comments = showDone ? scopedComments : scopedComments.filter((c) => c.category !== "done");
  const doneCount = scopedComments.filter((c) => c.category === "done").length;

  const [draft, setDraft] = useState("");
  const [authorName, setAuthorName] = useState("user");
  const [category, setCategory] = useState<CommentCategory | "">("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build element id → type label map for slide-level view
  const elementLabels = new Map<string, string>();
  if (!elementId && slide) {
    for (const el of slide.elements) {
      elementLabels.set(el.id, `${el.type}/${el.id}`);
    }
  }

  const handleAdd = () => {
    const text = draft.trim();
    if (!text) return;
    addComment(slideId, {
      id: crypto.randomUUID().slice(0, 8),
      elementId,
      text,
      author: authorName.trim() || "user",
      category: category || undefined,
      createdAt: Date.now(),
    });
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

  const startEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setEditText(comment.text);
  };

  const commitEdit = () => {
    if (editingId && editText.trim()) {
      updateComment(slideId, editingId, { text: editText.trim() });
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  // Auto-focus edit textarea
  useEffect(() => {
    if (editingId) {
      const el = document.querySelector<HTMLTextAreaElement>(`[data-comment-edit="${editingId}"]`);
      el?.focus();
      el?.select();
    }
  }, [editingId]);

  return (
    <div>
      <FieldLabel>
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        {doneCount > 0 && (
          <button
            onClick={() => setShowDone(!showDone)}
            className="text-zinc-600 hover:text-zinc-400 font-normal normal-case tracking-normal ml-1 transition-colors"
          >
            {showDone ? `- ${doneCount} done` : `+ ${doneCount} done`}
          </button>
        )}
      </FieldLabel>

      {comments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {comments.map((comment) => {
            const aColor = comment.author ? authorColor(comment.author) : "#94a3b8";
            const cat = comment.category ? CATEGORY_MAP.get(comment.category) : null;
            const diffStatus = commentDiffMap.get(comment.id);

            return (
              <div
                key={comment.id}
                className="group rounded border px-2 py-1.5"
                style={{
                  backgroundColor: diffStatus ? `${diffStatus === "added" ? "#22c55e" : "#22c55e"}08` : `${aColor}10`,
                  borderColor: diffStatus ? "#22c55e50" : `${aColor}30`,
                }}
              >
                {/* Author + category header */}
                <div className="flex items-center gap-1.5 mb-0.5">
                  {comment.author && (
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: aColor }}
                    >
                      {comment.author}
                    </span>
                  )}
                  {diffStatus && (
                    <span className="text-[8px] px-1 py-px rounded font-semibold bg-green-900/30 text-green-500">
                      {diffStatus === "added" ? "new" : "edited"}
                    </span>
                  )}
                  {cat && (
                    <span
                      className="text-[9px] px-1 py-px rounded font-medium"
                      style={{
                        backgroundColor: `${cat.color}20`,
                        color: cat.color,
                      }}
                    >
                      {cat.label}
                    </span>
                  )}
                  {/* Element label in slide-level view */}
                  {!elementId && comment.elementId && (
                    <button
                      onClick={() => selectElement(comment.elementId!)}
                      className="text-[10px] text-zinc-500 font-mono hover:text-zinc-300 transition-colors ml-auto"
                    >
                      {elementLabels.get(comment.elementId) ?? comment.elementId}
                    </button>
                  )}
                  {!elementId && !comment.elementId && (
                    <span className="text-[10px] text-zinc-500 font-mono ml-auto">slide</span>
                  )}
                </div>

                {editingId === comment.id ? (
                  <textarea
                    data-comment-edit={comment.id}
                    className="w-full bg-zinc-800 text-zinc-200 rounded px-1.5 py-1 text-xs resize-none border border-zinc-600 focus:outline-none"
                    value={editText}
                    rows={2}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={commitEdit}
                  />
                ) : (
                  <div>
                    <p className="text-xs text-zinc-200/90 whitespace-pre-wrap break-words">
                      {comment.text}
                    </p>
                    <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
                      {/* Category switcher */}
                      {CATEGORIES.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => updateComment(slideId, comment.id, { category: comment.category === c.value ? "" : c.value })}
                          className="text-[9px] px-1 py-px rounded transition-colors"
                          style={
                            comment.category === c.value
                              ? { backgroundColor: `${c.color}30`, color: c.color }
                              : { color: "#52525b" }
                          }
                          title={c.label}
                        >
                          {c.label}
                        </button>
                      ))}
                      <span className="text-zinc-800 mx-0.5">|</span>
                      <button
                        onClick={() => startEdit(comment)}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 px-0.5"
                        title="Edit"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => deleteComment(slideId, comment.id)}
                        className="text-[10px] text-zinc-500 hover:text-red-400 px-0.5"
                        title="Delete"
                      >
                        del
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add comment form */}
      <div className="space-y-1">
        {/* Author + category row */}
        <div className="flex items-center gap-1.5">
          <input
            className="w-16 bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5 text-[10px] border border-zinc-700 focus:border-zinc-500 focus:outline-none shrink-0"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="user"
            title="Author name"
          />
          <div className="flex gap-0.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(category === cat.value ? "" : cat.value)}
              className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
              style={
                category === cat.value
                  ? { backgroundColor: `${cat.color}30`, color: cat.color }
                  : { backgroundColor: "transparent", color: "#71717a" }
              }
            >
              {cat.label}
            </button>
          ))}
          </div>
        </div>
        <div className="flex gap-1">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs resize-y border border-zinc-700 focus:border-zinc-500 focus:outline-none min-h-[28px]"
            value={draft}
            rows={3}
            placeholder="Add comment..."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleAdd}
            disabled={!draft.trim()}
            className="px-2 py-1 text-xs rounded bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

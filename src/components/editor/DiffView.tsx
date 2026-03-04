import { useState, useMemo } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { SlideRenderer } from "@/components/renderer/SlideRenderer";
import { diffSlides } from "@/utils/deckDiff";
import type { SlideDiff, ElementDiff } from "@/utils/deckDiff";
import type { Deck } from "@/types/deck";

interface DiffViewProps {
  onClose: () => void;
}

export function DiffView({ onClose }: DiffViewProps) {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const temporal = useDeckStore.temporal.getState();
  const pastStates = temporal.pastStates as Array<{ deck: Deck | null }>;

  const [selectedPast, setSelectedPast] = useState(Math.max(0, pastStates.length - 1));

  if (!deck) return null;

  if (pastStates.length === 0) {
    return (
      <div className="h-full flex flex-col bg-zinc-950">
        <DiffHeader onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          No history to compare
        </div>
      </div>
    );
  }

  const pastDeck = pastStates[selectedPast]?.deck;
  const currentSlide = deck.slides[currentSlideIndex];

  // Find the matching slide in the past state
  const pastSlide = pastDeck
    ? pastDeck.slides.find((s) => s.id === currentSlide?.id) ?? null
    : null;

  const slideExistedInPast = pastSlide !== null;

  const diff = useMemo(
    () => diffSlides(pastSlide, currentSlide ?? null),
    [pastSlide, currentSlide],
  );

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <DiffHeader onClose={onClose} />

      {/* Timeline slider */}
      <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs whitespace-nowrap">
            Past ({selectedPast + 1}/{pastStates.length})
          </span>
          <input
            type="range"
            min={0}
            max={pastStates.length - 1}
            value={selectedPast}
            onChange={(e) => setSelectedPast(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-zinc-500 text-xs whitespace-nowrap">Current</span>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Past slide */}
        <div className="flex-1 flex flex-col items-center p-3 border-r border-zinc-800 overflow-hidden">
          <div className="text-zinc-500 text-xs mb-2 uppercase tracking-wider">
            Past State
          </div>
          {slideExistedInPast ? (
            <div className="relative">
              <SlideRenderer
                slide={pastSlide!}
                scale={0.4}
                thumbnail
                theme={pastDeck?.theme}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center text-zinc-600 text-sm h-full">
              Slide did not exist at this point
            </div>
          )}
        </div>

        {/* Current slide */}
        <div className="flex-1 flex flex-col items-center p-3 overflow-hidden">
          <div className="text-zinc-500 text-xs mb-2 uppercase tracking-wider">
            Current State
          </div>
          {currentSlide ? (
            <div className="relative">
              <SlideRenderer
                slide={currentSlide}
                scale={0.4}
                thumbnail
                theme={deck.theme}
              />
              {/* Diff overlays */}
              {diff && <DiffOverlay diff={diff} scale={0.4} />}
            </div>
          ) : (
            <div className="flex items-center justify-center text-zinc-600 text-sm h-full">
              No current slide
            </div>
          )}
        </div>
      </div>

      {/* Diff details panel */}
      <div className="h-40 border-t border-zinc-800 overflow-y-auto p-3 shrink-0">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Changes</div>
        {diff ? (
          <DiffDetails diff={diff} />
        ) : (
          <div className="text-zinc-600 text-xs">No diff available</div>
        )}
      </div>
    </div>
  );
}

function DiffHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-10 border-b border-zinc-800 flex items-center px-4 justify-between shrink-0">
      <span className="text-sm font-semibold text-zinc-300">Visual Diff</span>
      <button
        onClick={onClose}
        className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        Close
      </button>
    </div>
  );
}

function DiffOverlay({ diff, scale }: { diff: SlideDiff; scale: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {diff.elements.map((ed) => {
        if (ed.change === "unchanged") return null;
        const el = ed.newElement ?? ed.oldElement;
        if (!el) return null;

        const color =
          ed.change === "added"
            ? "rgba(34, 197, 94, 0.25)"
            : ed.change === "removed"
              ? "rgba(239, 68, 68, 0.25)"
              : "rgba(234, 179, 8, 0.25)";

        const borderColor =
          ed.change === "added"
            ? "rgba(34, 197, 94, 0.6)"
            : ed.change === "removed"
              ? "rgba(239, 68, 68, 0.6)"
              : "rgba(234, 179, 8, 0.6)";

        return (
          <div
            key={ed.elementId}
            className="absolute"
            style={{
              left: el.position.x,
              top: el.position.y,
              width: el.size.w,
              height: el.size.h,
              backgroundColor: color,
              border: `2px solid ${borderColor}`,
              borderRadius: 4,
            }}
          >
            <span
              className="absolute -top-5 left-0 text-[9px] font-mono px-1 rounded"
              style={{
                backgroundColor: borderColor,
                color: "#fff",
              }}
            >
              {ed.change}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DiffDetails({ diff }: { diff: SlideDiff }) {
  const changedElements = diff.elements.filter((e) => e.change !== "unchanged");

  if (changedElements.length === 0) {
    return <div className="text-zinc-600 text-xs">No changes detected</div>;
  }

  return (
    <div className="space-y-1.5">
      {changedElements.map((ed) => (
        <DiffElementRow key={ed.elementId} diff={ed} />
      ))}
    </div>
  );
}

function DiffElementRow({ diff }: { diff: ElementDiff }) {
  const colorClass =
    diff.change === "added"
      ? "text-green-400"
      : diff.change === "removed"
        ? "text-red-400"
        : "text-yellow-400";

  const el = diff.newElement ?? diff.oldElement;
  const typeLabel = el ? `${el.type}` : "unknown";

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`font-mono font-semibold w-16 shrink-0 ${colorClass}`}>
        {diff.change}
      </span>
      <span className="text-zinc-400 font-mono">{diff.elementId}</span>
      <span className="text-zinc-600">({typeLabel})</span>
      {diff.changedFields.length > 0 && (
        <span className="text-zinc-500">
          {diff.changedFields.join(", ")}
        </span>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useDeckStore } from "@/stores/deckStore";
import { useAdapter } from "@/contexts/AdapterContext";
import { loadGitBaseDeck, fetchGitHeadHash } from "@/utils/api";
import { getStoredProjectPath } from "@/components/editor/ProjectSettingsDialog";
import { diffSlides } from "@/utils/deckDiff";
import type { Deck } from "@/types/deck";
import type { ChangeType } from "@/utils/deckDiff";

export interface GitDiffResult {
  changedSlideIds: Set<string>;
  elementChanges: Map<string, ChangeType>;
  baseNotes: string | undefined;
  /** Base comments for current slide (from git HEAD) */
  baseComments: any[] | undefined;
  available: boolean;
  unavailableReason?: "no-path" | "no-git";
  refetch: () => void;
}

const EMPTY_SLIDES = new Set<string>();
const EMPTY_ELEMENTS = new Map<string, ChangeType>();

/** Stringify a slide for comparison, excluding the _ref metadata field */
function stableStringify(slide: any): string {
  const { _ref: _, ...rest } = slide;
  return JSON.stringify(rest);
}
const POLL_INTERVAL = 30_000; // 30 seconds
const CACHE_PREFIX = "deckode-git-base:";

function getCachedBase(project: string, hash: string): Deck | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${project}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.hash === hash) return cached.deck;
  } catch { /* ignore */ }
  return null;
}

function setCachedBase(project: string, hash: string, deck: Deck) {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${project}`, JSON.stringify({ hash, deck }));
  } catch { /* storage full — ignore */ }
}

export function useGitDiff(): GitDiffResult {
  const deck = useDeckStore((s) => s.deck);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const adapter = useAdapter();
  const [baseDeck, setBaseDeck] = useState<Deck | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<"no-path" | "no-git" | undefined>();
  const [fetchVersion, setFetchVersion] = useState(0);
  const headHashRef = useRef<string | null>(null);
  const fetchedKey = useRef<string | null>(null);

  const refetch = useCallback(() => {
    fetchedKey.current = null;
    headHashRef.current = null;
    setFetchVersion((v) => v + 1);
  }, []);

  // Fetch git base with caching
  useEffect(() => {
    const project = adapter.projectName;
    const absPath = adapter.mode === "fs-access"
      ? getStoredProjectPath(project) ?? undefined
      : undefined;

    const key = `${project}:${absPath ?? ""}:${fetchVersion}`;
    if (fetchedKey.current === key) return;
    fetchedKey.current = key;

    if (adapter.mode === "fs-access" && !absPath) {
      setUnavailableReason("no-path");
      setBaseDeck(null);
      return;
    }

    // First check HEAD hash, then use cache or fetch
    fetchGitHeadHash(project, absPath).then((hash) => {
      if (!hash) {
        setUnavailableReason("no-git");
        setBaseDeck(null);
        return;
      }
      headHashRef.current = hash;

      // Try cache
      const cached = getCachedBase(project, hash);
      if (cached) {
        setBaseDeck(cached);
        setUnavailableReason(undefined);
        return;
      }

      // Fetch fresh
      loadGitBaseDeck(project, absPath).then((base) => {
        if (base) {
          setCachedBase(project, hash, base);
          setBaseDeck(base);
          setUnavailableReason(undefined);
        } else {
          setUnavailableReason("no-git");
          setBaseDeck(null);
        }
      });
    });
  }, [adapter.projectName, adapter.mode, fetchVersion]);

  // Poll for HEAD hash changes
  useEffect(() => {
    if (unavailableReason) return;

    const project = adapter.projectName;
    const absPath = adapter.mode === "fs-access"
      ? getStoredProjectPath(project) ?? undefined
      : undefined;

    if (adapter.mode === "fs-access" && !absPath) return;

    const interval = setInterval(async () => {
      const hash = await fetchGitHeadHash(project, absPath);
      if (hash && headHashRef.current && hash !== headHashRef.current) {
        refetch();
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [adapter.projectName, adapter.mode, unavailableReason, refetch]);

  return useMemo(() => {
    const base = { refetch, unavailableReason };

    if (unavailableReason || !baseDeck || !deck) {
      return {
        changedSlideIds: EMPTY_SLIDES,
        elementChanges: EMPTY_ELEMENTS,
        baseNotes: undefined,
        baseComments: undefined,
        available: false,
        ...base,
      };
    }

    const baseSlideMap = new Map(baseDeck.slides.map((s) => [s.id, s]));
    const changedSlideIds = new Set<string>();

    for (const slide of deck.slides) {
      const baseSlide = baseSlideMap.get(slide.id);
      if (!baseSlide) {
        changedSlideIds.add(slide.id);
      } else if (stableStringify(baseSlide) !== stableStringify(slide)) {
        changedSlideIds.add(slide.id);
      }
    }

    const elementChanges = new Map<string, ChangeType>();
    const currentSlide = deck.slides[currentSlideIndex];
    if (currentSlide) {
      const baseSlide = baseSlideMap.get(currentSlide.id) ?? null;
      const diff = diffSlides(baseSlide, currentSlide);
      if (diff) {
        for (const ed of diff.elements) {
          if (ed.change !== "unchanged") {
            elementChanges.set(ed.elementId, ed.change);
          }
        }
      }
    }

    const baseSlideForCurrent = currentSlide ? baseSlideMap.get(currentSlide.id) : undefined;
    const baseNotes = baseSlideForCurrent?.notes;
    const baseComments = baseSlideForCurrent?.comments;

    return {
      changedSlideIds,
      elementChanges,
      baseNotes,
      baseComments,
      available: true,
      ...base,
    };
  }, [unavailableReason, baseDeck, deck, currentSlideIndex, refetch]);
}

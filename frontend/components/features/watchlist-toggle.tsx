"use client";

// Per-row watchlist toggle, localStorage-backed.
// WHY: the demo does not ship a multi-user watchlist table; persisting the
// set of "projects I'm watching" in localStorage is explicit about being a
// single-device, single-user convenience. The hook is exported so the
// Monitor page (and any future consumer) can sort / filter by watched
// state without re-reading storage on every render.

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "enlaye:watchlist";
// WHY: a single event name shared by every instance of the hook so a toggle
// in row A updates the badge in row B without round-tripping through a
// context provider. `storage` only fires cross-tab; we fire this in-tab.
const EVENT_NAME = "enlaye:watchlist:change";

function readFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // WHY: corrupt storage should not crash the page — treat as empty.
    return new Set();
  }
}

function writeToStorage(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* quota / disabled storage — no-op */
  }
}

/**
 * Reactive accessor for the watchlist.
 * Re-renders on every toggle in this tab and on cross-tab `storage` events.
 */
export function useWatchlist(): {
  watchedIds: Set<string>;
  toggle: (id: string) => void;
  isWatched: (id: string) => boolean;
} {
  // NOTE: start empty on SSR, hydrate on mount. Flashing a persisted
  // state during hydration is a worse UX than a 1-frame empty state.
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setWatchedIds(readFromStorage());
    const onChange = () => setWatchedIds(readFromStorage());
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeToStorage(next);
      return next;
    });
  }, []);

  const isWatched = useCallback((id: string) => watchedIds.has(id), [
    watchedIds,
  ]);

  return { watchedIds, toggle, isWatched };
}

type WatchlistToggleProps = {
  projectId: string;
  projectName: string | null;
  className?: string;
};

export function WatchlistToggle({
  projectId,
  projectName,
  className,
}: WatchlistToggleProps) {
  const { isWatched, toggle } = useWatchlist();
  const watched = isWatched(projectId);
  const label = projectName ?? "this project";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={watched}
      aria-label={
        watched
          ? `Stop watching ${label}`
          : `Watch ${label}`
      }
      onClick={() => toggle(projectId)}
      className={cn(
        watched ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {watched ? (
        <Eye aria-hidden className="size-4" />
      ) : (
        <EyeOff aria-hidden className="size-4" />
      )}
    </Button>
  );
}

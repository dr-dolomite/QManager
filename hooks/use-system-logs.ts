"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type {
  LevelFilter,
  LogBoot,
  LogEntry,
  LogStats,
  LogsResponse,
} from "@/types/system-logs";

// =============================================================================
// useSystemLogs — read, filter, poll and clear /tmp/qmanager.log
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/system/logs.sh
//
// `lines`, `component`, `search` and `include_rotated` are server-side. `level`
// is NOT: the backend's `level` is a minimum-severity FLOOR, so a filtered
// window cannot report the rail's other counts and picking WARN also showed
// ERROR. One unfiltered window is fetched and the level is applied in the view.
//
// Journal backend (qmanager_logd): entries carry `seq`, and the response names
// its boot, the boot running now, the newest `head_seq` and the boots held.
// While this boot is in view, the poll after the first read sends
// `after=<head_seq>` and appends only what is new (deduped by seq, trimmed to
// the line budget). The cursor resets when the boot changes or `head_seq`
// goes backwards (the journal was cleared). A previous boot is a fixed record:
// it is read once and never polled. Without `head_seq` (the old backend) every
// poll is a full read, exactly as before.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/logs.sh";

/** The silent refresh cadence, unchanged from the surface this replaces. */
export const POLL_INTERVAL_MS = 10_000;

/** How long the search field waits before it becomes a request. */
const SEARCH_DEBOUNCE_MS = 400;

export const LINE_BUDGETS = ["50", "100", "200", "500"] as const;

/**
 * Which boot the transcript reads: `this` (live), `prev` (the one before), or
 * an older boot's id. Sent verbatim as the `boot` parameter.
 */
export type BootChoice = string;
export const THIS_BOOT: BootChoice = "this";
export const PREV_BOOT: BootChoice = "prev";

interface Cursor {
  boot: string;
  head: number;
}

const bootKey = (b: number | string | undefined): string => (b === undefined ? "" : String(b));

/** Append `fresh` to `prev` (both oldest first), dropping seqs already held. */
function mergeBySeq(prev: LogEntry[], fresh: LogEntry[], cap: number): LogEntry[] {
  if (fresh.length === 0) return prev;
  const held = new Set<number>();
  for (const e of prev) if (typeof e.seq === "number") held.add(e.seq);
  const added = fresh.filter((e) => typeof e.seq !== "number" || !held.has(e.seq));
  if (added.length === 0) return prev;
  const next = prev.concat(added);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * What the feed is actually doing, with real referents.
 *
 * `live`    — the interval is armed and the last read landed.
 * `paused`  — deliberately suspended: the tab is hidden, or a dialog is open.
 * `stopped` — the last read failed, so the feed is not delivering.
 */
export type FeedState = "live" | "paused" | "stopped";

export interface UseSystemLogsOptions {
  /** Suspend the poll — the clear-confirmation dialog sets this. */
  paused?: boolean;
}

export interface UseSystemLogsReturn {
  entries: LogEntry[];
  stats: LogStats | null;
  availableComponents: string[];
  isLoading: boolean;
  /** Non-null when the most recent read failed, background or foreground. */
  error: string | null;
  isRefreshing: boolean;
  isClearing: boolean;
  feedState: FeedState;
  /** Epoch seconds of the last read that landed. */
  lastReadAtSec: number | null;

  /** Boots the journal holds (newest first); empty on the old backend. */
  boots: LogBoot[];
  /** The id of the boot running now, when the journal reports it. */
  thisBoot: string | null;
  boot: BootChoice;
  setBoot: (next: BootChoice) => void;

  level: LevelFilter;
  setLevel: (next: LevelFilter) => void;
  component: string;
  setComponent: (next: string) => void;
  /** The field's live text — the request follows it after a debounce. */
  searchInput: string;
  setSearchInput: (next: string) => void;
  lines: string;
  setLines: (next: string) => void;
  includeRotated: boolean;
  setIncludeRotated: (next: boolean) => void;
  /** True when any filter is narrowing the view. */
  filtersActive: boolean;
  clearFilters: () => void;

  /** User-initiated read. Resolves false when it failed. */
  refresh: () => Promise<boolean>;
  clear: () => Promise<boolean>;
}

export function useSystemLogs({
  paused = false,
}: UseSystemLogsOptions = {}): UseSystemLogsReturn {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [availableComponents, setAvailableComponents] = useState<string[]>([]);

  const [level, setLevel] = useState<LevelFilter>("all");
  const [component, setComponent] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState("100");
  const [includeRotated, setIncludeRotated] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReadAtSec, setLastReadAtSec] = useState<number | null>(null);
  const [tabHidden, setTabHidden] = useState(false);
  const [boot, setBoot] = useState<BootChoice>(THIS_BOOT);
  const [boots, setBoots] = useState<LogBoot[]>([]);
  const [thisBoot, setThisBoot] = useState<string | null>(null);

  // The incremental cursor, and a generation that drops a response from a
  // query that has since changed (a slow poll landing after a filter switch).
  const cursorRef = useRef<Cursor | null>(null);
  const genRef = useRef(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = () => setTabHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // The search field drives a debounced request rather than a keystroke each.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // The reset path below re-reads through this, so it never closes over itself.
  const fetchLogsRef = useRef<(silent: boolean, incremental?: boolean) => Promise<boolean>>(
    async () => false,
  );

  /**
   * One read. `incremental` asks only for what follows the cursor; it is a
   * full read when there is no cursor (old backend, first read, a reset).
   */
  const fetchLogs = useCallback(
    async (silent: boolean, incremental = false): Promise<boolean> => {
      const cursor = incremental && boot === THIS_BOOT ? cursorRef.current : null;
      if (!cursor) genRef.current += 1;
      const gen = genRef.current;
      const current = () => mountedRef.current && gen === genRef.current;

      if (!silent) setIsRefreshing(true);

      try {
        const params = new URLSearchParams();
        params.set("lines", lines);
        if (component !== "all") params.set("component", component);
        if (search.trim()) params.set("search", search.trim());
        if (includeRotated) params.set("include_rotated", "1");
        if (boot !== THIS_BOOT) params.set("boot", boot);
        if (cursor) params.set("after", String(cursor.head));

        const resp = await authFetch(`${CGI_ENDPOINT}?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: LogsResponse = await resp.json();
        if (!current()) return false;
        if (!data.success) {
          throw new Error(data.detail || data.error || "read_failed");
        }

        const fresh = data.entries ?? [];
        const head = typeof data.head_seq === "number" ? data.head_seq : null;
        const respBoot = bootKey(data.this_boot ?? data.boot);

        // The boot changed or the journal went backwards: the cursor no longer
        // names a point in this log, so read the window again from scratch.
        if (cursor && (head === null || respBoot !== cursor.boot || head < cursor.head)) {
          cursorRef.current = null;
          return await fetchLogsRef.current(true, false);
        }

        const cap = Number(lines) || 100;
        if (cursor) setEntries((prev) => mergeBySeq(prev, fresh, cap));
        else setEntries(fresh);
        cursorRef.current =
          boot === THIS_BOOT && head !== null ? { boot: respBoot, head } : null;

        setStats(data.stats ?? null);
        if (Array.isArray(data.available_components)) {
          setAvailableComponents(data.available_components);
        }
        setBoots(Array.isArray(data.boots) ? data.boots : []);
        setThisBoot(data.this_boot !== undefined ? bootKey(data.this_boot) : null);
        setLastReadAtSec(Math.floor(Date.now() / 1000));
        setError(null);
        return true;
      } catch (err) {
        // A failed background poll is NOT silent any more: it sets the error
        // that drives the stale notice. Only the toast is foreground-only.
        if (!current()) return false;
        setError(err instanceof Error ? err.message : "read_failed");
        return false;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          if (!silent) setIsRefreshing(false);
        }
      }
    },
    [lines, component, search, includeRotated, boot],
  );

  useEffect(() => {
    fetchLogsRef.current = fetchLogs;
  }, [fetchLogs]);

  // First read, and one on every server-side filter or boot change.
  useEffect(() => {
    cursorRef.current = null;
    void fetchLogs(true);
  }, [fetchLogs]);

  // The poll. Deliberately torn down while suspended, which is exactly what
  // `paused` reports — the interval and the face cannot disagree. A previous
  // boot is finished, so it is never polled.
  const pollSuspended = paused || tabHidden;
  const pollable = boot === THIS_BOOT;
  useEffect(() => {
    if (pollSuspended || !pollable) return;
    const id = setInterval(() => void fetchLogs(true, true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollSuspended, pollable, fetchLogs]);

  const refresh = useCallback(() => fetchLogs(false), [fetchLogs]);

  const clear = useCallback(async (): Promise<boolean> => {
    setIsClearing(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: { success?: boolean } = await resp.json();
      if (!mountedRef.current) return false;
      if (!data.success) return false;
      await fetchLogs(true);
      return true;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  }, [fetchLogs]);

  const clearFilters = useCallback(() => {
    setLevel("all");
    setComponent("all");
    setSearchInput("");
    setSearch("");
  }, []);

  const filtersActive =
    level !== "all" || component !== "all" || searchInput.trim() !== "";

  const feedState: FeedState = error
    ? "stopped"
    : pollSuspended || !pollable
      ? "paused"
      : "live";

  // Newest first, whatever order the journal sends them in.
  const orderedBoots = useMemo(() => {
    const seqOf = (b: LogBoot) => b.last_seq ?? b.first_seq ?? 0;
    return [...boots].sort((a, b) => seqOf(b) - seqOf(a));
  }, [boots]);

  return {
    entries,
    stats,
    availableComponents,
    isLoading,
    error,
    isRefreshing,
    isClearing,
    feedState,
    lastReadAtSec,
    boots: orderedBoots,
    thisBoot,
    boot,
    setBoot,
    level,
    setLevel,
    component,
    setComponent,
    searchInput,
    setSearchInput,
    lines,
    setLines,
    includeRotated,
    setIncludeRotated,
    filtersActive,
    clearFilters,
    refresh,
    clear,
  };
}

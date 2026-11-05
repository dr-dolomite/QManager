import type { ModemStatus } from "@/types/modem-status";

// =============================================================================
// Modem status store — one shared poll of fetch_data.sh (ledger B5.28)
// =============================================================================
// Every `useModemStatus()` instance used to run its own interval, so a page
// fetched the same cached JSON once per mounted consumer: the dashboard (2 s)
// plus the sidebar watchdog indicator (15 s) on every page, three instances on
// the Watchdog page, and so on. This store runs ONE loop for all of them.
//
//   - The loop ticks at the FASTEST subscriber's interval. Its phase is that
//     subscriber's: the dashboard's tier-aligned interval (poller cycle plus a
//     write buffer) still lands just after each daemon write.
//   - Each subscriber is handed a result only at its OWN cadence (within half
//     a base tick), so a 15 s consumer still re-renders about every 15 s and
//     sees errors and staleness on the same schedule as before.
//   - Subscribing, or refresh(), fetches at once and delivers that result to
//     the caller regardless of cadence, as the per-instance hook did on mount.
//     Requests never overlap: a fetch already in flight serves the caller.
//   - While the page is hidden the loop stops, so a background tab no longer
//     refreshes the poller's UI heartbeat and holds it in the Active tier.
//     Becoming visible fetches at once and delivers to every subscriber.
//
// The store keeps no snapshot of its own. Each hook instance holds its last
// data, so an error keeps showing the data that instance had, as before.
// =============================================================================

/** After this many seconds without a fresh timestamp, data is "stale". */
export const STALE_THRESHOLD_SECONDS = 10;

export type ModemStatusEvent =
  | { kind: "data"; data: ModemStatus; receivedAtMs: number; isStale: boolean }
  | { kind: "error"; message: string };

export interface ModemStatusSubscription {
  /** Fetch now and deliver the result to this subscriber. */
  refresh: () => void;
  unsubscribe: () => void;
}

export interface ModemStatusStoreDeps {
  fetchStatus: () => Promise<ModemStatus>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Page visibility; omitted = always visible (tests, non-browser callers). */
  visibility?: VisibilitySource;
}

export interface VisibilitySource {
  isHidden: () => boolean;
  /** Call `fn` on every visibility change; returns the unsubscribe. */
  onChange: (fn: () => void) => () => void;
}

/** `document.visibilityState` as a VisibilitySource. */
export const documentVisibility: VisibilitySource = {
  isHidden: () =>
    typeof document !== "undefined" && document.visibilityState === "hidden",
  onChange: (fn) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  },
};

interface Subscriber {
  intervalMs: number;
  listener: (event: ModemStatusEvent) => void;
  /** When this subscriber last received an event; null = never. */
  lastDeliveredMs: number | null;
  /** Deliver the next result regardless of cadence (mount or refresh). */
  force: boolean;
}

export function createModemStatusStore(deps: ModemStatusStoreDeps) {
  const subscribers = new Set<Subscriber>();
  let timer: unknown = null;
  let timerIntervalMs: number | null = null;
  let inFlight = false;
  let stopVisibility: (() => void) | null = null;
  const isHidden = () => deps.visibility?.isHidden() ?? false;

  const baseInterval = (): number | null => {
    let min: number | null = null;
    for (const s of subscribers) {
      if (min === null || s.intervalMs < min) min = s.intervalMs;
    }
    return min;
  };

  const deliver = (event: ModemStatusEvent) => {
    const nowMs = deps.now();
    const base = baseInterval() ?? 0;
    // Results land once per base tick, so a subscriber whose interval is not a
    // multiple of it is served at the first tick within half a tick of due.
    const slack = base / 2;
    for (const s of Array.from(subscribers)) {
      const due =
        s.force ||
        s.lastDeliveredMs === null ||
        nowMs - s.lastDeliveredMs + slack >= s.intervalMs;
      if (!due) continue;
      s.force = false;
      s.lastDeliveredMs = nowMs;
      s.listener(event);
    }
  };

  const fetchNow = async () => {
    if (inFlight) return;
    inFlight = true;
    let event: ModemStatusEvent;
    try {
      const data = await deps.fetchStatus();
      // One clock read per landed response, shared by the arrival time and the
      // staleness check. The modem stamps `timestamp`; the 10 s threshold
      // absorbs the drift between its clock and the browser's.
      const receivedAtMs = deps.now();
      const age = Math.floor(receivedAtMs / 1000) - data.timestamp;
      event = {
        kind: "data",
        data,
        receivedAtMs,
        isStale: age > STALE_THRESHOLD_SECONDS,
      };
    } catch (err) {
      event = {
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to fetch modem status",
      };
    } finally {
      inFlight = false;
    }
    deliver(event);
  };

  /**
   * Keep the loop at the fastest subscriber's interval; stop it when none are
   * left or the page is hidden.
   */
  const reschedule = () => {
    const base = isHidden() ? null : baseInterval();
    if (base === timerIntervalMs) return;
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    timerIntervalMs = base;
    if (base !== null) timer = deps.setInterval(() => void fetchNow(), base);
  };

  const onVisibilityChange = () => {
    reschedule();
    if (isHidden() || subscribers.size === 0) return;
    // Back in view: every subscriber gets this result, whatever its cadence.
    for (const s of subscribers) s.force = true;
    void fetchNow();
  };

  const subscribe = (
    intervalMs: number,
    listener: (event: ModemStatusEvent) => void,
  ): ModemStatusSubscription => {
    const sub: Subscriber = {
      intervalMs,
      listener,
      lastDeliveredMs: null,
      force: true,
    };
    subscribers.add(sub);
    if (subscribers.size === 1 && deps.visibility && !stopVisibility) {
      stopVisibility = deps.visibility.onChange(onVisibilityChange);
    }
    reschedule();
    // A tab mounted in the background fetches when it is first shown.
    if (!isHidden()) void fetchNow();

    return {
      refresh: () => {
        if (!subscribers.has(sub)) return;
        sub.force = true;
        void fetchNow();
      },
      unsubscribe: () => {
        if (!subscribers.delete(sub)) return;
        if (subscribers.size === 0 && stopVisibility) {
          stopVisibility();
          stopVisibility = null;
        }
        reschedule();
      },
    };
  };

  return {
    subscribe,
    /** Test hook: how many consumers share the loop. */
    subscriberCount: () => subscribers.size,
  };
}

export type ModemStatusStore = ReturnType<typeof createModemStatusStore>;

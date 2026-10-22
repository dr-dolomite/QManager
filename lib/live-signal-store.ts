import type {
  LiveFile,
  LiveLeaseResult,
  LiveSample,
  LiveSignalSnapshot,
  LiveSignalState,
  LiveTier,
} from "@/types/live-signal";

// =============================================================================
// Live signal store: one shared lease + poll of the broker's live file
// =============================================================================
// Every `useLiveSignal()` consumer shares ONE lease and ONE poll loop.
//
//   - Tier = fastest subscriber (`aim` beats `watch`). `aim` demotes to
//     `watch` after 10 minutes without pointer/keyboard input and is restored
//     by the next input.
//   - The lease is POSTed at subscribe, every `renew_s`, and on becoming
//     visible. The file is polled by a non-overlapping timeout chain at the
//     lease's `period_ms`. A hidden tab stops both.
//   - Samples merge by `seq` into a 150-sample ring. `seq` grows for the whole
//     daemon run (across lease episodes); only `run` changing (broker restart)
//     resets the ring. The url can change between leases; the next poll uses
//     the new one.
//   - A failed poll (404, network, bad body) or lease error re-leases at once,
//     then backs off 1 / 2 / 5 s; one more failure and the store is
//     `unavailable` until the tab becomes visible again or it is remounted.
//   - Nothing here touches the DOM or the clock directly: fetch, timers,
//     visibility, input and `now` are injected (pattern: modem-status-store).
// =============================================================================

/** Client ring size: 30 s at 5 Hz. */
export const LIVE_RING_SIZE = 150;
/** Re-lease delays after consecutive failures: now, then 1 / 2 / 5 s. */
export const LIVE_RETRY_DELAYS_MS = [0, 1000, 2000, 5000] as const;
/** `aim` becomes `watch` after this long without input. */
export const LIVE_IDLE_DEMOTE_MS = 10 * 60 * 1000;
/** A poll that has not settled after max(this, 4 periods) is a failure. */
export const LIVE_POLL_MIN_TIMEOUT_MS = 2000;
/** A fresh url may 404 for 2 periods plus this while the broker publishes. */
export const LIVE_PUBLISH_GRACE_EXTRA_MS = 500;
/** A file with no new seq for this many periods is stale. */
export const LIVE_STALE_PERIODS = 3;

export interface LiveFileResult {
  status: number;
  /** Parsed body; null when the body was not usable JSON. */
  file: LiveFile | null;
}

export interface LiveSignalStoreDeps {
  lease: (tier: LiveTier) => Promise<LiveLeaseResult>;
  /** `signal` aborts when the store gives up on the request (timeout/stop). */
  fetchFile: (url: string, signal: AbortSignal) => Promise<LiveFileResult>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isVisible: () => boolean;
  /** Registers a visibility listener; returns its remover. */
  onVisibilityChange: (cb: (visible: boolean) => void) => () => void;
  /** Registers a pointer/keyboard-input listener; returns its remover. */
  onInput: (cb: () => void) => () => void;
}

export interface LiveSignalSubscription {
  /** Change this subscriber's tier without a reset or a new subscription. */
  setTier: (tier: LiveTier) => void;
  unsubscribe: () => void;
}

export const INITIAL_LIVE_SNAPSHOT: LiveSignalSnapshot = {
  state: "connecting",
  latest: null,
  samples: [],
  receivedAtMs: null,
  qmiState: null,
  scan: false,
  ssrCount: 0,
  periodMs: null,
};

interface Sub {
  tier: LiveTier;
}

export function createLiveSignalStore(deps: LiveSignalStoreDeps) {
  const subs = new Set<Sub>();
  const listeners = new Set<() => void>();
  let snap: LiveSignalSnapshot = INITIAL_LIVE_SNAPSHOT;

  let running = false; // subscribers present AND tab visible AND not unavailable
  let unavailable = false;
  let epoch = 0; // bumps on stop/start so late async results are ignored
  let leaseTimer: unknown = null;
  let pollTimer: unknown = null;
  let idleTimer: unknown = null;
  let leaseInFlight = false;
  let leasePending = false;
  let pollInFlight = false;
  let pollToken = 0;
  let pollAbort: AbortController | null = null;
  let pollDeadline: unknown = null;
  let graceUntilMs = 0; // 404s before this on an unconfirmed url are "not yet"
  let lastUrl: string | null = null; // last url a lease returned
  let urlConfirmed = false; // a 200 has landed on the current url
  let failures = 0;
  let leasedTier: LiveTier | null = null;

  let url: string | null = null;
  let periodMs = 1000;
  let renewMs = 5000;

  let ring: LiveSample[] = [];
  let run: number | null = null;
  let maxSeq = -1;
  let lastNewAtMs: number | null = null;
  let dataVersion = 0;
  let builtVersion = 0;
  let meta = {
    qmiState: null as LiveSignalSnapshot["qmiState"],
    scan: false,
    ssrCount: 0,
    periodMs: null as number | null,
  };

  let lastInputMs = 0;
  let idle = false;
  let removeVisibility: (() => void) | null = null;
  let removeInput: (() => void) | null = null;

  // ---- snapshot ------------------------------------------------------------

  const computeState = (): LiveSignalState => {
    if (subs.size === 0) return "connecting";
    if (!deps.isVisible()) return "paused";
    if (unavailable) return "unavailable";
    const latest = ring.length > 0 ? ring[ring.length - 1] : null;
    if (latest === null || lastNewAtMs === null) return "connecting";
    const period = meta.periodMs ?? periodMs;
    if (deps.now() - lastNewAtMs > LIVE_STALE_PERIODS * period) return "stale";
    if (meta.qmiState !== "up" || latest.reg === false || meta.scan) {
      return "stale";
    }
    return "live";
  };

  const emit = () => {
    const state = computeState();
    if (state === snap.state && builtVersion === dataVersion) return;
    const samplesChanged = builtVersion !== dataVersion;
    snap = {
      state,
      latest: ring.length > 0 ? ring[ring.length - 1] : null,
      samples: samplesChanged ? ring.slice() : snap.samples,
      receivedAtMs: lastNewAtMs,
      qmiState: meta.qmiState,
      scan: meta.scan,
      ssrCount: meta.ssrCount,
      periodMs: meta.periodMs,
    };
    builtVersion = dataVersion;
    for (const l of Array.from(listeners)) l();
  };

  // ---- data ----------------------------------------------------------------

  const merge = (file: LiveFile): boolean => {
    if (
      typeof file !== "object" ||
      file === null ||
      file.v !== 1 ||
      typeof file.run !== "number" ||
      !Array.isArray(file.samples)
    ) {
      return false;
    }
    if (run !== file.run) {
      run = file.run;
      ring = [];
      maxSeq = -1;
      dataVersion += 1;
    }
    let added = false;
    for (const s of file.samples) {
      if (typeof s?.seq !== "number" || s.seq <= maxSeq) continue;
      ring.push(s);
      maxSeq = s.seq;
      added = true;
    }
    if (ring.length > LIVE_RING_SIZE) {
      ring = ring.slice(ring.length - LIVE_RING_SIZE);
    }
    if (added) {
      lastNewAtMs = deps.now();
      dataVersion += 1;
    }
    const next = {
      qmiState: file.qmi_state,
      scan: file.scan === true,
      ssrCount: typeof file.ssr_count === "number" ? file.ssr_count : 0,
      periodMs:
        typeof file.period_ms === "number" && file.period_ms > 0
          ? file.period_ms
          : meta.periodMs,
    };
    if (
      next.qmiState !== meta.qmiState ||
      next.scan !== meta.scan ||
      next.ssrCount !== meta.ssrCount ||
      next.periodMs !== meta.periodMs
    ) {
      meta = next;
      dataVersion += 1;
    }
    return true;
  };

  const resetData = () => {
    ring = [];
    run = null;
    maxSeq = -1;
    lastNewAtMs = null;
    meta = { qmiState: null, scan: false, ssrCount: 0, periodMs: null };
    url = null;
    lastUrl = null;
    urlConfirmed = false;
    dataVersion += 1;
  };

  // ---- timers / lifecycle --------------------------------------------------

  const clearLease = () => {
    if (leaseTimer !== null) deps.clearTimeout(leaseTimer);
    leaseTimer = null;
  };
  const clearPoll = () => {
    if (pollTimer !== null) deps.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const clearIdle = () => {
    if (idleTimer !== null) deps.clearTimeout(idleTimer);
    idleTimer = null;
  };

  /** Drop the in-flight poll (timeout, abort) so a late result is ignored. */
  const endPoll = () => {
    pollToken += 1;
    pollInFlight = false;
    if (pollDeadline !== null) deps.clearTimeout(pollDeadline);
    pollDeadline = null;
    pollAbort?.abort();
    pollAbort = null;
  };

  const stopLoops = () => {
    epoch += 1;
    clearLease();
    clearPoll();
    leaseInFlight = false;
    leasePending = false;
    endPoll();
    leasedTier = null;
  };

  const effectiveTier = (): LiveTier => {
    if (idle) return "watch";
    for (const s of subs) if (s.tier === "aim") return "aim";
    return "watch";
  };

  const goUnavailable = () => {
    stopLoops();
    running = false;
    unavailable = true;
    url = null;
    emit();
  };

  const onFailure = () => {
    clearPoll();
    url = null;
    failures += 1;
    if (failures > LIVE_RETRY_DELAYS_MS.length) {
      goUnavailable();
      return;
    }
    clearLease();
    // A lease already in flight supersedes the retry: its result brings a
    // fresh url, so arming a timer here would only be clobbered or orphaned.
    if (!leaseInFlight) {
      leaseTimer = deps.setTimeout(
        leaseNow,
        LIVE_RETRY_DELAYS_MS[failures - 1],
      );
    }
    emit();
  };

  const schedulePoll = () => {
    clearPoll();
    pollTimer = deps.setTimeout(() => {
      pollTimer = null;
      pollNow();
    }, periodMs);
  };

  const pollNow = () => {
    if (!running || url === null || pollInFlight) return;
    pollInFlight = true;
    const token = ++pollToken;
    const target = url;
    const abort = new AbortController();
    pollAbort = abort;
    pollDeadline = deps.setTimeout(
      () => {
        pollDeadline = null;
        if (token !== pollToken) return;
        endPoll(); // aborts the request; a late result is ignored
        onFailure();
      },
      Math.max(LIVE_POLL_MIN_TIMEOUT_MS, 4 * periodMs),
    );
    const settled = (): boolean => {
      if (token !== pollToken) return false;
      pollInFlight = false;
      if (pollDeadline !== null) deps.clearTimeout(pollDeadline);
      pollDeadline = null;
      pollAbort = null;
      return true;
    };
    deps.fetchFile(target, abort.signal).then(
      (res) => {
        if (!settled()) return;
        if (target !== url) {
          // Re-leased onto a new url while this was in flight.
          if (url !== null) pollNow();
          return;
        }
        if (res.status === 200 && res.file !== null && merge(res.file)) {
          failures = 0;
          urlConfirmed = true;
          schedulePoll();
          emit();
        } else if (
          res.status === 404 &&
          !urlConfirmed &&
          deps.now() < graceUntilMs
        ) {
          // Fresh url, broker has not published it yet: keep polling.
          schedulePoll();
          emit();
        } else {
          onFailure();
        }
      },
      () => {
        if (!settled()) return;
        if (target !== url) {
          if (url !== null) pollNow();
          return;
        }
        onFailure();
      },
    );
  };

  function leaseNow() {
    clearLease();
    if (!running) return;
    if (leaseInFlight) {
      leasePending = true;
      return;
    }
    leaseInFlight = true;
    const ep = epoch;
    const tier = effectiveTier();
    leasedTier = tier;
    const settle = (res: LiveLeaseResult) => {
      if (ep !== epoch) return;
      leaseInFlight = false;
      if (res.kind === "unavailable") {
        goUnavailable();
        return;
      }
      if (res.kind === "error") {
        leasePending = false;
        onFailure();
        return;
      }
      url = res.url;
      if (res.periodMs > 0) periodMs = res.periodMs;
      if (res.renewS > 0) renewMs = res.renewS * 1000;
      if (res.url !== lastUrl) {
        // A new url: the broker may not have published it yet.
        lastUrl = res.url;
        urlConfirmed = false;
        graceUntilMs =
          deps.now() + 2 * periodMs + LIVE_PUBLISH_GRACE_EXTRA_MS;
      }
      if (pollTimer === null && !pollInFlight) pollNow();
      clearLease();
      if (leasePending) {
        leasePending = false;
        leaseNow();
      } else {
        leaseTimer = deps.setTimeout(leaseNow, renewMs);
      }
      emit();
    };
    deps.lease(tier).then(settle, () => settle({ kind: "error" }));
  }

  const retier = () => {
    if (running && leasedTier !== effectiveTier()) leaseNow();
  };

  const start = () => {
    stopLoops();
    running = true;
    leaseNow();
  };

  // ---- idle demotion -------------------------------------------------------

  const armIdle = () => {
    clearIdle();
    if (idle) return;
    let hasAim = false;
    for (const s of subs) if (s.tier === "aim") hasAim = true;
    if (!hasAim) return;
    const remaining = Math.max(
      0,
      LIVE_IDLE_DEMOTE_MS - (deps.now() - lastInputMs),
    );
    idleTimer = deps.setTimeout(() => {
      idleTimer = null;
      if (deps.now() - lastInputMs >= LIVE_IDLE_DEMOTE_MS) {
        idle = true;
        retier();
      } else {
        armIdle();
      }
    }, remaining);
  };

  const handleInput = () => {
    lastInputMs = deps.now();
    if (idle) {
      idle = false;
      retier();
      armIdle();
    }
  };

  const handleVisibility = (visible: boolean) => {
    if (subs.size === 0) return;
    if (!visible) {
      running = false;
      stopLoops();
      emit();
      return;
    }
    failures = 0;
    unavailable = false;
    start();
    emit();
  };

  // ---- public --------------------------------------------------------------

  const subscribe = (tier: LiveTier): LiveSignalSubscription => {
    const sub: Sub = { tier };
    const first = subs.size === 0;
    subs.add(sub);
    if (first) {
      lastInputMs = deps.now();
      idle = false;
      failures = 0;
      unavailable = false;
      removeVisibility = deps.onVisibilityChange(handleVisibility);
      removeInput = deps.onInput(handleInput);
      if (deps.isVisible()) start();
    } else if (!unavailable && deps.isVisible()) {
      if (!running) start();
      else retier();
    }
    armIdle();
    emit();

    return {
      setTier: (next: LiveTier) => {
        if (!subs.has(sub) || sub.tier === next) return;
        sub.tier = next;
        armIdle();
        retier();
      },
      unsubscribe: () => {
        if (!subs.delete(sub)) return;
        if (subs.size === 0) {
          stopLoops();
          clearIdle();
          running = false;
          unavailable = false;
          failures = 0;
          idle = false;
          removeVisibility?.();
          removeInput?.();
          removeVisibility = null;
          removeInput = null;
          resetData();
          snap = INITIAL_LIVE_SNAPSHOT;
          builtVersion = dataVersion;
          for (const l of Array.from(listeners)) l();
        } else {
          armIdle();
          retier();
        }
      },
    };
  };

  return {
    subscribe,
    /** Plain change listener for `useSyncExternalStore`; returns its remover. */
    listen: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => snap,
    /** Test hooks. */
    subscriberCount: () => subs.size,
    leasedTier: () => leasedTier,
  };
}

export type LiveSignalStore = ReturnType<typeof createLiveSignalStore>;

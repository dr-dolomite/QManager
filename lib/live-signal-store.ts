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
/** A file with no new seq for this many periods is stale. */
export const LIVE_STALE_PERIODS = 3;

export interface LiveFileResult {
  status: number;
  /** Parsed body; null when the body was not usable JSON. */
  file: LiveFile | null;
}

export interface LiveSignalStoreDeps {
  lease: (tier: LiveTier) => Promise<LiveLeaseResult>;
  fetchFile: (url: string) => Promise<LiveFileResult>;
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

  const merge = (file: LiveFile) => {
    if (file.v !== 1 || typeof file.run !== "number") return;
    if (!Array.isArray(file.samples)) return;
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
  };

  const resetData = () => {
    ring = [];
    run = null;
    maxSeq = -1;
    lastNewAtMs = null;
    meta = { qmiState: null, scan: false, ssrCount: 0, periodMs: null };
    url = null;
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

  const stopLoops = () => {
    epoch += 1;
    clearLease();
    clearPoll();
    leaseInFlight = false;
    leasePending = false;
    pollInFlight = false;
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
    leaseTimer = deps.setTimeout(leaseNow, LIVE_RETRY_DELAYS_MS[failures - 1]);
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
    const ep = epoch;
    const target = url;
    deps.fetchFile(target).then(
      (res) => {
        if (ep !== epoch) return;
        pollInFlight = false;
        if (target !== url) {
          // Re-leased onto a new url while this was in flight.
          if (url !== null) pollNow();
          return;
        }
        if (res.status === 200 && res.file !== null) {
          failures = 0;
          merge(res.file);
          schedulePoll();
          emit();
        } else {
          onFailure();
        }
      },
      () => {
        if (ep !== epoch) return;
        pollInFlight = false;
        if (target !== url) return;
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
      if (pollTimer === null && !pollInFlight) pollNow();
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

// =============================================================================
// startVisibleInterval: a setInterval that only runs while the page is visible
// =============================================================================
// A hidden tab that keeps polling still costs the modem a CGI process per call
// and, for the status endpoints, refreshes the poller's UI heartbeat so the
// poller stays in its Active tier. Pollers that only feed what is on screen use
// this instead of a bare setInterval:
//
//   - visible at start: `tick` runs now (unless `immediate: false`), then every
//     `ms`;
//   - hidden: the interval is stopped;
//   - visible again: `onResume` runs, then `tick` at once, then the interval
//     restarts on that phase.
//
// Returns the stop function for the effect cleanup.
// =============================================================================

export interface VisibleIntervalOptions {
  /** Run `tick` at start when the page is visible (default: true). */
  immediate?: boolean;
  /** Runs on every hidden -> visible transition, before `tick`. */
  onResume?: () => void;
}

export function startVisibleInterval(
  tick: () => void,
  ms: number,
  options: VisibleIntervalOptions = {},
): () => void {
  const { immediate = true, onResume } = options;
  let id: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (id === null) id = setInterval(tick, ms);
  };
  const stop = () => {
    if (id !== null) {
      clearInterval(id);
      id = null;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    if (id !== null) return;
    onResume?.();
    tick();
    start();
  };

  if (document.visibilityState !== "hidden") {
    if (immediate) tick();
    start();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stop();
  };
}

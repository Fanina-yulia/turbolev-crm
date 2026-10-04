export type AdaptivePollingOptions = {
  run: () => Promise<unknown> | unknown;
  intervalMs: number | (() => number);
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  runOnFocus?: boolean;
};

function resolveInterval(value: AdaptivePollingOptions["intervalMs"]) {
  const raw = typeof value === "function" ? value() : value;
  return Math.max(250, Number.isFinite(raw) ? Math.trunc(raw) : 1_000);
}

export function startAdaptivePoller(options: AdaptivePollingOptions) {
  let stopped = false;
  let inFlight = false;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs = resolveInterval(options.intervalMs)) => {
    if (stopped) return;
    clearTimer();
    timer = window.setTimeout(() => { void tick(); }, Math.max(0, delayMs));
  };

  const tick = async () => {
    if (stopped) return;
    if (options.pauseWhenHidden !== false && document.visibilityState !== "visible") {
      clearTimer();
      return;
    }
    if (inFlight) {
      schedule();
      return;
    }

    inFlight = true;
    try {
      await options.run();
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const wake = () => {
    if (stopped) return;
    if (options.pauseWhenHidden !== false && document.visibilityState !== "visible") return;
    schedule(0);
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") wake();
    else clearTimer();
  };

  document.addEventListener("visibilitychange", onVisibility);
  if (options.runOnFocus !== false) window.addEventListener("focus", wake);
  schedule(options.immediate === false ? resolveInterval(options.intervalMs) : 0);

  return () => {
    stopped = true;
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    if (options.runOnFocus !== false) window.removeEventListener("focus", wake);
  };
}

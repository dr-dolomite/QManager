"use client";

// Shared cursor for History pages: hovering any chart, strip bar or event row
// marks one moment on every surface. Charts draw a crosshair + dots, the strip
// dims the other bars; only the hovered surface shows its own tooltip.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type CursorSource = "chart" | "strip" | "event";

export interface HistoryCursor {
  /** Epoch seconds of the hovered moment, or null. */
  t: number | null;
  /** Which surface owns the hover (owner shows the tooltip). */
  source: CursorSource | null;
  /** Id of the owning surface (e.g. "lte_rsrp" chart), for tooltip ownership. */
  ownerId: string | null;
  set: (t: number | null, source?: CursorSource, ownerId?: string) => void;
}

const Ctx = createContext<HistoryCursor | null>(null);

export function HistoryCursorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ t: number | null; source: CursorSource | null; ownerId: string | null }>({
    t: null,
    source: null,
    ownerId: null,
  });
  const value = useMemo<HistoryCursor>(
    () => ({
      ...state,
      set: (t, source, ownerId) =>
        setState(t === null ? { t: null, source: null, ownerId: null } : { t, source: source ?? null, ownerId: ownerId ?? null }),
    }),
    [state],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHistoryCursor(): HistoryCursor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHistoryCursor must be used inside HistoryCursorProvider");
  return v;
}

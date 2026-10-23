"use client";

import * as React from "react";

import { useLiveSignal } from "@/hooks/use-live-signal";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  normalizeSignalValue,
  type SignalQuality,
} from "@/types/modem-status";
import {
  sampleDb,
  type LiveSample,
  type LiveSignalState,
} from "@/types/live-signal";

// =============================================================================
// The live lead: serving-cell RSRP from the broker's live file
// =============================================================================
// The console's composite score is built from the PER-PORT snapshot, which
// lands every ~2 s. The live file is faster (1 Hz on either tier) but it
// carries something different: the SERVING cell's RSRP as the modem reports it
// across all receive chains (the LTE anchor in NSA). It is not Main / PRX, and
// nothing here pretends it is; the two readings sit side by side and are
// labelled apart.
//
// Derived once in the page and handed to both the console and the condensed
// pill, so the pinned readout and the card can never disagree about the peak.
// =============================================================================

/** The sparkline's window (the store's 150-sample ring covers it at up to 5 Hz). */
export const LIVE_WINDOW_MS = 30_000;

/** A sample gap longer than this breaks the line instead of bridging it. */
const GAP_BREAK_MS = 2_500;

export interface LivePoint {
  /** Milliseconds before the newest sample (0 = newest, negative = older). */
  dt: number;
  /** RSRP in dB, or null where the line breaks. */
  value: number | null;
}

export interface LiveLead {
  /** Never `unavailable`: that state returns no lead at all. */
  state: Exclude<LiveSignalState, "unavailable">;
  /** Newest serving RSRP at 0.1 dB, or null (unregistered, scanning). */
  rsrp: number | null;
  quality: SignalQuality;
  /** Best serving RSRP seen on this cell this session. */
  peak: number | null;
  /** `rsrp - peak`, at 0.1 dB (zero or negative). */
  toPeak: number | null;
  /** The last 30 s, oldest first. */
  points: LivePoint[];
}

interface PeakTrack {
  seq: number | null;
  cell: string | null;
  peak: number | null;
}

const cellKey = (s: LiveSample) => `${s.pci ?? "?"}/${s.earfcn ?? "?"}`;

const liveRsrp = (s: LiveSample): number | null =>
  normalizeSignalValue(sampleDb(s).rsrp, "rsrp");

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Returns the live lead, or `null` when the console should render exactly as
 * it did before the live channel existed: the broker is unavailable, or no
 * serving RSRP has arrived yet (connecting, or 5G SA where the live file has
 * no LTE serving cell to report).
 */
export function useLiveLead(): LiveLead | null {
  const { state, latest, samples } = useLiveSignal({ tier: "aim" });

  // Session peak, per serving cell. Adjusted during render from the sample
  // sequence (never in an effect), so it moves in the same frame as the
  // numeral. A handover resets it: a peak on another cell is not a position
  // this antenna can return to.
  const [track, setTrack] = React.useState<PeakTrack>({
    seq: null,
    cell: null,
    peak: null,
  });

  if (latest && latest.seq !== track.seq) {
    const cell = cellKey(latest);
    let peak = cell === track.cell ? track.peak : null;
    // A lower seq means the broker restarted; rescan the whole ring.
    const fresh =
      track.seq !== null && latest.seq > track.seq
        ? samples.filter((s) => s.seq > track.seq!)
        : samples;
    for (const s of fresh) {
      if (cellKey(s) !== cell) continue;
      const v = liveRsrp(s);
      if (v !== null && (peak === null || v > peak)) peak = v;
    }
    setTrack({ seq: latest.seq, cell, peak });
  }

  if (state === "unavailable" || !latest) return null;
  if (!samples.some((s) => liveRsrp(s) !== null)) return null;

  const end = latest.t;
  const points: LivePoint[] = [];
  let prevT: number | null = null;
  for (const s of samples) {
    if (s.t < end - LIVE_WINDOW_MS || s.t > end) continue;
    if (prevT !== null && s.t - prevT > GAP_BREAK_MS) {
      points.push({ dt: prevT - end + 1, value: null });
    }
    points.push({ dt: s.t - end, value: liveRsrp(s) });
    prevT = s.t;
  }

  const rsrp = liveRsrp(latest);
  const peak = track.cell === cellKey(latest) ? track.peak : null;

  return {
    state,
    rsrp,
    quality: getSignalQuality(rsrp, RSRP_THRESHOLDS),
    peak,
    toPeak: rsrp !== null && peak !== null ? round1(Math.min(0, rsrp - peak)) : null,
    points,
  };
}

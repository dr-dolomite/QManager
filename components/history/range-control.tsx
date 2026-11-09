"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { HISTORY_RANGE_ORDER, type HistoryRange } from "@/types/history";

// =============================================================================
// RangeControl: the one range every History card follows
// =============================================================================
// Six compact pills ("5m 1h 1D 1W 15D 1M") on a travelling thumb, one row at
// every width. The visible labels are the short forms in `shared.range_short.*`;
// each pill's accessible name is the full range name from the `<series>.range.*`
// keys ("5 minutes", "Day", "Month"), so the control is series-agnostic: a page
// passes its own key prefix.
//
// The thumb is one `motion.span` rendered inside the active pill, sharing a
// layoutId, so Motion tweens the box between pills instead of cross-fading two
// fills. The layoutId is unique PER MOUNT (a module counter read once), not per
// tree position: two routes of the same shape would otherwise mint the same id
// and hand each thumb the other's as its predecessor (see segmented-field.tsx).
// =============================================================================

/** Per-mount id source for the thumb's `layoutId`. */
let rangeControlSeq = 0;

export function RangeControl({
  value,
  onChange,
  keyPrefix,
  disabled,
}: {
  value: HistoryRange;
  onChange: (range: HistoryRange) => void;
  /** i18n prefix holding `label` and the full range names, e.g. "cellular.range". */
  keyPrefix: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("history");
  const [instanceId] = useState(() => `history-range-${++rangeControlSeq}`);

  // The thumb must not slide in from nowhere on first paint: one frame with a
  // zero-length transition and it is simply already under the active pill.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix emits "" when the active item is clicked again; a range has no
      // empty state, so the deselect is swallowed.
      onValueChange={(next) => next && onChange(next as HistoryRange)}
      spacing={1}
      disabled={disabled}
      aria-label={t(`${keyPrefix}.label`)}
      className="shrink-0 rounded-pill bg-surface-container p-1"
    >
      {HISTORY_RANGE_ORDER.map((range) => {
        const active = range === value;
        return (
          <ToggleGroupItem
            key={range}
            value={range}
            aria-label={t(`${keyPrefix}.${range}`)}
            className={cn(
              "relative h-auto rounded-pill px-3 py-1.5 text-xs font-semibold tabular-nums hover:bg-transparent disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-transparent",
              // The on-state colour must ride data-[state=on]: the Toggle base
              // sets data-[state=on]:text-accent-foreground, which outranks a
              // plain class and painted the active label white.
              active
                ? "data-[state=on]:text-primary-foreground"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${instanceId}-thumb`}
                className="absolute inset-0 rounded-pill bg-primary"
                transition={settled ? transitionStandard : { duration: 0 }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative">{t(`shared.range_short.${range}`)}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export default RangeControl;

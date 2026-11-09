"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { HISTORY_RANGE_ORDER, type HistoryRange } from "@/types/history";

// =============================================================================
// RangeControl — the one range every History card follows
// =============================================================================
// Three short options that always fit one row, so the pill group never falls
// back to a Select (`breakpoint="never"`). The labels come from the `history`
// namespace's `<series>.range.*` keys, so the control is series-agnostic: a page
// passes its own key prefix.
// =============================================================================

export function RangeControl({
  value,
  onChange,
  keyPrefix,
  disabled,
}: {
  value: HistoryRange;
  onChange: (range: HistoryRange) => void;
  /** i18n prefix holding `label`, `24h`, `7d`, `30d`, e.g. "cellular.range". */
  keyPrefix: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("history");
  return (
    <SegmentedField
      value={value}
      onValueChange={onChange}
      options={HISTORY_RANGE_ORDER.map((range) => ({
        value: range,
        label: t(`${keyPrefix}.${range}`),
      }))}
      ariaLabel={t(`${keyPrefix}.label`)}
      disabled={disabled}
      breakpoint="never"
      glyph={(className) => (
        <MaterialSymbol name="check" size={16} className={className} aria-hidden="true" />
      )}
    />
  );
}

export default RangeControl;

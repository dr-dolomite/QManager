"use client";

import { useTranslation } from "react-i18next";

import { formatSince, formatSpan, formatWhen } from "@/components/history/format";
import { HintIcon } from "@/components/ui/hint-icon";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PREV_BOOT, THIS_BOOT, type BootChoice } from "@/hooks/use-system-logs";
import type { LogBoot } from "@/types/system-logs";

import { dayKeyOf } from "./derive";
import { LOGS } from "./shapes";

// =============================================================================
// Logs: which boot the transcript reads
// =============================================================================
// Shown only when the journal holds two or more boots. Two boots are a This /
// Previous switch; more become a Select whose older entries are named by when
// they started. Beside it, the chosen boot's time span (the running boot reads
// "Since ..."), and one tip on how long boots are kept.
// =============================================================================

export interface BootSelectProps {
  /** Newest first, as the hook orders them. */
  boots: readonly LogBoot[];
  /** The running boot's id, when the journal reports it. */
  thisBoot: string | null;
  value: BootChoice;
  onValueChange: (next: BootChoice) => void;
  /** Seconds on the rows' clock the day words ("Today") are relative to. */
  nowSec: number;
  /**
   * Added to a boot's epoch stamps to put them on the rows' clock (the modem's
   * local time on the QManager tab, 0 where rows are drawn from epochs).
   */
  offsetSec?: number;
}

const checkGlyph = (className: string) => (
  <MaterialSymbol name="check" filled size={SEGMENTED.GLYPH} aria-hidden="true" className={className} />
);

/** The boot a choice names: `this` is the newest, `prev` the one after it. */
function bootOf(
  boots: readonly LogBoot[],
  thisBoot: string | null,
  value: BootChoice,
): LogBoot | undefined {
  const current = (thisBoot !== null && boots.find((b) => String(b.boot) === thisBoot)) || boots[0];
  if (value === THIS_BOOT) return current;
  const older = boots.filter((b) => b !== current);
  if (value === PREV_BOOT) return older[0];
  return boots.find((b) => String(b.boot) === value);
}

export function BootSelect({
  boots,
  thisBoot,
  value,
  onValueChange,
  nowSec,
  offsetSec = 0,
}: BootSelectProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;

  if (boots.length < 2) return null;

  const current = bootOf(boots, thisBoot, THIS_BOOT);
  const older = boots.filter((b) => b !== current);
  const shown = bootOf(boots, thisBoot, value);

  const startedAt = (b: LogBoot) =>
    typeof b.first === "number" ? formatWhen(b.first + offsetSec, nowSec, t, locale) : null;

  // The chosen boot's span on the rows' clock: "Since 14:40" while it runs,
  // else first to last (the shared History span; both days when it crosses one).
  let span: string | null = null;
  if (shown && typeof shown.first === "number") {
    const first = shown.first + offsetSec;
    if (value === THIS_BOOT) {
      span = t("logs.boot.since", { when: formatSince(first, nowSec, t, locale) });
    } else if (typeof shown.last === "number") {
      const last = shown.last + offsetSec;
      span =
        dayKeyOf(first) === dayKeyOf(last)
          ? formatSpan(first, last, nowSec, t, locale)
          : t("logs.boot.span", {
              from: formatWhen(first, nowSec, t, locale),
              to: formatWhen(last, nowSec, t, locale),
            });
    }
  }

  return (
    <div className={LOGS.BOOT_ROW}>
      {boots.length === 2 ? (
        <SegmentedField
          value={value}
          onValueChange={onValueChange}
          options={[
            { value: THIS_BOOT, label: t("logs.boot.this") },
            { value: PREV_BOOT, label: t("logs.boot.prev") },
          ]}
          ariaLabel={t("logs.boot.label")}
          breakpoint="never"
          glyph={checkGlyph}
        />
      ) : (
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger size="sm" aria-label={t("logs.boot.label")} className="tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-tile">
            <SelectItem value={THIS_BOOT}>{t("logs.boot.this")}</SelectItem>
            {older.map((b, i) => {
              const started = startedAt(b);
              return (
                <SelectItem
                  key={String(b.boot)}
                  value={i === 0 ? PREV_BOOT : String(b.boot)}
                  className="tabular-nums"
                >
                  {i === 0
                    ? t("logs.boot.prev")
                    : started
                      ? t("logs.boot.started", { when: started })
                      : t("logs.boot.numbered", { n: b.boot })}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
      <span className={LOGS.BOOT_SPAN}>
        {span ? <span className="truncate">{span}</span> : null}
        <HintIcon label={t("logs.boot.hint_label")}>{t("logs.boot.hint")}</HintIcon>
      </span>
    </div>
  );
}

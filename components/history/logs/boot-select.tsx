"use client";

import { useTranslation } from "react-i18next";

import { formatClock, formatSince, formatWhen } from "@/components/history/format";
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

// =============================================================================
// Logs: which boot the transcript reads
// =============================================================================
// Shown only when the journal holds two or more boots. Two boots are a This /
// Previous switch; more become a Select whose older entries are named by when
// they started. Beside it, the chosen boot's time span (the running boot reads
// "Since ..."), and one tip saying the log now outlives a restart.
// =============================================================================

export interface BootSelectProps {
  /** Newest first, as the hook orders them. */
  boots: readonly LogBoot[];
  /** The running boot's id, when the journal reports it. */
  thisBoot: string | null;
  value: BootChoice;
  onValueChange: (next: BootChoice) => void;
  /** Epoch seconds the day words ("Today") are relative to. */
  nowSec: number;
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

export function BootSelect({ boots, thisBoot, value, onValueChange, nowSec }: BootSelectProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;

  if (boots.length < 2) return null;

  const current = bootOf(boots, thisBoot, THIS_BOOT);
  const older = boots.filter((b) => b !== current);
  const shown = bootOf(boots, thisBoot, value);

  const startedAt = (b: LogBoot) =>
    typeof b.first === "number" ? formatWhen(b.first, nowSec, t, locale) : null;

  // The chosen boot's span: "Since 14:40" while it runs, else first to last.
  let span: string | null = null;
  if (shown && typeof shown.first === "number") {
    if (value === THIS_BOOT) {
      span = t("logs.boot.since", { when: formatSince(shown.first, nowSec, t, locale) });
    } else if (typeof shown.last === "number") {
      const sameDay = new Date(shown.first * 1000).toDateString() === new Date(shown.last * 1000).toDateString();
      span = t("logs.boot.span", {
        from: formatWhen(shown.first, nowSec, t, locale),
        to: sameDay ? formatClock(shown.last, locale) : formatWhen(shown.last, nowSec, t, locale),
      });
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
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
      <span className="text-on-surface-variant flex min-w-0 items-center gap-1.5 text-[0.8125rem] tabular-nums">
        {span ? <span className="truncate">{span}</span> : null}
        <HintIcon label={t("logs.boot.hint_label")}>{t("logs.boot.hint")}</HintIcon>
      </span>
    </div>
  );
}

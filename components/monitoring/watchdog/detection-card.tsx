"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, RadarIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HintIcon } from "@/components/ui/hint-icon";
import {
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import type { WatchdogSettingsV2, WatchdogStatus } from "@/types/cq-watchdog";
import { cn } from "@/lib/utils";

import {
  deriveTimeline,
  isIntInRange,
  useFormatters,
  type Formatters,
  type LimitFact,
  type QualityLimits,
  type SensitivityFacts,
  type TimelineLabel,
  type TimelineRow,
  type TimelineView,
} from "./derive";
import { Disclosure } from "./disclosure";
import { NumberField, OnOffField, renderCheckGlyph } from "./fields";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DETECT,
  SKELETON,
  TIMELINE,
} from "./shapes";
import { FIELD_ID, draftTiers, type WatchdogForm } from "./use-watchdog-form";
import { WatchdogFoot, WatchdogFootSkeleton } from "./watchdog-foot";

/** Start-recovery presets, in seconds. */
const ACT_PRESETS = [15, 30, 60, 120] as const;
/** Poor-quality presets, in seconds (stored as seconds, 30 to 1800). */
const QUALITY_PRESETS = [60, 120, 300, 600] as const;
/** One-carrier presets, in minutes. */
const CARRIER_PRESETS = [5, 15, 30, 60] as const;

const CUSTOM = "custom";

export interface DetectionCardProps {
  form: WatchdogForm;
  facts: SensitivityFacts;
  limits: QualityLimits;
  /** Saved settings: the fallback when a draft value is not a number yet. */
  saved: WatchdogSettingsV2;
  status: WatchdogStatus | null;
  /** The status reflects a reporting daemon (not off, starting or silent). */
  reporting: boolean;
  /** Seconds offline right now, or null when the link is up. */
  offlineSecs: number | null;
  /** The carrier count the daemon last read, with the live single-carrier run. */
  carrierSecs: number;
}

/** The number a draft string holds, or a fallback while it is not one. */
const numberOr = (raw: string, fallback: number): number =>
  Number.isInteger(Number(raw)) && raw.trim() !== "" ? Number(raw) : fallback;

/** A limit as the caption reads it: "250 ms", or "5 % → 10 %" when the floor raised it. */
function limitText(limit: LimitFact, unit: string, floorUnit = unit): string {
  return limit.raw !== null && limit.raw !== limit.effective
    ? `${limit.raw} ${unit} → ${limit.effective} ${floorUnit}`
    : `${limit.effective} ${floorUnit}`;
}

/**
 * Detection: when recovery starts, which signals start it (outage, poor
 * quality, one carrier), and what a drop would set in motion.
 */
export function DetectionCard({
  form,
  facts,
  limits,
  saved,
  status,
  reporting,
  offlineSecs,
  carrierSecs,
}: DetectionCardProps) {
  const { t } = useTranslation("monitoring");
  const fmt = useFormatters();
  const { draft } = form;

  const sensName = facts.name ? t(`watchdog.detection.sensitivity.${facts.name}`) : null;

  // The daemon never acts sooner than the link can be called down (or up again),
  // whatever is typed: show the value it will really use, beside the typed one.
  const typedAct = numberOr(draft.actAfter, saved.act_after_sec);
  const actEff = Math.max(typedAct, facts.failSecs);
  const typedWait = numberOr(draft.stepWait, saved.step_wait_sec);
  const waitFloor = facts.recoverSecs > 0 ? facts.recoverSecs + 20 : 0;
  const waitEff = Math.max(typedWait, waitFloor);

  const timeline = deriveTimeline({
    enabled: draft.enabled,
    tiers: draftTiers(draft),
    hasSlot: draft.backupSlot !== "",
    actSecs: actEff,
    waitSecs: waitEff,
    failSecs: facts.failSecs,
    sensitivityName: sensName,
    resting: status?.reboot_budget_exhausted === true,
    nowSecs: reporting ? offlineSecs : null,
  });

  const actClamped = actEff !== typedAct && isIntInRange(draft.actAfter, 15, 600);
  const waitClamped = waitEff !== typedWait && isIntInRange(draft.stepWait, 10, 300);

  const carrierLive = reporting && status !== null && saved.carrier_enabled && draft.carrier;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.detection.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.detection.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, DETECT.BODY)}>
        <div className={DETECT.READ}>
          <span className="flex min-w-0 items-center gap-2">
            <RadarIcon className="text-on-surface-variant size-4 flex-none" aria-hidden />
            <span className={DETECT.READ_TEXT}>
              {facts.failSecs > 0
                ? sensName
                  ? t("watchdog.detection.down.named", {
                      time: fmt.duration(facts.failSecs),
                      name: sensName,
                    })
                  : t("watchdog.detection.down.plain", {
                      time: fmt.duration(facts.failSecs),
                    })
                : t("watchdog.detection.down.unknown")}
            </span>
          </span>
          <Link href="/monitoring/connection-quality/" className={DETECT.LINK}>
            {t("watchdog.detection.sensitivityLink")}
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        </div>

        <div className={DETECT.SEP} aria-hidden />

        <PresetSetting
          form={form}
          field="actAfter"
          id={FIELD_ID.actAfter}
          label={t("watchdog.detection.act.label")}
          unit={t("watchdog.detection.unit.seconds")}
          presets={ACT_PRESETS.map((v) => ({ value: v, label: fmt.duration(v) }))}
          extra={
            actClamped ? (
              <span className="inline-flex items-center gap-1">
                <span className={DETECT.EFFECTIVE}>
                  {t("watchdog.detection.act.effective", { time: fmt.duration(actEff) })}
                </span>
                <HintIcon label={t("watchdog.detection.act.hintLabel")}>
                  {t("watchdog.detection.act.hint", {
                    time: fmt.duration(facts.failSecs),
                    name: sensName ?? t("watchdog.detection.act.hintFallback"),
                  })}
                </HintIcon>
              </span>
            ) : null}
        />

        <div className={DETECT.SEP} aria-hidden />

        <div className={DETECT.GROUP}>
          <div className={DETECT.ROW}>
            <span className={DETECT.KEY}>
              {t("watchdog.detection.quality.label")}
              <HintIcon label={t("watchdog.detection.quality.hintLabel")}>
                {t("watchdog.detection.quality.hint", {
                  ms: limits.latency.effective,
                  pct: limits.loss.effective,
                })}
              </HintIcon>
            </span>
            <OnOffField
              value={draft.quality}
              onChange={(on) => form.setFields({ quality: on })}
              ariaLabel={t("watchdog.detection.quality.label")}
            />
          </div>
          {draft.quality ? (
            <>
              <PresetSetting
                form={form}
                field="qualityAfter"
                id={FIELD_ID.qualityAfter}
                label={t("watchdog.detection.quality.afterLabel")}
                sub
                unit={t("watchdog.detection.unit.seconds")}
                presets={QUALITY_PRESETS.map((v) => ({ value: v, label: fmt.duration(v) }))}
              />
              <p className={DETECT.CAPTION}>
                {t("watchdog.detection.quality.caption", {
                  lat: limitText(limits.latency, t("watchdog.detection.unit.ms")),
                  loss: limitText(limits.loss, "%"),
                })}
              </p>
            </>
          ) : null}
        </div>

        <div className={DETECT.SEP} aria-hidden />

        <div className={DETECT.GROUP}>
          <div className={DETECT.ROW}>
            <span className={DETECT.KEY}>
              {t("watchdog.detection.carrier.label")}
              <HintIcon label={t("watchdog.detection.carrier.hintLabel")}>
                {t("watchdog.detection.carrier.hint")}
              </HintIcon>
            </span>
            <OnOffField
              value={draft.carrier}
              onChange={(on) => form.setFields({ carrier: on })}
              ariaLabel={t("watchdog.detection.carrier.label")}
            />
          </div>
          {draft.carrier ? (
            <>
              <PresetSetting
                form={form}
                field="carrierAfter"
                id={FIELD_ID.carrierAfter}
                label={t("watchdog.detection.carrier.afterLabel")}
                sub
                unit={t("watchdog.detection.unit.minutes")}
                presets={CARRIER_PRESETS.map((v) => ({
                  value: v,
                  label: fmt.duration(v * 60),
                }))}
              />
              <p className={DETECT.CONSEQUENCE}>
                <TriangleAlertIcon className="mt-0.5 size-3.5 flex-none" aria-hidden />
                {t("watchdog.detection.carrier.consequence")}
              </p>
              {carrierLive ? (
                <div className={DETECT.ROW}>
                  <span className={DETECT.SUBKEY}>
                    {t("watchdog.detection.carrier.rightNow")}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {carrierNow(status, carrierSecs, fmt)}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className={DETECT.SEP} aria-hidden />

        <div className="flex flex-col">
          <Disclosure
            label={t("watchdog.detection.advanced")}
            summary={t("watchdog.detection.stepWait.summary", {
              time: fmt.duration(waitEff),
            })}
          >
            <div className={DETECT.ROW}>
              <label htmlFor={FIELD_ID.stepWait} className={DETECT.KEY}>
                {t("watchdog.detection.stepWait.label")}
                <HintIcon label={t("watchdog.detection.stepWait.hintLabel")}>
                  {t("watchdog.detection.stepWait.hint")}
                </HintIcon>
              </label>
              <div className={DETECT.LINE}>
                <NumberField
                  id={FIELD_ID.stepWait}
                  inputRef={form.registerField(FIELD_ID.stepWait)}
                  value={draft.stepWait}
                  onChange={(next) => form.setFields({ stepWait: next })}
                  unit={t("watchdog.detection.unit.seconds")}
                  ariaLabel={t("watchdog.detection.stepWait.label")}
                  error={form.errors.stepWait}
                />
                {waitClamped ? (
                  <span className={DETECT.EFFECTIVE}>
                    {t("watchdog.detection.act.effective", { time: fmt.duration(waitEff) })}
                  </span>
                ) : null}
              </div>
              <FieldError id={FIELD_ID.stepWait} message={form.errors.stepWait} />
            </div>

            <div className={DETECT.ROW}>
              <span className={DETECT.KEY}>
                {t("watchdog.detection.ssr.label")}
                <HintIcon label={t("watchdog.detection.ssr.hintLabel")}>
                  {t("watchdog.detection.ssr.hint")}
                </HintIcon>
              </span>
              <div className={DETECT.LINE}>
                <OnOffField
                  value={draft.ssrAware}
                  onChange={(on) => form.setFields({ ssrAware: on })}
                  ariaLabel={t("watchdog.detection.ssr.label")}
                />
                <NumberField
                  id={FIELD_ID.ssrGrace}
                  inputRef={form.registerField(FIELD_ID.ssrGrace)}
                  value={draft.ssrGrace}
                  onChange={(next) => form.setFields({ ssrGrace: next })}
                  unit={t("watchdog.detection.unit.seconds")}
                  ariaLabel={t("watchdog.detection.ssr.graceLabel")}
                  error={form.errors.ssrGrace}
                  disabled={!draft.ssrAware}
                />
              </div>
              <FieldError id={FIELD_ID.ssrGrace} message={form.errors.ssrGrace} />
            </div>
          </Disclosure>

          <Disclosure
            label={t("watchdog.detection.timeline.title")}
            summary={timelineSummary(timeline, fmt)}
            live={timeline.summary?.kind === "now"}
            autoOpen={timeline.summary?.kind === "now"}
          >
            <Timeline view={timeline} fmt={fmt} />
          </Disclosure>
        </div>
      </CardContent>
      <WatchdogFoot
        form={form}
        scope="detection"
        note={
          draft.actAfter !== form.saved.actAfter && isIntInRange(draft.actAfter, 15, 600)
            ? t("watchdog.detection.act.note", { time: fmt.duration(actEff) })
            : null
        }
      />
    </Card>
  );
}

function carrierNow(
  status: WatchdogStatus | null,
  singleSecs: number,
  fmt: Formatters,
): string {
  const { t } = fmt;
  if (!status || status.carrier_cc === null || status.carrier_cc === undefined) {
    return t("watchdog.detection.carrier.unknown");
  }
  if (status.carrier_cc <= 1 && singleSecs > 0) {
    return t("watchdog.detection.carrier.singleFor", { time: fmt.duration(singleSecs) });
  }
  return t("watchdog.detection.carrier.count", { count: status.carrier_cc });
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className={DETECT.ERROR}>
      {message}
    </p>
  );
}

type PresetField = "actAfter" | "qualityAfter" | "carrierAfter";

/**
 * A number with the usual choices under it. The field is always the truth; a
 * preset writes into it, and Custom is the segment lit whenever the number is
 * not one of the presets (choosing it puts the cursor in the field).
 */
function PresetSetting({
  form,
  field,
  id,
  label,
  unit,
  presets,
  extra,
  sub = false,
}: {
  form: WatchdogForm;
  field: PresetField;
  id: string;
  label: string;
  unit: string;
  presets: { value: number; label: string }[];
  extra?: React.ReactNode;
  /** A follow-on row of a switch: a quieter key. */
  sub?: boolean;
}) {
  const { t } = useTranslation("monitoring");
  const inputEl = React.useRef<HTMLElement | null>(null);
  const register = form.registerField(id);
  const value = form.draft[field];
  const error = form.errors[field];

  const options: SegmentedOption<string>[] = [
    ...presets.map((p) => ({ value: String(p.value), label: p.label, numeric: true })),
    { value: CUSTOM, label: t("watchdog.detection.custom") },
  ];
  const selected = presets.some((p) => String(p.value) === value.trim())
    ? value.trim()
    : CUSTOM;

  return (
    <div className={DETECT.GROUP}>
      <div className={DETECT.ROW}>
        <label htmlFor={id} className={sub ? DETECT.SUBKEY : DETECT.KEY}>
          {label}
        </label>
        <div className={DETECT.LINE}>
          <NumberField
            id={id}
            inputRef={(el) => {
              inputEl.current = el;
              register(el);
            }}
            value={value}
            onChange={(next) => form.setFields({ [field]: next })}
            unit={unit}
            ariaLabel={label}
            error={error}
          />
          {extra}
        </div>
        <FieldError id={id} message={error} />
      </div>
      <SegmentedField
        value={selected}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            inputEl.current?.focus();
            return;
          }
          form.setFields({ [field]: next });
        }}
        options={options}
        ariaLabel={label}
        breakpoint="lg"
        glyph={renderCheckGlyph}
        className={cn("w-auto", DETECT.PRESET_PILL)}
      />
    </div>
  );
}

function timelineLabel(label: TimelineLabel, fmt: Formatters): string {
  const { t } = fmt;
  switch (label.key) {
    case "quiet":
      return t("watchdog.detection.timeline.quiet");
    case "markedDown":
      return label.name
        ? t("watchdog.detection.timeline.markedDownNamed", { name: label.name })
        : t("watchdog.detection.timeline.markedDown");
    case "step":
      return t(`watchdog.detection.timeline.step.${label.tier}`);
    case "reboot":
      return t("watchdog.detection.timeline.reboot");
    case "rebootResting":
      return t("watchdog.detection.timeline.rebootResting");
    case "holdoff":
      return t("watchdog.detection.timeline.holdoff");
    case "now":
      return t("watchdog.detection.timeline.now");
  }
}

function timelineSummary(view: TimelineView, fmt: Formatters): string | null {
  const { t } = fmt;
  if (!view.summary) return null;
  const time = fmt.duration(view.summary.seconds);
  return t(`watchdog.detection.timeline.summary.${view.summary.kind}`, { time });
}

const DOT_STATE: Record<TimelineRow["state"], string> = {
  "": "",
  done: TIMELINE.DOT_DONE,
  rest: TIMELINE.DOT_REST,
  now: TIMELINE.DOT_NOW,
};

/** When each armed step runs into an outage, from the values the daemon will use. */
function Timeline({ view, fmt }: { view: TimelineView; fmt: Formatters }) {
  const { t } = fmt;
  if (view.note) {
    return (
      <p className={TIMELINE.NOTE}>
        {t(view.note === "off" ? "watchdog.detection.timeline.off" : "watchdog.detection.timeline.none")}
      </p>
    );
  }
  return (
    <ul className={TIMELINE.ROWS}>
      {view.rows.map((row) => (
        <li key={row.id} className={TIMELINE.ROW}>
          <span aria-hidden className={cn(TIMELINE.DOT, DOT_STATE[row.state])} />
          <span
            className={cn(
              TIMELINE.KEY,
              row.label.key === "quiet" && TIMELINE.KEY_QUIET,
              row.state === "now" && "font-semibold",
            )}
          >
            {timelineLabel(row.label, fmt)}
          </span>
          <span className={TIMELINE.VALUE}>
            {row.seconds === 0 ? t("watchdog.duration.seconds", { s: 0 }) : fmt.duration(row.seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Mirrors the loaded card: the read-only line, the settings, two disclosures, the foot. */
export function DetectionCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden>
      <CardHeader className={CARD_PAD}>
        <Skeleton className={cn(SKELETON.CARD_TITLE, "w-32")} />
        <Skeleton className={cn(SKELETON.CARD_DESC, "w-56")} />
      </CardHeader>
      <CardContent className={cn(CARD_PAD, DETECT.BODY)}>
        <div className={DETECT.READ}>
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-48")} />
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-24")} />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className={DETECT.GROUP}>
            <div className={DETECT.ROW}>
              <Skeleton className={cn(SKELETON.LINE, "h-4 w-36")} />
              <Skeleton className={cn(SKELETON.FIELD, "w-24")} />
            </div>
            <Skeleton className={cn(SKELETON.PILL, "w-full")} />
          </div>
        ))}
        <div className={DETECT.ROW}>
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-32")} />
          <Skeleton className={cn(SKELETON.PILL, "w-28")} />
        </div>
        <div className={DETECT.GROUP}>
          {[0, 1].map((i) => (
            <div key={i} className={DETECT.ROW}>
              <Skeleton className={cn(SKELETON.LINE, "h-4 w-28")} />
              <Skeleton className={cn(SKELETON.LINE, "h-4 w-20")} />
            </div>
          ))}
        </div>
      </CardContent>
      <WatchdogFootSkeleton />
    </Card>
  );
}

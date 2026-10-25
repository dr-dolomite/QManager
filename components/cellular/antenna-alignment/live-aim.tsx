"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HintIcon } from "@/components/ui/hint-icon";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  worstSignalQuality,
} from "@/types/modem-status";
import type {
  SignalPerAntenna,
  SignalQuality,
  SignalThresholds,
} from "@/types/modem-status";
import {
  QUALITY_GLYPH,
  qualityInkClass,
  qualityMeterTone,
} from "../signal-quality-display";
import { LiveSparkline } from "./live-sparkline";
import { CONDENSED, CONSOLE, GLYPH, LIVE, SLOT } from "./shapes";
import type { LiveLead } from "./use-live-lead";
import { SCORE_WEIGHTS, normalizeValue, scoreLive } from "./utils";

// =============================================================================
// The aim console — the anchor instrument
// =============================================================================
// Aiming an antenna is a closed physical loop: the user is outdoors with a phone
// in one hand and hardware in the other, rotating and watching for change over
// minutes. The only figure that serves that loop is the live composite for the
// primary chain, so it is the one thing on this route that never leaves the
// screen — pinned in a sticky column on a wide surface, and condensed into a
// 64px pill readout on a phone once the card itself scrolls away.
//
// It is deliberately an INSTRUMENT, not a headline figure. One numeral leads
// (the live serving RSRP, 40px, with its distance back to the session peak on
// the same line), and the composite score sits under it as a "Now" row in the
// recorder's own anatomy, never as a second headline. The score never appears
// alone: it arrives with the two weighted legs that produced it, the weights
// themselves, its session-best tick and its change since the last
// measurement, and when a leg is missing, `partial` says so out loud rather
// than letting a one-leg score pass as a two-leg one. A number you can take
// apart is an instrument; a number you can only admire is decoration.
//
// The composite is the SAME function the recorder ranks by (`scoreLive` wraps
// `scoreSnapshot`), so "what am I reading now" and "what did I record there" are
// the same unit and can be compared directly.
//
// WIDTH: the console is designed for its SLOT — ~400-430px in the sticky left
// column at 1440, and full width on a phone. It is not a full-bleed row. The
// build this replaces was laid out as one, which is how the radio identity tag
// ended up ~1400px from the "Main / PRX" caption it labels, how the two leg bars
// became ~1130px decorative rules, and how the right third of the score block
// became dead band. Everything here is sized to the narrow slot and simply
// stretches; nothing is anchored to an opposite edge that may be a metre away.
//
// NO VALUE TICK ON THIS CARD, deliberately, and this is the one place the
// product's tick gesture is declined. The tick dips a figure to 0.35 opacity for
// 700ms to mark "this just moved". Correct on a dashboard glanced at for a
// second; wrong here, where the figures change every 1-2 s and the user is
// staring at them continuously — they would be dimmed much of the time they are
// being read, outdoors, in sunlight. The change signal is the delta and the
// meter retarget instead: one authored moment rather than a per-poll flicker.
// =============================================================================

// -----------------------------------------------------------------------------
// Session tracking: peak and delta
// -----------------------------------------------------------------------------

/**
 * Remembers the best score seen this session and the change since the previous
 * measurement.
 *
 * Peak-hold is the affordance the recorder cannot provide. The recorder compares
 * three DISCRETE positions and needs you to stop moving, tap Record, and hold
 * still — it cannot help you SWEEP. But you cannot watch a number and
 * simultaneously remember its best value while your body is rotating a mast, so
 * without a peak the sweep is unmeasurable.
 *
 * Both are session-scoped and deliberately NOT persisted: they are facts about
 * the current sweep, not measurements, and writing them to storage would let a
 * peak from yesterday's roof visit outrank what the antenna is doing now.
 *
 * Gated on the modem's timestamp for the same reason the sampler is — a repeated
 * fetch of an unchanged snapshot is not a new measurement, and letting it through
 * would report a delta of 0 as though the signal had genuinely held steady.
 */
function useSessionTracking(score: number | null, snapshotTs: number | null) {
  const [peak, setPeak] = React.useState<number | null>(null);
  const [delta, setDelta] = React.useState<number | null>(null);
  const previousRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (score === null || snapshotTs === null) return;
    if (lastTsRef.current === snapshotTs) return;
    lastTsRef.current = snapshotTs;

    const previous = previousRef.current;
    previousRef.current = score;

    setPeak((current) => (current === null || score > current ? score : current));
    setDelta(previous === null ? null : score - previous);
  }, [score, snapshotTs]);

  return { peak, delta };
}

/**
 * The whole reading, derived once.
 *
 * Both the console and the condensed bar render the same measurement, and they
 * must never disagree about it — a pinned readout that contradicts the card it
 * replaced is worse than no readout. Deriving both from one function is what
 * makes that structural rather than a review discipline.
 */
function useAimReading(spa: SignalPerAntenna, snapshotTs: number | null) {
  const score = scoreLive(spa);
  const { peak, delta } = useSessionTracking(score.value, snapshotTs);

  const radio = score.radio;
  const rsrp = radio ? normalizeValue(spa[`${radio}_rsrp`][0], "rsrp") : null;
  const sinr = radio ? normalizeValue(spa[`${radio}_sinr`][0], "sinr") : null;

  /**
   * The primary chain's verdict: the WORST of the legs that actually reported.
   *
   * This used to read RSRP alone, which left a hole once the meter took its fill
   * from the ramp. `scoreSnapshot` reweights around a missing leg, so a SINR-only
   * snapshot still produces a real composite — but an RSRP-only verdict called
   * that same snapshot `"none"`, and `qualityMeterTone("none")` is `null`, which
   * is the empty-track signal. A live score would have been drawn on an empty
   * track.
   *
   * `worstSignalQuality` skips `"none"` entries, so it returns a level whenever
   * ANY leg reported and `"none"` only when neither did — which is exactly when
   * `score.value` is null too. Tone, track and numeral can therefore never
   * disagree about whether there is a reading. It is also the better verdict on
   * its own terms, and matches `port-strip.tsx`: this chip sits directly above
   * both leg rows, and a summary that contradicts the rows beneath it is worse
   * than no summary.
   */
  const overallQuality = worstSignalQuality(
    getSignalQuality(rsrp, RSRP_THRESHOLDS),
    getSignalQuality(sinr, SINR_THRESHOLDS),
  );

  return {
    score,
    radio,
    rsrp,
    sinr,
    peak,
    delta,
    overallQuality,
    overallTone: qualityMeterTone(overallQuality),
    /** A chip that says "no change" is noise on a surface watched continuously. */
    showDelta: delta !== null && Math.abs(delta) >= 1,
    // 3GPP calls NR's metric SNR, not SINR. Reuse the radio-info labels so the
    // two antenna pages cannot disagree about what a row is called.
    sinrLabelKey: radio === "nr" ? ("snr" as const) : ("sinr" as const),
  };
}

// -----------------------------------------------------------------------------
// One weighted leg
// -----------------------------------------------------------------------------

/**
 * A metric row: key, weight, a 56px inline lane, and the reading.
 *
 * The lane is INLINE and fixed, not a flexed full-width bar. At the console's
 * pinned width a full-width bar was ~1130px of coloured rule for a figure the
 * user reads at its right-hand end — length that encodes nothing extra past the
 * first hundred pixels, and that pushed the key and the value to opposite sides
 * of the card. 56px is enough travel to compare two legs at a glance, which is
 * the only comparison this row is for; the composite meter above is the bar you
 * are meant to watch.
 */
function LegRow({
  label,
  weight,
  value,
  unit,
  thresholds,
  index,
}: {
  label: string;
  weight: number;
  value: number | null;
  unit: string;
  thresholds: SignalThresholds;
  index: number;
}) {
  const { t } = useTranslation("cellular");
  const quality = getSignalQuality(value, thresholds);

  // One decision drives both the fill and the ink, so they cannot disagree about
  // whether there is a reading. `null` covers the sentinel-suppressed case AND
  // the out-of-physical-range case, which `value === null` alone would miss.
  const tone = qualityMeterTone(quality);
  const reading = tone === null ? null : value;

  return (
    <div className={CONSOLE.LEG_ROW}>
      <span className={CONSOLE.LEG_KEY}>
        {label}
        {/* The weight is part of the claim: a user who sees 60% next to RSRP can
            work out why a strong RSRP with a weak SINR still scores well, which
            is the difference between an instrument and an oracle. It is rendered
            at LABEL weight rather than value weight — at value weight a second
            tabular figure in the row reads as a second reading. */}
        <span className={CONSOLE.LEG_WEIGHT}>{Math.round(weight * 100)}%</span>
      </span>

      {/* `ml-auto` is what makes the lane and the value travel together as one
          right-hand group instead of the lane stretching across the row. */}
      <div className={cn(CONSOLE.LEG_LANE, "ml-auto")} aria-hidden="true">
        <MetricBar
          /* A missing leg gets the TRACK ALONE, never a zero-length fill: an
             idle chain drawn as an empty red bar reads as a signal problem the
             user should go and fix (DESIGN.md > Quality bars). */
          value={reading === null ? null : signalToProgress(reading, thresholds)}
          max={100}
          warnAt={101}
          dangerAt={101}
          colorOverride={tone}
          /* The leg lane and the composite meter above are now the SAME 8px
             track. That is a deliberate reversal: this lane used to be 4px, on
             the argument that a leg should read lighter than the card's own
             subject. The product resolved to one thickness on 2026-09-01
             because DESIGN.md rests the ramp on LENGTH, and hierarchy here is
             carried by the 52px composite numeral and the lane's 56px width,
             neither of which the thickness was needed for. */
          track="surface-container-high"
          index={index}
        />
      </div>

      <span className={cn(CONSOLE.LEG_VALUE, qualityInkClass(quality))}>
        {reading === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">
              {t("antenna_alignment.aim.not_reported")}
            </span>
          </>
        ) : (
          <>
            {reading} {unit}
            {/* Adjacent ramp stops sit deliberately below the 0.05 separation
                floor — bar length carries the distinction for sighted users — so
                the tint is not a channel a screen-reader or a colour-blind user
                can read. The word is. */}
            <span className="sr-only">
              {" "}
              {t(`antenna_alignment.quality.${quality}`)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The live lead
// -----------------------------------------------------------------------------

/**
 * One chip per feed state, each with its own glyph. `live` is a FACT (the
 * Fact-Is-Info Rule), shown only while it holds; the others say why the figure
 * beside it has stopped moving. No two share a glyph.
 */
const LIVE_STATE_CHIP: Record<
  LiveLead["state"],
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  live: { variant: "info", glyph: "graphic_eq" },
  stale: { variant: "warning", glyph: "history" },
  paused: { variant: "muted", glyph: "visibility_off" },
  connecting: { variant: "muted", glyph: "progress_activity" },
};

function LiveStateChip({ state }: { state: LiveLead["state"] }) {
  const { t } = useTranslation("cellular");
  const chip = LIVE_STATE_CHIP[state];
  return (
    <Badge variant={chip.variant}>
      <MaterialSymbol name={chip.glyph} size={GLYPH.CHIP} filled />
      {t(`antenna_alignment.aim.live.state.${state}`)}
    </Badge>
  );
}

const fmtDb = (value: number) => value.toFixed(1);

/** `toPeak` within rounding of zero: the reading is the session best. */
const atPeak = (toPeak: number) => toPeak > -0.05;

/**
 * The steering cue: how far the reading sits below the session peak.
 *
 * It holds the numeral row's right edge because it is the figure a sweep is
 * steered by ("turn back, you were 2 dB better over there"), and as a 12px
 * grey caption under the meter it was the quietest text on the card. At the
 * peak it becomes a FACT, so it takes a filled `info` chip with its own glyph
 * (the Fact-Is-Info Rule) rather than a "0.0 dB" nobody reads as good news.
 */
function ToPeak({ toPeak, peak }: { toPeak: number; peak: number }) {
  const { t } = useTranslation("cellular");

  if (atPeak(toPeak)) {
    return (
      <Badge variant="info" className="shrink-0">
        <MaterialSymbol name="my_location" size={GLYPH.CHIP} filled />
        {t("antenna_alignment.aim.live.at_peak")}
      </Badge>
    );
  }

  return (
    <div className={LIVE.TO_PEAK}>
      <span className={LIVE.TO_PEAK_VALUE} aria-hidden="true">
        {fmtDb(toPeak)} dB
      </span>
      <span className={LIVE.TO_PEAK_CAPTION} aria-hidden="true">
        {t("antenna_alignment.aim.peak")} {fmtDb(peak)} dBm
      </span>
      <span className="sr-only">
        {t("antenna_alignment.aim.live.from_peak", { delta: fmtDb(toPeak) })}
      </span>
    </div>
  );
}

/**
 * The serving-cell RSRP, every second, with its 30 s trace.
 *
 * This is a DIFFERENT measurement from the RSRP leg below, and the labelling
 * keeps them apart: the lead is the serving cell as the modem reports it across
 * all receive chains (the LTE anchor in NSA); the leg is Main / PRX alone, from
 * the 2 s per-port snapshot, under its own "From Main / PRX" label. Neither is
 * ever presented as the other.
 *
 * Stale, paused and connecting keep the last figure on screen in neutral ink,
 * with the meter and trace dimmed, and a chip saying why. They never blank it:
 * a field tech who glances back must still see where the reading was.
 *
 * `aria-live="off"`: the page shell is a polite live region, and a figure that
 * changes every second inside it would be read out without end.
 */
function LiveLeadBlock({ lead, showTag }: { lead: LiveLead; showTag: boolean }) {
  const { t } = useTranslation("cellular");
  const muted = lead.state !== "live";
  const reading = lead.rsrp;
  const tone = qualityMeterTone(lead.quality);
  const ink = muted ? "text-on-surface-variant" : qualityInkClass(lead.quality);
  const peakPct =
    lead.peak !== null ? signalToProgress(lead.peak, RSRP_THRESHOLDS) : null;

  return (
    <section aria-live="off" className={cn(LIVE.BLOCK, LIVE.BLOCK_FILL)}>
      <div className={LIVE.KEY_ROW}>
        <span className={CONSOLE.EYEBROW}>
          {t("antenna_alignment.aim.live.label")}
        </span>
        {/* The radio is named only when it differs from the score's: in NSA
            the title says 5G NR and this figure is the LTE anchor. */}
        {showTag && (
          <Tag variant="lte" className="shrink-0">
            {t("antenna_alignment.mode.lte")}
          </Tag>
        )}
        <HintIcon label={t("antenna_alignment.aim.live.hint_label")}>
          {t("antenna_alignment.aim.live.hint")}
        </HintIcon>
        <span className="ml-auto flex shrink-0">
          <LiveStateChip state={lead.state} />
        </span>
      </div>

      <div className={LIVE.NUMERAL_ROW}>
        <div className={LIVE.NUMERAL}>
          {/* Ramp ink is legal here because the meter sits directly beneath. No
              value tick and no tween: the figure moves every second and is
              watched continuously, so any per-change gesture would be
              permanent. */}
          <span
            className={cn(CONSOLE.SCORE, CONSOLE.SCORE_BOX, ink)}
            aria-label={
              reading === null
                ? t("antenna_alignment.aim.live.no_reading")
                : `${t("antenna_alignment.aim.live.sr", {
                    value: fmtDb(reading),
                  })} ${t(`antenna_alignment.quality.${lead.quality}`)}`
            }
          >
            {reading === null ? "—" : fmtDb(reading)}
          </span>
          {/* A unit beside a dash would label a reading that does not exist. */}
          {reading !== null && (
            <span className={LIVE.UNIT} aria-hidden="true">
              dBm
            </span>
          )}
        </div>
        {lead.toPeak !== null && lead.peak !== null && (
          <ToPeak toPeak={lead.toPeak} peak={lead.peak} />
        )}
      </div>

      <div className={cn(LIVE.MUTABLE, muted && LIVE.MUTED)}>
        <div className={CONSOLE.METER_LANE}>
          <div className="min-w-0 flex-1" aria-hidden="true">
            <MetricBar
              /* A missing reading is the track alone, never a zero fill. */
              value={
                reading === null || tone === null
                  ? null
                  : signalToProgress(reading, RSRP_THRESHOLDS)
              }
              max={100}
              warnAt={101}
              dangerAt={101}
              colorOverride={tone}
              track="surface-container-high"
            />
          </div>
          {peakPct !== null && reading !== null && lead.peak! > reading && (
            <span
              aria-hidden="true"
              className={CONSOLE.PEAK_TICK}
              style={{ left: `calc(${peakPct}% - 1px)` }}
            />
          )}
        </div>
      </div>

      {/* The console's slack absorber: the trace grows when the work column is
          taller, so the difference becomes resolution, not a gap. Neutral ink:
          it used to wear the NEWEST sample's ramp colour across all 30 s, which
          painted history with a verdict it never had and put a third red mark
          beside the numeral and meter that already carry it. */}
      <div className={cn(LIVE.SPARK_SLOT, LIVE.MUTABLE, muted && LIVE.MUTED)}>
        <LiveSparkline
          points={lead.points}
          peak={lead.peak}
          inkClass={LIVE.SPARK_INK}
        />
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// The score, as a "Now" row
// -----------------------------------------------------------------------------

/**
 * The composite score in the recorder row's anatomy: label, 28px score, a bar
 * with the session-best tick, and the change since the last measurement.
 *
 * It used to be a 32px ramp-red numeral over its own full-width meter, under a
 * 52px ramp-red lead: two headline figures in one card, both alarm red at the
 * cell edge. As a row it reads as what it is, the measurement you would record
 * from here, on the same 0-100 scale as the Position rows beside it.
 */
function NowRow({
  score,
  quality,
  tone,
  peak,
  delta,
  showDelta,
}: {
  score: number | null;
  quality: SignalQuality;
  tone: ReturnType<typeof qualityMeterTone>;
  peak: number | null;
  delta: number | null;
  showDelta: boolean;
}) {
  const { t } = useTranslation("cellular");

  return (
    <div className={CONSOLE.NOW_ROW}>
      <span className={CONSOLE.NOW_LABEL}>{t("antenna_alignment.aim.now")}</span>

      {/* Ramp ink is legal because the bar sits immediately beside it. The
          quality word rides the `aria-label`: it REPLACES the element's
          contents for assistive tech, so a nested `sr-only` would be lost. */}
      <span
        className={cn(SLOT.SCORE, qualityInkClass(quality))}
        aria-label={
          score === null
            ? t("antenna_alignment.aim.no_reading")
            : `${t("antenna_alignment.aim.score_sr", { score })} ${t(
                `antenna_alignment.quality.${quality}`,
              )}`
        }
      >
        {score === null ? "—" : score}
      </span>

      <div className={CONSOLE.NOW_LANE}>
        <div className={CONSOLE.METER_LANE}>
          {/* A null composite is an EMPTY TRACK, never a zero-length fill. */}
          <div className="min-w-0 flex-1" aria-hidden="true">
            <MetricBar
              value={score}
              max={100}
              warnAt={101}
              dangerAt={101}
              colorOverride={tone}
              track="surface-container-high"
            />
          </div>
          {/* The session best, snapped rather than tweened: a new high is a
              discrete event, and `left` stays out of transitions. */}
          {peak !== null && score !== null && peak > score && (
            <span
              aria-hidden="true"
              className={CONSOLE.PEAK_TICK}
              style={{ left: `calc(${peak}% - 1px)` }}
            />
          )}
        </div>
        {peak !== null && (
          <span className="sr-only">
            {t("antenna_alignment.aim.peak")} {peak}
          </span>
        )}
      </div>

      {/* Not a status: signal dropping while you rotate is expected, so the
          direction rides the glyph in caption ink, never a hue. */}
      <span className={CONSOLE.NOW_DELTA}>
        {showDelta && delta !== null && (
          <>
            <MaterialSymbol
              name={delta > 0 ? "arrow_upward" : "arrow_downward"}
              size={GLYPH.CHIP}
              filled
              aria-hidden="true"
            />
            <span aria-hidden="true">{Math.abs(delta)}</span>
            <span className="sr-only">
              {t(
                delta > 0
                  ? "antenna_alignment.aim.delta_up"
                  : "antenna_alignment.aim.delta_down",
                { delta: Math.abs(delta) },
              )}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The console
// -----------------------------------------------------------------------------

export function AimConsole({
  spa,
  snapshotTs,
  lead,
}: {
  /** The live serving-cell lead, or null to render the console without it. */
  lead: LiveLead | null;
  spa: SignalPerAntenna;
  /** The modem's own timestamp for this snapshot, in seconds. */
  snapshotTs: number | null;
}) {
  const { t } = useTranslation("cellular");
  const {
    score,
    radio,
    rsrp,
    sinr,
    peak,
    delta,
    overallQuality,
    overallTone,
    showDelta,
    sinrLabelKey,
  } = useAimReading(spa, snapshotTs);

  return (
    <Card className={CONSOLE.SHELL}>
      {/* The identity tag sits on the TITLE's line, immediately after the words
          it qualifies. No icon here: icons belong to chips and actions, never
          to a CardHeader. */}
      <CardHeader className="gap-1 px-0">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className={CONSOLE.TITLE}>
            {t("antenna_alignment.aim.title")}
          </CardTitle>
          {radio && (
            <Tag variant={radio === "nr" ? "nr" : "lte"} className="shrink-0">
              {t(`antenna_alignment.mode.${radio}`)}
            </Tag>
          )}
        </div>
        <CardDescription className={CONSOLE.DESCRIPTION}>
          {t("antenna_alignment.aim.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 px-0">
        {lead && <LiveLeadBlock lead={lead} showTag={radio !== "lte"} />}

        {/* --- The score ---------------------------------------------------- */}
        <section className={CONSOLE.SECTION}>
          <div className={CONSOLE.SECTION_HEAD}>
            <span className={CONSOLE.EYEBROW}>
              {t("antenna_alignment.aim.score_label")}
            </span>
            {/* Cadence and scale live behind the tip, not on the surface:
                beside a 1 Hz lead the 2 s score needs saying once, quietly, or
                its stillness reads as a stalled feed. */}
            <HintIcon label={t("antenna_alignment.aim.score_hint_label")}>
              {t("antenna_alignment.aim.score_hint")}
            </HintIcon>
            {score.partial && score.value !== null && (
              <span className="ml-auto flex shrink-0">
                <Badge variant="info">
                  <MaterialSymbol name="info" size={GLYPH.CHIP} filled />
                  {t("antenna_alignment.aim.partial", {
                    leg: t(
                      `radio_info.bands.metric.${
                        score.legs[0] === "sinr" ? sinrLabelKey : "rsrp"
                      }`,
                    ),
                  })}
                </Badge>
              </span>
            )}
          </div>
          <NowRow
            score={score.value}
            quality={overallQuality}
            tone={overallTone}
            peak={peak}
            delta={delta}
            showDelta={showDelta}
          />
        </section>

        {/* --- The two weighted legs ---------------------------------------- */}
        {/* Labelled with the chain they come from, directly above them; that
            was a sentence at the card's foot, read last if at all. `mt-auto`
            holds the card's bottom edge when there is no live trace to absorb
            a taller work column. */}
        <section className={cn(CONSOLE.SECTION, !lead && "mt-auto")}>
          <div className={CONSOLE.SECTION_HEAD}>
            <span className={CONSOLE.EYEBROW}>
              {t("antenna_alignment.aim.from_chain")}
            </span>
          </div>
          <div className={CONSOLE.LEGS}>
            <LegRow
              label={t("radio_info.bands.metric.rsrp")}
              weight={SCORE_WEIGHTS.rsrp}
              value={rsrp}
              unit="dBm"
              thresholds={RSRP_THRESHOLDS}
              index={0}
            />
            <LegRow
              label={t(`radio_info.bands.metric.${sinrLabelKey}`)}
              weight={SCORE_WEIGHTS.sinr}
              value={sinr}
              unit="dB"
              thresholds={SINR_THRESHOLDS}
              index={1}
            />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// The condensed readout
// -----------------------------------------------------------------------------

/**
 * The 64px pill that pins at the top of a phone once the console scrolls away.
 *
 * It exists so the user never loses the number, NOT to restate the card: key,
 * score, verdict glyph, direction, meter. Nothing that needs reading twice. The
 * peak, the legs, the weights and the timestamp all stay in the console — a
 * pinned bar that reproduced them would be a second instrument disagreeing with
 * the first one poll later.
 *
 * The KEY LABEL is not decoration and not a restatement. Without it this pill
 * was anatomically a position row — same height, same pill, same numeral-plus-
 * meter — pinned directly above three position rows, so a floating instrument
 * read as a slot that had come loose. `CONDENSED.BAR`'s tonal step says "above";
 * the label says which instrument. It reuses the console's own `score_label`, so
 * the pinned bar and the card name the figure identically.
 *
 * The parent owns the sticky zero-height slot (`CONDENSED.ROOT`) and the
 * IntersectionObserver behind `shown`; this component owns the shade, the bar
 * and their shared crossfade.
 *
 * Opacity ONLY. No height animation (off the transform-and-opacity scale), no
 * spring (the Settled-Motion Rule), no blur or backdrop-filter (an alpha over a
 * scrolling page collapses in dark mode, and the tonal container step already
 * says "this floats above that").
 *
 * When hidden it is `pointer-events-none` and `aria-hidden`, so it is neither a
 * phantom tab stop nor a second screen-reader announcement of the score the user
 * is already on.
 */
export function CondensedAim({
  spa,
  snapshotTs,
  shown,
  lead,
}: {
  spa: SignalPerAntenna;
  /** The modem's own timestamp for this snapshot, in seconds. */
  snapshotTs: number | null;
  /** True once the full console has scrolled out from under this bar. */
  shown: boolean;
  /** The live lead; when present it is what pins, since it leads the card. */
  lead: LiveLead | null;
}) {
  const { t } = useTranslation("cellular");
  const { score, delta, overallQuality, overallTone, showDelta } = useAimReading(
    spa,
    snapshotTs,
  );

  const ink = qualityInkClass(overallQuality);

  if (lead) {
    return <CondensedLive lead={lead} shown={shown} />;
  }

  return (
    // The shade is the opaque ground under the pill and across the gutter, and
    // it carries the crossfade so ground and bar arrive as one object. Without
    // it the page scrolls through the transparent band above the pill, which
    // reads as a stacking bug rather than as a pinned element.
    <div
      className={cn(CONDENSED.SHADE, shown ? CONDENSED.SHOWN : CONDENSED.HIDDEN)}
      aria-hidden={!shown}
    >
      <div className={CONDENSED.BAR}>
        {/* Which instrument is floating. `shrink-0`, so at 390px the lane gives
            up width before the label does — a pinned readout whose label wrapped
            would be taller than the pill it lives in. */}
        <span className={CONDENSED.KEY}>
          {t("antenna_alignment.aim.score_label")}
        </span>

        <span
          className={cn(CONDENSED.SCORE, ink)}
          aria-label={
            score.value === null
              ? t("antenna_alignment.aim.no_reading")
              : `${t("antenna_alignment.aim.score_sr", {
                  score: score.value,
                })} ${t(`antenna_alignment.quality.${overallQuality}`)}`
          }
        >
          {score.value === null ? "—" : score.value}
        </span>

        {/* The glyph, not a chip: the ladder is the non-chromatic channel, and
            at this size a full verdict chip would crowd out the meter that gives
            the ramp ink its legal bar. */}
        <MaterialSymbol
          name={QUALITY_GLYPH[overallQuality]}
          size={GLYPH.INLINE}
          filled
          className={cn("shrink-0", ink)}
          aria-hidden="true"
        />

        {showDelta && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums text-on-surface-variant">
            <MaterialSymbol
              name={delta! > 0 ? "arrow_upward" : "arrow_downward"}
              size={GLYPH.CHIP}
              filled
              aria-hidden="true"
            />
            {delta! > 0 ? `+${delta}` : `${delta}`}
            <span className="sr-only">
              {delta! > 0
                ? t("antenna_alignment.aim.delta_up")
                : t("antenna_alignment.aim.delta_down")}
            </span>
          </span>
        )}

        <div className={CONDENSED.LANE} aria-hidden="true">
          <MetricBar
            value={score.value}
            max={100}
            warnAt={101}
            dangerAt={101}
            colorOverride={overallTone}
            /* `muted`, not `surface-container-high`: the bar itself is now that
               step, and a track the same tone as its ground is an invisible
               track — the empty-track signal for a missing reading would have
               been silently lost with it. */
            track="muted"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The pinned pill while the live lead is shown: figure, glyph, lane, and the
 * distance back to the peak on the right edge. The steering cue travels with
 * the figure, because a phone held at a mast is exactly where it is needed.
 *
 * No key label here, unlike the score pill. That label exists so a 64px pill
 * of numeral plus bar does not read as a Position row come loose; the "dBm"
 * unit already says this is not a 0-100 score, and the width a key cost came
 * out of the lane.
 *
 * When the feed is not live the quality glyph gives way to the state's own
 * glyph, in neutral ink, so a frozen figure on a pinned bar cannot pass as a
 * current one. The lane dims with it, exactly as in the console.
 */
function CondensedLive({ lead, shown }: { lead: LiveLead; shown: boolean }) {
  const { t } = useTranslation("cellular");
  const muted = lead.state !== "live";
  const reading = lead.rsrp;
  const tone = qualityMeterTone(lead.quality);
  const ink = muted ? "text-on-surface-variant" : qualityInkClass(lead.quality);

  return (
    <div
      className={cn(CONDENSED.SHADE, shown ? CONDENSED.SHOWN : CONDENSED.HIDDEN)}
      aria-hidden={!shown}
    >
      <div className={CONDENSED.BAR} aria-live="off">
        <span className={CONDENSED.FIGURE}>
          <span
            className={cn(CONDENSED.SCORE, ink)}
            aria-label={
              reading === null
                ? t("antenna_alignment.aim.live.no_reading")
                : `${t("antenna_alignment.aim.live.sr", {
                    value: fmtDb(reading),
                  })} ${t(`antenna_alignment.quality.${lead.quality}`)}`
            }
          >
            {reading === null ? "—" : fmtDb(reading)}
          </span>
          {reading !== null && (
            <span className={CONDENSED.UNIT} aria-hidden="true">
              dBm
            </span>
          )}
        </span>

        <MaterialSymbol
          name={
            muted ? LIVE_STATE_CHIP[lead.state].glyph : QUALITY_GLYPH[lead.quality]
          }
          size={GLYPH.INLINE}
          filled
          className={cn("shrink-0", ink)}
          aria-hidden="true"
        />
        {muted && (
          <span className="sr-only">
            {t(`antenna_alignment.aim.live.state.${lead.state}`)}
          </span>
        )}

        <div
          className={cn(CONDENSED.LANE, LIVE.MUTABLE, muted && LIVE.MUTED)}
          aria-hidden="true"
        >
          <MetricBar
            value={
              reading === null || tone === null
                ? null
                : signalToProgress(reading, RSRP_THRESHOLDS)
            }
            max={100}
            warnAt={101}
            dangerAt={101}
            colorOverride={tone}
            track="muted"
          />
        </div>

        {/* At the peak the cue is the console's own `my_location` glyph in
            primary ink: a chip would not fit the pill without starving the
            lane, and the glyph is the one the card's "At peak" chip wears. */}
        {lead.toPeak !== null &&
          (atPeak(lead.toPeak) ? (
            <MaterialSymbol
              name="my_location"
              size={GLYPH.INLINE}
              filled
              className="shrink-0 text-primary-on-surface"
              aria-label={t("antenna_alignment.aim.live.at_peak")}
            />
          ) : (
            <span className={CONDENSED.TO_PEAK}>
              <span aria-hidden="true">{fmtDb(lead.toPeak)} dB</span>
              <span className="sr-only">
                {t("antenna_alignment.aim.live.from_peak", {
                  delta: fmtDb(lead.toPeak),
                })}
              </span>
            </span>
          ))}
      </div>
    </div>
  );
}

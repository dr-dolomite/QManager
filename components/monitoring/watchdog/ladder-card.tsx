"use client";

import * as React from "react";
import {
  BanIcon,
  CheckIcon,
  CircleOffIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
  MoonIcon,
  TimerIcon,
  Undo2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import { Disclosure } from "./disclosure";
import {
  TIERS,
  TIER_CONSEQUENCE_KEY,
  TIER_NAME_KEY,
  type FailbackView,
  type RungState,
  type RungView,
  type TierIndex,
} from "./derive";
import { NumberField, OnOffField, renderCheckGlyph } from "./fields";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DETECT,
  GLYPH_SPIN,
  GROUP_LABEL,
  MASTER,
  RUNG,
  SKELETON,
} from "./shapes";
import { FIELD_ID, draftTiers, type WatchdogForm } from "./use-watchdog-form";
import { WatchdogFoot, WatchdogFootSkeleton } from "./watchdog-foot";

export interface LadderCardProps {
  form: WatchdogForm;
  /** The daemon's own per-step state (saved truth, never the draft). */
  rungs: Record<TierIndex, RungView>;
  failback: FailbackView;
  simDual: boolean;
  /** "Try again now" for a failback that gave up; resolves when the call has. */
  onRetryFailback: () => Promise<void>;
  retrying: boolean;
}

const TIER_FLAG = { 1: "tier1", 2: "tier2", 3: "tier3", 4: "tier4" } as const;

/** The disc's colour for a state. A disarmed, idle step keeps the resting tone. */
const DISC_STATE: Record<RungState, string> = {
  idle: RUNG.DISC_REST,
  tried: RUNG.DISC_DONE,
  running: RUNG.DISC_RUNNING,
  resting: RUNG.DISC_LIMIT,
  unused: RUNG.DISC_NA,
  unavailable: RUNG.DISC_NA,
};

/** What the disc shows: the number at rest, a glyph once the step has a state. */
function DiscContent({ tier, rung }: { tier: TierIndex; rung: RungView }) {
  switch (rung.state) {
    case "tried":
      return <CheckIcon className={RUNG.DONE_GLYPH} />;
    case "running":
      return rung.running === "recovery" ? (
        <LoaderCircleIcon className={cn(RUNG.DONE_GLYPH, GLYPH_SPIN)} />
      ) : (
        <TimerIcon className={RUNG.DONE_GLYPH} />
      );
    case "resting":
      return <MoonIcon className={RUNG.DONE_GLYPH} />;
    case "unused":
      return <BanIcon className={RUNG.DONE_GLYPH} />;
    case "unavailable":
      return <CircleSlashIcon className={RUNG.DONE_GLYPH} />;
    default:
      return <>{tier}</>;
  }
}

/** The recovery ladder: the master switch, four rungs, and its own commit. */
export function LadderCard({
  form,
  rungs,
  failback,
  simDual,
  onRetryFailback,
  retrying,
}: LadderCardProps) {
  const { t } = useTranslation("monitoring");
  const { draft } = form;
  const everyValid = form.errors.failbackEvery == null && draft.failbackEvery.trim() !== "";

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.ladder.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.ladder.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        <div className={MASTER.ROW}>
          <span className={MASTER.KEY}>{t("watchdog.master.label")}</span>
          <OnOffField
            value={draft.enabled}
            onChange={(on) => form.setFields({ enabled: on })}
            ariaLabel={t("watchdog.master.label")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className={GROUP_LABEL}>{t("watchdog.ladder.steps")}</span>
          <ol className={RUNG.STACK} aria-label={t("watchdog.ladder.aria")}>
            {TIERS.map((tier) => (
              <React.Fragment key={tier}>
                <Rung tier={tier} form={form} rung={rungs[tier]} simDual={simDual} />
                {tier === 3 && simDual && draft.tier3 ? (
                  <FailbackRow
                    form={form}
                    view={failback}
                    onRetry={onRetryFailback}
                    retrying={retrying}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </ol>
        </div>

        {simDual ? (
          <Disclosure
            label={t("watchdog.ladder.advanced")}
            summary={
              draft.tier3 && draft.failback && everyValid
                ? t("watchdog.ladder.failback.summary", { n: draft.failbackEvery })
                : t("watchdog.ladder.failback.summaryOff")
            }
          >
            <div className={DETECT.ROW}>
              <label htmlFor={FIELD_ID.failbackEvery} className={DETECT.KEY}>
                {t("watchdog.ladder.failback.everyLabel")}
              </label>
              <NumberField
                id={FIELD_ID.failbackEvery}
                inputRef={form.registerField(FIELD_ID.failbackEvery)}
                value={draft.failbackEvery}
                onChange={(next) => form.setFields({ failbackEvery: next })}
                unit={t("watchdog.ladder.failback.unit")}
                ariaLabel={t("watchdog.ladder.failback.everyLabel")}
                error={form.errors.failbackEvery}
                disabled={!draft.tier3 || !draft.failback}
              />
              {form.errors.failbackEvery ? (
                <p
                  id={`${FIELD_ID.failbackEvery}-error`}
                  role="alert"
                  className={DETECT.ERROR}
                >
                  {form.errors.failbackEvery}
                </p>
              ) : null}
            </div>
          </Disclosure>
        ) : null}
      </CardContent>
      <WatchdogFoot form={form} scope="ladder" />
    </Card>
  );
}

function Rung({
  tier,
  form,
  rung,
  simDual,
}: {
  tier: TierIndex;
  form: WatchdogForm;
  rung: RungView;
  simDual: boolean;
}) {
  const { t } = useTranslation("monitoring");
  const { draft } = form;
  const masterOff = !draft.enabled;
  const armed = draftTiers(draft)[tier];
  const unavailable = rung.state === "unavailable";
  const name = t(TIER_NAME_KEY[tier]);
  const ariaLabel = t("watchdog.ladder.tierAria", { name });
  const inactive = (masterOff || !armed || unavailable) && rung.state === "idle";

  const costKey =
    tier === 3 && draft.failback
      ? "watchdog.ladder.tier3.consequenceFailback"
      : TIER_CONSEQUENCE_KEY[tier];

  const slotOptions: SegmentedOption<string>[] = [
    { value: "1", label: t("watchdog.ladder.tier3.slot", { slot: 1 }) },
    { value: "2", label: t("watchdog.ladder.tier3.slot", { slot: 2 }) },
  ];

  const slotError = tier === 3 ? form.errors.backupSlot : undefined;
  const capError = tier === 4 ? form.errors.maxReboots : undefined;

  return (
    <li className={cn(RUNG.ROOT, RUNG.REST)}>
      <span aria-hidden className={cn(RUNG.DISC, RUNG.TRANSITION, DISC_STATE[rung.state])}>
        <DiscContent tier={tier} rung={rung} />
      </span>

      <div className={RUNG.TEXT}>
        <span className={cn(RUNG.NAME, inactive && RUNG.NAME_INACTIVE)}>
          <span className="min-w-0">{name}</span>
        </span>
        <span className={rung.caption ? RUNG.COST_STATE : RUNG.COST}>
          {rung.caption ?? t(costKey)}
        </span>
      </div>

      {unavailable ? null : (
        <div className={RUNG.CONTROLS}>
          <OnOffField
            value={armed}
            onChange={(on) => form.setFields({ [TIER_FLAG[tier]]: on })}
            ariaLabel={ariaLabel}
            disabled={masterOff}
          />
        </div>
      )}

      {tier === 3 && simDual && armed ? (
        <div className={RUNG.SUB}>
          <span className={RUNG.SUB_LABEL}>{t("watchdog.ladder.tier3.slotLabel")}</span>
          <div ref={form.registerField(FIELD_ID.backupSlot)} className="contents">
            <SegmentedField
              value={draft.backupSlot}
              onValueChange={(next) =>
                form.setFields({ backupSlot: next === "2" ? "2" : "1" })
              }
              options={slotOptions}
              ariaLabel={t("watchdog.ladder.tier3.slotLabel")}
              disabled={masterOff}
              breakpoint="never"
              glyph={renderCheckGlyph}
            />
          </div>
        </div>
      ) : null}
      {slotError ? (
        <p role="alert" className={RUNG.ERROR}>
          {slotError}
        </p>
      ) : null}

      {tier === 4 && armed ? (
        <div className={RUNG.SUB}>
          <label htmlFor={FIELD_ID.maxReboots} className={RUNG.SUB_LABEL}>
            {t("watchdog.ladder.tier4.capLead")}
          </label>
          <NumberField
            id={FIELD_ID.maxReboots}
            inputRef={form.registerField(FIELD_ID.maxReboots)}
            value={draft.maxReboots}
            onChange={(next) => form.setFields({ maxReboots: next })}
            unit={t("watchdog.ladder.tier4.capUnit")}
            ariaLabel={t("watchdog.ladder.tier4.capLabel")}
            error={capError}
            disabled={masterOff}
          />
          <HintIcon label={t("watchdog.ladder.tier4.hintLabel")}>
            {t("watchdog.ladder.tier4.hint")}
          </HintIcon>
        </div>
      ) : null}
      {capError ? (
        <p id={`${FIELD_ID.maxReboots}-error`} role="alert" className={RUNG.ERROR}>
          {capError}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Step 3's companion: swap back to the primary SIM after a while. It has no
 * numbered disc of its own because it only ever runs after step 3 has switched.
 */
function FailbackRow({
  form,
  view,
  onRetry,
  retrying,
}: {
  form: WatchdogForm;
  view: FailbackView;
  onRetry: () => Promise<void>;
  retrying: boolean;
}) {
  const { t } = useTranslation("monitoring");
  const { draft } = form;
  const masterOff = !draft.enabled;
  const gaveUp = view.state === "gaveUp";
  const name = t("watchdog.ladder.failback.name");

  return (
    <li className={cn(RUNG.ROOT, RUNG.REST)}>
      <span
        aria-hidden
        className={cn(
          RUNG.DISC,
          RUNG.DISC_CHILD,
          RUNG.TRANSITION,
          gaveUp ? RUNG.DISC_LIMIT : RUNG.DISC_REST,
        )}
      >
        {gaveUp ? (
          <CircleOffIcon className={RUNG.DONE_GLYPH} />
        ) : (
          <Undo2Icon className={RUNG.DONE_GLYPH} />
        )}
      </span>
      <div className={RUNG.TEXT}>
        <span className={cn(RUNG.NAME, masterOff && RUNG.NAME_INACTIVE)}>
          <span className="min-w-0">{name}</span>
        </span>
        <span className={view.caption ? RUNG.COST_STATE : RUNG.COST}>
          {view.caption ?? t("watchdog.ladder.failback.consequence")}
        </span>
      </div>
      <div className={RUNG.CONTROLS}>
        <OnOffField
          value={draft.failback}
          onChange={(on) => form.setFields({ failback: on })}
          ariaLabel={t("watchdog.ladder.tierAria", { name })}
          disabled={masterOff}
        />
      </div>
      {gaveUp ? (
        <div className={RUNG.SUB}>
          <Button
            type="button"
            variant="tonal"
            size="action"
            onClick={() => void onRetry()}
            disabled={retrying || form.scopes.ladder.busy}
          >
            {t("watchdog.ladder.failback.retry")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Mirrors the loaded card: header, master row, five rungs, then the foot. */
export function LadderCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden>
      <CardHeader className={CARD_PAD}>
        <Skeleton className={cn(SKELETON.CARD_TITLE, "w-40")} />
        <Skeleton className={cn(SKELETON.CARD_DESC, "w-56")} />
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        <div className={MASTER.ROW}>
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-40")} />
          <Skeleton className={cn(SKELETON.PILL, "w-28")} />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className={cn(SKELETON.EYEBROW, "w-12")} />
          <div className={RUNG.STACK}>
            {[1, 2, 3, 4].map((tier) => (
              <div key={tier} className={RUNG.ROOT}>
                <Skeleton className={RUNG.DISC} />
                <div className={RUNG.TEXT}>
                  <Skeleton className={SKELETON.RUNG_NAME} />
                  <Skeleton className={SKELETON.RUNG_COST} />
                </div>
                <div className={RUNG.CONTROLS}>
                  <Skeleton className={cn(SKELETON.PILL, "w-28")} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <WatchdogFootSkeleton />
    </Card>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  CqGetResponse,
  CqLive,
  SlotLive,
  UseConnectionQualityReturn,
} from "@/types/cq-watchdog";

import { ConditionBlock } from "./condition-block";
import { LastOutageRow, LastOutageSkeleton } from "./last-outage-row";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  EYEBROW,
  FAILED,
  FALLBACK_SLOTS,
  FIELD_ERROR,
  FIELD_LIT,
  FIELD_MONO,
  GROUP,
  GROUP_HEAD,
  PRIMARY_SLOTS,
  ROW_STACK,
  SKELETON_LOCAL,
  SLOT,
  SLOT_DISC,
  VERDICT,
  VERDICT_TONE,
  type VerdictTone,
} from "./shapes";

// Probe Targets: four slots, pinged in order. Slot 1 alone; when it misses, slots
// 2-4 together, and the lowest that answers counts. How often, and when a miss
// counts as down, is the Sensitivity on the neighbouring card.

const K = "connection_quality.targets";
const MAX_TARGET_LENGTH = 128;

type Targets = [string, string, string, string];

// ─── Validation: mirrors the CGI's target rules ─────────────────────────────

type ValidationCode = "empty" | "too_long" | "spaces" | "disallowed" | "leading_dash";

function validateTarget(value: string): ValidationCode | null {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_TARGET_LENGTH) return "too_long";
  if (/\s/.test(trimmed)) return "spaces";
  if (/[^0-9A-Za-z.:%-]/.test(trimmed)) return "disallowed";
  if (trimmed.startsWith("-")) return "leading_dash";
  return null;
}

/** `targets[2]` → 2, the CGI's zero-based index. */
function fieldIndex(field: string | null): number | null {
  const match = field ? /^targets\[(\d)\]$/.exec(field) : null;
  return match ? Number(match[1]) : null;
}

// ─── The chain's live verdict ───────────────────────────────────────────────

interface Verdict {
  tone: VerdictTone;
  key: string;
  n?: number;
}

function verdictOf(live: CqLive): Verdict {
  if (live.reachable === null) return { tone: "muted", key: "verdict.unknown" };
  if (!live.reachable) return { tone: "destructive", key: "verdict.none" };
  return live.last_leg >= 1 && live.last_leg <= 4
    ? { tone: "success", key: "verdict.answering", n: live.last_leg }
    : { tone: "success", key: "verdict.answering_any" };
}

/** Which address type a skipped slot has no route for, read from its saved target. */
function skippedKey(target: string): string {
  if (target.includes(":")) return "slot.skipped_ipv6";
  if (/^[0-9.]+$/.test(target)) return "slot.skipped_ipv4";
  return "slot.skipped";
}

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ProbeTargetsCardProps {
  cq: UseConnectionQualityReturn;
}

export default function ProbeTargetsCard({ cq }: ProbeTargetsCardProps) {
  const { t } = useTranslation("monitoring");
  const { data, isLoading, refresh } = cq;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t(`${K}.title`)}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {isLoading && !data ? (
          <ProbeTargetsSkeleton />
        ) : !data ? (
          <ConditionBlock
            tone="destructive"
            icon={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error.title`)}
            description={t(`${K}.error.body`)}
            onAction={() => void refresh()}
            actionLabel={t(`${K}.error.retry`)}
            actionIcon={RefreshCwIcon}
            className={CONDITION.SCREEN}
          />
        ) : (
          <ProbeForm cq={cq} data={data} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

function SlotSkeleton() {
  return (
    <div className={SLOT.ROW} aria-hidden="true">
      <Skeleton className={SKELETON_LOCAL.DISC} />
      <Skeleton className={SKELETON_LOCAL.FIELD} />
      <Skeleton className={cn(SKELETON_LOCAL.VALUE, "col-start-2 @sm/card:col-start-3")} />
    </div>
  );
}

function ProbeTargetsSkeleton() {
  return (
    <>
      {[PRIMARY_SLOTS, FALLBACK_SLOTS].map((slots, group) => (
        <div key={group} className={GROUP}>
          <div className={GROUP_HEAD}>
            <Skeleton className={SKELETON_LOCAL.EYEBROW} />
          </div>
          <div className={ROW_STACK}>
            {slots.map((i) => (
              <SlotSkeleton key={i} />
            ))}
          </div>
        </div>
      ))}
      <LastOutageSkeleton />
      <CardFoot
        liveStatus={false}
        actions={
          <>
            <Skeleton className={SKELETON_LOCAL.ACTION} />
            <Skeleton className={SKELETON_LOCAL.ACTION} />
          </>
        }
      />
    </>
  );
}

// ─── The form ───────────────────────────────────────────────────────────────

interface ProbeFormProps {
  cq: UseConnectionQualityReturn;
  /** Narrowed: this subtree only renders once the GET has landed. */
  data: CqGetResponse;
}

function ProbeForm({ cq, data }: ProbeFormProps) {
  const { t } = useTranslation("monitoring");
  const { isSaving, saveProbe } = cq;
  const { settings, live } = data;
  const { saved: flashed, markSaved } = useSaveFlash();

  // Edits are HELD and overlaid on the server values, never synced by an effect.
  const [draft, setDraft] = React.useState<Record<number, string>>({});
  const [serverError, setServerError] = React.useState<{ index: number; message: string } | null>(
    null,
  );
  const [failed, setFailed] = React.useState(false);

  const value = (i: number) => draft[i] ?? settings.targets[i];
  const codes = settings.targets.map((_, i) =>
    draft[i] === undefined ? null : validateTarget(draft[i]),
  );

  const isDirty = settings.targets.some(
    (saved, i) => draft[i] !== undefined && draft[i].trim() !== saved,
  );
  const hasErrors = codes.some((code) => code !== null);
  const canSave = isDirty && !isSaving && !hasErrors;

  const edit = (i: number, next: string) => {
    setDraft((prev) => ({ ...prev, [i]: next }));
    setServerError((prev) => (prev?.index === i ? null : prev));
    setFailed(false);
  };

  const discard = () => {
    setDraft({});
    setServerError(null);
    setFailed(false);
  };

  const handleSave = async () => {
    if (!canSave) return;
    const targets = settings.targets.map((_, i) => value(i).trim()) as Targets;

    // Sensitivity is not edited here: the saved one rides along unchanged.
    const result = await saveProbe({ sensitivity: settings.sensitivity, targets });
    if (result.ok) {
      setDraft({});
      setServerError(null);
      setFailed(false);
      markSaved();
      toast.success(t(`${K}.toast.saved`));
      return;
    }
    const index = fieldIndex(result.field);
    if (index !== null && result.message) setServerError({ index, message: result.message });
    setFailed(true);
    toast.error(result.message ?? t(`${K}.toast.failed`));
  };

  const verdict = verdictOf(live);
  const tone = VERDICT_TONE[verdict.tone];
  const answering = live.reachable === true ? live.last_leg - 1 : -1;
  const unknown = live.reachable === null;

  const renderSlot = (i: number) => {
    const slot: SlotLive = live.slots[i];
    const state = unknown ? "standby" : slot.state;
    const lit = i === answering;
    const fieldId = `probe-slot-${i + 1}`;
    const errorId = `${fieldId}-error`;
    const code = codes[i];
    const errorText =
      code !== null
        ? t(`${K}.validation.${code}`, { max: MAX_TARGET_LENGTH })
        : serverError?.index === i
          ? serverError.message
          : null;

    let valueText: React.ReactNode;
    if (unknown) {
      valueText = (
        <>
          <span aria-hidden="true">{"—"}</span>
          <span className="sr-only">{t(`${K}.slot.unknown`)}</span>
        </>
      );
    } else if (state === "ok") {
      valueText =
        slot.rtt_ms === null
          ? t(`${K}.slot.answering`)
          : t(`${K}.slot.ok`, { ms: Math.round(slot.rtt_ms) });
    } else if (state === "miss") {
      valueText = t(`${K}.slot.miss`);
    } else if (state === "skipped") {
      valueText = t(`${K}.${skippedKey(settings.targets[i])}`);
    } else {
      valueText = t(`${K}.slot.standby`);
    }

    return (
      <div key={i} className={SLOT.ROOT}>
        <div className={cn(SLOT.ROW, lit && SLOT.ROW_LIT)}>
          <span aria-hidden="true" className={cn(SLOT.DISC, SLOT_DISC[state])}>
            {i + 1}
          </span>
          <label htmlFor={fieldId} className="sr-only">
            {t(`${K}.slot.label`, { n: i + 1 })}
          </label>
          <Input
            id={fieldId}
            className={cn(FIELD_MONO, lit && FIELD_LIT)}
            value={value(i)}
            onChange={(event) => edit(i, event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errorText !== null}
            aria-describedby={errorText ? errorId : undefined}
          />
          <span
            className={cn(
              SLOT.VALUE,
              state === "miss" && !unknown && SLOT.VALUE_MISS,
              lit && SLOT.VALUE_LIT,
            )}
          >
            {valueText}
          </span>
        </div>
        {errorText ? (
          <span id={errorId} role="alert" className={FIELD_ERROR}>
            {errorText}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.primary`)}</span>
        </div>
        <div className={ROW_STACK}>{PRIMARY_SLOTS.map(renderSlot)}</div>
      </div>

      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.fallbacks`)}</span>
          <HintIcon label={t(`${K}.fallbacks_hint_label`)}>{t(`${K}.fallbacks_hint`)}</HintIcon>
        </div>
        <div className={ROW_STACK}>{FALLBACK_SLOTS.map(renderSlot)}</div>
      </div>

      <LastOutageRow outage={data.last_outage} reachable={live.reachable} />

      <CardFoot
        status={
          failed ? (
            <span className={FAILED.ROOT}>
              <TriangleAlertIcon className={FAILED.GLYPH} aria-hidden="true" />
              {t(`${K}.failed`)}
            </span>
          ) : (
            <span className={cn(VERDICT.ROOT, tone.ink)}>
              <span aria-hidden="true" className={cn(VERDICT.DOT, tone.dot)} />
              {t(`${K}.${verdict.key}`, { n: verdict.n })}
            </span>
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={discard}
              disabled={!isDirty || isSaving}
            >
              {t(`${K}.discard`)}
            </Button>
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={flashed}
              label={t(`${K}.save`)}
              disabled={!canSave}
              size="action"
            />
          </>
        }
      />
    </>
  );
}

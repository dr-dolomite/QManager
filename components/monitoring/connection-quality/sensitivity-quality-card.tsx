"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import { cn } from "@/lib/utils";
import {
  QUALITY_PRESETS,
  SENSITIVITIES,
  type CqGetResponse,
  type CqWdMutationResult,
  type NamedQualityPreset,
  type QualityPreset,
  type Sensitivity,
  type SensitivityRow,
  type UseConnectionQualityReturn,
} from "@/types/cq-watchdog";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CUSTOM_FIELD,
  EYEBROW,
  FAILED,
  GROUP,
  METRIC_HEAD,
  PRESET_FIELD,
  ROW,
  SENS_GRID,
  SKELETON_LOCAL,
} from "./shapes";

// Sensitivity and Quality: when the link counts as down (how often the modem
// probes and how many misses it takes) and when it counts as poor (the latency
// and loss limits). Every number comes from the GET's `tables`; none is copied here.

const K = "connection_quality.quality";

type Metric = "latency" | "loss";

/** `very-tolerant` is a value, not a key: i18next leaves have no hyphens. */
const PRESET_KEY: Record<QualityPreset, string> = {
  standard: "standard",
  tolerant: "tolerant",
  "very-tolerant": "very_tolerant",
  custom: "custom",
};

const GRID_ROWS = [
  { key: "every", pick: (row: SensitivityRow) => row.interval_sec },
  { key: "down", pick: (row: SensitivityRow) => row.fail_secs },
  { key: "up", pick: (row: SensitivityRow) => row.recover_secs },
] as const;

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** One decimal under a whole percent step, none on a whole one. */
function formatPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/** The field's text as an in-range integer, or null. */
function parseCustom(raw: string, [min, max]: readonly [number, number]): number | null {
  if (!/^[0-9]+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

// ─── Draft ──────────────────────────────────────────────────────────────────

interface MetricDraft {
  preset?: QualityPreset;
  text?: string;
}

interface Draft {
  sensitivity?: Sensitivity;
  latency?: MetricDraft;
  loss?: MetricDraft;
}

interface ResolvedMetric {
  preset: QualityPreset;
  text: string;
  /** The custom field parsed in range, else null. */
  custom: number | null;
  /** Custom is chosen and its text is not a valid number. */
  invalid: boolean;
  /** The limit the draft resolves to; null while a custom field is invalid. */
  limit: number | null;
  dirty: boolean;
}

function resolveMetric(
  saved: { preset: QualityPreset; custom: number | null },
  draft: MetricDraft | undefined,
  table: Record<NamedQualityPreset, number>,
  range: readonly [number, number],
): ResolvedMetric {
  const preset = draft?.preset ?? saved.preset;
  // A custom field opens on the saved number, else on the tolerant cut as a start.
  const text = draft?.text ?? String(saved.custom ?? table.tolerant);
  const custom = parseCustom(text, range);
  const isCustom = preset === "custom";
  return {
    preset,
    text,
    custom,
    invalid: isCustom && custom === null,
    limit: isCustom ? custom : table[preset as NamedQualityPreset],
    dirty: preset !== saved.preset || (isCustom && custom !== saved.custom),
  };
}

// ─── Sensitivity: the four columns ──────────────────────────────────────────

interface SensitivityGridProps {
  rows: Record<Sensitivity, SensitivityRow>;
  selected: Sensitivity;
}

function SensitivityGrid({ rows, selected }: SensitivityGridProps) {
  const { t } = useTranslation("monitoring");

  const tone = (sens: Sensitivity) => sens === selected && SENS_GRID.SEL;
  const shift = "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

  return (
    <table className={SENS_GRID.TABLE}>
      <caption className="sr-only">{t(`${K}.grid.caption`)}</caption>
      <thead>
        <tr>
          <td className={SENS_GRID.KEY} />
          {SENSITIVITIES.map((sens) => (
            <th
              key={sens}
              scope="col"
              className={cn(
                SENS_GRID.HEAD,
                shift,
                tone(sens),
                sens === selected && SENS_GRID.SEL_FIRST,
              )}
            >
              {t(`${K}.sensitivity.${sens}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {GRID_ROWS.map((row, index) => (
          <tr key={row.key}>
            <th scope="row" className={SENS_GRID.KEY}>
              {t(`${K}.grid.${row.key}`)}
            </th>
            {SENSITIVITIES.map((sens) => (
              <td
                key={sens}
                className={cn(
                  SENS_GRID.CELL,
                  shift,
                  tone(sens),
                  sens === selected && index === GRID_ROWS.length - 1 && SENS_GRID.SEL_LAST,
                )}
              >
                {t(`${K}.grid.${row.key}_value`, { n: row.pick(rows[sens]) })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── One metric: limit, preset pill, right now ──────────────────────────────

interface MetricBlockProps {
  metric: Metric;
  state: ResolvedMetric;
  table: Record<NamedQualityPreset, number>;
  range: readonly [number, number];
  onPreset: (preset: QualityPreset) => void;
  onText: (text: string) => void;
  /** The CGI's rejection of this field, already translated. */
  serverMessage: string | null;
  /** The poller's reading, or `null` for "not measured". Never a zero. */
  live: number | null;
  liveLoading: boolean;
}

function MetricBlock({
  metric,
  state,
  table,
  range,
  onPreset,
  onText,
  serverMessage,
  live,
  liveLoading,
}: MetricBlockProps) {
  const { t } = useTranslation("monitoring");
  const title = t(`${K}.${metric}.title`);
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;
  const [min, max] = range;

  const valueText = (n: number) => t(`${K}.value.${metric}`, { n });

  const options: SegmentedOption<QualityPreset>[] = QUALITY_PRESETS.map((preset) => ({
    value: preset,
    // Short names keep the pill on one row in a pair cell; the active limit
    // reads beside the metric title.
    label: t(`${K}.preset.${preset === "custom" ? "custom" : PRESET_KEY[preset]}`),
  }));

  const errorText = state.invalid
    ? t(`${K}.validation.range`, { min, max })
    : serverMessage;

  // Latency is over its limit above it; loss is over its limit AT it.
  const over =
    live !== null &&
    state.limit !== null &&
    (metric === "latency" ? live > state.limit : live >= state.limit);

  let now: React.ReactNode;
  if (liveLoading) {
    now = <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-16")} />;
  } else if (live === null) {
    now = (
      <span className={ROW.QUIET}>
        {t(metric === "latency" ? `${K}.now.no_reply` : `${K}.now.collecting`)}
      </span>
    );
  } else {
    now = (
      <>
        {metric === "latency"
          ? t(`${K}.value.latency`, { n: Math.round(live) })
          : t(`${K}.value.loss`, { n: formatPct(live) })}
        {over && state.limit !== null ? (
          <>
            <TriangleAlertIcon aria-hidden="true" className={ROW.ALERT} />
            <span className="sr-only">{t(`${K}.now.over_${metric}`, { n: state.limit })}</span>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div className={GROUP}>
      <div className={cn(METRIC_HEAD, "justify-between")}>
        <span className={EYEBROW}>{title}</span>
        {state.preset === "custom" ? (
          <div className={CUSTOM_FIELD.WRAP}>
            <Input
              id={fieldId}
              className={CUSTOM_FIELD.INPUT}
              value={state.text}
              onChange={(event) => onText(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              aria-label={t(`${K}.custom.aria`, { metric: title, min, max })}
              aria-invalid={errorText !== null}
              aria-describedby={errorText ? errorId : undefined}
            />
            <span className={CUSTOM_FIELD.UNIT}>{t(`${K}.unit.${metric}`)}</span>
          </div>
        ) : state.limit !== null ? (
          <span className={CUSTOM_FIELD.VALUE}>{valueText(state.limit)}</span>
        ) : null}
      </div>
      {errorText ? (
        <span id={errorId} role="alert" className={CUSTOM_FIELD.ERROR}>
          {errorText}
        </span>
      ) : null}
      <SegmentedField
        value={state.preset}
        onValueChange={onPreset}
        options={options}
        ariaLabel={title}
        breakpoint="lg"
        glyph={renderCheckGlyph}
        className={PRESET_FIELD}
      />
      <div className={ROW.ROOT}>
        <span className={ROW.KEY}>{t(`${K}.now.label`)}</span>
        <span className={ROW.VALUE}>{now}</span>
      </div>
    </div>
  );
}

// ─── The loaded form ────────────────────────────────────────────────────────

/** `latency.custom_ms` / `loss.custom_pct` → the metric the CGI rejected. */
function fieldMetric(field: string | null): Metric | null {
  if (field?.startsWith("latency")) return "latency";
  if (field?.startsWith("loss")) return "loss";
  return null;
}

interface QualityFormProps {
  cq: UseConnectionQualityReturn;
  /** Narrowed: this subtree only renders once the GET has landed. */
  data: CqGetResponse;
}

function QualityForm({ cq, data }: QualityFormProps) {
  const { t } = useTranslation("monitoring");
  const { isSaving, saveProbe, saveThresholds } = cq;
  const { settings, tables } = data;
  const { saved: flashed, markSaved } = useSaveFlash();
  const { data: status, isLoading: statusLoading } = useModemStatus();

  // The draft holds only what the user CHANGED; the saved value shows through.
  const [draft, setDraft] = React.useState<Draft>({});
  const [failed, setFailed] = React.useState(false);
  const [serverError, setServerError] = React.useState<{
    metric: Metric;
    message: string;
  } | null>(null);

  const sensitivity = draft.sensitivity ?? settings.sensitivity;
  const latency = resolveMetric(
    { preset: settings.latency.preset, custom: settings.latency.custom_ms },
    draft.latency,
    tables.presets.latency,
    tables.presets.custom_range.latency_ms,
  );
  const loss = resolveMetric(
    { preset: settings.loss.preset, custom: settings.loss.custom_pct },
    draft.loss,
    tables.presets.loss,
    tables.presets.custom_range.loss_pct,
  );

  const sensDirty = sensitivity !== settings.sensitivity;
  const dirty = sensDirty || latency.dirty || loss.dirty;
  // Built-in defaults are not on the device yet, so saving them is a real write.
  const canSave =
    (dirty || data.is_default) && !isSaving && !latency.invalid && !loss.invalid;

  // The limit is compared against the windowed average, so "Right now" reads the same.
  // NEVER `??` a 0 in: a null loss is under the poller's sample floor.
  const conn = status?.connectivity;
  const liveLatency =
    typeof conn?.avg_latency_ms === "number" && Number.isFinite(conn.avg_latency_ms)
      ? conn.avg_latency_ms
      : null;
  const liveLoss =
    typeof conn?.packet_loss_pct === "number" && Number.isFinite(conn.packet_loss_pct)
      ? conn.packet_loss_pct
      : null;

  const touch = () => {
    setFailed(false);
    setServerError(null);
  };

  const pickSensitivity = (next: Sensitivity) => {
    setDraft((prev) => ({ ...prev, sensitivity: next }));
    touch();
  };
  const pickPreset = (metric: Metric) => (preset: QualityPreset) => {
    setDraft((prev) => ({ ...prev, [metric]: { ...prev[metric], preset } }));
    touch();
  };
  const editText = (metric: Metric) => (text: string) => {
    setDraft((prev) => ({ ...prev, [metric]: { ...prev[metric], text } }));
    touch();
  };

  const discard = () => {
    setDraft({});
    touch();
  };

  const handleSave = async () => {
    if (!canSave) return;

    // One Save, up to two writes: the sensitivity rides `save_probe` with the SAVED
    // targets, the limits ride `save_thresholds`. Stop at the first rejection.
    let failure: CqWdMutationResult | null = null;
    if (sensDirty) {
      const result = await saveProbe({ sensitivity, targets: settings.targets });
      if (result.ok) setDraft((prev) => ({ ...prev, sensitivity: undefined }));
      else failure = result;
    }
    if (!failure && (latency.dirty || loss.dirty || data.is_default)) {
      const result = await saveThresholds({
        latency:
          latency.preset === "custom" && latency.custom !== null
            ? { preset: latency.preset, custom_ms: latency.custom }
            : { preset: latency.preset },
        loss:
          loss.preset === "custom" && loss.custom !== null
            ? { preset: loss.preset, custom_pct: loss.custom }
            : { preset: loss.preset },
      });
      if (!result.ok) failure = result;
    }

    if (!failure) {
      setDraft({});
      touch();
      markSaved();
      toast.success(t(`${K}.toast.saved`));
      return;
    }
    const metric = fieldMetric(failure.field);
    if (metric && failure.message) setServerError({ metric, message: failure.message });
    setFailed(true);
    toast.error(failure.message ?? t(`${K}.toast.failed`));
  };

  const sensitivityOptions: SegmentedOption<Sensitivity>[] = SENSITIVITIES.map((sens) => ({
    value: sens,
    label: t(`${K}.sensitivity.${sens}`),
  }));
  const sensitivityLabel = t(`${K}.sensitivity.label`);

  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          <span className={cn(EYEBROW, "mr-auto")}>{sensitivityLabel}</span>
          <SegmentedField
            value={sensitivity}
            onValueChange={pickSensitivity}
            options={sensitivityOptions}
            ariaLabel={sensitivityLabel}
            breakpoint="sm"
            glyph={renderCheckGlyph}
          />
        </div>
        <SensitivityGrid rows={tables.sensitivity} selected={sensitivity} />
      </div>

      <MetricBlock
        metric="latency"
        state={latency}
        table={tables.presets.latency}
        range={tables.presets.custom_range.latency_ms}
        onPreset={pickPreset("latency")}
        onText={editText("latency")}
        serverMessage={serverError?.metric === "latency" ? serverError.message : null}
        live={liveLatency}
        liveLoading={statusLoading}
      />
      <MetricBlock
        metric="loss"
        state={loss}
        table={tables.presets.loss}
        range={tables.presets.custom_range.loss_pct}
        onPreset={pickPreset("loss")}
        onText={editText("loss")}
        serverMessage={serverError?.metric === "loss" ? serverError.message : null}
        live={liveLoss}
        liveLoading={statusLoading}
      />

      <CardFoot
        status={
          failed ? (
            <span className={FAILED.ROOT}>
              <TriangleAlertIcon className={FAILED.GLYPH} aria-hidden="true" />
              {t(`${K}.failed`)}
            </span>
          ) : sensDirty ? (
            <span>
              {t(`${K}.consequence`, {
                to: tables.sensitivity[sensitivity].fail_secs,
                from: tables.sensitivity[settings.sensitivity].fail_secs,
              })}
            </span>
          ) : !dirty && data.is_default ? (
            <Badge variant="info">
              <InfoIcon className="size-3" aria-hidden="true" />
              {t(`${K}.default_chip`)}
            </Badge>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={discard}
              disabled={!dirty || isSaving}
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

// ─── Loading ────────────────────────────────────────────────────────────────

function QualitySkeleton() {
  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          {/* Inside the eyebrow's own line box, so the head keeps its loaded height. */}
          <span className={cn(EYEBROW, "mr-auto")}>
            <Skeleton className={cn(SKELETON_LOCAL.EYEBROW, "inline-block w-20 align-middle")} />
          </span>
          <Skeleton className={SKELETON_LOCAL.SEGMENT} />
        </div>
        <Skeleton className={SKELETON_LOCAL.GRID} />
      </div>
      {[0, 1].map((block) => (
        <div key={block} className={GROUP}>
          <div className={cn(METRIC_HEAD, "justify-between")}>
            <span className={EYEBROW}>
              <Skeleton className={cn(SKELETON_LOCAL.EYEBROW, "inline-block w-16 align-middle")} />
            </span>
            <Skeleton className={SKELETON_LOCAL.LIMIT} />
          </div>
          <Skeleton className={SKELETON_LOCAL.PRESET} />
          <div className={ROW.ROOT} aria-hidden="true">
            <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-20")} />
            <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-14")} />
          </div>
        </div>
      ))}
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

// ─── Card ───────────────────────────────────────────────────────────────────

export interface SensitivityQualityCardProps {
  cq: UseConnectionQualityReturn;
}

export default function SensitivityQualityCard({ cq }: SensitivityQualityCardProps) {
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
          <QualitySkeleton />
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
          <QualityForm cq={cq} data={data} />
        )}
      </CardContent>
    </Card>
  );
}

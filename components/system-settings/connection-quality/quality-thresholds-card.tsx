"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { MetaPanel, MetaPair } from "@/components/ui/meta-panel";

import { useQualityThresholds } from "@/hooks/use-quality-thresholds";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  QUALITY_PRESETS,
  type QualityPreset,
  type QualityNamedPreset,
  type QualityThresholdsSettings,
} from "@/types/modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";

// ─── Preset metadata (named presets only; `custom` is user-entered) ──────────

interface PresetMeta {
  label: string;
  blurb: string;
  threshold: number;
  debounce: number;
}

const LATENCY_META: Record<QualityNamedPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Good cellular. Flags any sustained latency over 150 ms.",
    threshold: 150,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Average cellular. Allows occasional spikes before flagging.",
    threshold: 250,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Poor signal areas. Only flags when latency stays high for a while.",
    threshold: 500,
    debounce: 2,
  },
};

const LOSS_META: Record<QualityNamedPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Tight quality bar. Flags loss above 15 %.",
    threshold: 15,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Acceptable on cellular under load. Won't fire from short bursts.",
    threshold: 30,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Severe drops only — useful in poor signal areas.",
    threshold: 50,
    debounce: 2,
  },
};

const PRESET_LABEL: Record<QualityPreset, string> = {
  standard: "Standard",
  tolerant: "Tolerant",
  "very-tolerant": "Very Tolerant",
  custom: "Custom",
};

const LATENCY_CUSTOM_MIN = 1;
const LATENCY_CUSTOM_MAX = 10000;
const LOSS_CUSTOM_MIN = 0;
const LOSS_CUSTOM_MAX = 100;

const isNamed = (p: QualityPreset): p is QualityNamedPreset => p !== "custom";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${Math.round(ms)} ms`;
}

function formatLoss(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct} %`;
}

function intInRange(raw: string, min: number, max: number): boolean {
  const n = Number(raw);
  return !(raw === "" || isNaN(n) || !Number.isInteger(n) || n < min || n > max);
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QualityThresholdsCard() {
  const { thresholds, isDefault, isLoading, error, isSaving, saveError, save } =
    useQualityThresholds();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  // SSR-safe stable ids for tablist <-> visible-label association (WCAG 1.3.1).
  const latencyLabelId = useId();
  const lossLabelId = useId();

  const [selected, setSelected] = useState<QualityThresholdsSettings | undefined>(
    thresholds,
  );

  // Sync local state when the saved thresholds arrive (or change after a save).
  // "Store previous value in state" pattern per React docs — no effects, which
  // the React Compiler lint requires.
  const [prevSavedKey, setPrevSavedKey] = useState<string | null>(null);
  if (thresholds) {
    const savedKey = [
      thresholds.latency.preset,
      thresholds.latency.custom_ms ?? "",
      thresholds.loss.preset,
      thresholds.loss.custom_pct ?? "",
    ].join("|");
    if (prevSavedKey !== savedKey) {
      setPrevSavedKey(savedKey);
      setSelected(thresholds);
    }
  }

  const isDirty = useMemo(() => {
    if (!thresholds || !selected) return false;
    return (
      selected.latency.preset !== thresholds.latency.preset ||
      selected.loss.preset !== thresholds.loss.preset ||
      (selected.latency.preset === "custom" &&
        (selected.latency.custom_ms ?? null) !==
          (thresholds.latency.custom_ms ?? null)) ||
      (selected.loss.preset === "custom" &&
        (selected.loss.custom_pct ?? null) !==
          (thresholds.loss.custom_pct ?? null))
    );
  }, [thresholds, selected]);

  const latencyCustomStr =
    selected?.latency.custom_ms != null ? String(selected.latency.custom_ms) : "";
  const lossCustomStr =
    selected?.loss.custom_pct != null ? String(selected.loss.custom_pct) : "";

  const latencyCustomError =
    selected?.latency.preset === "custom" &&
    latencyCustomStr !== "" &&
    !intInRange(latencyCustomStr, LATENCY_CUSTOM_MIN, LATENCY_CUSTOM_MAX)
      ? `Must be ${LATENCY_CUSTOM_MIN}–${LATENCY_CUSTOM_MAX} ms`
      : null;
  const lossCustomError =
    selected?.loss.preset === "custom" &&
    lossCustomStr !== "" &&
    !intInRange(lossCustomStr, LOSS_CUSTOM_MIN, LOSS_CUSTOM_MAX)
      ? `Must be ${LOSS_CUSTOM_MIN}–${LOSS_CUSTOM_MAX} %`
      : null;
  const customMissing =
    (selected?.latency.preset === "custom" && latencyCustomStr === "") ||
    (selected?.loss.preset === "custom" && lossCustomStr === "");

  const canSave =
    isDirty &&
    !isSaving &&
    !latencyCustomError &&
    !lossCustomError &&
    !customMissing;

  const handleSave = async () => {
    if (!canSave || !selected) return;
    try {
      await save(selected);
      markSaved();
      toast.success("Quality thresholds updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss — used for events and
            for Watchdog quality recovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5">
            {/* Latency: label → segmented control → preview panel */}
            <div className="grid gap-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            </div>
            <Separator />
            {/* Packet loss: same shape */}
            <div className="grid gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && !thresholds) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss — used for events and
            for Watchdog quality recovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!selected) return null;

  const liveLatency = modemStatus?.connectivity?.avg_latency_ms ?? null;
  const liveLoss = modemStatus?.connectivity?.packet_loss_pct ?? null;

  // Effective threshold for the live OK/warn glyph.
  const latThreshold = isNamed(selected.latency.preset)
    ? LATENCY_META[selected.latency.preset].threshold
    : (selected.latency.custom_ms ?? null);
  const lossThreshold = isNamed(selected.loss.preset)
    ? LOSS_META[selected.loss.preset].threshold
    : (selected.loss.custom_pct ?? null);

  const latencyOk =
    liveLatency === null || latThreshold === null || liveLatency <= latThreshold;
  const lossOk =
    liveLoss === null || lossThreshold === null || liveLoss < lossThreshold;

  const onLatencyPreset = (v: QualityPreset) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = { ...prev, latency: { ...prev.latency, preset: v } };
      // Seed the custom field from the previous named threshold so it isn't blank.
      if (v === "custom" && next.latency.custom_ms == null) {
        const seedFrom = isNamed(prev.latency.preset)
          ? LATENCY_META[prev.latency.preset].threshold
          : LATENCY_META.tolerant.threshold;
        next.latency.custom_ms = seedFrom;
      }
      return next;
    });
  };

  const onLossPreset = (v: QualityPreset) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = { ...prev, loss: { ...prev.loss, preset: v } };
      if (v === "custom" && next.loss.custom_pct == null) {
        const seedFrom = isNamed(prev.loss.preset)
          ? LOSS_META[prev.loss.preset].threshold
          : LOSS_META.tolerant.threshold;
        next.loss.custom_pct = seedFrom;
      }
      return next;
    });
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
        <CardDescription>
          When QManager flags slow latency or packet loss — used for Recent
          Activities events and for Watchdog quality recovery.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <motion.div
          className="grid gap-5"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── Latency row ─────────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3">
            <span id={latencyLabelId} className="text-sm font-medium">
              Latency
            </span>

            <Tabs
              value={selected.latency.preset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  onLatencyPreset(v as QualityPreset);
                }
              }}
            >
              <TabsList
                className="grid w-full grid-cols-4"
                aria-labelledby={latencyLabelId}
              >
                {QUALITY_PRESETS.map((p) => (
                  <TabsTrigger key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {selected.latency.preset === "custom" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="latency-custom">Latency threshold (ms)</Label>
                <Input
                  id="latency-custom"
                  type="number"
                  inputMode="numeric"
                  min={LATENCY_CUSTOM_MIN}
                  max={LATENCY_CUSTOM_MAX}
                  placeholder="e.g. 350"
                  className="tabular-nums @sm/card:max-w-[14rem]"
                  value={latencyCustomStr}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setSelected((prev) =>
                      prev
                        ? {
                            ...prev,
                            latency: {
                              ...prev.latency,
                              custom_ms: raw === "" ? null : Number(raw),
                            },
                          }
                        : prev,
                    );
                  }}
                  aria-invalid={latencyCustomError !== null}
                  aria-describedby={
                    latencyCustomError
                      ? "latency-custom-err"
                      : "latency-custom-desc"
                  }
                />
                {latencyCustomError ? (
                  <p id="latency-custom-err" role="alert" className="text-destructive text-xs">
                    {latencyCustomError}
                  </p>
                ) : (
                  <p id="latency-custom-desc" className="text-muted-foreground text-xs">
                    Flag latency above this (windowed average), {LATENCY_CUSTOM_MIN}–
                    {LATENCY_CUSTOM_MAX} ms.
                  </p>
                )}
                <MetaPanel title="Custom" blurb="Your own latency limit.">
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <MetaPair
                      label="Threshold"
                      value={
                        selected.latency.custom_ms != null
                          ? `${selected.latency.custom_ms} ms`
                          : "—"
                      }
                    />
                    <MetaPair
                      label="Current"
                      value={formatLatency(liveLatency)}
                      glyph={liveLatency === null ? null : latencyOk ? "ok" : "warn"}
                    />
                  </div>
                </MetaPanel>
              </div>
            ) : (
              <MetaPanel
                title={LATENCY_META[selected.latency.preset].label}
                blurb={LATENCY_META[selected.latency.preset].blurb}
              >
                <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                  <MetaPair
                    label="Threshold"
                    value={`${LATENCY_META[selected.latency.preset].threshold} ms`}
                  />
                  <MetaPair
                    label="Debounce"
                    value={`${LATENCY_META[selected.latency.preset].debounce} samples`}
                  />
                  <MetaPair
                    label="Current"
                    value={formatLatency(liveLatency)}
                    glyph={liveLatency === null ? null : latencyOk ? "ok" : "warn"}
                  />
                </div>
              </MetaPanel>
            )}
          </motion.div>

          <Separator />

          {/* ── Packet loss row ─────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3">
            <span id={lossLabelId} className="text-sm font-medium">
              Packet loss
            </span>

            <Tabs
              value={selected.loss.preset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  onLossPreset(v as QualityPreset);
                }
              }}
            >
              <TabsList
                className="grid w-full grid-cols-4"
                aria-labelledby={lossLabelId}
              >
                {QUALITY_PRESETS.map((p) => (
                  <TabsTrigger key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {selected.loss.preset === "custom" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="loss-custom">Packet loss threshold (%)</Label>
                <Input
                  id="loss-custom"
                  type="number"
                  inputMode="numeric"
                  min={LOSS_CUSTOM_MIN}
                  max={LOSS_CUSTOM_MAX}
                  placeholder="e.g. 25"
                  className="tabular-nums @sm/card:max-w-[14rem]"
                  value={lossCustomStr}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setSelected((prev) =>
                      prev
                        ? {
                            ...prev,
                            loss: {
                              ...prev.loss,
                              custom_pct: raw === "" ? null : Number(raw),
                            },
                          }
                        : prev,
                    );
                  }}
                  aria-invalid={lossCustomError !== null}
                  aria-describedby={
                    lossCustomError ? "loss-custom-err" : "loss-custom-desc"
                  }
                />
                {lossCustomError ? (
                  <p id="loss-custom-err" role="alert" className="text-destructive text-xs">
                    {lossCustomError}
                  </p>
                ) : (
                  <p id="loss-custom-desc" className="text-muted-foreground text-xs">
                    Flag loss at or above this, {LOSS_CUSTOM_MIN}–{LOSS_CUSTOM_MAX} %.
                  </p>
                )}
                <MetaPanel title="Custom" blurb="Your own packet-loss limit.">
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <MetaPair
                      label="Threshold"
                      value={
                        selected.loss.custom_pct != null
                          ? `${selected.loss.custom_pct} %`
                          : "—"
                      }
                    />
                    <MetaPair
                      label="Current"
                      value={formatLoss(liveLoss)}
                      glyph={liveLoss === null ? null : lossOk ? "ok" : "warn"}
                    />
                  </div>
                </MetaPanel>
              </div>
            ) : (
              <MetaPanel
                title={LOSS_META[selected.loss.preset].label}
                blurb={LOSS_META[selected.loss.preset].blurb}
              >
                <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                  <MetaPair
                    label="Threshold"
                    value={`${LOSS_META[selected.loss.preset].threshold} %`}
                  />
                  <MetaPair
                    label="Debounce"
                    value={`${LOSS_META[selected.loss.preset].debounce} samples`}
                  />
                  <MetaPair
                    label="Current"
                    value={formatLoss(liveLoss)}
                    glyph={liveLoss === null ? null : lossOk ? "ok" : "warn"}
                  />
                </div>
              </MetaPanel>
            )}
          </motion.div>

          {isDefault && (
            <motion.p
              variants={staggerItem}
              className="text-muted-foreground text-xs"
            >
              Using default thresholds — pick Standard to flag smaller spikes.
            </motion.p>
          )}

          {/* ── Save button ──────────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="flex justify-end">
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
            />
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
}

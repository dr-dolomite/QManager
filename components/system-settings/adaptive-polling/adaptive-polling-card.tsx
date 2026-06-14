"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  AlertTriangleIcon,
  GaugeIcon,
  MoonIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";

import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
import type {
  AdaptivePollingSettings,
  PollerTier,
} from "@/types/modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";

// ─── Live-tier badge metadata ────────────────────────────────────────────────
// Mandatory status-badge pattern: variant="outline" + bg-{role}/15
// text-{role} border-{role}/30 + size-3 lucide icon. Solid variants forbidden.

interface TierMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind class trio keyed to a semantic OKLCH role. */
  className: string;
}

const TIER_META: Record<PollerTier, TierMeta> = {
  active: {
    label: "Active · full rate",
    icon: ZapIcon,
    className: "bg-success/15 text-success border-success/30",
  },
  idle: {
    label: "Idle · slowed",
    icon: GaugeIcon,
    className: "bg-warning/15 text-warning border-warning/30",
  },
  deep: {
    label: "Deep idle · minimal",
    icon: MoonIcon,
    className:
      "bg-muted/50 text-muted-foreground border-muted-foreground/30",
  },
};

function TierBadge({ tier }: { tier: PollerTier | undefined }) {
  if (!tier) return null;
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", meta.className)}
      aria-label={`Live poller tier: ${meta.label}`}
    >
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

// ─── Numeric field metadata ───────────────────────────────────────────────────

type FieldKey =
  | "active_grace"
  | "idle_interval"
  | "idle_threshold"
  | "deep_idle_interval";

interface FieldMeta {
  key: FieldKey;
  label: string;
  hint: string;
  min: number;
  max: number;
}

const FIELDS: FieldMeta[] = [
  {
    key: "active_grace",
    label: "Active grace",
    hint: "Stay full-rate this long after the page is closed.",
    min: 0,
    max: 600,
  },
  {
    key: "idle_interval",
    label: "Idle interval",
    hint: "How often to poll while idle.",
    min: 2,
    max: 600,
  },
  {
    key: "idle_threshold",
    label: "Deep-idle threshold",
    hint: "When idle becomes deep-idle.",
    min: 30,
    max: 3600,
  },
  {
    key: "deep_idle_interval",
    label: "Deep-idle interval",
    hint: "How often to poll when deep-idle.",
    min: 5,
    max: 3600,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function settingsKey(s: AdaptivePollingSettings): string {
  return [
    s.enabled ? "1" : "0",
    s.active_grace,
    s.idle_interval,
    s.idle_threshold,
    s.deep_idle_interval,
  ].join(" ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdaptivePollingCard() {
  const {
    settings,
    isDefault,
    tier,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  } = useAdaptivePolling();
  const { saved, markSaved } = useSaveFlash();

  const enabledId = useId();

  const [draft, setDraft] = useState<AdaptivePollingSettings | undefined>(
    settings,
  );

  // Sync local edit state when the saved settings arrive (or change after a
  // save) using the "store previous value in state" pattern per React docs —
  // no setState-in-effect, which the React Compiler lint requires.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevSavedKey, setPrevSavedKey] = useState<string | null>(null);
  if (settings) {
    const savedKey = settingsKey(settings);
    if (prevSavedKey !== savedKey) {
      setPrevSavedKey(savedKey);
      setDraft(settings);
    }
  }

  const isDirty = useMemo(() => {
    if (!settings || !draft) return false;
    return settingsKey(settings) !== settingsKey(draft);
  }, [settings, draft]);

  const canSave = isDirty && !isSaving;

  const handleSave = async () => {
    if (!canSave || !draft) return;
    // Clamp every numeric field to its allowed range before persisting.
    const sanitized: AdaptivePollingSettings = {
      enabled: draft.enabled,
      active_grace: clamp(draft.active_grace, 0, 600),
      idle_interval: clamp(draft.idle_interval, 2, 600),
      idle_threshold: clamp(draft.idle_threshold, 30, 3600),
      deep_idle_interval: clamp(draft.deep_idle_interval, 5, 3600),
    };
    try {
      await save(sanitized);
      markSaved();
      toast.success("Adaptive polling updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Adaptive Polling</CardTitle>
          <CardDescription>
            Slow the modem&apos;s AT polling when no one is viewing the UI, then
            snap back to full rate the moment the dashboard is opened.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-px w-full" />
            <div className="grid gap-3 @md/card:grid-cols-2">
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ─────────────────────────────────────────────────────────
  if (error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Adaptive Polling</CardTitle>
          <CardDescription>
            Slow the modem&apos;s AT polling when no one is viewing the UI, then
            snap back to full rate the moment the dashboard is opened.
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

  if (!draft) return null;

  const fieldsDisabled = !draft.enabled;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Adaptive Polling</CardTitle>
        <CardDescription>
          Slow the modem&apos;s AT polling when no one is viewing the UI, then
          snap back to full rate the moment the dashboard is opened. Background
          alerts and connection recovery are unaffected.
        </CardDescription>
        <CardAction>
          <TierBadge tier={tier} />
        </CardAction>
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
          {/* ── Enable row ──────────────────────────────────────────────── */}
          <motion.div
            variants={staggerItem}
            className="flex items-center justify-between gap-4"
          >
            <div className="grid gap-1">
              <Label htmlFor={enabledId} className="text-sm font-medium">
                Slow polling when idle
              </Label>
              <span className="text-xs text-muted-foreground">
                Turn off to always poll at the full ~2 s rate.
              </span>
            </div>
            <Switch
              id={enabledId}
              checked={draft.enabled}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, enabled: checked })
              }
              aria-label="Slow polling when idle"
            />
          </motion.div>

          <Separator />

          {/* ── Numeric controls ────────────────────────────────────────── */}
          <motion.div
            variants={staggerItem}
            className="grid gap-4 @md/card:grid-cols-2"
            aria-disabled={fieldsDisabled}
          >
            {FIELDS.map((field) => (
              <NumericField
                key={field.key}
                meta={field}
                value={draft[field.key]}
                disabled={fieldsDisabled}
                onChange={(n) => setDraft({ ...draft, [field.key]: n })}
              />
            ))}
          </motion.div>

          {fieldsDisabled && (
            <motion.p
              variants={staggerItem}
              className="text-xs text-muted-foreground"
            >
              Backoff is off — the poller stays at full rate. Enable it to tune
              the intervals above.
            </motion.p>
          )}

          {isDefault && !fieldsDisabled && (
            <motion.p
              variants={staggerItem}
              className="text-xs text-muted-foreground"
            >
              Using default backoff timings.
            </motion.p>
          )}

          {/* ── Save button ─────────────────────────────────────────────── */}
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

// ─── Numeric field ────────────────────────────────────────────────────────────

function NumericField({
  meta,
  value,
  disabled,
  onChange,
}: {
  meta: FieldMeta;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {meta.label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={meta.min}
          max={meta.max}
          step={1}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isNaN(n) ? meta.min : n);
          }}
          className="pr-8 tabular-nums"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
        >
          s
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{meta.hint}</span>
    </div>
  );
}

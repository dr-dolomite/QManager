"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
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
    className: "bg-success/15 text-success-on-surface border-success/30",
  },
  idle: {
    label: "Idle · slowed",
    icon: GaugeIcon,
    className: "bg-warning/15 text-warning-on-surface border-warning/30",
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
    hint: "Stay full-rate this long after the page is closed, in seconds.",
    min: 0,
    max: 600,
  },
  {
    key: "idle_interval",
    label: "Idle interval",
    hint: "How often to poll while idle, in seconds.",
    min: 2,
    max: 600,
  },
  {
    key: "idle_threshold",
    label: "Deep-idle threshold",
    hint: "Time idle before switching to deep-idle, in seconds.",
    min: 30,
    max: 3600,
  },
  {
    key: "deep_idle_interval",
    label: "Deep-idle interval",
    hint: "How often to poll when deep-idle, in seconds.",
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
            Idle and deep-sleep tiers reduce AT command frequency when the
            dashboard is closed. Background alerts and connection recovery are
            unaffected by tier changes.
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
            Idle and deep-sleep tiers reduce AT command frequency when the
            dashboard is closed. Background alerts and connection recovery are
            unaffected by tier changes.
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
          Idle and deep-sleep tiers reduce AT command frequency when the
          dashboard is closed. Background alerts and connection recovery are
          unaffected by tier changes.
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

        <div className="grid gap-5">
          {/* ── Enable row ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-4">
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
          </div>

          <Separator />

          {/* ── Numeric controls ────────────────────────────────────────── */}
          <div
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
          </div>

          {fieldsDisabled && (
            <p className="text-xs text-muted-foreground">
              Backoff is off — the poller stays at full rate. Enable it to tune
              the intervals above.
            </p>
          )}

          {isDefault && !fieldsDisabled && (
            <p className="text-xs text-muted-foreground">
              Using default backoff timings.
            </p>
          )}

          {/* ── Save button ─────────────────────────────────────────────── */}
          <div className="flex justify-end">
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Numeric field ────────────────────────────────────────────────────────────
// Three a11y / UX hardening points:
//
// 1. Hint is wired via aria-describedby so screen readers hear it.
// 2. Hint copy includes "in seconds", so the unit is conveyed through the
//    already-wired describedby — the visible `s` adornment remains aria-hidden.
// 3. Local string state lets the user clear the field and retype freely;
//    the parent draft only receives a parsed number while input is valid.
//    On blur, an empty field resets to whatever the parent currently holds.
//    Uses the "store previous prop" pattern (no setState-in-effect) to keep
//    the local display in sync when the external value changes (e.g. after a
//    successful save round-trips from the server).

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
  const hintId = `${id}-hint`;

  // Local string state — allows transient empty / partial inputs without
  // immediately snapping back to the min. The parent still receives a valid
  // number on every well-formed keystroke.
  const [localStr, setLocalStr] = useState<string>(
    Number.isFinite(value) ? String(value) : "",
  );

  // "Store previous prop value" sync — mirrors the pattern at lines 174-181 in
  // the parent card. When the external value changes (server round-trip or a
  // reset), bring the local display in sync — but only if the field is not
  // mid-edit (i.e. the current local string parses back to the same value the
  // parent already has, meaning no user edit is in flight).
  const [prevValue, setPrevValue] = useState<number>(value);
  if (prevValue !== value) {
    setPrevValue(value);
    // Only sync the local display string when the user is not actively editing
    // a different value.
    const localParsed = parseInt(localStr, 10);
    if (localParsed !== value) {
      setLocalStr(Number.isFinite(value) ? String(value) : "");
    }
  }

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
          value={localStr}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => {
            const raw = e.target.value;
            setLocalStr(raw);
            const n = parseInt(raw, 10);
            // Only push a number to the parent when the string is a valid
            // finite integer. Empty / partial strings are held locally so the
            // user can clear and retype without the field fighting them.
            if (Number.isFinite(n)) {
              onChange(n);
            }
          }}
          onBlur={() => {
            // On blur, if the field is empty or unparseable, reset the local
            // display to whatever the parent draft currently holds.
            const n = parseInt(localStr, 10);
            if (!Number.isFinite(n)) {
              setLocalStr(Number.isFinite(value) ? String(value) : "");
            }
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
      <span id={hintId} className="text-xs text-muted-foreground">
        {meta.hint}
      </span>
    </div>
  );
}

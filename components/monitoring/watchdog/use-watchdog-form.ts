"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { isMotionReduced } from "@/lib/motion-preference";
import { useSaveFlash } from "@/components/ui/save-button";
import {
  WATCHDOG_RANGES,
  type CqWdMutationResult,
  type WatchdogSettingsPatch,
  type WatchdogSettingsV2,
} from "@/types/cq-watchdog";

import { isIntInRange, type TierIndex } from "./derive";

// Ladder and Detection each commit their own draft. A save sends only the keys
// the card changed: the other card's half-edit, and a value another page
// changed, both survive.

/** A callback-ref factory: the form owns the map, a card registers into it. */
export type RegisterField = (id: string) => (el: HTMLElement | null) => void;

export type WatchdogScope = "ladder" | "detection";

/** The validated controls, by the id they register under. */
export const FIELD_ID = {
  backupSlot: "watchdog-backup-slot",
  failbackEvery: "watchdog-failback-every",
  maxReboots: "watchdog-max-reboots",
  actAfter: "watchdog-act-after",
  qualityAfter: "watchdog-quality-after",
  carrierAfter: "watchdog-carrier-after",
  stepWait: "watchdog-step-wait",
  ssrGrace: "watchdog-ssr-grace",
} as const;

/** Every field the two cards edit. Numbers stay strings while typed. */
export interface WatchdogDraft {
  enabled: boolean;
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  /** "" = no slot chosen. */
  backupSlot: "" | "1" | "2";
  failback: boolean;
  failbackEvery: string;
  tier4: boolean;
  maxReboots: string;
  actAfter: string;
  quality: boolean;
  qualityAfter: string;
  carrier: boolean;
  carrierAfter: string;
  stepWait: string;
  ssrAware: boolean;
  ssrGrace: string;
}

type DraftKey = keyof WatchdogDraft;

/** Fields that can block a save, in reading order per card. */
export type BlockableField =
  | "backupSlot"
  | "failbackEvery"
  | "maxReboots"
  | "actAfter"
  | "qualityAfter"
  | "carrierAfter"
  | "stepWait"
  | "ssrGrace";

const SCOPE_KEYS = {
  ladder: [
    "enabled",
    "tier1",
    "tier2",
    "tier3",
    "backupSlot",
    "failback",
    "failbackEvery",
    "tier4",
    "maxReboots",
  ],
  detection: [
    "actAfter",
    "quality",
    "qualityAfter",
    "carrier",
    "carrierAfter",
    "stepWait",
    "ssrAware",
    "ssrGrace",
  ],
} as const satisfies Record<WatchdogScope, readonly DraftKey[]>;

const SCOPE_FIELDS = {
  ladder: ["backupSlot", "failbackEvery", "maxReboots"],
  detection: ["actAfter", "qualityAfter", "carrierAfter", "stepWait", "ssrGrace"],
} as const satisfies Record<WatchdogScope, readonly BlockableField[]>;

/** A blocked save names the FIELD by its visible label. */
export const FIELD_LABEL_KEY: Record<BlockableField, string> = {
  backupSlot: "watchdog.ladder.tier3.slotLabel",
  failbackEvery: "watchdog.ladder.failback.everyLabel",
  maxReboots: "watchdog.ladder.tier4.capLabel",
  actAfter: "watchdog.detection.act.label",
  qualityAfter: "watchdog.detection.quality.afterLabel",
  carrierAfter: "watchdog.detection.carrier.afterLabel",
  stepWait: "watchdog.detection.stepWait.label",
  ssrGrace: "watchdog.detection.ssr.label",
};

/** The numeric fields: draft key, wire key, range and the unit the message names. */
const NUMERIC = {
  failbackEvery: { wire: "failback_every_min", range: WATCHDOG_RANGES.failback_every_min, unit: "minutes" },
  maxReboots: { wire: "max_reboots_per_hour", range: WATCHDOG_RANGES.max_reboots_per_hour, unit: "count" },
  actAfter: { wire: "act_after_sec", range: WATCHDOG_RANGES.act_after_sec, unit: "seconds" },
  qualityAfter: { wire: "quality_after_sec", range: WATCHDOG_RANGES.quality_after_sec, unit: "seconds" },
  carrierAfter: { wire: "carrier_after_min", range: WATCHDOG_RANGES.carrier_after_min, unit: "minutes" },
  stepWait: { wire: "step_wait_sec", range: WATCHDOG_RANGES.step_wait_sec, unit: "seconds" },
  ssrGrace: { wire: "ssr_grace_sec", range: WATCHDOG_RANGES.ssr_grace_sec, unit: "seconds" },
} as const satisfies Record<
  Exclude<BlockableField, "backupSlot">,
  { wire: keyof WatchdogSettingsV2; range: readonly [number, number]; unit: string }
>;

type NumericField = keyof typeof NUMERIC;

/** The wire key a rejected request names, mapped to the control that shows it. */
const WIRE_TO_FIELD: Partial<Record<string, DraftKey>> = {
  enabled: "enabled",
  tier3_enabled: "backupSlot",
  backup_sim_slot: "backupSlot",
  failback_every_min: "failbackEvery",
  max_reboots_per_hour: "maxReboots",
  act_after_sec: "actAfter",
  quality_after_sec: "qualityAfter",
  carrier_after_min: "carrierAfter",
  step_wait_sec: "stepWait",
  ssr_grace_sec: "ssrGrace",
};

/**
 * Which controls are in play: an off feature's field stays editable but only
 * blocks a save once the user has touched it.
 */
const relevantFields = (d: WatchdogDraft): Record<BlockableField, boolean> => ({
  backupSlot: d.tier3,
  failbackEvery: d.tier3 && d.failback,
  maxReboots: d.tier4,
  actAfter: true,
  qualityAfter: d.quality,
  carrierAfter: d.carrier,
  stepWait: true,
  ssrGrace: d.ssrAware,
});

const savedDraft = (s: WatchdogSettingsV2): WatchdogDraft => ({
  enabled: s.enabled,
  tier1: s.tier1_enabled,
  tier2: s.tier2_enabled,
  tier3: s.tier3_enabled,
  backupSlot: s.backup_sim_slot === 1 ? "1" : s.backup_sim_slot === 2 ? "2" : "",
  failback: s.failback_enabled,
  failbackEvery: String(s.failback_every_min),
  tier4: s.tier4_enabled,
  maxReboots: String(s.max_reboots_per_hour),
  actAfter: String(s.act_after_sec),
  quality: s.quality_enabled,
  qualityAfter: String(s.quality_after_sec),
  carrier: s.carrier_enabled,
  carrierAfter: String(s.carrier_after_min),
  stepWait: String(s.step_wait_sec),
  ssrAware: s.ssr_aware,
  ssrGrace: String(s.ssr_grace_sec),
});

const int = (raw: string) => parseInt(raw, 10);

/** Only the keys the card changed go on the wire. */
function toPatch(
  scope: WatchdogScope,
  draft: WatchdogDraft,
  saved: WatchdogDraft,
): WatchdogSettingsPatch {
  const changed = (k: DraftKey) => draft[k] !== saved[k];
  const patch: WatchdogSettingsPatch = {};
  const d = draft;

  if (scope === "ladder") {
    if (changed("enabled")) patch.enabled = d.enabled;
    if (changed("tier1")) patch.tier1_enabled = d.tier1;
    if (changed("tier2")) patch.tier2_enabled = d.tier2;
    if (changed("tier3")) patch.tier3_enabled = d.tier3;
    if (changed("backupSlot")) {
      patch.backup_sim_slot = d.backupSlot === "" ? null : (int(d.backupSlot) as 1 | 2);
    }
    if (changed("failback")) patch.failback_enabled = d.failback;
    if (changed("failbackEvery")) patch.failback_every_min = int(d.failbackEvery);
    if (changed("tier4")) patch.tier4_enabled = d.tier4;
    if (changed("maxReboots")) patch.max_reboots_per_hour = int(d.maxReboots);
  } else {
    if (changed("actAfter")) patch.act_after_sec = int(d.actAfter);
    if (changed("quality")) patch.quality_enabled = d.quality;
    if (changed("qualityAfter")) patch.quality_after_sec = int(d.qualityAfter);
    if (changed("carrier")) patch.carrier_enabled = d.carrier;
    if (changed("carrierAfter")) patch.carrier_after_min = int(d.carrierAfter);
    if (changed("stepWait")) patch.step_wait_sec = int(d.stepWait);
    if (changed("ssrAware")) patch.ssr_aware = d.ssrAware;
    if (changed("ssrGrace")) patch.ssr_grace_sec = int(d.ssrGrace);
  }
  return patch;
}

function omit<T extends Partial<Record<DraftKey, unknown>>>(
  source: T,
  keys: readonly DraftKey[],
): T {
  const next = { ...source };
  for (const k of keys) delete next[k];
  return next;
}

/** Edits that now equal the saved values have done their job. */
const pruneSettled = (
  edits: Partial<WatchdogDraft>,
  saved: WatchdogDraft,
): Partial<WatchdogDraft> => {
  const next: Partial<WatchdogDraft> = {};
  for (const k of Object.keys(edits) as DraftKey[]) {
    if (edits[k] !== saved[k]) (next as Record<DraftKey, unknown>)[k] = edits[k];
  }
  return next;
};

export interface FieldError {
  /** A translated sentence, ready to render. */
  message: string;
}

export interface ScopeState {
  dirty: boolean;
  /** Fields blocking this card's save, in reading order. */
  blockedFields: BlockableField[];
  isSaving: boolean;
  /** Any save is in flight; one at a time. */
  busy: boolean;
  saved: boolean;
  submit: () => Promise<void>;
  discard: () => void;
  /** Focus and reveal the first blocking control. No-op when nothing blocks. */
  focusFirstBlocked: () => void;
}

export interface WatchdogForm {
  /** The draft both cards render: saved truth overlaid with unsaved edits. */
  draft: WatchdogDraft;
  /** The saved truth the draft is compared against. */
  saved: WatchdogDraft;
  setFields: (patch: Partial<WatchdogDraft>) => void;
  /** Field messages: client range checks, then the backend's own rejection. */
  errors: Partial<Record<DraftKey, string>>;
  scopes: Record<WatchdogScope, ScopeState>;
  /** Newly lets the watchdog reboot unattended; keyed on master AND tier 4. */
  grantsRebootAuthority: boolean;
  registerField: RegisterField;
}

interface UseWatchdogFormArgs {
  settings: WatchdogSettingsV2;
  isSaving: boolean;
  saveSettings: (patch: WatchdogSettingsPatch) => Promise<CqWdMutationResult>;
}

export function useWatchdogForm({
  settings,
  isSaving,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { t } = useTranslation("monitoring");
  const ladderFlash = useSaveFlash();
  const detectionFlash = useSaveFlash();

  // Edits overlay server truth, so a re-read never eats a typed value and one
  // card's save leaves the other card's half-edit alone.
  const [edits, setEdits] = useState<Partial<WatchdogDraft>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<DraftKey, string>>>({});
  const [savingScope, setSavingScope] = useState<WatchdogScope | null>(null);
  const [seen, setSeen] = useState(settings);

  const saved = useMemo(() => savedDraft(settings), [settings]);

  // A new read settles the edits it now matches (adjust state during render).
  if (seen !== settings) {
    setSeen(settings);
    setEdits((prev) => pruneSettled(prev, saved));
  }

  const draft = useMemo<WatchdogDraft>(() => ({ ...saved, ...edits }), [saved, edits]);

  const setFields = useCallback((patch: Partial<WatchdogDraft>) => {
    setEdits((prev) => ({ ...prev, ...patch }));
    // Touching a control retires the backend's complaint about it. The slot
    // control carries the tier 3 complaint, so toggling tier 3 clears it too.
    setServerErrors((prev) => {
      const keys = Object.keys(patch) as DraftKey[];
      if (!keys.some((k) => prev[k] || (k === "tier3" && prev.backupSlot))) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      if (keys.includes("tier3")) delete next.backupSlot;
      return next;
    });
  }, []);

  const rangeMessage = useCallback(
    (field: NumericField) => {
      const { range, unit } = NUMERIC[field];
      return t(`watchdog.errors.${unit}`, { min: range[0], max: range[1] });
    },
    [t],
  );

  const clientErrors = useMemo(() => {
    const relevant = relevantFields(draft);
    const out: Partial<Record<DraftKey, string>> = {};
    (Object.keys(NUMERIC) as NumericField[]).forEach((field) => {
      const { range } = NUMERIC[field];
      const raw = draft[field];
      const touched = raw !== saved[field];
      const empty = raw.trim() === "";
      const invalid = empty || !isIntInRange(raw, range[0], range[1]);
      // An empty field is caught by the save gate; only a typed bad value is
      // worth a sentence while the user is still in it.
      if (invalid && !empty && (touched || relevant[field])) {
        out[field] = rangeMessage(field);
      }
    });
    if (draft.tier3 && draft.backupSlot === "") {
      out.backupSlot = t("watchdog.errors.backupSlot");
    }
    return out;
  }, [draft, saved, rangeMessage, t]);

  const errors = useMemo(
    () => ({ ...clientErrors, ...serverErrors }),
    [clientErrors, serverErrors],
  );

  const blockedFor = (scope: WatchdogScope): BlockableField[] => {
    const relevant = relevantFields(draft);
    return SCOPE_FIELDS[scope].filter((field) => {
      if (field === "backupSlot") return draft.tier3 && draft.backupSlot === "";
      const { range } = NUMERIC[field];
      const raw = draft[field];
      const invalid = raw.trim() === "" || !isIntInRange(raw, range[0], range[1]);
      return invalid && (raw !== saved[field] || relevant[field]);
    });
  };

  const dirtyFor = (scope: WatchdogScope) =>
    SCOPE_KEYS[scope].some((k) => draft[k] !== saved[k]);

  const grantsRebootAuthority =
    draft.enabled && draft.tier4 && !(settings.enabled && settings.tier4_enabled);

  // A ref, because nothing renders off it.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback<RegisterField>(
    (id) => (el) => {
      fieldRefs.current[id] = el;
    },
    [],
  );

  const focusField = (field: BlockableField) => {
    const host = fieldRefs.current[FIELD_ID[field]];
    if (!host) return;
    // A segmented control registers its wrapper; focus its first visible segment.
    const el = host.matches("input, button")
      ? host
      : Array.from(host.querySelectorAll<HTMLElement>("input, button")).find(
          (n) => n.getClientRects().length > 0 && !n.hasAttribute("disabled"),
        );
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({
      block: "center",
      behavior: isMotionReduced() ? "auto" : "smooth",
    });
  };

  const submitScope = async (scope: WatchdogScope) => {
    if (!dirtyFor(scope) || blockedFor(scope).length > 0 || isSaving) return;

    setSavingScope(scope);
    setServerErrors((prev) => omit(prev, SCOPE_KEYS[scope]));
    // The RESULT carries the backend's reason; hook `error` state would be stale here.
    const result = await saveSettings(toPatch(scope, draft, saved));
    setSavingScope(null);
    if (result.ok) {
      (scope === "ladder" ? ladderFlash : detectionFlash).markSaved();
      toast.success(
        t(scope === "ladder" ? "watchdog.save.ladderOk" : "watchdog.save.detectionOk"),
      );
      return;
    }
    const field = result.field ? WIRE_TO_FIELD[result.field] : undefined;
    if (field && result.message) {
      const message = result.message;
      setServerErrors((prev) => ({ ...prev, [field]: message }));
    }
    toast.error(
      t(scope === "ladder" ? "watchdog.save.ladderFail" : "watchdog.save.detectionFail"),
      { description: result.message ?? undefined },
    );
  };

  const scopeState = (scope: WatchdogScope): ScopeState => ({
    dirty: dirtyFor(scope),
    blockedFields: blockedFor(scope),
    isSaving: isSaving && savingScope === scope,
    busy: isSaving,
    saved: (scope === "ladder" ? ladderFlash : detectionFlash).saved,
    submit: () => submitScope(scope),
    discard: () => {
      setEdits((prev) => omit(prev, SCOPE_KEYS[scope]));
      setServerErrors((prev) => omit(prev, SCOPE_KEYS[scope]));
    },
    focusFirstBlocked: () => {
      const first = blockedFor(scope)[0];
      if (first) focusField(first);
    },
  });

  return {
    draft,
    saved,
    setFields,
    errors,
    scopes: { ladder: scopeState("ladder"), detection: scopeState("detection") },
    grantsRebootAuthority,
    registerField,
  };
}

/** Tier on/off by index, for the rungs and the timeline. */
export const draftTiers = (d: WatchdogDraft): Record<TierIndex, boolean> => ({
  1: d.tier1,
  2: d.tier2,
  3: d.tier3,
  4: d.tier4,
});

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { MetaPanel, MetaPair } from "@/components/ui/meta-panel";

import { usePingProfile } from "@/hooks/use-ping-profile";
import { useModemStatus } from "@/hooks/use-modem-status";
import { PING_PROFILES, type PingProfile } from "@/types/modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";

// ─── Profile metadata (UI labels and per-preset blurbs) ────────────────────

// Mirrors the qmanager_ping daemon's resolve_profile() table. Keep these in
// sync — the daemon is the source of truth, this table is purely for previewing
// values in the UI before the user saves.
const PROFILE_META: Record<
  PingProfile,
  {
    label: string;
    blurb: string;
    intervalSec: number;
    failSecs: number;
    recoverSecs: number;
  }
> = {
  sensitive: {
    label: "Sensitive",
    blurb:
      "Fastest UI feedback. Best for hardwired or strong-signal setups.",
    intervalSec: 1,
    failSecs: 6,
    recoverSecs: 3,
  },
  regular: {
    label: "Regular",
    blurb: "Balanced default. Good for most users.",
    intervalSec: 2,
    failSecs: 10,
    recoverSecs: 6,
  },
  relaxed: {
    label: "Relaxed",
    blurb: "Conservative. Matches the previous QManager default.",
    intervalSec: 5,
    failSecs: 15,
    recoverSecs: 10,
  },
  quiet: {
    label: "Quiet",
    blurb: "Battery and data conscious. Slowest reaction time.",
    intervalSec: 10,
    failSecs: 30,
    recoverSecs: 20,
  },
};

// 30 seconds — how long after a save we wait before showing the
// "daemon hasn't picked up the change yet" footnote.
const STUCK_THRESHOLD_MS = 30_000;

// Cloudflare anycast DNS — fast, reliable ICMP responders for both families.
const DEFAULT_TARGET_IPV4 = "1.1.1.1";
const DEFAULT_TARGET_IPV6 = "2606:4700:4700::1111";

// Common host rules shared by both families: trimmed, non-empty, length-bounded,
// no whitespace, no shell/HTML metacharacters. Mirrors the CGI's validate_target
// so the user sees the same verdict inline that the backend would return.
function checkCommonHostRules(trimmed: string): string | null {
  if (!trimmed) return "Address cannot be empty";
  if (trimmed.length > 128) return "Address too long (max 128 characters)";
  if (/\s/.test(trimmed)) return "Address cannot contain spaces";
  if (/[`$();|<>"\\]/.test(trimmed))
    return "Address contains disallowed characters";
  return null;
}

// IPv4 literal or hostname — charset [0-9A-Za-z.-].
function validateIpv4Target(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonHostRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed))
    return "Enter an IPv4 address or hostname";
  return null;
}

// IPv6 literal — charset [0-9A-Fa-f:.%], and must contain a colon.
function validateIpv6Target(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonHostRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Fa-f:.%]/.test(trimmed)) return "Enter a valid IPv6 address";
  if (!trimmed.includes(":")) return "An IPv6 address must contain ':'";
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatSecs(value: number | null | undefined): string {
  if (value === undefined || value === null || value === 0) return "—";
  return `${value}s`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConnectivitySensitivityCard() {
  const {
    profile,
    targetIpv4,
    targetIpv6,
    intervalOverride,
    effectiveInterval,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  } = usePingProfile();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  const [selected, setSelected] = useState<PingProfile | undefined>(profile);
  const [ipv4Input, setIpv4Input] = useState<string>("");
  const [ipv6Input, setIpv6Input] = useState<string>("");
  const [ipv4Err, setIpv4Err] = useState<string | null>(null);
  const [ipv6Err, setIpv6Err] = useState<string | null>(null);

  // Sync local form state when the saved settings arrive (or change after a
  // save). "Store previous value in state" pattern per React docs — no refs,
  // no effects, which the React Compiler lint requires.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevSavedKey, setPrevSavedKey] = useState<string | null>(null);
  if (
    profile !== undefined &&
    targetIpv4 !== undefined &&
    targetIpv6 !== undefined
  ) {
    const savedKey = [profile, targetIpv4, targetIpv6].join("|");
    if (prevSavedKey !== savedKey) {
      setPrevSavedKey(savedKey);
      setSelected(profile);
      setIpv4Input(targetIpv4);
      setIpv6Input(targetIpv6);
    }
  }

  // After a successful save, sync local selection to whatever was just saved
  // (prevents stale dirty state if user clicks a profile twice)
  const lastSavedAtRef = useRef<number | null>(null);
  const lastSavedProfileRef = useRef<PingProfile | null>(null);

  // Dirty detection
  const isDirty = useMemo(() => {
    if (!profile || selected === undefined) return false;
    if (selected !== profile) return true;
    if (targetIpv4 !== undefined && ipv4Input !== targetIpv4) return true;
    if (targetIpv6 !== undefined && ipv6Input !== targetIpv6) return true;
    return false;
  }, [profile, selected, targetIpv4, ipv4Input, targetIpv6, ipv6Input]);

  const hasValidationErrors = ipv4Err !== null || ipv6Err !== null;
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  // Live family indicator: which address family the daemon's last successful
  // probe used. "ipv6" means the IPv4 leg failed and the fallback carried the
  // connection — the exact case this card's IPv6 target exists to cover.
  const lastFamily = modemStatus?.connectivity?.last_family;

  // Daemon-stuck detection: after a save, if the daemon's runtime profile
  // doesn't match within STUCK_THRESHOLD_MS, surface a footnote.
  const [stuckHint, setStuckHint] = useState(false);
  const [saveCount, setSaveCount] = useState(0);
  useEffect(() => {
    if (lastSavedAtRef.current === null) return;
    const interval = setInterval(() => {
      if (lastSavedAtRef.current === null) return;
      const elapsed = Date.now() - lastSavedAtRef.current;
      if (elapsed < STUCK_THRESHOLD_MS) return;
      const runtime = modemStatus?.connectivity?.profile;
      const target = lastSavedProfileRef.current;
      if (runtime && target && runtime !== target) {
        setStuckHint(true);
      } else {
        setStuckHint(false);
        lastSavedAtRef.current = null;
        lastSavedProfileRef.current = null;
      }
    }, 2_000);
    return () => clearInterval(interval);
  }, [saveCount, modemStatus?.connectivity?.profile]);

  // Save handler
  const handleSave = async () => {
    if (!canSave || !selected) return;
    // Re-validate at submit time
    const e4 = validateIpv4Target(ipv4Input);
    const e6 = validateIpv6Target(ipv6Input);
    setIpv4Err(e4);
    setIpv6Err(e6);
    if (e4 || e6) return;

    try {
      await save({
        profile: selected,
        target_ipv4: ipv4Input.trim(),
        target_ipv6: ipv6Input.trim(),
      });
      markSaved();
      lastSavedAtRef.current = Date.now();
      lastSavedProfileRef.current = selected;
      setStuckHint(false);
      setSaveCount((c) => c + 1);
      toast.success("Connectivity settings updated");
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
          <CardTitle>Connectivity Sensitivity</CardTitle>
          <CardDescription>
            How aggressively the modem checks if your internet is working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {/* Profile tabs */}
            <Skeleton className="h-10 w-full rounded-md" />
            {/* Active-profile meta panel */}
            <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            {/* Separator */}
            <Separator className="my-2" />
            {/* Probe targets header + reset icon */}
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1.5 flex-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
              <Skeleton className="h-9 w-9 rounded-md shrink-0" />
            </div>
            {/* IPv4 target */}
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* IPv6 target */}
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* Save button */}
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && !profile) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Connectivity Sensitivity</CardTitle>
          <CardDescription>
            How aggressively the modem checks if your internet is working.
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

  const activeMeta = selected ? PROFILE_META[selected] : null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Connectivity Sensitivity</CardTitle>
        <CardDescription>
          How aggressively the modem checks if your internet is working.
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
          className="grid gap-3"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── Segmented control ────────────────────────────────────── */}
          <motion.div variants={staggerItem}>
            <Tabs
              value={selected ?? ""}
              onValueChange={(v) => {
                if (v && (PING_PROFILES as readonly string[]).includes(v)) {
                  setSelected(v as PingProfile);
                }
              }}
            >
              <TabsList
                className="grid w-full grid-cols-4"
                aria-label="Connectivity sensitivity profile"
              >
                {PING_PROFILES.map((p) => (
                  <TabsTrigger
                    key={p}
                    value={p}
                    aria-label={`${PROFILE_META[p].label} (${PROFILE_META[p].intervalSec}s probe)`}
                  >
                    {PROFILE_META[p].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </motion.div>

          {/* ── Active-profile meta panel ────────────────────────────── */}
          {/* Sensitivity is now probe-interval only. How many failed probes
              count as "down" and what happens next (recovery) live in the
              Connection Watchdog. */}
          {activeMeta && (
            <motion.div variants={staggerItem}>
              <MetaPanel title={activeMeta.label} blurb={activeMeta.blurb}>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <MetaPair
                    label="Probe interval"
                    value={formatSecs(activeMeta.intervalSec)}
                  />
                  <MetaPair
                    label="Checks internet"
                    value={
                      activeMeta.intervalSec
                        ? `every ${activeMeta.intervalSec}s`
                        : "—"
                    }
                  />
                </div>
              </MetaPanel>
            </motion.div>
          )}

          {/* ── Watchdog override notice ──────────────────────────────── */}
          {/* The Connection Watchdog can set a Custom probe interval that wins
              over the profile. Surface it honestly so the profile choice above
              doesn't look like it's being ignored. */}
          {intervalOverride != null && (
            <motion.div variants={staggerItem}>
              <Alert>
                <RotateCcwIcon className="size-4" />
                <AlertTitle>Watchdog override active</AlertTitle>
                <AlertDescription>
                  <p>
                    The Connection Watchdog is enforcing a custom{" "}
                    <span className="tabular-nums font-medium text-foreground">
                      {effectiveInterval ?? intervalOverride}s
                    </span>{" "}
                    probe interval. Your profile choice here becomes the fallback
                    once that override is cleared.
                  </p>
                </AlertDescription>
              </Alert>
            </motion.div>
          )}

          {/* ── Probe target inputs ──────────────────────────────────── */}
          <Separator className="my-2" />
          <motion.div variants={staggerItem} className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium">Probe Targets</h4>
                <p
                  id="probe-targets-help"
                  className="text-xs text-muted-foreground mt-0.5"
                >
                  DNS servers the modem pings to check the internet. IPv4 is
                  tried first; IPv6 is the fallback, so an IPv6-only connection
                  is never reported as down.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => {
                  setIpv4Input(DEFAULT_TARGET_IPV4);
                  setIpv6Input(DEFAULT_TARGET_IPV6);
                  setIpv4Err(null);
                  setIpv6Err(null);
                }}
                aria-label="Reset probe targets to defaults"
                title="Reset to defaults"
              >
                <RotateCcwIcon />
              </Button>
            </div>

            {/* IPv4 DNS server — pinged first */}
            <div className="grid gap-1.5">
              <Label htmlFor="target-ipv4">IPv4 DNS Server</Label>
              <Input
                id="target-ipv4"
                value={ipv4Input}
                onChange={(e) => {
                  setIpv4Input(e.target.value);
                  setIpv4Err(validateIpv4Target(e.target.value));
                }}
                placeholder="1.1.1.1"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={ipv4Err !== null}
                aria-describedby={
                  ipv4Err
                    ? "probe-targets-help target-ipv4-err"
                    : "probe-targets-help"
                }
              />
              {ipv4Err && (
                <p
                  id="target-ipv4-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {ipv4Err}
                </p>
              )}
            </div>

            {/* IPv6 DNS server — fallback for IPv6-only bearers */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="target-ipv6">IPv6 DNS Server</Label>
                {lastFamily === "ipv6" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Currently reachable via IPv6
                  </span>
                )}
              </div>
              <Input
                id="target-ipv6"
                value={ipv6Input}
                onChange={(e) => {
                  setIpv6Input(e.target.value);
                  setIpv6Err(validateIpv6Target(e.target.value));
                }}
                placeholder="2606:4700:4700::1111"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={ipv6Err !== null}
                aria-describedby={
                  ipv6Err
                    ? "target-ipv6-help target-ipv6-err"
                    : "target-ipv6-help"
                }
              />
              <p
                id="target-ipv6-help"
                className="text-xs text-muted-foreground"
              >
                Only used when the IPv4 ping fails. On an IPv6-only connection
                this keeps the modem from reporting a false outage.
              </p>
              {ipv6Err && (
                <p
                  id="target-ipv6-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {ipv6Err}
                </p>
              )}
            </div>
          </motion.div>

          {/* ── Daemon-stuck warning banner ──────────────────────────── */}
          {/* Appears after the card has already settled, so it runs its own
              entrance rather than inheriting the parent's finished stagger. */}
          {stuckHint && (
            <motion.div variants={staggerItem} initial="hidden" animate="visible">
              <Alert variant="warning">
                <AlertTriangleIcon className="size-4" />
                <AlertTitle>Saved, but not applied yet</AlertTitle>
                <AlertDescription>
                  The probe is still running the previous preset. Give it a
                  moment and refresh; if it sticks, restart the qmanager-ping
                  service.
                </AlertDescription>
              </Alert>
            </motion.div>
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

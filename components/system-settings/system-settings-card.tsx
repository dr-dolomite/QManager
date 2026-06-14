"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangleIcon,
  Check,
  ChevronDownIcon,
  ChevronsUpDown,
} from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import KnownSimsRow from "@/components/system-settings/known-sims-row";
import SshPasswordSection from "@/components/system-settings/ssh-password/ssh-password-section";
import { motion } from "motion/react";
import { containerVariants, itemVariants } from "@/lib/motion";
import { TbInfoCircleFilled } from "react-icons/tb";
import { useTranslation } from "react-i18next";

import type {
  UseSystemSettingsReturn,
  SaveSettingsPayload,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";
import { cn } from "@/lib/utils";

// ─── Component ──────────────────────────────────────────────────────────────

type SystemSettingsCardProps = Pick<
  UseSystemSettingsReturn,
  "settings" | "isLoading" | "isSaving" | "error" | "saveSettings"
>;

export default function SystemSettingsCard({
  settings,
  isLoading,
  isSaving,
  error,
  saveSettings,
}: SystemSettingsCardProps) {
  const { t } = useTranslation("system-settings");

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("system.card_title")}</CardTitle>
          <CardDescription>
            {t("system.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-9 w-52" />
            </div>
            <Separator />
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state ---
  if (error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("system.card_title")}</CardTitle>
          <CardDescription>
            {t("system.card_description")}
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

  // Key-based remount: when settings change after save/re-fetch,
  // the form reinitializes with fresh values from useState defaults.
  const formKey = settings
    ? `${settings.force_tailscale_fixes}-${settings.temp_unit}-${settings.distance_unit}-${settings.zonename}`
    : "empty";

  return (
    <SystemSettingsForm
      key={formKey}
      settings={settings}
      isSaving={isSaving}
      error={error}
      saveSettings={saveSettings}
    />
  );
}

// ─── Form (remounts on settings change for clean state reset) ───────────────

interface SystemSettingsFormProps {
  settings: UseSystemSettingsReturn["settings"];
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<boolean>;
}

function SystemSettingsForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: SystemSettingsFormProps) {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  // --- Local form state (initialized from settings prop) ---
  const [tempUnit, setTempUnit] = useState<"celsius" | "fahrenheit">(
    settings?.temp_unit ?? "celsius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(
    settings?.distance_unit ?? "km",
  );
  const [zonename, setZonename] = useState(settings?.zonename ?? "UTC");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC0");
  const [tzOpen, setTzOpen] = useState(false);

  // SSH password change lives in a disclosure under the Timezone row. Its own
  // mutation (ssh_password.sh) is independent of this card's Save button.
  const [sshOpen, setSshOpen] = useState(false);

  // Force Tailscale Fixes toggle state (saves immediately, not via Save button).
  // Re-introduces the historical fw4 zone + mwan3 ipset workarounds for
  // tailscale0. Off by default; recommended for R02 firmware users.
  const [forceTailscaleFixes, setForceTailscaleFixes] = useState(
    settings?.force_tailscale_fixes ?? false,
  );
  const [forceTailscaleFixesSaving, setForceTailscaleFixesSaving] = useState(false);

  // --- Dirty check (Save-button items only, not the immediate toggles) ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      tempUnit !== settings.temp_unit ||
      distanceUnit !== settings.distance_unit ||
      zonename !== settings.zonename
    );
  }, [settings, tempUnit, distanceUnit, zonename]);

  const canSave = isDirty && !isSaving;

  // --- Force Tailscale Fixes immediate toggle handler ---
  const handleForceTailscaleFixesChange = useCallback(
    async (checked: boolean) => {
      setForceTailscaleFixes(checked);
      setForceTailscaleFixesSaving(true);

      const success = await saveSettings({
        action: "save_settings",
        force_tailscale_fixes: checked,
        temp_unit: settings?.temp_unit ?? "celsius",
        distance_unit: settings?.distance_unit ?? "km",
        timezone: settings?.timezone ?? "UTC0",
        zonename: settings?.zonename ?? "UTC",
      });

      setForceTailscaleFixesSaving(false);

      if (success) {
        toast.success(
          checked
            ? t("system.force_tailscale_fixes_toast_enabled")
            : t("system.force_tailscale_fixes_toast_disabled"),
        );
      } else {
        setForceTailscaleFixes(!checked);
        toast.error(t("system.force_tailscale_fixes_toast_failed"));
      }
    },
    [saveSettings, settings, t],
  );

  // --- Timezone change handler ---
  const handleTimezoneChange = useCallback((selectedZonename: string) => {
    const entry = TIMEZONES.find((tz) => tz.zonename === selectedZonename);
    if (entry) {
      setZonename(entry.zonename);
      setTimezone(entry.timezone);
    }
  }, []);

  // --- Save handler (items 2-4) ---
  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const success = await saveSettings({
      action: "save_settings",
      force_tailscale_fixes: forceTailscaleFixes,
      temp_unit: tempUnit,
      distance_unit: distanceUnit,
      timezone,
      zonename,
    });

    if (success) {
      markSaved();
      toast.success(t("system.toast_saved"));
    } else {
      toast.error(error || t("system.toast_failed"));
    }
  }, [
    canSave,
    saveSettings,
    forceTailscaleFixes,
    tempUnit,
    distanceUnit,
    timezone,
    zonename,
    error,
    markSaved,
    t,
  ]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("system.card_title")}</CardTitle>
        <CardDescription>
          {t("system.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <motion.div
          className="grid gap-2"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── Force Tailscale Fixes Toggle ──────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex"
                    aria-label={t("system.force_tailscale_fixes_info_aria")}
                  >
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-balance max-w-sm">{t("system.force_tailscale_fixes_tooltip")}</p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                {t("system.force_tailscale_fixes_label")}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="force-tailscale-fixes"
                checked={forceTailscaleFixes}
                onCheckedChange={handleForceTailscaleFixesChange}
                disabled={forceTailscaleFixesSaving}
              />
              <Label htmlFor="force-tailscale-fixes">
                {forceTailscaleFixes
                  ? t("state.enabled", { ns: "common" })
                  : t("state.disabled", { ns: "common" })}
              </Label>
            </div>
          </motion.div>

          {/* ── Known SIMs (clear remembered SIM list) ────────────── */}
          <Separator />
          <KnownSimsRow />

          {/* ── Temperature Unit ──────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("system.temperature_unit_label")}
            </p>
            <Select
              value={tempUnit}
              onValueChange={(v) => setTempUnit(v as "celsius" | "fahrenheit")}
            >
              <SelectTrigger className="w-36" aria-label={t("system.temperature_unit_aria")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">{t("system.temperature_celsius")}</SelectItem>
                <SelectItem value="fahrenheit">{t("system.temperature_fahrenheit")}</SelectItem>
              </SelectContent>
            </Select>
          </motion.div>

          {/* ── Distance Unit ─────────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("system.distance_unit_label")}
            </p>
            <Select
              value={distanceUnit}
              onValueChange={(v) => setDistanceUnit(v as "km" | "miles")}
            >
              <SelectTrigger className="w-36" aria-label={t("system.distance_unit_aria")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">{t("system.distance_km")}</SelectItem>
                <SelectItem value="miles">{t("system.distance_miles")}</SelectItem>
              </SelectContent>
            </Select>
          </motion.div>

          {/* ── Timezone ──────────────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("system.timezone_label")}
            </p>
            <Popover open={tzOpen} onOpenChange={setTzOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={tzOpen}
                  className="w-52 @sm/card:w-64 justify-between font-normal"
                >
                  <span className="truncate">
                    {TIMEZONES.find((tz) => tz.zonename === zonename)?.label ??
                      t("system.timezone_placeholder")}
                  </span>
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <Command>
                  <CommandInput placeholder={t("system.timezone_search_placeholder")} />
                  <CommandList>
                    <CommandEmpty>{t("system.timezone_not_found")}</CommandEmpty>
                    <CommandGroup>
                      {TIMEZONES.map((tz) => (
                        <CommandItem
                          key={tz.zonename}
                          value={tz.label}
                          onSelect={() => {
                            handleTimezoneChange(tz.zonename);
                            setTzOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              zonename === tz.zonename
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {tz.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </motion.div>

          {/* ── SSH Password (disclosed form) ─────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants}>
            <Collapsible open={sshOpen} onOpenChange={setSshOpen}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex"
                        aria-label={t("ssh_password.enforce_strong_info_aria")}
                      >
                        <TbInfoCircleFilled className="size-5 text-info" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-balance max-w-sm">
                        {t("ssh_password.card_description")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <p className="font-semibold text-muted-foreground text-sm">
                    {t("ssh_password.card_title")}
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="group gap-1.5">
                    {t("ssh_password.button_change")}
                    <ChevronDownIcon className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="pt-4">
                <SshPasswordSection />
              </CollapsibleContent>
            </Collapsible>
          </motion.div>

          {/* ── Save Button ───────────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex justify-end">
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

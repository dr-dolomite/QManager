"use client";

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/components/ui/field";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import type { SimProfile, CurrentModemSettings } from "@/types/sim-profile";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import {
  type PdpType,
} from "@/types/sim-profile";
import {
  MNO_PRESETS,
  MNO_CUSTOM_ID,
  getMnoPreset,
} from "@/constants/mno-presets";

// =============================================================================
// CustomProfileFormComponent — Create / Edit SIM Profile Form
// =============================================================================

interface CustomProfileFormProps {
  editingProfile?: SimProfile | null;
  onSave: (data: ProfileFormData) => Promise<string | null>;
  onCancel?: () => void;
  /** Current modem settings for pre-fill (from useCurrentSettings) */
  currentSettings?: CurrentModemSettings | null;
  /** Callback to trigger loading current modem settings */
  onLoadCurrentSettings?: () => void;
}

const DEFAULT_FORM_STATE: ProfileFormData = {
  name: "",
  mno: "Custom",
  sim_iccid: "",
  cid: 1,
  apn_name: "",
  pdp_type: "IPV4V6",
  imei: "",
  ttl: 64,
  hl: 64,
};

function profileToFormData(profile: SimProfile): ProfileFormData {
  const s = profile.settings;
  return {
    name: profile.name,
    mno: profile.mno,
    sim_iccid: profile.sim_iccid,
    cid: profile.mno === "Verizon" ? 3 : s.apn.cid,
    apn_name: s.apn.name,
    pdp_type: s.apn.pdp_type,
    imei: s.imei,
    ttl: s.ttl,
    hl: s.hl,
  };
}

const CustomProfileFormComponent = ({
  editingProfile,
  onSave,
  onCancel,
  currentSettings,
  onLoadCurrentSettings,
}: CustomProfileFormProps) => {
  const { t } = useTranslation("cellular");

  const [form, setForm] = useState<ProfileFormData>(DEFAULT_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pending Verizon MNO id — set when user picks Verizon, cleared on confirm/cancel
  const [pendingVerizonMnoId, setPendingVerizonMnoId] = useState<string | null>(null);

  const isEditing = !!editingProfile;
  const isVerizon = form.mno === "Verizon";

  const pdpTypeLabels = useMemo<Record<PdpType, string>>(
    () => ({
      IP: t("custom_profiles.form.fields.ip_protocol_ipv4"),
      IPV6: t("custom_profiles.form.fields.ip_protocol_ipv6"),
      IPV4V6: t("custom_profiles.form.fields.ip_protocol_dual"),
    }),
    [t],
  );

  // Derive MNO selection from form.mno — no separate state needed
  const selectedMno = useMemo(() => {
    const match = MNO_PRESETS.find((p) => p.label === form.mno);
    return match ? match.id : MNO_CUSTOM_ID;
  }, [form.mno]);

  // Reset form when the editing target changes (React-recommended pattern:
  // compare previous prop during render instead of syncing via useEffect)
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null);
  const currentEditingId = editingProfile?.id ?? null;

  if (currentEditingId !== prevEditingId) {
    setPrevEditingId(currentEditingId);
    setForm(
      editingProfile ? profileToFormData(editingProfile) : DEFAULT_FORM_STATE,
    );
    setErrors({});
  }

  // Pre-fill from current modem settings when loaded (create mode only)
  // Compare during render instead of useEffect to avoid cascading setState.
  const [prevSettings, setPrevSettings] = useState<CurrentModemSettings | null>(
    null,
  );

  if (currentSettings && currentSettings !== prevSettings && !isEditing) {
    setPrevSettings(currentSettings);
    const apnPrefill =
      currentSettings.apn_profiles?.length > 0
        ? (() => {
            const activeCid = currentSettings.active_cid;
            const primary =
              currentSettings.apn_profiles.find((a) => a.cid === activeCid) ||
              currentSettings.apn_profiles[0];
            return {
              cid: primary.cid,
              apn_name: primary.apn || "",
              pdp_type: primary.pdp_type || "IPV4V6",
            };
          })()
        : {};

    setForm((prev) => ({
      ...prev,
      sim_iccid: currentSettings.iccid || prev.sim_iccid,
      imei: currentSettings.imei || prev.imei,
      ...apnPrefill,
    }));
  }

  const updateField = <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleMnoChange = (mnoId: string) => {
    if (mnoId === "vzw" && form.mno !== "Verizon") {
      // Gate: show warning dialog before applying Verizon preset
      setPendingVerizonMnoId(mnoId);
      return;
    }

    const preset = getMnoPreset(mnoId);
    if (preset) {
      setForm((prev) => ({
        ...prev,
        mno: preset.label,
        apn_name: preset.apn_name,
        ttl: preset.ttl,
        hl: preset.hl,
      }));
    } else {
      // Switching away from Verizon resets CID to default
      setForm((prev) => ({
        ...prev,
        mno: "Custom",
        cid: prev.mno === "Verizon" ? 1 : prev.cid,
      }));
    }
  };

  const handleVerizonConfirm = () => {
    if (!pendingVerizonMnoId) return;
    const preset = getMnoPreset(pendingVerizonMnoId);
    if (preset) {
      setForm((prev) => ({
        ...prev,
        mno: preset.label,
        apn_name: preset.apn_name,
        ttl: preset.ttl,
        hl: preset.hl,
        cid: 3,
      }));
    }
    setPendingVerizonMnoId(null);
  };

  const handleVerizonCancel = () => {
    setPendingVerizonMnoId(null);
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = t("custom_profiles.form.fields.profile_name_required");
    }

    if (form.cid < 1 || form.cid > 15) {
      newErrors.cid = t("custom_profiles.form.fields.cid_error");
    }

    if (form.imei && !/^\d{15}$/.test(form.imei)) {
      newErrors.imei = t("custom_profiles.form.fields.imei_error");
    }

    if (form.ttl < 0 || form.ttl > 255) {
      newErrors.ttl = t("custom_profiles.form.fields.ttl_error");
    }

    if (form.hl < 0 || form.hl > 255) {
      newErrors.hl = t("custom_profiles.form.fields.hl_error");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSaving(true);
    const result = await onSave(form);
    setIsSaving(false);

    if (result) {
      toast.success(
        isEditing
          ? t("custom_profiles.form.toast.update_success")
          : t("custom_profiles.form.toast.create_success"),
      );
      if (!isEditing) {
        setForm(DEFAULT_FORM_STATE);
      }
    } else {
      toast.error(
        isEditing
          ? t("custom_profiles.form.toast.update_error")
          : t("custom_profiles.form.toast.create_error"),
      );
    }
  };

  const handleReset = () => {
    if (isEditing && onCancel) {
      onCancel();
    } else {
      setForm(DEFAULT_FORM_STATE);
      setErrors({});
    }
  };

  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>
            {isEditing
              ? t("custom_profiles.form.edit_title")
              : t("custom_profiles.form.create_title")}
          </CardTitle>
          <CardDescription>
            {isEditing
              ? t("custom_profiles.form.edit_description", {
                  name: editingProfile?.name ?? "",
                })
              : t("custom_profiles.form.create_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex w-full justify-end">
            {!isEditing && onLoadCurrentSettings && (
              <Button type="button" size="sm" onClick={onLoadCurrentSettings}>
                <DownloadIcon className="size-4" />
                {t("custom_profiles.form.load_current_button")}
              </Button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="grid gap-4">
            <FieldSet>
              <FieldGroup>
                {/* --- Profile Identity --- */}
                <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="profileName">
                      {t("custom_profiles.form.fields.profile_name_label")} *
                    </FieldLabel>
                    <Input
                      id="profileName"
                      type="text"
                      placeholder={t(
                        "custom_profiles.form.fields.profile_name_placeholder",
                      )}
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      aria-describedby={
                        errors.name ? "profileName-error" : undefined
                      }
                    />
                    {errors.name && (
                      <FieldError id="profileName-error">{errors.name}</FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="simIccid">
                      {t("custom_profiles.form.fields.sim_iccid_label")}
                    </FieldLabel>
                    <Input
                      id="simIccid"
                      type="text"
                      placeholder={t(
                        "custom_profiles.form.fields.sim_iccid_placeholder",
                      )}
                      value={form.sim_iccid}
                      onChange={(e) => updateField("sim_iccid", e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>
                      {t("custom_profiles.form.fields.mno_label")}
                    </FieldLabel>
                    <Select value={selectedMno} onValueChange={handleMnoChange}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "custom_profiles.form.fields.mno_placeholder",
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {MNO_PRESETS.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={MNO_CUSTOM_ID}>
                          {t("custom_profiles.form.fields.mno_custom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="apnName">
                      {t("custom_profiles.form.fields.apn_name_label")}
                    </FieldLabel>
                    <Input
                      id="apnName"
                      type="text"
                      placeholder={t(
                        "custom_profiles.form.fields.apn_name_placeholder",
                      )}
                      value={form.apn_name}
                      onChange={(e) => updateField("apn_name", e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>
                      {t("custom_profiles.form.fields.ip_protocol_label")}
                    </FieldLabel>
                    <Select
                      value={form.pdp_type}
                      onValueChange={(v) => updateField("pdp_type", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.entries(pdpTypeLabels) as [PdpType, string][]
                        ).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="apnCid">
                      {t("custom_profiles.form.fields.cid_label")}
                    </FieldLabel>
                    <Input
                      id="apnCid"
                      type="number"
                      min={1}
                      max={15}
                      disabled={isVerizon}
                      value={form.cid}
                      onChange={(e) => updateField("cid", parseInt(e.target.value) || 1)}
                      aria-describedby={
                        isVerizon
                          ? "apnCid-verizon-hint"
                          : errors.cid
                            ? "apnCid-error"
                            : undefined
                      }
                    />
                    {isVerizon && (
                      <p id="apnCid-verizon-hint" className="text-xs text-muted-foreground mt-1">
                        {t("custom_profiles.form.fields.cid_locked_verizon")}
                      </p>
                    )}
                    {!isVerizon && errors.cid && (
                      <FieldError id="apnCid-error">{errors.cid}</FieldError>
                    )}
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="imei">
                    {t("custom_profiles.form.fields.imei_label")}
                  </FieldLabel>
                  <Input
                    id="imei"
                    type="text"
                    placeholder={t(
                      "custom_profiles.form.fields.imei_placeholder",
                    )}
                    maxLength={15}
                    value={form.imei}
                    onChange={(e) => updateField("imei", e.target.value)}
                    aria-describedby={errors.imei ? "imei-error" : undefined}
                  />
                  {errors.imei && (
                    <FieldError id="imei-error">{errors.imei}</FieldError>
                  )}
                </Field>

                <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="ttl">
                      {t("custom_profiles.form.fields.ttl_label")}
                    </FieldLabel>
                    <Input
                      id="ttl"
                      type="number"
                      min={0}
                      max={255}
                      value={form.ttl}
                      onChange={(e) =>
                        updateField("ttl", parseInt(e.target.value) || 0)
                      }
                      aria-describedby={errors.ttl ? "ttl-error" : undefined}
                    />
                    {errors.ttl && (
                      <FieldError id="ttl-error">{errors.ttl}</FieldError>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="hl">
                      {t("custom_profiles.form.fields.hl_label")}
                    </FieldLabel>
                    <Input
                      id="hl"
                      type="number"
                      min={0}
                      max={255}
                      value={form.hl}
                      onChange={(e) =>
                        updateField("hl", parseInt(e.target.value) || 0)
                      }
                      aria-describedby={errors.hl ? "hl-error" : undefined}
                    />
                    {errors.hl && (
                      <FieldError id="hl-error">{errors.hl}</FieldError>
                    )}
                  </Field>
                </div>

                {/* --- Actions --- */}
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Spinner className="size-4" />}
                    {isEditing
                      ? t("custom_profiles.form.buttons.update_submit")
                      : t("custom_profiles.form.buttons.create_submit")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleReset}
                    disabled={isSaving}
                  >
                    {isEditing
                      ? t("actions.cancel", { ns: "common" })
                      : t("custom_profiles.form.buttons.reset")}
                  </Button>
                </div>
              </FieldGroup>
            </FieldSet>
          </form>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingVerizonMnoId !== null}
        onOpenChange={(open) => { if (!open) handleVerizonCancel(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.verizon_warning.title")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{t("custom_profiles.verizon_warning.body_intro")}</p>
                <p>
                  <strong>{t("custom_profiles.verizon_warning.body_warning_lead")}</strong>{" "}
                  {t("custom_profiles.verizon_warning.body_warning_rest")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleVerizonCancel}>
              {t("custom_profiles.verizon_warning.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleVerizonConfirm}>
              {t("custom_profiles.verizon_warning.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default CustomProfileFormComponent;

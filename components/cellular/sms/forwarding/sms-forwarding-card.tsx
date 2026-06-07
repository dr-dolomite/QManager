"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { AlertCircle, RefreshCcwIcon } from "lucide-react";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion";
import {
  type SmsForwardingData,
  type UseSmsForwardingReturn,
} from "@/hooks/use-sms-forwarding";

// =============================================================================
// SmsForwardingCard — the control surface for the daemon-backed SMS relay.
// Setup only: enable toggle + destination number + save. Live status, the
// recipient preview, the test action, and delivery failures all live in the
// companion DeliveryHealthCard, which shares this card's lifted hook.
// =============================================================================

// E.164-ish: optional leading +, first digit 1-9, total 7-15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

const SmsForwardingCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isSaving, isSendingTest, error, saveSettings, refresh } =
    fwd;

  const { saved, markSaved } = useSaveFlash();
  const [prevData, setPrevData] = useState<SmsForwardingData | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [targetPhone, setTargetPhone] = useState("");

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setIsEnabled(data.settings.enabled);
    setTargetPhone(data.settings.target_phone);
  }

  // Only validate while enabling — turning forwarding off must never be blocked
  // by a stale/invalid number left in the field.
  const phoneError =
    isEnabled && targetPhone && !PHONE_REGEX.test(targetPhone)
      ? t("sms.forwarding.sms.validation_phone")
      : null;

  const isDirty = data
    ? isEnabled !== data.settings.enabled ||
      targetPhone !== data.settings.target_phone
    : false;

  const canSave = !phoneError && isDirty && !isSaving && !isSendingTest;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const success = await saveSettings({
      enabled: isEnabled,
      target_phone: targetPhone,
    });
    if (success) {
      markSaved();
      toast.success(t("sms.forwarding.sms.toast_save_success"));
    } else {
      toast.error(error || t("sms.forwarding.sms.toast_save_error"));
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  // Mirrors the real form geometry (toggle row → labeled input → button) so the
  // card holds its height and nothing snaps when data lands.
  if (isLoading) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.sms.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {/* Enable toggle row */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            {/* Target field: label + input + helper */}
            <div className="grid gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full max-w-sm" />
              <Skeleton className="h-3 w-48" />
            </div>
            {/* Save */}
            <Skeleton className="h-9 w-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Initial fetch error ---------------------------------------------------
  if (!isLoading && error && !data) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.sms.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t("sms.forwarding.sms.error_load")}</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => refresh()}
              >
                <RefreshCcwIcon className="size-3.5" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
        <CardDescription>
          {t("sms.forwarding.sms.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.form
          className="grid gap-4"
          onSubmit={handleSave}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.slow, ease: EASE_OUT_EXPO }}
        >
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="sms-forwarding-enabled">
                  {t("sms.forwarding.sms.enable_label")}
                </FieldLabel>
                <Switch
                  id="sms-forwarding-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </Field>

              {/* Target phone */}
              <Field>
                <FieldLabel htmlFor="sms-forwarding-target">
                  {t("sms.forwarding.sms.target_label")}
                </FieldLabel>
                <Input
                  id="sms-forwarding-target"
                  type="tel"
                  inputMode="tel"
                  placeholder={t("sms.forwarding.sms.target_placeholder")}
                  className="max-w-sm font-mono"
                  value={targetPhone}
                  onChange={(e) => setTargetPhone(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError
                      ? "sms-forwarding-target-error"
                      : "sms-forwarding-target-desc"
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="sms-forwarding-target-error">
                    {phoneError}
                  </FieldError>
                ) : (
                  <FieldDescription id="sms-forwarding-target-desc">
                    {t("sms.forwarding.sms.target_description")}
                  </FieldDescription>
                )}
              </Field>

              {/* Save */}
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                disabled={!canSave}
                className="w-fit"
              />
            </FieldGroup>
          </FieldSet>
        </motion.form>
      </CardContent>
    </Card>
  );
};

export default SmsForwardingCard;

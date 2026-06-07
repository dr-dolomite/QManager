"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";

import {
  Card,
  CardAction,
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  AlertCircle,
  CheckCircle2Icon,
  Loader2,
  MinusCircleIcon,
  RefreshCcwIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { EASE_OUT_QUART } from "@/lib/motion";
import {
  useSmsForwarding,
  type SmsForwardingData,
} from "@/hooks/use-sms-forwarding";

// =============================================================================
// SmsForwardingCard — app-level SMS relay (daemon-backed)
// =============================================================================

// E.164-ish: optional leading +, first digit 1-9, total 7-15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

function StatusBadge({ data }: { data: SmsForwardingData }) {
  const { t } = useTranslation("cellular");
  if (!data.settings.enabled) {
    return (
      <Badge
        variant="outline"
        className="border-muted-foreground/30 bg-muted/50 text-muted-foreground"
      >
        <MinusCircleIcon className="size-3" />
        {t("sms.forwarding.sms.status_off")}
      </Badge>
    );
  }
  if (data.failure_count > 0) {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 bg-warning/15 text-warning"
      >
        <TriangleAlertIcon className="size-3" />
        {t("sms.forwarding.sms.status_issue")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-success/30 bg-success/15 text-success"
    >
      <CheckCircle2Icon className="size-3" />
      {t("sms.forwarding.sms.status_on")}
    </Badge>
  );
}

const SmsForwardingCard = () => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSaving,
    isSendingTest,
    isClearing,
    error,
    saveSettings,
    sendTest,
    clearFailures,
    refresh,
  } = useSmsForwarding();

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

  const phoneError =
    targetPhone && !PHONE_REGEX.test(targetPhone)
      ? t("sms.forwarding.sms.validation_phone")
      : null;

  const isDirty = data
    ? isEnabled !== data.settings.enabled ||
      targetPhone !== data.settings.target_phone
    : false;

  const canSave = !phoneError && isDirty && !isSaving && !isSendingTest;

  // Test only makes sense against a saved, valid, enabled target.
  const canSendTest =
    !!data?.settings.enabled &&
    !!data?.settings.target_phone &&
    !isDirty &&
    !isSaving &&
    !isSendingTest;

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

  const handleSendTest = async () => {
    const success = await sendTest();
    if (success) {
      toast.success(t("sms.forwarding.sms.toast_test_success"));
    } else {
      toast.error(error || t("sms.forwarding.sms.toast_test_error"));
    }
  };

  const handleClear = async () => {
    const success = await clearFailures();
    if (success) {
      toast.success(t("sms.forwarding.sms.toast_clear_success"));
    } else {
      toast.error(error || t("sms.forwarding.sms.toast_clear_error"));
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.sms.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Initial fetch error ---------------------------------------------------
  if (!isLoading && error && !data) {
    return (
      <Card className="@container/card">
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

  const failures = data?.failures ?? [];

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
        <CardDescription>
          {t("sms.forwarding.sms.card_description")}
        </CardDescription>
        {data && (
          <CardAction>
            <StatusBadge data={data} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
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

              {/* Actions */}
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <SaveButton
                    type="submit"
                    isSaving={isSaving}
                    saved={saved}
                    disabled={!canSave}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={!canSendTest}
                    onClick={handleSendTest}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t("sms.forwarding.sms.test_sending")}
                      </>
                    ) : (
                      <>
                        <SendIcon className="size-4" />
                        {t("sms.forwarding.sms.test_button")}
                      </>
                    )}
                  </Button>
                </div>
                {isDirty && isEnabled && (
                  <p className="text-xs text-muted-foreground">
                    {t("sms.forwarding.sms.save_before_test_hint")}
                  </p>
                )}
              </div>
            </FieldGroup>
          </FieldSet>

          {/* Persistent failure alert */}
          <AnimatePresence initial={false}>
            {failures.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
                style={{ overflow: "hidden" }}
              >
                <Alert variant="destructive">
                  <TriangleAlertIcon className="size-4" />
                  <AlertTitle>
                    {t("sms.forwarding.sms.failure_title", {
                      count: failures.length,
                    })}
                  </AlertTitle>
                  <AlertDescription className="grid gap-2">
                    <p>{t("sms.forwarding.sms.failure_description")}</p>
                    <ul className="grid gap-1 text-xs">
                      {failures.slice(0, 5).map((f, i) => (
                        <li
                          key={`${f.sender}-${f.timestamp}-${i}`}
                          className="flex flex-wrap items-baseline gap-x-2"
                        >
                          <span className="font-mono font-medium">
                            {f.sender || t("sms.forwarding.sms.failure_unknown_sender")}
                          </span>
                          <span className="text-muted-foreground">
                            {f.timestamp}
                          </span>
                          {f.last_error && (
                            <span className="text-muted-foreground">
                              — {f.last_error}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1 w-fit"
                      disabled={isClearing}
                      onClick={handleClear}
                    >
                      {isClearing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <XIcon className="size-3.5" />
                      )}
                      {t("sms.forwarding.sms.clear_button")}
                    </Button>
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </CardContent>
    </Card>
  );
};

export default SmsForwardingCard;

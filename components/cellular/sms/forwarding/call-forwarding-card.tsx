"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
  CheckCircle2Icon,
  InfoIcon,
  MinusCircleIcon,
  PhoneForwardedIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useCallForwarding,
  type CallForwardingStatus,
} from "@/hooks/use-call-forwarding";

// =============================================================================
// CallForwardingCard — network-level unconditional forwarding (AT+CCFC)
// =============================================================================

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

function StatusBadge({ status }: { status: CallForwardingStatus }) {
  const { t } = useTranslation("cellular");
  switch (status) {
    case "active":
      return (
        <Badge
          variant="outline"
          className="border-success/30 bg-success/15 text-success"
        >
          <CheckCircle2Icon className="size-3" />
          {t("sms.forwarding.call.status_on")}
        </Badge>
      );
    case "network_rejected":
      return (
        <Badge
          variant="outline"
          className="border-warning/30 bg-warning/15 text-warning"
        >
          <TriangleAlertIcon className="size-3" />
          {t("sms.forwarding.call.status_unsupported")}
        </Badge>
      );
    case "query_failed":
      return (
        <Badge
          variant="outline"
          className="border-destructive/30 bg-destructive/15 text-destructive"
        >
          <XCircleIcon className="size-3" />
          {t("sms.forwarding.call.status_error")}
        </Badge>
      );
    case "inactive":
    case "unknown":
    default:
      return (
        <Badge
          variant="outline"
          className="border-muted-foreground/30 bg-muted/50 text-muted-foreground"
        >
          <MinusCircleIcon className="size-3" />
          {t("sms.forwarding.call.status_off")}
        </Badge>
      );
  }
}

const CallForwardingCard = () => {
  const { t } = useTranslation("cellular");
  const {
    state,
    isLoading,
    isSaving,
    error,
    setForwarding,
    disableForwarding,
    refresh,
  } = useCallForwarding();

  const { saved, markSaved } = useSaveFlash();
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const [isOn, setIsOn] = useState(false);
  const [number, setNumber] = useState("");

  // Server intent baseline (network truth).
  const serverOn = state.status === "active";
  const serverNumber = serverOn ? state.number : "";

  // Sync server → local during render. The key folds every server field that
  // should reset the form, so a fresh query re-seeds the inputs.
  const nextKey = `${state.status}|${state.number}|${state.lastNumber}`;
  if (!isLoading && nextKey !== syncKey) {
    setSyncKey(nextKey);
    setIsOn(serverOn);
    // Prefill: active number when on, else the remembered last number.
    setNumber(serverOn ? state.number : state.lastNumber);
  }

  const phoneError =
    isOn && number && !PHONE_REGEX.test(number)
      ? t("sms.forwarding.call.validation_phone")
      : null;

  const isDirty = isOn !== serverOn || (isOn && number !== serverNumber);
  const canSave =
    isDirty &&
    !phoneError &&
    !isSaving &&
    !isLoading &&
    (!isOn || PHONE_REGEX.test(number));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const success = isOn
      ? await setForwarding(number)
      : await disableForwarding();

    if (success) {
      markSaved();
      toast.success(
        isOn
          ? t("sms.forwarding.call.toast_set_success")
          : t("sms.forwarding.call.toast_disable_success"),
      );
    } else {
      toast.error(error || t("sms.forwarding.call.toast_error"));
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.call.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.call.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-9 w-28" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const showRejected = state.status === "network_rejected";
  const showQueryFailed = state.status === "query_failed";

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("sms.forwarding.call.card_title")}</CardTitle>
        <CardDescription>
          {t("sms.forwarding.call.card_description")}
        </CardDescription>
        <CardAction>
          <StatusBadge status={state.status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          {/* Carrier blocks reading state — honest, non-blocking explanation. */}
          {showRejected && (
            <Alert>
              <InfoIcon className="size-4" />
              <AlertTitle>
                {t("sms.forwarding.call.rejected_title")}
              </AlertTitle>
              <AlertDescription>
                {t("sms.forwarding.call.rejected_description")}
              </AlertDescription>
            </Alert>
          )}

          {/* Query failed — offer a retry. */}
          {showQueryFailed && (
            <Alert variant="destructive">
              <XCircleIcon className="size-4" />
              <AlertTitle>{t("sms.forwarding.call.error_title")}</AlertTitle>
              <AlertDescription>
                <p>{error || t("sms.forwarding.call.error_description")}</p>
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
          )}

          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="call-forwarding-enabled">
                  {t("sms.forwarding.call.enable_label")}
                </FieldLabel>
                <Switch
                  id="call-forwarding-enabled"
                  checked={isOn}
                  onCheckedChange={setIsOn}
                />
              </Field>

              {/* Destination number */}
              <Field>
                <FieldLabel htmlFor="call-forwarding-number">
                  {t("sms.forwarding.call.number_label")}
                </FieldLabel>
                <Input
                  id="call-forwarding-number"
                  type="tel"
                  inputMode="tel"
                  placeholder={t("sms.forwarding.call.number_placeholder")}
                  className="max-w-sm font-mono"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  disabled={!isOn}
                  required={isOn}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError
                      ? "call-forwarding-number-error"
                      : "call-forwarding-number-desc"
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="call-forwarding-number-error">
                    {phoneError}
                  </FieldError>
                ) : (
                  <FieldDescription id="call-forwarding-number-desc">
                    {t("sms.forwarding.call.number_description")}
                  </FieldDescription>
                )}
              </Field>

              {/* Live network readout */}
              {state.status === "active" && state.number && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <PhoneForwardedIcon className="size-3.5 text-success" />
                  <span>
                    {t("sms.forwarding.call.live_readout")}{" "}
                    <span className="font-mono text-foreground">
                      {state.number}
                    </span>
                  </span>
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <SaveButton
                  type="submit"
                  isSaving={isSaving}
                  saved={saved}
                  disabled={!canSave}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="w-fit"
                  disabled={isSaving}
                  onClick={() => refresh()}
                >
                  <RefreshCcwIcon className="size-4" />
                  {t("sms.forwarding.call.refresh_button")}
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default CallForwardingCard;

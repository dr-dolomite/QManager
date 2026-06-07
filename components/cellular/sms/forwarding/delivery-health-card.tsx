"use client";

import React from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2Icon,
  Loader2,
  MinusCircleIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { EASE_OUT_QUART } from "@/lib/motion";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";

// =============================================================================
// DeliveryHealthCard — the status companion to SmsForwardingCard. Reports the
// live relay state, a preview of what the recipient receives, the test action
// (verifies the SAVED path — the CGI reads the target from UCI), and the
// daemon's delivery-failure history. Shares the lifted useSmsForwarding hook.
// =============================================================================

// The preview teaches the relay FORMAT, so the "From" sender is a sample
// inbound number — not the saved target, who is the one RECEIVING this bubble.
const SAMPLE_SENDER = "+15550142";

type Health = "active" | "issue" | "off" | "unconfigured";

type Tone = "success" | "warning" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/30 bg-success/15 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning",
  muted: "border-muted-foreground/30 bg-muted/50 text-muted-foreground",
};

const ICON_WRAP_CLASS: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  muted: "bg-muted text-muted-foreground",
};

const DeliveryHealthCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isSendingTest, isClearing, error, sendTest, clearFailures } =
    fwd;

  const handleSendTest = async () => {
    const success = await sendTest();
    if (success) {
      toast.success(t("sms.forwarding.health.toast_test_success"));
    } else {
      toast.error(error || t("sms.forwarding.health.toast_test_error"));
    }
  };

  const handleClear = async () => {
    const success = await clearFailures();
    if (success) {
      toast.success(t("sms.forwarding.health.toast_clear_success"));
    } else {
      toast.error(error || t("sms.forwarding.health.toast_clear_error"));
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading || !data) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.health.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.health.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-9 w-28" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const { enabled, target_phone } = data.settings;
  const failures = data.failures ?? [];
  const failureCount = data.failure_count ?? failures.length;

  // Single state machine drives the badge, the focal row, and the destination.
  const health: Health = !enabled
    ? "off"
    : !target_phone
      ? "unconfigured"
      : failureCount > 0
        ? "issue"
        : "active";

  const STATE: Record<
    Health,
    { tone: Tone; Icon: typeof CheckCircle2Icon; label: string }
  > = {
    active: {
      tone: "success",
      Icon: CheckCircle2Icon,
      label: t("sms.forwarding.health.state_active"),
    },
    issue: {
      tone: "warning",
      Icon: TriangleAlertIcon,
      label: t("sms.forwarding.health.state_issue"),
    },
    unconfigured: {
      tone: "warning",
      Icon: TriangleAlertIcon,
      label: t("sms.forwarding.health.state_unconfigured"),
    },
    off: {
      tone: "muted",
      Icon: MinusCircleIcon,
      label: t("sms.forwarding.health.state_off"),
    },
  };

  const state = STATE[health];
  const { Icon } = state;
  const canSendTest = enabled && !!target_phone && !isSendingTest;

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("sms.forwarding.health.card_title")}</CardTitle>
        <CardDescription>
          {t("sms.forwarding.health.card_description")}
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={TONE_CLASS[state.tone]}>
            <Icon className="size-3" />
            {state.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Focal state + destination */}
        <div className="flex items-start gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${ICON_WRAP_CLASS[state.tone]}`}
          >
            <Icon className="size-5" />
          </span>
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold leading-tight">{state.label}</p>
            {target_phone ? (
              <p className="text-sm text-muted-foreground">
                {t("sms.forwarding.health.destination_label")}{" "}
                <span className="font-mono text-foreground tabular-nums">
                  {target_phone}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("sms.forwarding.health.destination_none")}
              </p>
            )}
          </div>
        </div>

        {/* Recipient preview */}
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("sms.forwarding.health.preview_label")}
          </p>
          <div className="rounded-lg border bg-muted/40 px-3 py-2">
            <p className="text-sm leading-snug">
              <span className="font-mono text-muted-foreground">
                From {SAMPLE_SENDER}:
              </span>{" "}
              <span className="text-foreground">
                {t("sms.forwarding.health.preview_sample_body")}
              </span>
            </p>
          </div>
        </div>

        {/* Test the saved relay path */}
        <div className="grid gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="w-fit"
            disabled={!canSendTest}
            onClick={handleSendTest}
          >
            {isSendingTest ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("sms.forwarding.health.test_sending")}
              </>
            ) : (
              <>
                <SendIcon className="size-4" />
                {t("sms.forwarding.health.test_button")}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {canSendTest
              ? t("sms.forwarding.health.test_hint")
              : t("sms.forwarding.health.test_disabled_hint")}
          </p>
        </div>

        {/* Delivery failures */}
        <AnimatePresence initial={false} mode="wait">
          {failures.length > 0 ? (
            <motion.div
              key="failures"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
              style={{ overflow: "hidden" }}
            >
              <Alert variant="destructive">
                <TriangleAlertIcon className="size-4" />
                <AlertTitle>
                  {t("sms.forwarding.health.failures_title", {
                    count: failures.length,
                  })}
                </AlertTitle>
                <AlertDescription className="grid gap-2">
                  <p>{t("sms.forwarding.health.failures_description")}</p>
                  <ul className="grid gap-1 text-xs">
                    {failures.slice(0, 5).map((f, i) => (
                      <li
                        key={`${f.sender}-${f.timestamp}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-mono font-medium">
                          {f.sender ||
                            t("sms.forwarding.health.failures_unknown_sender")}
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
                    {t("sms.forwarding.health.clear_button")}
                  </Button>
                </AlertDescription>
              </Alert>
            </motion.div>
          ) : (
            <motion.p
              key="no-failures"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE_OUT_QUART }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <CheckCircle2Icon className="size-3.5 text-success" />
              {t("sms.forwarding.health.failures_empty")}
            </motion.p>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};

export default DeliveryHealthCard;

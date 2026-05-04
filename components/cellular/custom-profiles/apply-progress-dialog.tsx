"use client";

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TbCircleCheck,
  TbCircleX,
  TbLoader2,
  TbClock,
  TbCircleMinus,
} from "react-icons/tb";

import type {
  ProfileApplyState,
  ApplyStep,
  ApplyStepStatus,
} from "@/types/sim-profile";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// ApplyProgressDialog — Shows step-by-step profile application progress
// =============================================================================

interface ApplyProgressDialogProps {
  open: boolean;
  onClose: () => void;
  applyState: ProfileApplyState | null;
  error: string | null;
}

/** Default steps shown while waiting for the first poll response */
const DEFAULT_STEPS: ApplyStep[] = [
  { name: "apn", status: "pending", detail: "" },
  { name: "ttl_hl", status: "pending", detail: "" },
  { name: "imei", status: "pending", detail: "" },
  { name: "mpdn_rule", status: "pending", detail: "" },
];

const stepIcons: Record<ApplyStepStatus, React.ReactNode> = {
  pending: <TbClock className="size-4 text-muted-foreground" />,
  running: <TbLoader2 className="size-4 text-info animate-spin" />,
  done: <TbCircleCheck className="size-4 text-success" />,
  failed: <TbCircleX className="size-4 text-destructive" />,
  skipped: <TbCircleMinus className="size-4 text-muted-foreground" />,
};

/** When the overall apply is complete, "skipped" means "already correct" — show a check */
const getStepIcon = (stepStatus: ApplyStepStatus, overallStatus?: string) => {
  if (stepStatus === "skipped" && overallStatus === "complete") {
    return <TbCircleCheck className="size-4 text-success" />;
  }
  return stepIcons[stepStatus];
};


export function ApplyProgressDialog({
  open,
  onClose,
  applyState,
  error,
}: ApplyProgressDialogProps) {
  const { t } = useTranslation("cellular");

  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      apn: t("custom_profiles.apply_dialog.step_labels.apn"),
      ttl_hl: t("custom_profiles.apply_dialog.step_labels.ttl_hl"),
      imei: t("custom_profiles.apply_dialog.step_labels.imei"),
      mpdn_rule: t("custom_profiles.apply_dialog.step_labels.mpdn_rule"),
    }),
    [t]
  );

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "applying":
        return (
          <Badge className="bg-info/10 text-info border-info/20">
            {t("state.applying", { ns: "common" })}
          </Badge>
        );
      case "complete":
        return (
          <Badge className="bg-success/10 text-success border-success/20">
            {t("custom_profiles.apply_dialog.status_badge.complete")}
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-warning/10 text-warning border-warning/20">
            {t("custom_profiles.apply_dialog.status_badge.partial")}
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
            {t("custom_profiles.apply_dialog.status_badge.failed")}
          </Badge>
        );
      default:
        return null;
    }
  };

  const isTerminal =
    applyState &&
    ["complete", "partial", "failed"].includes(applyState.status);

  // Use live steps from backend, or show default pending steps while waiting
  const steps = applyState?.steps ?? (open ? DEFAULT_STEPS : []);

  // Resolve display status — when the dialog first opens with no applyState
  // yet, show "Applying…" badge so the user sees immediate feedback.
  const displayStatus = applyState?.status ?? (open ? "applying" : undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isTerminal && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("custom_profiles.apply_dialog.title")}
            {displayStatus && renderStatusBadge(displayStatus)}
          </DialogTitle>
          {applyState?.profile_name && (
            <DialogDescription>
              {applyState.profile_name}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step list — always visible when dialog is open */}
        {steps.length > 0 && (
          <div className="space-y-1 py-2">
            {steps.map((step) => (
              <div
                key={step.name}
                className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  step.status === "running"
                    ? "bg-info/5"
                    : ""
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {getStepIcon(step.status, applyState?.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {stepLabels[step.name] ?? step.name}
                  </div>
                  {step.detail && (
                    <div className="text-muted-foreground text-xs truncate">
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reboot notice */}
        {applyState?.requires_reboot && (
          <div className="rounded-md bg-info/10 p-3 text-sm text-info">
            {t("custom_profiles.apply_dialog.reboot_notice")}
          </div>
        )}

        {/* Error from the start request (not step-level) */}
        {error && !applyState && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Partial/failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <div className="rounded-md bg-warning/10 p-3 text-sm text-warning">
            {resolveErrorMessage(t, applyState.error, undefined, applyState.error)}
          </div>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {resolveErrorMessage(t, applyState.error, undefined, applyState.error)}
          </div>
        )}

        {/* Close button (only on terminal states) */}
        {(isTerminal || (error && !applyState)) && (
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              {t("actions.close", { ns: "common" })}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

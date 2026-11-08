"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CARD_PAD, FOOT, SKELETON } from "./shapes";
import {
  FIELD_LABEL_KEY,
  type WatchdogForm,
  type WatchdogScope,
} from "./use-watchdog-form";

/** A real list for the active locale: separator and conjunction are language facts. */
function formatList(items: string[], language: string): string {
  if (items.length === 0) return "";
  try {
    return new Intl.ListFormat(language, {
      style: "long",
      type: "conjunction",
    }).format(items);
  } catch {
    return items.join(", ");
  }
}

/**
 * One card's commit, on that card's bottom edge. The Ladder's save carries the
 * reboot-authority confirm; Detection's never can. `note` is the consequence of
 * the pending edit (what the daemon will actually do), shown while it is dirty.
 */
export function WatchdogFoot({
  form,
  scope,
  note,
}: {
  form: WatchdogForm;
  scope: WatchdogScope;
  note?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation("monitoring");
  const state = form.scopes[scope];
  const blocked = state.dirty && state.blockedFields.length > 0;
  const nameList = formatList(
    state.blockedFields.map((key) => t(FIELD_LABEL_KEY[key])),
    i18n.language,
  );
  const blockedText = t("watchdog.save.blockedIn", { fields: nameList });
  const saveLabel = t(scope === "ladder" ? "watchdog.save.ladder" : "watchdog.save.detection");

  const [confirmReboot, setConfirmReboot] = React.useState(false);
  const saveWrapRef = React.useRef<HTMLSpanElement | null>(null);

  // The gate is the save, not the tier-4 control: a stock device seeds tier 4
  // armed under a master that is off.
  const handleSave = () => {
    if (scope === "ladder" && form.grantsRebootAuthority) {
      setConfirmReboot(true);
      return;
    }
    void state.submit();
  };

  // `SaveButton` stops the event while `blockedReason` is set, so the jump to
  // the offending field runs in the capture phase.
  const jumpToBlocked = () => {
    if (blocked) state.focusFirstBlocked();
  };

  return (
    <>
      <CardFoot
        className={CARD_PAD}
        status={
          blocked ? (
            <span className={cn(FOOT.LINE, "text-destructive-on-surface")}>
              <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
              <span className="font-medium text-pretty">{blockedText}</span>
            </span>
          ) : state.dirty && note ? (
            <span className="text-pretty tabular-nums">{note}</span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              className="text-on-surface-variant"
              onClick={state.discard}
              disabled={!state.dirty || state.isSaving}
            >
              {t("watchdog.save.discard")}
            </Button>
            <span ref={saveWrapRef} className="contents" onClickCapture={jumpToBlocked}>
              <SaveButton
                type="button"
                size="action"
                label={saveLabel}
                isSaving={state.isSaving}
                saved={state.saved}
                blockedReason={blocked ? blockedText : null}
                disabled={!state.dirty || state.busy}
                onClick={handleSave}
              />
            </span>
          </>
        }
      />

      {scope === "ladder" ? (
        // No AlertDialogTrigger renders, so focus is handed back to the Save pill.
        <AlertDialog open={confirmReboot} onOpenChange={setConfirmReboot}>
          <AlertDialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              saveWrapRef.current?.querySelector("button")?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("watchdog.save.confirmReboot.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("watchdog.save.confirmReboot.body")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {t("watchdog.save.confirmReboot.cap", {
                cap: Number(form.draft.maxReboots) || 3,
              })}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("watchdog.save.confirmReboot.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void state.submit()}>
                {t("watchdog.save.confirmReboot.action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

/** Mirrors the loaded foot: a status line, then Discard and Save pills. */
export function WatchdogFootSkeleton() {
  return (
    <CardFoot
      className={CARD_PAD}
      liveStatus={false}
      aria-hidden="true"
      status={<Skeleton className={cn(SKELETON.FOOT_STATUS, "w-32")} />}
      actions={
        <>
          <Skeleton className={cn(SKELETON.PILL, "w-20")} />
          <Skeleton className={cn(SKELETON.PILL, "w-28")} />
        </>
      }
    />
  );
}

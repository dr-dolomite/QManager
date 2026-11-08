"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestoreIcon,
  CircleAlertIcon,
  FileUpIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardFoot } from "@/components/ui/card-foot";
import { useConfigRestore } from "@/hooks/use-config-restore";
import { useModemStatus } from "@/hooks/use-modem-status";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { BACKUP_SECTIONS } from "@/lib/config-backup/sections";
import {
  clearPendingReboot,
  enterRebootFlow,
  requestRebootLater,
} from "@/lib/reboot";
import { cn } from "@/lib/utils";
import type { BackupSectionKey } from "@/types/config-backup";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DROP,
  FIELD,
  GROUP_FILL,
  NOTICE,
  PICK,
  PILL_GLYPH,
  RECEIPT,
  ROW,
  ROW_GROUP,
  STACK_ROW,
} from "../shapes";
import {
  RestorePipelineDialog,
  type PipelinePhase,
} from "./restore-pipeline-dialog";

const K = "config_backup.restore";

/** Section keys in picker order, so the receipt lists them the way the
 *  create card does rather than in whatever order the payload carries. */
const PICKER_ORDER = BACKUP_SECTIONS.map((s) => s.key);

/** "invalid_envelope: not JSON" → "invalid_envelope"; "HTTP 500" → null. */
function errorCode(message: string | null): string | null {
  if (!message) return null;
  const code = message.split(":")[0].trim();
  return /^[a-z_]+$/.test(code) ? code : null;
}

const RestoreConfigBackupCard = () => {
  const { t } = useTranslation("system-settings");
  const modem = useModemStatus();
  const currentModel = modem.data?.device.model ?? "";
  const {
    state,
    readFile,
    tryPassword,
    confirmModelWarning,
    startApply,
    cancel,
    reset,
  } = useConfigRestore(currentModel);

  const fileInput = useRef<HTMLInputElement>(null);
  const passId = useId();
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebootBusy, setRebootBusy] = useState(false);

  const ui = state.ui;
  const envelope = state.envelope;
  const progress = state.progress;

  const planned: BackupSectionKey[] = state.payload
    ? PICKER_ORDER.filter(
        (k) =>
          k in state.payload!.sections ||
          // Older backups name this section quality_thresholds; the restore
          // CGI folds it into connection_quality.
          (k === "connection_quality" && "quality_thresholds" in state.payload!.sections),
      )
    : [];

  const phase: PipelinePhase =
    ui === "success" || ui === "partial_success"
      ? "done"
      : ui === "failed"
        ? "start_failed"
        : progress
          ? "running"
          : "starting";

  // One toast at the terminal moment of a restore this session started. The
  // id is deterministic so a re-render cannot fire it twice.
  useEffect(() => {
    if (!pipelineOpen) return;
    if (ui === "success" || ui === "partial_success") {
      const id = `config-restore:${progress?.job_id ?? "run"}:${ui}`;
      const failed = progress?.summary?.failed ?? 0;
      const restored = progress?.summary?.success ?? 0;
      if (progress?.reboot_required) requestRebootLater("config_restore");
      if (failed > 0) {
        toast.error(t(`${K}.toast_partial`, { count: failed }), { id });
      } else if (progress?.status === "cancelled") {
        toast.error(t(`${K}.toast_cancelled`, { count: restored }), { id });
      } else {
        toast.success(t(`${K}.toast_success`), { id });
      }
    } else if (ui === "failed") {
      toast.error(
        resolveErrorMessage(t, errorCode(state.error), undefined, t(`${K}.toast_failed`)),
        { id: `config-restore:start:${state.error ?? ""}` },
      );
    }
  }, [pipelineOpen, ui, progress, state.error, t]);

  const openFilePicker = () => fileInput.current?.click();

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) {
      setPassphrase("");
      await readFile(f);
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase || unlocking) return;
    setUnlocking(true);
    try {
      await tryPassword(passphrase);
    } finally {
      setUnlocking(false);
    }
  };

  const handleCancel = () => {
    setPassphrase("");
    reset();
  };

  const handleRestore = () => {
    if (ui === "model_warning") confirmModelWarning();
    setPipelineOpen(true);
    void startApply();
  };

  const handlePipelineClose = () => {
    const needsReboot = progress?.reboot_required === true;
    setPipelineOpen(false);
    setPassphrase("");
    reset();
    if (needsReboot) setRebootDialogOpen(true);
  };

  const handleRebootNow = async () => {
    setRebootBusy(true);
    clearPendingReboot();
    try {
      const res = await authFetch("/cgi-bin/quecmanager/system/reboot.sh", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`reboot_failed: HTTP ${res.status}`);
      // Ends in the /reboot/ hand-off, which is its own confirmation.
      enterRebootFlow("config_restore");
    } catch {
      requestRebootLater("config_restore");
      setRebootBusy(false);
      setRebootDialogOpen(false);
      toast.error(t("config_backup.reboot_failed_toast"));
    }
  };

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept=".qmbackup,application/octet-stream"
      className="hidden"
      onChange={onFileChange}
    />
  );

  // The read failed before anything was decrypted: the card stays on the
  // picker and says why, beside the action that fixes it.
  const readFailed = ui === "failed" && !state.payload;
  const opened =
    envelope &&
    (ui === "password_required" ||
      ui === "password_incorrect" ||
      ui === "model_warning" ||
      ui === "ready" ||
      (pipelineOpen && state.payload));

  const receipt = envelope ? (
    <div className={ROW_GROUP}>
      <div className={RECEIPT.ROW}>
        <span className={RECEIPT.KEY}>{t(`${K}.receipt_model`)}</span>
        <span className={RECEIPT.VALUE}>{envelope.device.model || "—"}</span>
      </div>
      <div className={RECEIPT.ROW}>
        <span className={RECEIPT.KEY}>{t(`${K}.receipt_created`)}</span>
        <span className={RECEIPT.VALUE}>
          {new Date(envelope.created_at).toLocaleString()}
        </span>
      </div>
    </div>
  ) : null;

  const unlocked = ui === "model_warning" || ui === "ready" || pipelineOpen;

  let body: React.ReactNode;
  let foot: React.ReactNode;

  if (opened && !unlocked) {
    // ── Passphrase ──────────────────────────────────────────────────────
    body = (
      <>
        {receipt}
        <div className={ROW_GROUP}>
          <div className={STACK_ROW}>
            <div className={ROW.TEXT}>
              <label htmlFor={passId} className={ROW.LABEL}>
                {t(`${K}.passphrase_label`)}
              </label>
              <span className={ROW.CONSEQUENCE}>{t(`${K}.passphrase_consequence`)}</span>
            </div>
            <Input
              id={passId}
              type="password"
              host="container"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-invalid={ui === "password_incorrect" || undefined}
              disabled={unlocking}
              autoFocus
              className={cn(FIELD, "@2xl/card:w-full")}
            />
          </div>
        </div>
        {ui === "password_incorrect" ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.password_incorrect`)}</span>
          </div>
        ) : null}
      </>
    );
    foot = (
      <>
        <Button type="button" variant="ghost" size="action" onClick={handleCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" size="action" disabled={!passphrase || unlocking}>
          {unlocking ? (
            <Loader2Icon className={cn(PILL_GLYPH, "animate-spin")} aria-hidden="true" />
          ) : null}
          {t(`${K}.button_unlock`)}
        </Button>
      </>
    );
  } else if (opened && unlocked) {
    // ── Ready: what will be overwritten ────────────────────────────────
    body = (
      <>
        {receipt}
        {ui === "model_warning" ? (
          <div role="note" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>
              {t(`${K}.model_warning`, {
                from: envelope.device.model,
                to: currentModel || t(`${K}.model_unknown`),
              })}
            </span>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className={PICK.LABEL}>{t(`${K}.overwrite_label`)}</p>
          <ul className={cn(ROW_GROUP, GROUP_FILL)}>
            {planned.map((key) => (
              <li key={key} className={cn(PICK.ROW, "cursor-default")}>
                <span className={PICK.NAME}>{t(`config_backup.sections.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
    foot = (
      <>
        <Button
          type="button"
          variant="ghost"
          size="action"
          onClick={handleCancel}
          disabled={pipelineOpen}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button type="button" size="action" onClick={handleRestore} disabled={pipelineOpen}>
          <ArchiveRestoreIcon className={PILL_GLYPH} aria-hidden="true" />
          {t(`${K}.button_apply`)}
        </Button>
      </>
    );
  } else {
    // ── Picker (idle, reading, or a file that could not be read) ──────
    const reading = ui === "reading";
    body = (
      <>
        <div className={DROP.ROOT}>
          <span className={DROP.DISC} aria-hidden="true">
            {reading ? (
              <Loader2Icon className={cn(DROP.GLYPH, "animate-spin")} />
            ) : (
              <FileUpIcon className={DROP.GLYPH} />
            )}
          </span>
          <div className="flex flex-col gap-1">
            <p className={DROP.TITLE}>
              {t(reading ? `${K}.reading_title` : `${K}.idle_title`)}
            </p>
            <p className={DROP.BODY}>{t(`${K}.idle_description`)}</p>
          </div>
        </div>
        {readFailed ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>
              {resolveErrorMessage(
                t,
                errorCode(state.error),
                undefined,
                t(`${K}.read_failed`),
              )}
            </span>
          </div>
        ) : null}
      </>
    );
    foot = (
      <Button
        type="button"
        size="action"
        onClick={openFilePicker}
        disabled={reading}
      >
        <FileUpIcon className={PILL_GLYPH} aria-hidden="true" />
        {t(readFailed ? `${K}.button_choose_another` : `${K}.upload_button`)}
      </Button>
    );
  }

  const isPassphraseView = opened && !unlocked;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card_description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {fileInputEl}
        <form
          onSubmit={isPassphraseView ? handleUnlock : (e) => e.preventDefault()}
          className={cn(CARD_BODY, "gap-4")}
        >
          {body}
          <CardFoot className="mt-auto" actions={foot} />
        </form>
      </CardContent>

      <RestorePipelineDialog
        open={pipelineOpen}
        phase={phase}
        planned={planned}
        progress={progress}
        startError={errorCode(state.error)}
        sourceModel={envelope?.device.model ?? ""}
        onStop={() => void cancel()}
        onClose={handlePipelineClose}
      />

      <AlertDialog open={rebootDialogOpen} onOpenChange={setRebootDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.reboot_dialog_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.reboot_dialog_description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebootBusy}>
              {t(`${K}.reboot_later_button`)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRebootNow();
              }}
              disabled={rebootBusy}
            >
              {rebootBusy ? (
                <Loader2Icon className={cn(PILL_GLYPH, "animate-spin")} aria-hidden="true" />
              ) : null}
              {t("config_backup.reboot_now_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default RestoreConfigBackupCard;

"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SaveButton } from "@/components/ui/save-button";
import { TbInfoCircleFilled } from "react-icons/tb";

import { useSshPassword } from "@/hooks/use-ssh-password";
import { useTranslation } from "react-i18next";

// =============================================================================
// SshPasswordSection — the SSH root-password change form, without Card chrome.
// =============================================================================
// Lives inside the System Settings card (disclosed under the Timezone row), so
// it renders only the form body. The mutation posts to its own CGI
// (`ssh_password.sh`) via useSshPassword and is intentionally independent of the
// host card's "Save Settings" button, which writes units/timezone via a
// different endpoint. That is why this section carries its own action button.
// =============================================================================

function meetsPolicy(password: string, enforceStrong: boolean): boolean {
  if (password.length < 5) return false;
  if (!enforceStrong) return true;
  return /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}

export default function SshPasswordSection() {
  const { t } = useTranslation("system-settings");
  const { changePassword, isPending, error, clearError } = useSshPassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [enforceStrong, setEnforceStrong] = useState(true);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const policyHint = enforceStrong
    ? t("ssh_password.strong_policy_hint")
    : t("ssh_password.weak_policy_hint");

  const policyOk = useMemo(
    () => meetsPolicy(next, enforceStrong),
    [next, enforceStrong]
  );
  const confirmMatches = next.length > 0 && next === confirm;
  const canSubmit =
    !isPending &&
    current.length > 0 &&
    next.length > 0 &&
    confirm.length > 0 &&
    policyOk &&
    confirmMatches;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const ok = await changePassword(current, next, enforceStrong);
    if (ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("ssh_password.toast_success"));
    }
  }, [canSubmit, changePassword, current, next, enforceStrong, t]);

  const onAnyInputChange = useCallback(() => {
    if (error) clearError();
  }, [error, clearError]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="ssh-current">{t("ssh_password.current_label")}</Label>
        <div className="relative">
          <Input
            id="ssh-current"
            type={showCurrent ? "text" : "password"}
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              onAnyInputChange();
            }}
            disabled={isPending}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowCurrent((v) => !v)}
            tabIndex={-1}
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ssh-new">{t("ssh_password.new_label")}</Label>
        <div className="relative">
          <Input
            id="ssh-new"
            type={showNext ? "text" : "password"}
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              onAnyInputChange();
            }}
            disabled={isPending}
            aria-describedby="ssh-new-hint"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowNext((v) => !v)}
            tabIndex={-1}
            aria-label={showNext ? "Hide password" : "Show password"}
          >
            {showNext ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
        </div>
        {next.length > 0 && !policyOk && (
          <p id="ssh-new-hint" className="text-xs text-destructive">
            {policyHint}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ssh-confirm">{t("ssh_password.confirm_label")}</Label>
        <div className="relative">
          <Input
            id="ssh-confirm"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              onAnyInputChange();
            }}
            disabled={isPending}
            aria-describedby="ssh-confirm-hint"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowConfirm((v) => !v)}
            tabIndex={-1}
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            {showConfirm ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
        </div>
        {confirm.length > 0 && !confirmMatches && (
          <p id="ssh-confirm-hint" className="text-xs text-destructive">
            {t("ssh_password.error_mismatch")}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
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
              <p>{t("ssh_password.strong_policy_hint")}</p>
            </TooltipContent>
          </Tooltip>
          <span className="font-semibold text-muted-foreground text-sm">
            {t("ssh_password.enforce_strong_label")}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="ssh-strong"
            checked={enforceStrong}
            disabled={isPending}
            onCheckedChange={(checked) => {
              setEnforceStrong(checked);
              onAnyInputChange();
            }}
          />
          <Label htmlFor="ssh-strong">
            {enforceStrong ? t("state.on", { ns: "common" }) : t("state.off", { ns: "common" })}
          </Label>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <SaveButton
          isSaving={isPending}
          saved={false}
          label={t("ssh_password.button_change")}
          disabled={!canSubmit}
          onClick={handleSubmit}
        />
      </div>
    </div>
  );
}

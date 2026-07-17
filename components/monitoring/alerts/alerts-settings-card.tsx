"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";
import { useReducedMotion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { CopyableCommand } from "@/components/ui/copyable-command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  EyeIcon,
  EyeOffIcon,
  SendIcon,
  PackageIcon,
  Trash2Icon,
  RefreshCcwIcon,
  CheckIcon,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AlertsState, AlertChannel } from "@/types/alerts";
import type { UseAlertsReturn } from "@/hooks/use-alerts";
import type { AlertsForm } from "./use-alerts-form";
import { AlertRoutingGrid } from "./alert-routing-grid";

type SettingsTab = "routing" | "sms" | "email";

interface AlertsSettingsCardProps {
  form: AlertsForm;
  state: AlertsState;
  hook: UseAlertsReturn;
  /** Bumped after a successful test so the log card silently refreshes. */
  onTested: () => void;
}

// -----------------------------------------------------------------------------
// AlertsSettingsCard — one card, three tabs (Routing / SMS / Email), one atomic
// Save. The sticky bar commits every pending change on the page regardless of
// the visible tab; each tab shows a destructive dot when a field on it is
// invalid, and a blocked Save jumps to the first offending tab + focuses it.
// -----------------------------------------------------------------------------
export function AlertsSettingsCard({
  form,
  state,
  hook,
  onTested,
}: AlertsSettingsCardProps) {
  const { t } = useTranslation("monitoring");
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<SettingsTab>("routing");
  const [showPassword, setShowPassword] = useState(false);

  const { errors, missing, smsEnabled, emailEnabled } = form;

  // ── Per-tab error state ────────────────────────────────────────────────────
  const smsHasError =
    (smsEnabled && (!!errors.smsPhone || !!errors.smsThreshold)) ||
    missing.smsPhone;
  const emailHasError =
    (emailEnabled &&
      (!!errors.senderEmail ||
        !!errors.recipientEmail ||
        !!errors.emailThreshold)) ||
    missing.senderEmail ||
    missing.recipientEmail ||
    missing.appPassword;

  const tabErrors: Record<SettingsTab, boolean> = {
    routing: false,
    sms: smsHasError,
    email: emailHasError,
  };

  // ── Focus-first-invalid on a blocked save ──────────────────────────────────
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      fieldRefs.current[id] = el;
    },
    [],
  );
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(
    null,
  );
  useEffect(() => {
    if (!focusReq) return;
    const raf = requestAnimationFrame(() => {
      const el = fieldRefs.current[focusReq.id];
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusReq, reduceMotion]);

  const orderedErrors: { tab: SettingsTab; id: string; present: boolean }[] = [
    {
      tab: "sms",
      id: "sms-phone",
      present: (smsEnabled && !!errors.smsPhone) || missing.smsPhone,
    },
    { tab: "sms", id: "sms-threshold", present: smsEnabled && !!errors.smsThreshold },
    {
      tab: "email",
      id: "sender-email",
      present: (emailEnabled && !!errors.senderEmail) || missing.senderEmail,
    },
    {
      tab: "email",
      id: "recipient-email",
      present:
        (emailEnabled && !!errors.recipientEmail) || missing.recipientEmail,
    },
    { tab: "email", id: "app-password", present: missing.appPassword },
    {
      tab: "email",
      id: "email-threshold",
      present: emailEnabled && !!errors.emailThreshold,
    },
  ];

  const handleSave = async () => {
    if (form.blocked) {
      const first = orderedErrors.find((f) => f.present);
      if (first) {
        setTab(first.tab);
        setFocusReq((prev) => ({ id: first.id, n: (prev?.n ?? 0) + 1 }));
      }
      return;
    }
    const ok = await hook.saveSettings(form.buildPayload());
    if (ok) {
      form.markSaved();
      toast.success(t("alerts.toast_save_success"));
    } else {
      toast.error(hook.error || t("alerts.toast_save_error"));
    }
  };

  const erroredTabNames = (["routing", "sms", "email"] as const)
    .filter((tk) => tabErrors[tk])
    .map((tk) => t(`alerts.tab_${tk}`));

  // ── Test gating (tests run against SAVED config on the device) ─────────────
  const canTestSms =
    state.channels.sms.enabled &&
    state.channels.sms.configured &&
    !form.isDirty &&
    hook.testingChannel === null;
  const canTestEmail =
    state.channels.email.enabled &&
    state.channels.email.configured &&
    state.channels.email.msmtp_installed &&
    !form.isDirty &&
    hook.testingChannel === null;

  const handleTest = async (channel: AlertChannel) => {
    const ok = await hook.sendTest(channel);
    if (ok) toast.success(t(`alerts.toast_test_${channel}_success`));
    else toast.error(hook.error || t(`alerts.toast_test_${channel}_error`));
    onTested();
  };

  const msmtpInstalled = state.channels.email.msmtp_installed;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("alerts.settings_title")}</CardTitle>
        <CardDescription>{t("alerts.settings_description")}</CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            {(["routing", "sms", "email"] as const).map((tk) => (
              <TabsTrigger key={tk} value={tk} className="gap-1.5">
                {t(`alerts.tab_${tk}`)}
                {tabErrors[tk] && (
                  <span
                    aria-label={t("alerts.tab_has_errors_aria")}
                    className="bg-destructive size-1.5 rounded-full"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ================= ROUTING ================= */}
          <TabsContent
            value="routing"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <p className="text-muted-foreground mb-4 text-sm">
              {t("alerts.routing_intro")}
            </p>
            <div className="rounded-lg border p-4">
              <AlertRoutingGrid form={form} capabilities={state.capabilities} />
            </div>
          </TabsContent>

          {/* ================= SMS ================= */}
          <TabsContent
            value="sms"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                <ChannelEnableRow
                  id="sms-enabled"
                  label={t("alerts.sms_enable_label")}
                  onHint={t("alerts.sms_on_hint")}
                  offHint={t("alerts.sms_off_hint")}
                  checked={smsEnabled}
                  onChange={form.setSmsEnabled}
                />

                <Field>
                  <FieldLabel htmlFor="sms-phone">
                    {t("alerts.sms_recipient_label")}
                  </FieldLabel>
                  <Input
                    ref={registerField("sms-phone")}
                    id="sms-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={t("alerts.sms_recipient_placeholder")}
                    className="max-w-sm font-mono"
                    value={form.smsPhone}
                    onChange={(e) => form.setSmsPhone(e.target.value)}
                    disabled={!smsEnabled}
                    aria-invalid={smsEnabled && !!errors.smsPhone}
                    aria-describedby={
                      errors.smsPhone ? "sms-phone-error" : "sms-phone-desc"
                    }
                  />
                  {smsEnabled && errors.smsPhone ? (
                    <FieldError id="sms-phone-error">
                      {t("alerts.validation_phone")}
                    </FieldError>
                  ) : (
                    <FieldDescription id="sms-phone-desc">
                      {t("alerts.sms_recipient_description")}
                    </FieldDescription>
                  )}
                </Field>

                <ThresholdField
                  id="sms-threshold"
                  registerField={registerField}
                  label={t("alerts.threshold_label")}
                  description={t("alerts.threshold_description")}
                  value={form.smsThreshold}
                  onChange={form.setSmsThreshold}
                  disabled={!smsEnabled}
                  invalid={smsEnabled && !!errors.smsThreshold}
                />

                <TestRow
                  label={t("alerts.test_sms_button")}
                  sendingLabel={t("alerts.test_sms_sending")}
                  isSending={hook.testingChannel === "sms"}
                  canSend={canTestSms}
                  showHint={form.isDirty && smsEnabled}
                  hint={t("alerts.save_before_test_hint")}
                  onSend={() => handleTest("sms")}
                />
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= EMAIL ================= */}
          <TabsContent
            value="email"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            {!msmtpInstalled && (
              <MsmtpInstallBanner
                installResult={hook.installResult}
                onInstall={hook.runInstall}
                onRefresh={hook.refresh}
              />
            )}

            <FieldSet>
              <FieldGroup>
                <ChannelEnableRow
                  id="email-enabled"
                  label={t("alerts.email_enable_label")}
                  onHint={t("alerts.email_on_hint")}
                  offHint={t("alerts.email_off_hint")}
                  checked={emailEnabled}
                  onChange={form.setEmailEnabled}
                />

                <Field>
                  <FieldLabel htmlFor="sender-email">
                    {t("alerts.email_sender_label")}
                  </FieldLabel>
                  <Input
                    ref={registerField("sender-email")}
                    id="sender-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("alerts.email_sender_placeholder")}
                    className="max-w-sm"
                    value={form.senderEmail}
                    onChange={(e) => form.setSenderEmail(e.target.value)}
                    disabled={!emailEnabled}
                    aria-invalid={emailEnabled && !!errors.senderEmail}
                    aria-describedby={
                      errors.senderEmail
                        ? "sender-email-error"
                        : "sender-email-desc"
                    }
                  />
                  {emailEnabled && errors.senderEmail ? (
                    <FieldError id="sender-email-error">
                      {t("alerts.validation_email")}
                    </FieldError>
                  ) : (
                    <FieldDescription id="sender-email-desc">
                      {t("alerts.email_sender_description")}
                    </FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="recipient-email">
                    {t("alerts.email_recipient_label")}
                  </FieldLabel>
                  <Input
                    ref={registerField("recipient-email")}
                    id="recipient-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("alerts.email_recipient_placeholder")}
                    className="max-w-sm"
                    value={form.recipientEmail}
                    onChange={(e) => form.setRecipientEmail(e.target.value)}
                    disabled={!emailEnabled}
                    aria-invalid={emailEnabled && !!errors.recipientEmail}
                    aria-describedby={
                      errors.recipientEmail
                        ? "recipient-email-error"
                        : "recipient-email-desc"
                    }
                  />
                  {emailEnabled && errors.recipientEmail ? (
                    <FieldError id="recipient-email-error">
                      {t("alerts.validation_email")}
                    </FieldError>
                  ) : (
                    <FieldDescription id="recipient-email-desc">
                      {t("alerts.email_recipient_description")}
                    </FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="app-password">
                    {t("alerts.email_app_password_label")}
                  </FieldLabel>
                  <div className="relative max-w-sm">
                    <Input
                      ref={registerField("app-password")}
                      id="app-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder={
                        form.appPasswordSet
                          ? t("alerts.email_app_password_saved_placeholder")
                          : t("alerts.email_app_password_placeholder")
                      }
                      className="pr-10"
                      value={form.appPassword}
                      onChange={(e) => form.setAppPassword(e.target.value)}
                      disabled={!emailEnabled}
                      aria-invalid={missing.appPassword}
                      aria-describedby="app-password-desc"
                    />
                    <button
                      type="button"
                      aria-label={
                        showPassword
                          ? t("alerts.email_app_password_hide")
                          : t("alerts.email_app_password_show")
                      }
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                  {missing.appPassword ? (
                    <FieldError id="app-password-desc">
                      {t("alerts.validation_app_password_required")}
                    </FieldError>
                  ) : (
                    <FieldDescription id="app-password-desc">
                      <Trans
                        i18nKey="alerts.email_app_password_description"
                        ns="monitoring"
                        components={{
                          link: (
                            <a
                              href="https://myaccount.google.com/apppasswords"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-info underline underline-offset-2 hover:text-info/80"
                            />
                          ),
                        }}
                      />
                    </FieldDescription>
                  )}
                </Field>

                <ThresholdField
                  id="email-threshold"
                  registerField={registerField}
                  label={t("alerts.threshold_label")}
                  description={t("alerts.threshold_description")}
                  value={form.emailThreshold}
                  onChange={form.setEmailThreshold}
                  disabled={!emailEnabled}
                  invalid={emailEnabled && !!errors.emailThreshold}
                />

                <TestRow
                  label={t("alerts.test_email_button")}
                  sendingLabel={t("alerts.test_email_sending")}
                  isSending={hook.testingChannel === "email"}
                  canSend={canTestEmail}
                  showHint={form.isDirty && emailEnabled}
                  hint={t("alerts.save_before_test_hint")}
                  onSend={() => handleTest("email")}
                />
              </FieldGroup>
            </FieldSet>

            {/* Uninstall mailer — only when installed and the channel is off. */}
            {msmtpInstalled && !emailEnabled && (
              <>
                <Separator className="mt-6" />
                <div className="flex items-center justify-between gap-3 pt-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t("alerts.uninstall_section_label")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("alerts.uninstall_section_description")}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={hook.isUninstalling}
                      >
                        {hook.isUninstalling ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                        {t("alerts.uninstall_button")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("alerts.uninstall_confirm_title")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("alerts.uninstall_confirm_description")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t("actions.cancel", { ns: "common" })}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={async () => {
                            const ok = await hook.uninstall();
                            if (ok) toast.success(t("alerts.toast_uninstalled"));
                            else
                              toast.error(
                                hook.error || t("alerts.toast_uninstall_error"),
                              );
                          }}
                        >
                          {t("alerts.uninstall_confirm_button")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* ---- Sticky save bar — commits every pending change on the page. ---- */}
        <div className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex shrink-0 items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4 backdrop-blur">
          <SaveStatus
            t={t}
            isDirty={form.isDirty}
            blocked={form.blocked}
            saved={form.saved}
            erroredTabNames={erroredTabNames}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={form.discard}
              disabled={!form.isDirty || form.isSaving}
            >
              {t("alerts.save_discard")}
            </Button>
            <SaveButton
              type="button"
              size="sm"
              isSaving={form.isSaving}
              saved={form.saved}
              disabled={!form.isDirty || form.isSaving}
              onClick={handleSave}
              label={t("alerts.save_button")}
              savingLabel={t("alerts.save_saving")}
              savedLabel={t("alerts.save_saved_flash")}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// ChannelEnableRow — the state-tinted master toggle at the top of a channel tab.
// -----------------------------------------------------------------------------
function ChannelEnableRow({
  id,
  label,
  onHint,
  offHint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  onHint: string;
  offHint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors duration-300 motion-reduce:transition-none",
        checked ? "border-primary/30 bg-primary/5" : "bg-muted/20",
      )}
    >
      <Field orientation="horizontal" className="justify-between">
        <div className="grid min-w-0 gap-1">
          <FieldLabel htmlFor={id} className="m-0">
            {label}
          </FieldLabel>
          <FieldDescription>{checked ? onHint : offHint}</FieldDescription>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-label={label}
        />
      </Field>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ThresholdField — the shared "Alert After (minutes)" numeric input.
// -----------------------------------------------------------------------------
function ThresholdField({
  id,
  registerField,
  label,
  description,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  registerField: (id: string) => (el: HTMLElement | null) => void;
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const { t } = useTranslation("monitoring");
  return (
    <Field className="@sm/card:max-w-[18rem]">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        ref={registerField(id)}
        id={id}
        type="number"
        inputMode="numeric"
        min="1"
        max="60"
        placeholder="5"
        className="tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : `${id}-desc`}
      />
      {invalid ? (
        <FieldError id={`${id}-error`}>
          {t("alerts.validation_threshold")}
        </FieldError>
      ) : (
        <FieldDescription id={`${id}-desc`}>{description}</FieldDescription>
      )}
    </Field>
  );
}

// -----------------------------------------------------------------------------
// TestRow — per-channel "send a real test" action, gated on a saved config.
// -----------------------------------------------------------------------------
function TestRow({
  label,
  sendingLabel,
  isSending,
  canSend,
  showHint,
  hint,
  onSend,
}: {
  label: string;
  sendingLabel: string;
  isSending: boolean;
  canSend: boolean;
  showHint: boolean;
  hint: string;
  onSend: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={!canSend}
        onClick={onSend}
      >
        {isSending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {sendingLabel}
          </>
        ) : (
          <>
            <SendIcon className="size-4" />
            {label}
          </>
        )}
      </Button>
      {showHint && !canSend && (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MsmtpInstallBanner — inline "mailer not installed" affordance. Unlike the old
// email page, this does NOT block the form: SMS + routing still save while the
// mailer is missing; only email delivery waits on the install.
// -----------------------------------------------------------------------------
function MsmtpInstallBanner({
  installResult,
  onInstall,
  onRefresh,
}: {
  installResult: UseAlertsReturn["installResult"];
  onInstall: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("monitoring");
  const running = installResult.status === "running";
  return (
    <div className="mb-5 grid gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <PackageIcon className="text-warning mt-0.5 size-5 shrink-0" />
        <div className="grid gap-0.5">
          <p className="text-sm font-medium">
            {t("alerts.not_installed_title")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("alerts.not_installed_helper")}
          </p>
        </div>
      </div>

      {installResult.status === "complete" && (
        <Alert className="border-success/30 bg-success/5">
          <AlertCircle className="text-success" />
          <AlertDescription className="text-success">
            <p>{installResult.message}</p>
          </AlertDescription>
        </Alert>
      )}
      {installResult.status === "error" && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <p>
              {installResult.message}
              {installResult.detail && (
                <span className="mt-1 block text-xs opacity-80">
                  {installResult.detail}
                </span>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onInstall} disabled={running}>
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {installResult.message || t("alerts.install_running_label")}
            </>
          ) : (
            <>
              <PackageIcon className="size-4" />
              {t("alerts.install_button")}
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={running}
        >
          <RefreshCcwIcon className="size-3.5" />
          {t("alerts.check_again_button")}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <span className="text-muted-foreground text-xs">
          {t("alerts.install_manually_label")}
        </span>
        <CopyableCommand command={t("alerts.install_command")} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SaveStatus — the four-state truthful save line (shared shape with Watchdog).
// -----------------------------------------------------------------------------
function SaveStatus({
  t,
  isDirty,
  blocked,
  saved,
  erroredTabNames,
}: {
  t: (k: string, o?: Record<string, unknown>) => string;
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  erroredTabNames: string[];
}) {
  if (isDirty && blocked) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="bg-destructive size-2 shrink-0 rounded-full"
          aria-hidden
        />
        <p className="text-destructive truncate text-xs font-medium">
          {erroredTabNames.length > 0
            ? t("alerts.save_fix_errors_in", {
                tabs: erroredTabNames.join(", "),
              })
            : t("alerts.save_fix_errors")}
        </p>
      </div>
    );
  }
  if (isDirty) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="bg-primary/50 absolute inline-flex size-full animate-ping rounded-full motion-reduce:hidden" />
          <span className="bg-primary relative inline-flex size-2 rounded-full" />
        </span>
        <p className="truncate text-xs font-medium">
          {t("alerts.save_unsaved")}
        </p>
      </div>
    );
  }
  if (saved) {
    return (
      <div className="text-success flex min-w-0 items-center gap-1.5">
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        <p className="truncate text-xs font-medium">
          {t("alerts.save_saved_flash")}
        </p>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground truncate text-xs">
      {t("alerts.save_all_saved")}
    </p>
  );
}

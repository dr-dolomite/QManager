"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
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
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UploadDestinationSettings {
  upload_target: string;
  custom_url: string;
  custom_auth: string;
  custom_format: string;
  custom_gzip: boolean;
  batch_size: number;
  upload_interval: number;
  retry_enabled: boolean;
  upload_policy: string;
}

interface CellMapperUploadDestinationCardProps {
  settings: UploadDestinationSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (partial: Record<string, unknown>) => Promise<boolean>;
  onTestEndpoint: () => Promise<{ success: boolean; message: string }>;
}

// ─── Card (outer) ─────────────────────────────────────────────────────────────

export function CellMapperUploadDestinationCard({
  settings,
  isLoading,
  isSaving,
  onSave,
  onTestEndpoint,
}: CellMapperUploadDestinationCardProps) {
  const { t } = useTranslation("monitoring");

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.upload_cfg_title")}</CardTitle>
          <CardDescription>{t("cellmapper.upload_cfg_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-32 mt-2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Key-based remount so form state reinitializes on fresh settings
  const formKey = settings
    ? `${settings.upload_target}-${settings.batch_size}-${settings.upload_interval}-${settings.upload_policy}`
    : "empty";

  return (
    <UploadDestinationForm
      key={formKey}
      settings={settings}
      isSaving={isSaving}
      onSave={onSave}
      onTestEndpoint={onTestEndpoint}
    />
  );
}

// ─── Form (inner) ─────────────────────────────────────────────────────────────

function UploadDestinationForm({
  settings,
  isSaving,
  onSave,
  onTestEndpoint,
}: Omit<CellMapperUploadDestinationCardProps, "isLoading">) {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();

  // --- Local form state ---
  const [target, setTarget] = useState(settings?.upload_target ?? "cellmapper");
  const [customUrl, setCustomUrl] = useState(settings?.custom_url ?? "");
  const [customAuth, setCustomAuth] = useState(settings?.custom_auth ?? "");
  const [customFormat, setCustomFormat] = useState(
    settings?.custom_format ?? "cellmapper_json",
  );
  const [customGzip, setCustomGzip] = useState(settings?.custom_gzip ?? true);
  const [batchSize, setBatchSize] = useState(String(settings?.batch_size ?? 50));
  const [uploadInterval, setUploadInterval] = useState(
    String(settings?.upload_interval ?? 60),
  );
  const [retryEnabled, setRetryEnabled] = useState(
    settings?.retry_enabled ?? true,
  );
  const [uploadPolicy, setUploadPolicy] = useState(
    settings?.upload_policy ?? "always",
  );
  const [isTesting, setIsTesting] = useState(false);

  // --- Dirty check ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      target !== settings.upload_target ||
      customUrl !== settings.custom_url ||
      customAuth !== settings.custom_auth ||
      customFormat !== settings.custom_format ||
      customGzip !== settings.custom_gzip ||
      batchSize !== String(settings.batch_size) ||
      uploadInterval !== String(settings.upload_interval) ||
      retryEnabled !== settings.retry_enabled ||
      uploadPolicy !== settings.upload_policy
    );
  }, [
    settings,
    target,
    customUrl,
    customAuth,
    customFormat,
    customGzip,
    batchSize,
    uploadInterval,
    retryEnabled,
    uploadPolicy,
  ]);

  // --- Validation ---
  const batchError =
    batchSize &&
    (isNaN(Number(batchSize)) ||
      Number(batchSize) < 5 ||
      Number(batchSize) > 500)
      ? t("cellmapper.upload_cfg_batch_error")
      : null;

  const intervalError =
    uploadInterval &&
    (isNaN(Number(uploadInterval)) ||
      Number(uploadInterval) < 10 ||
      Number(uploadInterval) > 600)
      ? t("cellmapper.upload_cfg_interval_error")
      : null;

  const canSave = isDirty && !isSaving && !batchError && !intervalError;

  // --- Save handler ---
  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSave) return;

      const success = await onSave({
        upload_target: target,
        custom_url: customUrl,
        custom_auth: customAuth,
        custom_format: customFormat,
        custom_gzip: customGzip,
        batch_size: parseInt(batchSize, 10),
        upload_interval: parseInt(uploadInterval, 10),
        retry_enabled: retryEnabled,
        upload_policy: uploadPolicy,
      });

      if (success) {
        markSaved();
        toast.success(t("cellmapper.toast_save_success"));
      } else {
        toast.error(t("cellmapper.toast_save_error"));
      }
    },
    [
      canSave,
      onSave,
      target,
      customUrl,
      customAuth,
      customFormat,
      customGzip,
      batchSize,
      uploadInterval,
      retryEnabled,
      uploadPolicy,
      markSaved,
      t,
    ],
  );

  // --- Test endpoint handler ---
  const handleTestEndpoint = useCallback(async () => {
    setIsTesting(true);
    try {
      const result = await onTestEndpoint();
      if (result.success) {
        toast.success(result.message || t("cellmapper.upload_cfg_test_success"));
      } else {
        toast.error(t("cellmapper.upload_cfg_test_error", { reason: result.message || t("cellmapper.upload_cfg_test_error_unknown") }));
      }
    } finally {
      setIsTesting(false);
    }
  }, [onTestEndpoint, t]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.upload_cfg_title")}</CardTitle>
        <CardDescription>{t("cellmapper.upload_cfg_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              {/* Target selection */}
              <Field>
                <FieldLabel>{t("cellmapper.upload_cfg_target_label")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={target}
                  onValueChange={(v) => v && setTarget(v)}
                  className="justify-start"
                >
                  <ToggleGroupItem value="cellmapper">
                    {t("cellmapper.upload_cfg_target_cm")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="custom">
                    {t("cellmapper.upload_cfg_target_custom")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              {/* Custom endpoint fields — animated reveal */}
              <AnimatePresence>
                {target === "custom" && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="grid gap-4 pt-2">
                      {/* Endpoint URL */}
                      <Field>
                        <FieldLabel htmlFor="custom-url">
                          {t("cellmapper.upload_cfg_custom_url_label")}
                        </FieldLabel>
                        <Input
                          id="custom-url"
                          type="url"
                          placeholder={t(
                            "cellmapper.upload_cfg_custom_url_placeholder",
                          )}
                          value={customUrl}
                          onChange={(e) => setCustomUrl(e.target.value)}
                        />
                      </Field>

                      {/* Auth header */}
                      <Field>
                        <FieldLabel htmlFor="custom-auth">
                          {t("cellmapper.upload_cfg_custom_auth_label")}
                        </FieldLabel>
                        <Input
                          id="custom-auth"
                          type="text"
                          placeholder={t(
                            "cellmapper.upload_cfg_custom_auth_placeholder",
                          )}
                          value={customAuth}
                          onChange={(e) => setCustomAuth(e.target.value)}
                        />
                        <FieldDescription>
                          {t("cellmapper.upload_cfg_custom_auth_description")}
                        </FieldDescription>
                      </Field>

                      {/* Request format */}
                      <Field>
                        <FieldLabel htmlFor="custom-format">
                          {t("cellmapper.upload_cfg_custom_format_label")}
                        </FieldLabel>
                        <Select value={customFormat} onValueChange={setCustomFormat}>
                          <SelectTrigger id="custom-format" className="max-w-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cellmapper_json">
                              {t("cellmapper.upload_cfg_format_cm_json")}
                            </SelectItem>
                            <SelectItem value="opencellid">
                              {t("cellmapper.upload_cfg_format_opencellid")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      {/* Gzip payload */}
                      <Field orientation="horizontal" className="w-fit">
                        <FieldLabel htmlFor="custom-gzip">
                          {t("cellmapper.upload_cfg_custom_gzip_label")}
                        </FieldLabel>
                        <Switch
                          id="custom-gzip"
                          checked={customGzip}
                          onCheckedChange={setCustomGzip}
                        />
                      </Field>

                      {/* Test endpoint button */}
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleTestEndpoint}
                          disabled={isTesting || !customUrl}
                        >
                          {isTesting ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : null}
                          {t("cellmapper.upload_cfg_test_btn")}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Separator />

              {/* Batch size */}
              <Field>
                <FieldLabel htmlFor="batch-size">
                  {t("cellmapper.upload_cfg_batch_label")}
                </FieldLabel>
                <Input
                  id="batch-size"
                  type="number"
                  min="5"
                  max="500"
                  className="max-w-sm"
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                  aria-invalid={!!batchError}
                />
                {batchError ? (
                  <FieldError>{batchError}</FieldError>
                ) : (
                  <FieldDescription>
                    {t("cellmapper.upload_cfg_batch_description")}
                  </FieldDescription>
                )}
              </Field>

              {/* Upload interval */}
              <Field>
                <FieldLabel htmlFor="upload-interval">
                  {t("cellmapper.upload_cfg_interval_label")}
                </FieldLabel>
                <Input
                  id="upload-interval"
                  type="number"
                  min="10"
                  max="600"
                  className="max-w-sm"
                  value={uploadInterval}
                  onChange={(e) => setUploadInterval(e.target.value)}
                  aria-invalid={!!intervalError}
                />
                {intervalError ? (
                  <FieldError>{intervalError}</FieldError>
                ) : (
                  <FieldDescription>
                    {t("cellmapper.upload_cfg_interval_description")}
                  </FieldDescription>
                )}
              </Field>

              {/* Retry failed */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="retry-enabled">
                  {t("cellmapper.upload_cfg_retry_label")}
                </FieldLabel>
                <Switch
                  id="retry-enabled"
                  checked={retryEnabled}
                  onCheckedChange={setRetryEnabled}
                />
              </Field>

              <Separator />

              {/* Upload policy */}
              <Field>
                <FieldLabel htmlFor="upload-policy">
                  {t("cellmapper.upload_cfg_policy_label")}
                </FieldLabel>
                <Select value={uploadPolicy} onValueChange={setUploadPolicy}>
                  <SelectTrigger id="upload-policy" className="max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">
                      {t("cellmapper.upload_cfg_policy_always")}
                    </SelectItem>
                    <SelectItem value="wifi">
                      {t("cellmapper.upload_cfg_policy_wifi")}
                    </SelectItem>
                    <SelectItem value="scheduled">
                      {t("cellmapper.upload_cfg_policy_scheduled")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t("cellmapper.upload_cfg_policy_description")}
                </FieldDescription>
              </Field>

              {/* Save */}
              <div className="flex items-center gap-2 pt-2">
                <SaveButton
                  type="submit"
                  isSaving={isSaving}
                  saved={saved}
                  className="w-fit"
                  disabled={!canSave}
                />
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}

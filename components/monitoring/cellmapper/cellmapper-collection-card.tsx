"use client";

import { useState, useMemo } from "react";
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
import { TbInfoCircleFilled } from "react-icons/tb";

// =============================================================================
// CellMapperCollectionCard — Collection settings form.
// Follows the watchdog-settings-card.tsx key-based remount pattern.
// =============================================================================

interface CellMapperCollectionCardProps {
  settings: {
    enabled: boolean;
    gps_source: string;
    gpsd_host: string;
    gpsd_port: number;
    nmea_device: string;
    nmea_baud: number;
    http_gps_url: string;
    http_gps_auth: string;
    nmea_udp_port: number;
    interval_moving: number;
    interval_stopped: number;
    neighbor_interval: number;
    consent_accepted: boolean;
  } | null;
  adapterName: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (partial: Record<string, unknown>) => Promise<boolean>;
  onTestGps: () => Promise<{ success: boolean; message: string; fixType?: string; satellites?: number }>;
  /** Trigger consent dialog when enabling without consent */
  onConsentRequired: () => void;
}

export function CellMapperCollectionCard({
  settings,
  adapterName,
  isLoading,
  isSaving,
  onSave,
  onTestGps,
  onConsentRequired,
}: CellMapperCollectionCardProps) {
  const { t } = useTranslation("monitoring");

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.collection_card_title")}</CardTitle>
          <CardDescription>
            {t("cellmapper.collection_card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-9 w-24" />
            <Separator />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-9 w-36 mt-2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Key-based remount: when settings change (initial load or post-save re-fetch),
  // the form reinitializes with fresh values from useState defaults.
  const formKey = settings
    ? `${settings.enabled}-${settings.gps_source}-${settings.interval_moving}-${settings.interval_stopped}-${settings.neighbor_interval}`
    : "empty";

  return (
    <CollectionForm
      key={formKey}
      settings={settings}
      adapterName={adapterName}
      isSaving={isSaving}
      onSave={onSave}
      onTestGps={onTestGps}
      onConsentRequired={onConsentRequired}
    />
  );
}

// ─── Internal form component ──────────────────────────────────────────────────

interface CollectionFormProps {
  settings: CellMapperCollectionCardProps["settings"];
  adapterName: string | null;
  isSaving: boolean;
  onSave: (partial: Record<string, unknown>) => Promise<boolean>;
  onTestGps: () => Promise<{ success: boolean; message: string; fixType?: string; satellites?: number }>;
  onConsentRequired: () => void;
}

function CollectionForm({
  settings,
  adapterName,
  isSaving,
  onSave,
  onTestGps,
  onConsentRequired,
}: CollectionFormProps) {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();

  // --- Local form state ---
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [gpsSource, setGpsSource] = useState(
    settings?.gps_source ?? "modem",
  );
  const [gpsdHost, setGpsdHost] = useState(
    settings?.gpsd_host ?? "127.0.0.1",
  );
  const [gpsdPort, setGpsdPort] = useState(
    String(settings?.gpsd_port ?? 2947),
  );
  const [nmeaDevice, setNmeaDevice] = useState(settings?.nmea_device ?? "");
  const [nmeaBaud, setNmeaBaud] = useState(
    String(settings?.nmea_baud ?? 9600),
  );
  const [httpUrl, setHttpUrl] = useState(settings?.http_gps_url ?? "");
  const [httpAuth, setHttpAuth] = useState(settings?.http_gps_auth ?? "");
  const [nmeaUdpPort, setNmeaUdpPort] = useState(
    String(settings?.nmea_udp_port ?? 29998),
  );
  const [intervalMoving, setIntervalMoving] = useState(
    String(settings?.interval_moving ?? 5),
  );
  const [intervalStopped, setIntervalStopped] = useState(
    String(settings?.interval_stopped ?? 60),
  );
  const [neighborInterval, setNeighborInterval] = useState(
    String(settings?.neighbor_interval ?? 30),
  );

  // --- Dirty check ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      enabled !== settings.enabled ||
      gpsSource !== settings.gps_source ||
      gpsdHost !== settings.gpsd_host ||
      gpsdPort !== String(settings.gpsd_port) ||
      nmeaDevice !== settings.nmea_device ||
      nmeaBaud !== String(settings.nmea_baud) ||
      httpUrl !== settings.http_gps_url ||
      httpAuth !== settings.http_gps_auth ||
      nmeaUdpPort !== String(settings.nmea_udp_port ?? 29998) ||
      intervalMoving !== String(settings.interval_moving) ||
      intervalStopped !== String(settings.interval_stopped) ||
      neighborInterval !== String(settings.neighbor_interval)
    );
  }, [
    settings,
    enabled,
    gpsSource,
    gpsdHost,
    gpsdPort,
    nmeaDevice,
    nmeaBaud,
    httpUrl,
    httpAuth,
    nmeaUdpPort,
    intervalMoving,
    intervalStopped,
    neighborInterval,
  ]);

  // --- Enable toggle with consent check ---
  const handleEnableToggle = (checked: boolean) => {
    if (checked && !settings?.consent_accepted) {
      onConsentRequired();
      return; // Don't toggle yet — consent dialog will handle it
    }
    setEnabled(checked);
  };

  // --- GPS test ---
  const [isTesting, setIsTesting] = useState(false);
  const handleTestGps = async () => {
    setIsTesting(true);
    try {
      const result = await onTestGps();
      if (result.success)
        toast.success(t("cellmapper.toast_gps_test_ok", { fix: result.fixType ?? "—", sats: result.satellites ?? 0 }));
      else
        toast.error(
          t("cellmapper.toast_gps_test_fail", { reason: result.message }),
        );
    } finally {
      setIsTesting(false);
    }
  };

  // --- Save handler ---
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      enabled,
      gps_source: gpsSource,
      gpsd_host: gpsdHost,
      gpsd_port: parseInt(gpsdPort, 10),
      nmea_device: nmeaDevice,
      nmea_baud: parseInt(nmeaBaud, 10),
      http_gps_url: httpUrl,
      http_gps_auth: httpAuth,
      nmea_udp_port: parseInt(nmeaUdpPort, 10),
      interval_moving: parseInt(intervalMoving, 10),
      interval_stopped: parseInt(intervalStopped, 10),
      neighbor_interval: parseInt(neighborInterval, 10),
    };
    const ok = await onSave(payload);
    if (ok) {
      markSaved();
      toast.success(t("cellmapper.toast_save_success"));
    } else {
      toast.error(t("cellmapper.toast_save_error"));
    }
  };

  // GPS source hint text key
  const gpsHintKey =
    gpsSource === "modem"
      ? "cellmapper.gps_hint_modem"
      : gpsSource === "gpsd_local"
        ? "cellmapper.gps_hint_gpsd_local"
        : gpsSource === "gpsd_remote"
          ? "cellmapper.gps_hint_gpsd_remote"
          : gpsSource === "nmea"
            ? "cellmapper.gps_hint_nmea"
            : gpsSource === "http"
              ? "cellmapper.gps_hint_http"
              : gpsSource === "nmea_udp"
                ? "cellmapper.gps_hint_nmea_udp"
                : "cellmapper.gps_hint_modem";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.collection_card_title")}</CardTitle>
        <CardDescription>
          {t("cellmapper.collection_card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => void handleSave(e)}>
          <FieldGroup>
            {/* Enable toggle */}
            <Field orientation="horizontal" className="w-fit">
              <FieldLabel htmlFor="cellmapper-collection-enabled">
                {t("cellmapper.collection_enable_label")}
              </FieldLabel>
              <Switch
                id="cellmapper-collection-enabled"
                checked={enabled}
                onCheckedChange={handleEnableToggle}
              />
            </Field>

            <Separator />

            {/* Adapter (auto-detected) */}
            <Field>
              <FieldLabel>{t("cellmapper.collection_adapter_label")}</FieldLabel>
              {adapterName ? (
                <p className="text-sm font-semibold">{adapterName}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("cellmapper.collection_adapter_not_detected")}
                </p>
              )}
            </Field>

            <Separator />

            {/* GPS source */}
            <Field>
              <FieldLabel htmlFor="gps-source">
                {t("cellmapper.collection_gps_source_label")}
              </FieldLabel>
              <Select
                value={gpsSource}
                onValueChange={setGpsSource}
                disabled={!enabled}
              >
                <SelectTrigger id="gps-source" className="max-w-sm">
                  <SelectValue
                    placeholder={t(
                      "cellmapper.collection_gps_source_placeholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="modem">
                    {t("cellmapper.gps_source_modem")}
                  </SelectItem>
                  <SelectItem value="gpsd_local">
                    {t("cellmapper.gps_source_gpsd_local")}
                  </SelectItem>
                  <SelectItem value="gpsd_remote">
                    {t("cellmapper.gps_source_gpsd_remote")}
                  </SelectItem>
                  <SelectItem value="nmea">
                    {t("cellmapper.gps_source_nmea")}
                  </SelectItem>
                  <SelectItem value="nmea_udp">
                    {t("cellmapper.gps_source_nmea_udp")}
                  </SelectItem>
                  <SelectItem value="http">
                    {t("cellmapper.gps_source_http")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Hint text */}
              <div className="flex items-start gap-1.5 mt-1">
                <TbInfoCircleFilled className="size-4 text-info shrink-0 mt-0.5" />
                <FieldDescription>{t(gpsHintKey)}</FieldDescription>
              </div>
            </Field>

            {/* Conditional GPS source fields */}
            <AnimatePresence mode="wait">
              {gpsSource === "gpsd_remote" && (
                <motion.div
                  key="gpsd_remote"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                  className="grid grid-cols-1 @sm/card:grid-cols-2 gap-4"
                >
                  <Field>
                    <FieldLabel htmlFor="gpsd-host">
                      {t("cellmapper.collection_gpsd_host_label")}
                    </FieldLabel>
                    <Input
                      id="gpsd-host"
                      type="text"
                      placeholder="127.0.0.1"
                      className="max-w-sm"
                      value={gpsdHost}
                      onChange={(e) => setGpsdHost(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_gpsd_host_description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="gpsd-port">
                      {t("cellmapper.collection_gpsd_port_label")}
                    </FieldLabel>
                    <Input
                      id="gpsd-port"
                      type="number"
                      min="1"
                      max="65535"
                      placeholder="2947"
                      className="max-w-sm"
                      value={gpsdPort}
                      onChange={(e) => setGpsdPort(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_gpsd_port_description")}
                    </FieldDescription>
                  </Field>
                </motion.div>
              )}

              {gpsSource === "nmea" && (
                <motion.div
                  key="nmea"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                  className="grid grid-cols-1 @sm/card:grid-cols-2 gap-4"
                >
                  <Field>
                    <FieldLabel htmlFor="nmea-device">
                      {t("cellmapper.collection_nmea_device_label")}
                    </FieldLabel>
                    <Input
                      id="nmea-device"
                      type="text"
                      placeholder="/dev/ttyUSB0"
                      className="max-w-sm"
                      value={nmeaDevice}
                      onChange={(e) => setNmeaDevice(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_nmea_device_description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="nmea-baud">
                      {t("cellmapper.collection_nmea_baud_label")}
                    </FieldLabel>
                    <Select
                      value={nmeaBaud}
                      onValueChange={setNmeaBaud}
                      disabled={!enabled}
                    >
                      <SelectTrigger id="nmea-baud" className="max-w-sm">
                        <SelectValue placeholder="9600" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="4800">4800</SelectItem>
                        <SelectItem value="9600">9600</SelectItem>
                        <SelectItem value="19200">19200</SelectItem>
                        <SelectItem value="38400">38400</SelectItem>
                        <SelectItem value="57600">57600</SelectItem>
                        <SelectItem value="115200">115200</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("cellmapper.collection_nmea_baud_description")}
                    </FieldDescription>
                  </Field>
                </motion.div>
              )}

              {gpsSource === "nmea_udp" && (
                <motion.div
                  key="nmea_udp"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                  className="grid gap-4"
                >
                  <Field>
                    <FieldLabel htmlFor="nmea-udp-port">
                      {t("cellmapper.collection_nmea_udp_port_label")}
                    </FieldLabel>
                    <Input
                      id="nmea-udp-port"
                      type="number"
                      min="1024"
                      max="65535"
                      placeholder="29998"
                      className="max-w-sm"
                      value={nmeaUdpPort}
                      onChange={(e) => setNmeaUdpPort(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_nmea_udp_port_description")}
                    </FieldDescription>
                  </Field>
                </motion.div>
              )}

              {gpsSource === "http" && (
                <motion.div
                  key="http"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                  className="grid gap-4"
                >
                  <Field>
                    <FieldLabel htmlFor="http-gps-url">
                      {t("cellmapper.collection_http_url_label")}
                    </FieldLabel>
                    <Input
                      id="http-gps-url"
                      type="url"
                      placeholder="http://localhost:5000/gps"
                      className="max-w-sm"
                      value={httpUrl}
                      onChange={(e) => setHttpUrl(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_http_url_description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="http-gps-auth">
                      {t("cellmapper.collection_http_auth_label")}
                    </FieldLabel>
                    <Input
                      id="http-gps-auth"
                      type="text"
                      placeholder="Bearer token123"
                      className="max-w-sm"
                      value={httpAuth}
                      onChange={(e) => setHttpAuth(e.target.value)}
                      disabled={!enabled}
                    />
                    <FieldDescription>
                      {t("cellmapper.collection_http_auth_description")}
                    </FieldDescription>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Test GPS button */}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!enabled || isTesting}
                onClick={() => void handleTestGps()}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("cellmapper.collection_testing_gps")}
                  </>
                ) : (
                  t("cellmapper.collection_test_gps_button")
                )}
              </Button>
            </div>

            <Separator />

            {/* Interval (moving) */}
            <Field>
              <FieldLabel>{t("cellmapper.collection_interval_moving_label")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={intervalMoving}
                onValueChange={(v) => v && setIntervalMoving(v)}
                disabled={!enabled}
                className="w-fit"
              >
                <ToggleGroupItem value="2">2s</ToggleGroupItem>
                <ToggleGroupItem value="5">5s</ToggleGroupItem>
                <ToggleGroupItem value="10">10s</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {t("cellmapper.collection_interval_moving_description")}
              </FieldDescription>
            </Field>

            {/* Interval (stopped) */}
            <Field>
              <FieldLabel>{t("cellmapper.collection_interval_stopped_label")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={intervalStopped}
                onValueChange={(v) => v && setIntervalStopped(v)}
                disabled={!enabled}
                className="w-fit"
              >
                <ToggleGroupItem value="30">30s</ToggleGroupItem>
                <ToggleGroupItem value="60">60s</ToggleGroupItem>
                <ToggleGroupItem value="300">5m</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {t("cellmapper.collection_interval_stopped_description")}
              </FieldDescription>
            </Field>

            {/* Neighbor scan */}
            <Field>
              <FieldLabel>{t("cellmapper.collection_neighbor_interval_label")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={neighborInterval}
                onValueChange={(v) => v && setNeighborInterval(v)}
                disabled={!enabled}
                className="w-fit"
              >
                <ToggleGroupItem value="0">
                  {t("cellmapper.collection_neighbor_off")}
                </ToggleGroupItem>
                <ToggleGroupItem value="30">30s</ToggleGroupItem>
                <ToggleGroupItem value="60">60s</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {t("cellmapper.collection_neighbor_description")}
              </FieldDescription>
            </Field>

            {/* Save button */}
            <div className="flex items-center gap-2 pt-2">
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                className="w-fit"
                disabled={!isDirty}
                label={t("cellmapper.collection_save_button")}
              />
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

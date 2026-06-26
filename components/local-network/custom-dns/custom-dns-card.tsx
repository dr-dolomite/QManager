"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useDnsSettings } from "@/hooks/use-dns-settings";
import {
  CUSTOM_PROVIDER_ID,
  DNS_PROVIDERS,
  matchProvider,
} from "./dns-providers";

// =============================================================================
// CustomDNSCard — Custom DNS Configuration
// =============================================================================
// Lets users replace carrier-assigned DNS with a built-in provider preset
// (Cloudflare, Google, Quad9, AdGuard, ControlD) or their own Custom servers,
// across both IPv4 and IPv6. The active NIC (lan vs lan_bind4) is determined by
// the backend based on IP passthrough state.
// =============================================================================

const CustomDNSCard = () => {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, error, saveDns, refresh } = useDnsSettings();
  const { saved, markSaved } = useSaveFlash();

  // --- Local form state -------------------------------------------------------
  const [isEnabled, setIsEnabled] = useState(false);
  const [dns1, setDns1] = useState("");
  const [dns2, setDns2] = useState("");
  const [dns3, setDns3] = useState("");
  const [dns1v6, setDns1v6] = useState("");
  const [dns2v6, setDns2v6] = useState("");
  // Selected provider preset id, or CUSTOM_PROVIDER_ID for user-entered values.
  const [provider, setProvider] = useState<string>(CUSTOM_PROVIDER_ID);

  // Seed local form state when data arrives from the backend. Uses the
  // render-phase derived-state pattern (React docs: "You Might Not Need an
  // Effect") instead of useEffect, so the sync lands in the same commit rather
  // than a second render. prevData makes it re-run only when the source object
  // reference changes — identical semantics to the previous [data] effect.
  const [prevData, setPrevData] = useState(data);
  if (data && data !== prevData) {
    setPrevData(data);
    setIsEnabled(data.mode === "enabled");
    setDns1(data.dns1);
    setDns2(data.dns2);
    setDns3(data.dns3);
    setDns1v6(data.dns1v6);
    setDns2v6(data.dns2v6);
    // Recognise a known provider from the saved addresses; else fall to Custom.
    setProvider(
      matchProvider(data.dns1, data.dns2, data.dns3, data.dns1v6, data.dns2v6),
    );
  }

  const isCustom = provider === CUSTOM_PROVIDER_ID;

  // Switching providers fills the form from the preset (and clears the unused
  // tertiary IPv4 slot). Choosing "Custom" keeps whatever is currently entered
  // so the user can tweak a preset they just selected.
  const handleProviderChange = useCallback((value: string) => {
    setProvider(value);
    if (value === CUSTOM_PROVIDER_ID) return;
    const preset = DNS_PROVIDERS.find((p) => p.id === value);
    if (!preset) return;
    setDns1(preset.ipv4[0]);
    setDns2(preset.ipv4[1]);
    setDns3("");
    setDns1v6(preset.ipv6[0]);
    setDns2v6(preset.ipv6[1]);
  }, []);

  // --- Per-address IPv6 validity (client-side fence; backend re-checks) -------
  // Covers full, compressed (::), and zero-run forms. IPv4-mapped suffixes are
  // intentionally out of scope — a v4 literal belongs in the IPv4 fields.
  const isValidIPv6 = useCallback((value: string): boolean => {
    if (!value) return true; // empty is allowed (optional field)
    const v6 =
      /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
    return v6.test(value.trim());
  }, []);

  const dns1v6Invalid = isEnabled && !isValidIPv6(dns1v6);
  const dns2v6Invalid = isEnabled && !isValidIPv6(dns2v6);
  const hasV6Error = dns1v6Invalid || dns2v6Invalid;

  // At least one address across BOTH families is required when enabling.
  const noAddresses = !dns1 && !dns2 && !dns3 && !dns1v6 && !dns2v6;

  // --- Dirty check: save button enabled only when something changed ----------
  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      isEnabled !== (data.mode === "enabled") ||
      dns1 !== data.dns1 ||
      dns2 !== data.dns2 ||
      dns3 !== data.dns3 ||
      dns1v6 !== data.dns1v6 ||
      dns2v6 !== data.dns2v6
    );
  }, [data, isEnabled, dns1, dns2, dns3, dns1v6, dns2v6]);

  // --- Handle toggle ---------------------------------------------------------
  const handleToggle = useCallback((checked: boolean) => {
    setIsEnabled(checked);
  }, []);

  // --- Handle save -----------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!data) return;

    // Guard: when enabling, require at least one DNS server and reject
    // malformed IPv6 input before it reaches the backend fence.
    if (isEnabled && (noAddresses || hasV6Error)) return;

    const success = await saveDns({
      mode: isEnabled ? "enabled" : "disabled",
      nic: data.nic,
      dns1,
      dns2,
      dns3,
      dns1v6,
      dns2v6,
    });

    if (success) {
      markSaved();
      toast.success(
        isEnabled
          ? t("dns.toast_success_enabled")
          : t("dns.toast_success_disabled"),
      );
    } else {
      toast.error(error || t("dns.toast_error_apply"));
    }
  }, [data, isEnabled, dns1, dns2, dns3, dns1v6, dns2v6, noAddresses, hasV6Error, saveDns, error, markSaved, t]);

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("dns.card_title")}</CardTitle>
        <CardDescription>
          {t("dns.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && !isLoading && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 mb-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={refresh}
            >
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        )}
        {isLoading ? (
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <FieldSet>
              <FieldGroup>
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="custom-dns">{t("dns.label_enable")}</FieldLabel>
                  <Switch
                    id="custom-dns"
                    checked={isEnabled}
                    onCheckedChange={handleToggle}
                  />
                </Field>

                {/* Provider preset selector — the primary control */}
                <Field>
                  <FieldLabel htmlFor="dns-provider">{t("dns.label_provider")}</FieldLabel>
                  <Select
                    value={provider}
                    onValueChange={handleProviderChange}
                    disabled={!isEnabled}
                  >
                    <SelectTrigger id="dns-provider" className="@md/card:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DNS_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_PROVIDER_ID}>
                        {t("dns.provider_custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {isCustom ? (
                  <>
                    {/* IPv4 servers */}
                    <div className="grid gap-3">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t("dns.label_ipv4_section")}
                      </p>
                      <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                        <Field>
                          <FieldLabel htmlFor="primary-dns">
                            {t("dns.label_primary_dns")}
                          </FieldLabel>
                          <Input
                            id="primary-dns"
                            placeholder={t("dns.placeholder_primary_dns")}
                            value={dns1}
                            onChange={(e) => setDns1(e.target.value)}
                            disabled={!isEnabled}
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="secondary-dns">
                            {t("dns.label_secondary_dns")}
                          </FieldLabel>
                          <Input
                            id="secondary-dns"
                            placeholder={t("dns.placeholder_secondary_dns")}
                            value={dns2}
                            onChange={(e) => setDns2(e.target.value)}
                            disabled={!isEnabled}
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="tertiary-dns">
                            {t("dns.label_tertiary_dns")}
                            <span className="text-muted-foreground">{t("dns.label_tertiary_dns_optional_suffix")}</span>
                          </FieldLabel>
                          <Input
                            id="tertiary-dns"
                            placeholder={t("dns.placeholder_tertiary_dns")}
                            value={dns3}
                            onChange={(e) => setDns3(e.target.value)}
                            disabled={!isEnabled}
                          />
                        </Field>
                      </div>
                    </div>

                    <FieldSeparator />

                    {/* IPv6 servers */}
                    <div className="grid gap-3">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t("dns.label_ipv6_section")}
                      </p>
                      <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                        <Field>
                          <FieldLabel htmlFor="primary-dns6">
                            {t("dns.label_primary_dns6")}
                          </FieldLabel>
                          <Input
                            id="primary-dns6"
                            placeholder={t("dns.placeholder_primary_dns6")}
                            value={dns1v6}
                            onChange={(e) => setDns1v6(e.target.value)}
                            disabled={!isEnabled}
                            aria-invalid={dns1v6Invalid || undefined}
                            spellCheck={false}
                            autoCapitalize="none"
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="secondary-dns6">
                            {t("dns.label_secondary_dns6")}
                            <span className="text-muted-foreground">{t("dns.label_tertiary_dns_optional_suffix")}</span>
                          </FieldLabel>
                          <Input
                            id="secondary-dns6"
                            placeholder={t("dns.placeholder_secondary_dns6")}
                            value={dns2v6}
                            onChange={(e) => setDns2v6(e.target.value)}
                            disabled={!isEnabled}
                            aria-invalid={dns2v6Invalid || undefined}
                            spellCheck={false}
                            autoCapitalize="none"
                          />
                        </Field>
                      </div>
                      {hasV6Error && (
                        <FieldError id="dns6-error">
                          {t("dns.error_invalid_ipv6")}
                        </FieldError>
                      )}
                    </div>
                  </>
                ) : (
                  /* Preset selected — show the resolved addresses read-only */
                  <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                    <div className="grid gap-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("dns.label_ipv4_section")}
                      </p>
                      <p className="text-sm tabular-nums">
                        {[dns1, dns2].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <div className="grid gap-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("dns.label_ipv6_section")}
                      </p>
                      <p className="text-sm tabular-nums break-all">
                        {[dns1v6, dns2v6].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  </div>
                )}

                {isEnabled && noAddresses && (
                  <FieldError id="dns-error">
                    {t("dns.error_at_least_one")}
                  </FieldError>
                )}

                <SaveButton
                  type="submit"
                  isSaving={isSaving}
                  saved={saved}
                  label={t("actions.apply", { ns: "common" })}
                  className="w-fit"
                  disabled={!isDirty || (isEnabled && (noAddresses || hasV6Error))}
                />
              </FieldGroup>
            </FieldSet>
          </form>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomDNSCard;

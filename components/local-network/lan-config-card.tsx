"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { EASE_OUT_EXPO, DUR } from "@/lib/motion";

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
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveButton } from "@/components/ui/save-button";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { useLanConfig } from "@/hooks/use-lan-config";
import { LanReconnecting } from "@/components/local-network/lan-reconnecting";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// LanConfigCard — LAN Gateway / Subnet Editor
// =============================================================================
// Edits the br-lan IPv4 address (the gateway clients use) and subnet mask
// (chosen as a CIDR prefix). Applying rebinds br-lan, which severs the current
// connection — so the apply is gated behind a confirm dialog and followed by a
// persistent banner pointing the user at the new address.
// =============================================================================

// CIDR prefixes offered in the UI (backend enforces 16..30).
const PREFIX_OPTIONS = [16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

// --- Pure helpers (UI-side pre-validation; the backend is source of truth) ---

function prefixToNetmask(prefix: number): string {
  // Build a 32-bit mask, split into octets. Use >>> for unsigned shift.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [
    (mask >>> 24) & 0xff,
    (mask >>> 16) & 0xff,
    (mask >>> 8) & 0xff,
    mask & 0xff,
  ].join(".");
}

function parseOctets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    // Reject leading zeros (e.g. "01") to match the backend.
    if (p.length > 1 && p[0] === "0") return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Returns an error key suffix, or null if the address is a usable host. */
function validateHost(ip: string, prefix: number): string | null {
  const octets = parseOctets(ip);
  if (!octets) return "invalid_ipaddr";
  // Unicast guard: first octet 1..223, not loopback.
  if (octets[0] < 1 || octets[0] > 223 || octets[0] === 127) {
    return "invalid_ipaddr";
  }
  const ipNum =
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3];
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipNum & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  if (ipNum === network || ipNum === broadcast) return "invalid_host_in_subnet";
  return null;
}

const LanConfigCard = () => {
  const { t } = useTranslation("local-network");
  const { t: tErrors } = useTranslation("errors");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading, isSaving, applied, error, saveLanConfig } =
    useLanConfig();

  // --- Local form state — seeded from backend via render-phase derived state --
  const [ipInput, setIpInput] = useState("");
  const [prefix, setPrefix] = useState<number>(24);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [prevData, setPrevData] = useState(data);
  if (data && data !== prevData) {
    setPrevData(data);
    setIpInput(data.ipaddr);
    setPrefix(data.prefix);
  }

  // --- Derived validation -----------------------------------------------------
  const validationKey = useMemo(
    () => (ipInput ? validateHost(ipInput, prefix) : "invalid_ipaddr"),
    [ipInput, prefix],
  );
  const isValid = validationKey === null;
  const isDirty = data
    ? ipInput !== data.ipaddr || prefix !== data.prefix
    : false;
  const canApply = isValid && isDirty && !isSaving && !applied;

  const netmask = useMemo(() => prefixToNetmask(prefix), [prefix]);

  // --- Apply ------------------------------------------------------------------
  const handleApply = useCallback(async () => {
    setConfirmOpen(false);
    const result = await saveLanConfig(ipInput, prefix);
    if (!result.success) {
      toast.error(
        resolveErrorMessage(
          tErrors,
          result.errorCode,
          result.errorDetail,
          t("lan_config.toast_error_save"),
        ),
      );
    }
    // On success the connection is about to drop; the persistent banner takes
    // over — no success toast (it would never be seen reliably).
  }, [ipInput, prefix, saveLanConfig, t, tErrors]);

  // --- Loading skeleton -------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("lan_config.card_title")}</CardTitle>
          <CardDescription>{t("lan_config.card_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            <div className="grid gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 max-w-xs w-full" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 max-w-xs w-full" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Unified render (reconnect countdown + normal form, crossfaded) ---------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("lan_config.card_title")}</CardTitle>
        <CardDescription>{t("lan_config.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AnimatePresence mode="wait" initial={false}>
          {applied ? (
            <LanReconnecting
              key="reconnecting"
              newIpaddr={applied.newIpaddr}
              prefix={applied.prefix}
              windowSeconds={applied.windowSeconds}
              carrierBounce={applied.carrierBounce}
            />
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
            >
              <form
                className="grid gap-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canApply) setConfirmOpen(true);
                }}
              >
                <FieldSet>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="lan-ipaddr">
                        {t("lan_config.label_gateway")}
                      </FieldLabel>
                      <Input
                        id="lan-ipaddr"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="192.168.1.1"
                        value={ipInput}
                        onChange={(e) => setIpInput(e.target.value.trim())}
                        disabled={isSaving}
                        aria-invalid={ipInput !== "" && !isValid}
                        className="tabular-nums max-w-xs"
                      />
                      <FieldDescription>
                        {ipInput !== "" && validationKey ? (
                          <span
                            role="alert"
                            className="inline-flex items-center gap-1.5 text-destructive"
                          >
                            <TriangleAlertIcon className="size-3.5 shrink-0" />
                            {t(`lan_config.error_${validationKey}`)}
                          </span>
                        ) : (
                          t("lan_config.help_gateway")
                        )}
                      </FieldDescription>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="lan-prefix">
                        {t("lan_config.label_subnet")}
                      </FieldLabel>
                      <Select
                        value={String(prefix)}
                        onValueChange={(v) => setPrefix(Number(v))}
                        disabled={isSaving}
                      >
                        <SelectTrigger
                          id="lan-prefix"
                          className="tabular-nums max-w-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PREFIX_OPTIONS.map((p) => (
                            <SelectItem
                              key={p}
                              value={String(p)}
                              className="tabular-nums"
                            >
                              /{p} · {prefixToNetmask(p)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("lan_config.help_subnet")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </FieldSet>

                {error && !applied && (
                  <p
                    role="alert"
                    className="inline-flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <TriangleAlertIcon className="size-3.5 shrink-0" />
                    {error}
                  </p>
                )}

                <SaveButton
                  type="submit"
                  className="w-fit"
                  isSaving={isSaving}
                  saved={false}
                  disabled={!canApply}
                  label={t("lan_config.action_apply")}
                  savingLabel={tCommon("state.applying")}
                />
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>

      {/* Confirm dialog — applying severs the LAN connection */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("lan_config.confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("lan_config.confirm_body", {
                address: `${ipInput}/${prefix}`,
                netmask,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              {t("lan_config.confirm_reconnect")}
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tCommon("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleApply}>
              {t("lan_config.confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default LanConfigCard;

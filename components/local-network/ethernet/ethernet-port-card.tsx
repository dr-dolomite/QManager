"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { FIELD, FIELD_GLYPH, ROW, ROW_GROUP } from "./shapes";
import type { AspmPolicy, EthernetPortChange } from "./types";

// =============================================================================
// EthernetPortCard — the write card of /local-network/ethernet
// =============================================================================
// The two things this page writes, as two rows of one group: the link speed
// limit and the PCIe ASPM policy of the ethernet controller.
//
// Target deviation from the fork: the fork applies on Select change. Here each
// Select edits a draft and `CardFoot` commits both in one POST (Card-Foot Apply
// Rule), because a speed change drops the link the user is on: a stray pick in
// a dropdown should not cut the session. An ASPM-only change does not touch the
// link, so the shell skips the wait-out for it.
//
// The speed row's consequence sentence changes with the row's condition: it
// names the risk when the control is live, says what is happening while
// applying, and says why the control is held when it cannot work. The ASPM row
// is hidden when the kernel exposes no ASPM policy.
// =============================================================================

const K = "ethernet";
const SPEED_LIMIT_LABEL_ID = "ethernet-speed-limit-label";
const ASPM_LABEL_ID = "ethernet-aspm-label";

const ASPM_OPTIONS: readonly { value: AspmPolicy; key: string }[] = [
  { value: "performance", key: "aspm_option_performance" },
  { value: "default", key: "aspm_option_default" },
  { value: "powersave", key: "aspm_option_powersave" },
  { value: "powersupersave", key: "aspm_option_powersupersave" },
];

export interface EthernetPortCardProps {
  /** The saved limit, or `""` before the first read (never a defaulted `"auto"`). */
  speedLimit: string;
  supports2500: boolean;
  /** The kernel's ACTIVE ASPM policy, or `""` when unread or unsupported. */
  aspmPolicy: string;
  /** False when the kernel exposes no ASPM policy: the row is not rendered. */
  aspmSupported: boolean;
  isSaving: boolean;
  /** False until the first successful read lands. */
  hasStatus: boolean;
  /** The last poll failed: the controls are held so a write is never sent blind. */
  pollFailed: boolean;
  /** False when the device has no ethernet controller. */
  interfacePresent: boolean;
  /** Resolves true once every requested change is confirmed. */
  onApply: (change: EthernetPortChange) => Promise<boolean>;
}

export function EthernetPortCard({
  speedLimit,
  supports2500,
  aspmPolicy,
  aspmSupported,
  isSaving,
  hasStatus,
  pollFailed,
  interfacePresent,
  onApply,
}: EthernetPortCardProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();
  // `null` = untouched, so each Select follows every poll until the user edits.
  const [speedDraft, setSpeedDraft] = React.useState<string | null>(null);
  const [aspmDraft, setAspmDraft] = React.useState<string | null>(null);

  const speedValue = speedDraft ?? speedLimit;
  const aspmValue = aspmDraft ?? aspmPolicy;
  const speedDirty = speedDraft !== null && speedDraft !== speedLimit;
  const aspmDirty = aspmDraft !== null && aspmDraft !== aspmPolicy;
  const isDirty = speedDirty || aspmDirty;
  const held = !interfacePresent || !hasStatus || (pollFailed && !isSaving);

  const consequence = !interfacePresent
    ? t(`${K}.settings.consequence_absent`)
    : isSaving
      ? t(`${K}.settings.consequence_applying`)
      : !hasStatus
        ? t(`${K}.settings.consequence_unread`)
        : pollFailed
          ? t(`${K}.settings.consequence_unresponsive`)
          : t(`${K}.settings.consequence`);

  const discard = () => {
    setSpeedDraft(null);
    setAspmDraft(null);
  };

  const handleApply = async () => {
    if (!isDirty) return;
    const change: EthernetPortChange = {};
    if (speedDirty && speedDraft !== null) change.speed_limit = speedDraft;
    if (aspmDirty && aspmDraft !== null) {
      change.aspm_policy = aspmDraft as AspmPolicy;
    }
    const ok = await onApply(change);
    if (ok) {
      discard();
      markSaved();
    }
  };

  const applyingValue = (
    <span className="flex items-center gap-2">
      <Loader2Icon
        className={cn(FIELD_GLYPH, "motion-safe:animate-spin")}
        aria-hidden="true"
      />
      {t("state.applying", { ns: "common" })}
    </span>
  );

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t(`${K}.settings.title`)}</CardTitle>
        <CardDescription>{t(`${K}.settings.description`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={ROW_GROUP}>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <span id={SPEED_LIMIT_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.settings.row_label`)}
              </span>
              <span className={ROW.CONSEQUENCE}>{consequence}</span>
            </div>
            <div className={ROW.CONTROL}>
              <Select
                value={speedValue}
                onValueChange={setSpeedDraft}
                disabled={isSaving || held}
              >
                <SelectTrigger
                  host="container"
                  aria-labelledby={SPEED_LIMIT_LABEL_ID}
                  className={FIELD}
                >
                  {isSaving && speedDirty ? (
                    applyingValue
                  ) : (
                    <SelectValue placeholder={t(`${K}.settings.placeholder`)} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t(`${K}.settings.row_label`)}</SelectLabel>
                    <SelectItem value="auto">
                      {t(`${K}.settings.option_auto`)}
                    </SelectItem>
                    <SelectItem value="10">{t(`${K}.settings.option_10`)}</SelectItem>
                    <SelectItem value="100">
                      {t(`${K}.settings.option_100`)}
                    </SelectItem>
                    <SelectItem value="1000">
                      {t(`${K}.settings.option_1000`)}
                    </SelectItem>
                    {/* Hidden, not disabled, when the PHY cannot do 2.5G; the
                        rate tile's caption still states the ceiling. */}
                    {supports2500 ? (
                      <SelectItem value="2500">
                        {t(`${K}.settings.option_2500`)}
                      </SelectItem>
                    ) : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {aspmSupported ? (
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <span className="flex items-center gap-1.5">
                  <span id={ASPM_LABEL_ID} className={ROW.LABEL}>
                    {t(`${K}.settings.aspm_label`)}
                  </span>
                  <HintIcon label={t(`${K}.settings.aspm_hint_aria`)}>
                    {t(`${K}.settings.aspm_hint`)}
                  </HintIcon>
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.settings.aspm_consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Select
                  value={aspmValue}
                  onValueChange={setAspmDraft}
                  disabled={isSaving || held}
                >
                  <SelectTrigger
                    host="container"
                    aria-labelledby={ASPM_LABEL_ID}
                    className={FIELD}
                  >
                    {isSaving && aspmDirty ? (
                      applyingValue
                    ) : (
                      <SelectValue
                        placeholder={t(`${K}.settings.aspm_placeholder`)}
                      />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t(`${K}.settings.aspm_label`)}</SelectLabel>
                      {ASPM_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(`${K}.settings.${option.key}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
      <CardFoot
        className="px-6"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={discard}
              disabled={!isDirty || isSaving}
            >
              {t("actions.discard", { ns: "common" })}
            </Button>
            <SaveButton
              type="button"
              isSaving={isSaving}
              saved={saved}
              disabled={!isDirty || held}
              label={t(`${K}.settings.apply`)}
              size="action"
              onClick={handleApply}
            />
          </>
        }
      />
    </Card>
  );
}

export default EthernetPortCard;

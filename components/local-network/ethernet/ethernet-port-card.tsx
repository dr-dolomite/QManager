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

// =============================================================================
// SpeedLimitCard — the write card of /local-network/ethernet
// =============================================================================
// The one thing this page writes, in one row of one group.
//
// Target deviation from the fork: the fork applies on Select change. Here the
// Select edits a draft and `CardFoot` commits it (Card-Foot Apply Rule),
// because applying drops the link the user is on: a stray pick in a dropdown
// should not cut the session. Apply then runs the same POST, wait-out and
// confirm-poll in the shell.
//
// The consequence sentence changes with the row's condition: it names the risk
// when the control is live, says what is happening while applying, and says why
// the control is held when it cannot work.
// =============================================================================

const K = "ethernet";
const SPEED_LIMIT_LABEL_ID = "ethernet-speed-limit-label";

export interface SpeedLimitCardProps {
  /** The saved limit, or `""` before the first read (never a defaulted `"auto"`). */
  speedLimit: string;
  supports2500: boolean;
  isSaving: boolean;
  /** False until the first successful read lands. */
  hasStatus: boolean;
  /** The last poll failed: the control is held so a write is never sent blind. */
  pollFailed: boolean;
  /** False when the device has no ethernet controller. */
  interfacePresent: boolean;
  /** Resolves true once the new speed is confirmed on the link. */
  onApply: (value: string) => Promise<boolean>;
}

export function SpeedLimitCard({
  speedLimit,
  supports2500,
  isSaving,
  hasStatus,
  pollFailed,
  interfacePresent,
  onApply,
}: SpeedLimitCardProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();
  // `null` = untouched, so the Select follows every poll until the user edits.
  const [draft, setDraft] = React.useState<string | null>(null);

  const value = draft ?? speedLimit;
  const isDirty = draft !== null && draft !== speedLimit;
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

  const handleApply = async () => {
    if (draft === null || !isDirty) return;
    const ok = await onApply(draft);
    if (ok) {
      setDraft(null);
      markSaved();
    }
  };

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
                value={value}
                onValueChange={setDraft}
                disabled={isSaving || held}
              >
                <SelectTrigger
                  host="container"
                  aria-labelledby={SPEED_LIMIT_LABEL_ID}
                  className={FIELD}
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2Icon
                        className={cn(FIELD_GLYPH, "motion-safe:animate-spin")}
                        aria-hidden="true"
                      />
                      {t("state.applying", { ns: "common" })}
                    </span>
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
              onClick={() => setDraft(null)}
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

export default SpeedLimitCard;

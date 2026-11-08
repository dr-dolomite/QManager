"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  SegmentedField,
  SEGMENTED,
  type SegmentedOption,
} from "@/components/ui/segmented-field";

import { NUM_FIELD } from "./shapes";

/** The lucide check that SegmentedField reserves on every segment. */
export const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

type OnOff = "on" | "off";

/** Off / On as one pill. The one place the watchdog spells a boolean. */
export function OnOffField({
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: boolean;
  onChange: (on: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("monitoring");
  const options: SegmentedOption<OnOff>[] = [
    { value: "off", label: t("common:state.off") },
    { value: "on", label: t("common:state.on") },
  ];
  return (
    <SegmentedField
      value={value ? "on" : "off"}
      onValueChange={(next) => onChange(next === "on")}
      options={options}
      ariaLabel={ariaLabel}
      disabled={disabled}
      breakpoint="never"
      glyph={renderCheckGlyph}
    />
  );
}

/** A compact whole number with its unit inside the field. Numbers stay strings while typed. */
export function NumberField({
  id,
  value,
  onChange,
  unit,
  ariaLabel,
  error,
  disabled,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  unit: string;
  ariaLabel: string;
  error?: string | null;
  disabled?: boolean;
  /** Registers the input so a blocked save can focus it. */
  inputRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <InputGroup data-disabled={disabled ? true : undefined} className={NUM_FIELD.GROUP}>
      <InputGroupInput
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={NUM_FIELD.INPUT}
      />
      <InputGroupAddon align="inline-end" className={NUM_FIELD.UNIT}>
        {unit}
      </InputGroupAddon>
    </InputGroup>
  );
}

import { describe, expect, it } from "bun:test";
import type { TFunction } from "i18next";

import { eventMessage } from "@/lib/event-message";

const CATALOG: Record<string, string> = {
  "message.device_reboot": "The device restarted",
  "message.device_reboot_user": "Restarted from QManager",
  "message.device_reboot_unexpected": "Restarted unexpectedly",
  "message.device_reboot_off": "{{what}} (off for {{duration}})",
};

const t = ((key: string, opts: Record<string, string> = {}) => {
  const s = CATALOG[key];
  if (!s) return opts.defaultValue ?? "";
  return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => opts[k] ?? "");
}) as unknown as TFunction;

const reboot = (message: string, f?: Record<string, string>) => ({
  type: "device_reboot" as const,
  message,
  f,
});

describe("device_reboot sentence", () => {
  it("maps a known cause and shows the off time", () => {
    expect(eventMessage(reboot("cause=user off=24"), t, "en")).toBe(
      "Restarted from QManager (off for 24s)",
    );
  });
  it("reads fields and maps unplanned to unexpected", () => {
    expect(eventMessage(reboot("x", { cause: "unplanned", off: "-" }), t, "en")).toBe(
      "Restarted unexpectedly",
    );
  });
  it("falls back to the generic sentence, never the raw text", () => {
    const out = eventMessage(reboot("cause=weird off=0"), t, "en");
    expect(out).toBe("The device restarted");
    expect(out).not.toContain("cause=");
  });
});

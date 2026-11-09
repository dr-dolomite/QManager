import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { presentEvent } from "@/lib/event-presentation";

import type { ConnectionEvent, ConnectionEventType } from "./types";

// =============================================================================
// Connection History: how an event row looks
// =============================================================================
// One glyph per event type so a row is scannable by shape before it is read, and
// the filter's five categories, which group the eight types into the questions
// a person asks ("did it go down?", "was it slow?", "what fixed it?").
// =============================================================================

const GLYPH: Record<ConnectionEventType, MaterialSymbolName> = {
  internet_lost: "wifi_off",
  internet_restored: "public",
  high_latency: "speed",
  latency_recovered: "check_circle",
  high_packet_loss: "network_ping",
  packet_loss_recovered: "check_circle",
  watchcat_recovery: "restart_alt",
  sim_failover: "sim_card",
};

export function eventGlyph(type: ConnectionEventType): MaterialSymbolName {
  return GLYPH[type];
}

export const EVENT_CATEGORIES = [
  { id: "outage", glyph: "wifi_off", types: ["internet_lost", "internet_restored"] },
  { id: "latency", glyph: "speed", types: ["high_latency", "latency_recovered"] },
  { id: "loss", glyph: "network_ping", types: ["high_packet_loss", "packet_loss_recovered"] },
  { id: "watchdog", glyph: "restart_alt", types: ["watchcat_recovery"] },
  { id: "sim", glyph: "sim_card", types: ["sim_failover"] },
] as const satisfies readonly {
  id: string;
  glyph: MaterialSymbolName;
  types: readonly ConnectionEventType[];
}[];

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventCategoryId = EventCategory["id"];

/** The wire types behind a set of categories, in filter order. */
export function typesOf(ids: readonly EventCategoryId[]): ConnectionEventType[] {
  return EVENT_CATEGORIES.filter((c) => ids.includes(c.id)).flatMap((c) => [...c.types]);
}

/** The icon disc: its fill and the glyph ink paired with it. */
export function discClass(event: ConnectionEvent): string {
  // An outage is the page's fault state, drawn in the same destructive fill as
  // the Reachability bars (the poller logs it at warning severity).
  if (event.type === "internet_lost") return "bg-destructive text-destructive-foreground";
  // The watchdog acting is a fact, not a verdict: info, not recovery green.
  if (event.type === "watchcat_recovery") return "bg-primary text-primary-foreground";
  return presentEvent(event, false, false, "card").discClass;
}

const ONSET_TYPES: ReadonlySet<string> = new Set([
  "internet_lost",
  "high_latency",
  "high_packet_loss",
]);

export type Lasted =
  | { kind: "none" }
  | { kind: "ongoing"; fault: boolean }
  | { kind: "duration"; sec: number };

/**
 * How long an onset row lasted. `end` is a number once it recovered, `null` while
 * it is still going, and absent from cores that do not report it (nothing shown).
 */
export function lastedOf(event: ConnectionEvent): Lasted {
  if (!ONSET_TYPES.has(event.type) || event.end === undefined) return { kind: "none" };
  if (event.end === null) return { kind: "ongoing", fault: event.type === "internet_lost" };
  return { kind: "duration", sec: Math.max(0, event.end - event.timestamp) };
}

# System Settings (`/system-settings`)

> **Applies to:** the QManager target, ported from the RM520N fork's re-authored index (ledger U4.2),
> then regrouped (`docs/plans/2026-10-20-system-settings-regroup.html`): frontend only, no backend,
> CGI or UCI change, and no existing URL moved.
> Family: `components/system-settings/**` · namespace `public/locales/*/system-settings.json`

The index, plus two pages split out of it: **Device Access** and **Hardware** (both below).
The other sub-routes have their own docs: [logs.md](logs.md), [languages.md](languages.md),
[software-update.md](software-update.md), [at-terminal.md](at-terminal.md), and
[system-health-check.md](../features/system-health-check.md) (which also hosts the Debug
Report card).

The index is a header (title and an icon-only Refresh that reveals its label on hover or
focus; no hostname badge), a status band of three tiles, and two cards. Page description:
"How this device keeps time, when it restarts, and which SIMs it remembers." **Device & Units**
and **Scheduled Reboot** sit side by side as a symmetric 2-up. Tracked SIMs is no longer a
card of its own: it is a row inside Device & Units.

| Cell | Component | Data |
| --- | --- | --- |
| Device & Units | `system-settings-card.tsx` | `useSystemSettings()` -> `settings`, plus `useKnownSims()` for the Tracked SIMs row |
| Scheduled Reboot | `scheduled-operations-card.tsx` | `scheduledReboot` |

Passwords and Web Port live on [Device Access](#device-access-system-settingsdevice-access);
Hardware Offload and Host AT Ports on [Hardware](#hardware-system-settingshardware); the
debug report on System Health Check. None of them render on the index.

`modem-subsystem-card.tsx` from the source is **not** ported; the target has no
subsystem endpoint for it.

---

## The family contract

`shapes.ts` owns every geometry string, control height, tone map and skeleton line box on
the surface; the loaded views and their skeletons read the same values. `derive.ts` is
the non-geometry sibling (`formatOffset`, currently without a consumer on this index
because the target's `settings.sh` does not report a live offset). `condition-block.tsx`
is the lucide state block.

Geometry is restated from the system's numbers, never imported across a family boundary.

### Load-bearing constants

| Constant | Why it is the way it is |
| --- | --- |
| `TILE.ROOT` | 104px **pinned**, never `min-h`. The skeleton wears `ROOT` itself so the two cannot drift. |
| `CARD_GRID` | `*:h-full *:*:data-[slot=card]:h-full`. The second step lets the height lock reach **through** each card's motion wrapper. |
| `COARSE_TARGET` | A pseudo-element overlay, so a 44px touch target does not move the row's baseline. Used on both schedule switches and the password reveal toggles. |
| `ROW.RAIL_ROOT` | The row holding a day rail; it never flips beside its label. An `auto-fit` track list inside `ROW.CONTROL`'s shrink-to-fit box has no width to count against and collapses to one column. |
| `CARD_BODY` | The content box that fills a height-locked cell. Gaps stay composed at the call site. |

---

## What the backend actually sends

`system/settings.sh` GET returns `settings` (`hostname`,
`temp_unit`, `distance_unit`, `timezone`, `zonename`), and `scheduled_reboot`. It does **not** send the fields the source UI used: `effective_offset`,
`effective_zone_abbr`, `timezone_applied`, `timezone_apply_status`, and the reboot
`armed` / `reason` arm status. The UI that needed them is therefore absent, not faked:

- The band's first tile is **Time zone** (the saved `zonename`), not the source's
  **Device clock**. It never grades the live clock, so it has no `drifted` face.
- Preferences has no "clock not updated" notice, and saves do not warn that a timer was
  not armed.
- The `sms_tool_device` payload field is not sent: `settings.sh` ignores it.

`known_sims.sh` returns only `{success, count}` (GET and `clear`). There is no
registry sidecar, so the **Tracked SIMs** row shows a count, not a list, and the band's
SIM tile reads the same count.

## Save results

Every save in `useSystemSettings()` resolves to `SaveResult { success, message? }`.
`message` is the device's reason already translated through `resolveErrorMessage`
(`errors` namespace); it is absent for a transport failure or an empty reason, and the
caller then toasts its own generic line. `useSshPassword()` and `useWebPassword()` (`changePassword`, `verifyPassword`) and
`useKnownSims().clear` follow the same shape (`useIpaOffload().setEnabled` returns the
related `{ ok, error? }` `IpaOffloadMutationResult`; see [Hardware](#hardware-system-settingshardware)). Toasts are fired from the returned value,
never from hook state read after an `await`.

`error` on `useSystemSettings()` is set by a failed **read** only. A rejected write does
not touch it, so a refused edit cannot light the "last confirmed read" badge or the
stale notices.

---

## Invariants

- **`useKnownSims().count` is `number | null`.** The hook swallows a failed GET by
  design; without the null a swallowed failure is indistinguishable from a genuine zero.
  The row has an error state for `null` and a separate empty screen for `0`; the band
  tile renders `—` for `null`.
- **A payload that omits a key is not an error.** Cards gate their condition block on
  `!data`, not on `error && !data`; the second form renders invented defaults as though
  the device had reported them. The schedule card needs `scheduledReboot` before it renders the form.
- **Schedule blocks sync on identity** (`server !== prev`), never on truthiness, and are
  held off while a save is queued or in flight (`savePending`), so a refresh landing
  inside the debounce window cannot overwrite the edit being saved.
- **Preferences syncs field by field.** The draft re-syncs per field when `settings`
  changes, so a refetch (a poll, or the unit or zone just saved) cannot wipe an unsaved
  edit to another field.
- **One cascade root per route, for everything present at mount.** `system-settings.tsx`
  declares `initial`/`animate`; the card grid is a nested `staggerContainer`. A row
  cascade that mounts on a skeleton -> data swap arrives after the page's clock has run,
  so it declares its own `initial="hidden" animate="visible"`.
- **`DAY_PILL.RAIL` needs a definite host**, so it rides `ROW.RAIL_ROOT`.
- **Icons are lucide here.** `/system-settings` is not in the Material set.
  `HintIcon` is the only exception, and the index uses none.

---

## Cards

### Device & Units (`system-settings-card.tsx`)

"How this modem keeps time, the units readings use, and the SIMs it remembers." Time zone,
temperature and distance rows in one tonal group, committed from `CardFoot` (Discard, then
`SaveButton`); each row has its own `Unsaved` marker. The **Tracked SIMs** row (count, from
`useKnownSims()`, lifted into `system-settings.tsx` so the band tile and the row share one
GET) sits in the same card with an inline **Clear** row action (icon-only, label revealed on hover/focus via
`reveal-label-button.tsx`, the same as the header Refresh). Clear is not a draft
commit, so it is exempt from the `CardFoot` rule and does not touch Discard or Save. See
[known-sims.md](../features/known-sims.md#frontend-tracked-sims-grouptsx).

> ℹ️ NOTE: The target-only **Force Tailscale Fixes** row was removed with the Tailscale
> rework. The fw4 zone and routing rule are now automatic, and the on/off lives in the
> **Network fixes** row on the Tailscale page ([`tailscale.md`](tailscale.md)).
> `settings.sh` no longer reads or writes `force_tailscale_fixes`; an old client that
> still posts it is ignored.

### Scheduled Reboot (`scheduled-operations-card.tsx`)

The only scheduled operation left: one `ROW_GROUP` with an enable switch, a time field, a
day rail and a read-only **Modem time** row. That row ticks the `device_clock` from the GET
(`useSystemSettings().deviceClock`, stamped with the browser time it arrived): the device's
own wall time and zone, never the browser's. A clock before 2025 shows a `warning` chip
("Not set yet"), since the schedule guard will not fire on it; no clock reads `—`. It saves through one internal hook (`useAutosaveSchedule`): the switch saves at
once; any other edit saves 800ms after the last, only while the block is on; a failure
reverts to the server's values and toasts the returned reason; unmounting with an edit
queued warns through `*.toast.unsaved`. There is no Save button, so the card keeps a
decorative receipt strip plus an `sr-only` hint wired by `aria-describedby`.

> ℹ️ NOTE: Low Power Mode (a scheduled CFUN=0 window) was removed from this page and the
> backend; see [scheduled-jobs.md](../features/scheduled-jobs.md#retired-low-power-mode).

The receipt strip's `aria-hidden="true"` is correct: `toast.success` announces every
save through Sonner's live region, and the strip's layers are cross-faded by opacity,
which would otherwise read as one permanent string.

The backend rejects "enabled with no days" (`no_days`), so the `Never fires` chip and
the band's `no_day` face are reachable only transiently, between a day being cleared and
its save being refused.

---

## Device Access (`/system-settings/device-access`)

"The password and ports used to reach this modem." Route
`app/system-settings/device-access/page.tsx` ->
`components/system-settings/device-access/device-access.tsx`. A two-column grid (`CARD_GRID`, one
column on a phone) of two half-width cards; each owns its hook and internals, the page only composes them.

| Card | Component | Data |
| --- | --- | --- |
| Passwords | `password-card.tsx` | `useWebPassword()`, `useSshPassword()` |
| Web Port | `web-port/web-port-card.tsx` | `useWebPort()` ([web-port.md](../features/web-port.md)) |

### Passwords (`password-card.tsx`)

Two tabs, **Web Password** (the QManager sign-in password, `auth/password.sh`) and **SSH Password**
(the root password, `system/ssh_password.sh`), each a `PasswordPanel` driven by its hook
(`useWebPassword` / `useSshPassword`, both `PasswordActions` from `types/password-change.ts`).
First-time onboarding seeds both: the password chosen there is also set as the root password
(`auth/login.sh` > `qm_set_ssh_password`, see [auth-rate-limiting.md](auth-rate-limiting.md)). After
that the two passwords are independent. Each tab asks for ITS OWN current password first:

1. The panel shows one field and **Continue**. Continue calls the endpoint with `verify_only` and
   a wrong password stays on the card as an inline notice (the device's reason, e.g. `rate_limited`).
2. Only a correct one opens `PasswordChangeDialog`: new password, confirm (with a live match hint
   instead of a second error), the shared `StrongPasswordToggle` (default On) and
   `PasswordRequirements`. It mirrors the device policy (five characters minimum; with the strong
   policy, upper case, lower case and a digit) so it refuses before the round trip.
3. Save sends the current password again; the device re-checks it. A device failure toasts the
   returned reason. Cancelling or closing clears the typed current password too.

An SSH change toasts and resets the panel. A web change destroys the session on the device and
`use-auth`'s `changePassword` sends the browser to `/login/`, which is the confirmation (no toast);
the dialog stays locked (`leaving`) until the page goes. Switching tabs unmounts the other panel,
so no typed password lingers behind a tab.

**The dialog is a sibling of the panel's `<form>`, never a child.** It portals to `<body>`, but React
still bubbles its `submit` event up the component tree, so nested inside the form every Save also fired
Continue (a second verify, and the dialog reopened after a successful save). Keep the `form-` and
`dialog-` key prefixes distinct for the same reason.

The wrong web password counts toward the sign-in lockout (shared counter,
[auth-rate-limiting.md](auth-rate-limiting.md)); the SSH check does not.
`PasswordInput` (`password-input.tsx`) is the field with its show/hide toggle, a ghost `Button` over an
`Input` (the target's `InputGroup` does not take the canon `host` prop yet).

### Web Port (`web-port/web-port-card.tsx`)

HTTP and HTTPS fields sit side by side on a wide card, each row carrying a one-line description like every
other row group. `PORT_GRID` is `content-start`: the grid sits in a `GROUP_FILL` group that grows to the
cell's height, and a default `align-content: stretch` would spread the two rows across all of it. The card keeps its confirm dialog
and its post-save redirect, which now lands on `/system-settings/device-access/` on the new
origin (it used to land on `/system-settings/`).

---

## Hardware (`/system-settings/hardware`)

"How Ethernet traffic and a connected host reach the modem's hardware." Route
`app/system-settings/hardware/page.tsx` ->
`components/system-settings/hardware/hardware.tsx`. A symmetric 2-up of two cards, each with
its own hook.

| Card | Component | Data |
| --- | --- | --- |
| Hardware Offload | `ipa-offload/ipa-offload-card.tsx` | `useIpaOffload()` ([diagnostics.md](../features/diagnostics.md)) |
| Host AT Ports | `at-engine/host-at-ports-card.tsx` | `useHostAtPorts()` ([at-broker.md](../features/at-broker.md)) |

### Hardware Offload (`ipa-offload-card.tsx`)

A draft-and-apply card. An On/Off `SegmentedField` edits a local draft, committed from
`CardFoot` (status left, "Takes effect after a reboot."; Discard, then an Apply
`SaveButton`). It replaces the old bare `Switch`, which saved the moment it was toggled.

- Apply POSTs as before. On success it calls `requestRebootLater("ipa_offload")` (the
  deferred-reboot banner) and toasts; on failure it toasts the returned reason.
- The status is drawn, not listed: a path diagram (Ethernet forking into a Hardware lane and a CPU lane,
  merging into Cellular) shows both ways traffic can go and lights the one in use. There is no On/Off chip:
  the head shows a warning "Pending reboot" chip only while the pending-reboot flag's source is `ipa_offload`
  (the diagram is then drawn still, since the saved state is not yet running), and while a draft is open the
  diagram draws it still under a Preview tag. See [Path diagram](#path-diagram-hardwarepath-diagramtsx).
- Firmware without the vendor init script (`available: false`) shows a neutral "Not on this
  modem" state instead of a disabled switch.

> ℹ️ NOTE: `useIpaOffload().setEnabled` returns `{ ok, error? }` (`IpaOffloadMutationResult`, `types/ipa-offload.ts`)
> instead of a boolean, so the card toasts the call's own failure reason. A failed save no
> longer sets the hook's load `error`, so it cannot flip the card to its unreachable state.

### Host AT Ports (`host-at-ports-card.tsx`)

On/Off for the vendor host AT bridge ([at-broker.md](../features/at-broker.md)). It gained
dedicated unreachable-state copy (`host_at.{unavailable_title,error_title,error_description}`)
with the move.

Its status is the same kind of diagram: Computer through the USB (or PCIe) port, and QManager through its
built-in link, both into the Modem. QManager's lane is always lit and flowing; the computer's lane follows
`running`, and with host access off it rests with an X on its line, so turning access off visibly cuts only the
computer's path. No status chip; a draft is drawn still under a Preview tag.

### Path diagram (`hardware/path-diagram.tsx`)

The Hardware pair's status visual, in the spirit of Traffic Engine's handshake strip but drawn as a route:
nodes joined by routes, read left to right, with two lanes between the ends so a reader sees there are two
ways and which one is used. One end may be a lone node (a disc over its name) that forks into (or merges out
of) both lanes; every other node is a pill holding its disc and name, and the pills in a column share a width.

- **Routes.** The grid places the nodes; the routes are one SVG under them, measured from where the nodes
  actually landed (a `ResizeObserver` on the field and every node), so a line always meets a node's edge
  whatever the label or locale. A fork leaves its lone source as one trunk and bends into each lane on
  rounded elbows at one shared column; a merge bends both lanes back into one trunk, so the sink takes a
  single arrow. The route in play is drawn after the resting one, so it owns any shared trunk.
- **Colour.** Green is spent only on the discs in play (`success` with `success-foreground`, the filled
  check-disc green, user call 2026-10-20) and the beads; resting lone discs sit on `surface-container-high`,
  a resting chip's disc lets the pill show. Lines are never green: the route in play takes
  `on-surface-variant`, a resting one the quieter `outline`. A shut lane carries an X in a small
  `destructive-container` disc on its own leg and loses its inbound arrow. Names take `on-surface` in play,
  `on-surface-variant` at rest, so state never rides on colour alone.
- **Flow.** While `live` (the drawing is the real running state), beads travel each route in play end to end,
  from the source's centre to the sink's, slipping under every opaque node they pass through: two
  zero-length round-capped dashes on a `pathLength="100"` path with a `0 50` pattern, walked by
  `animate-path-flow` in `app/globals.css` (on the `ambient` token, `linear` because it is a continuous
  stream, `motion-safe:` only). Under Reduced the beads are not drawn, so the routes are still solid lines. A
  draft (Preview) or a pending reboot passes `live={false}` and draws the same picture still. This is the
  third sanctioned loop in DESIGN.md > The One-Loop Rule (2026-10-20).
- **Layout.** It rides on the card's `ROW_GROUP` rather than wrapping itself in a tile (The One-Nest Rule);
  geometry is `PATH` in `shapes.ts`, pinned so `SKELETON_HARDWARE.PATH` mirrors it. On a narrow card (path
  container under 22rem) the lane names drop when a named pair feeds the lanes (Host AT), since each route is
  already named by its ends; Hardware Offload keeps every name and fits a 243px field.
- **Motion.** Nodes fade in and lines draw on along `rowCascadeDelay`; a state change is a fill and ink
  transition on the `standard` clock. Copy lives under `ipa_offload.path_*` and `host_at.path_*`.

---

## The status band

Three tiles, all reading data the page already fetches. No new endpoint, no poller.

| Tile | Source | States |
| --- | --- | --- |
| Time zone | `settings.zonename` | unreachable, unread, saved |
| Next reboot | `scheduled_reboot` | unreachable, unread, off, no_day, armed |
| Tracked SIMs | `known_sims.sh` count | count, unknown (`—`), none |

Each tile derives **one state union** and reads tone and glyph from a `Record`-typed
face map, so the value line, the caption and the disc cannot answer the same question
differently. Every state carries its own glyph: `success-container` and
`warning-container` measure 1.03:1 apart, so the glyph is the only separator a tile has.

The band takes `knownLoading` separately from `isLoading`: the known-SIMs set has its own
GET and can land later, and without it the tile would show a confident `0`.

---

## i18n

Subtrees: `page`, `band`, `preferences`, `reboot`, `ssh`, `known_sims`,
`device_access`, `hardware`, `web_port`, `ipa_offload`, `host_at`, in all five packs (en,
zh-CN, zh-TW, it, id). The regroup added `device_access.page.{title,description}`,
`hardware.page.{title,description}`,
`ipa_offload.{status_on,status_off,reboot_note,discard,unavailable_title,error_title,error_description}`,
`host_at.{unavailable_title,error_title,error_description}` and
`web_port.{error_title,error_description}`; `sidebar.json` gained `items.device_access` and
`items.hardware`. The pre-port `system`, `scheduled_operations` and `ssh_password`
subtrees are deleted.

- **Casing lives in the class, never the leaf.** `EYEBROW` carries `uppercase`.
- **No middle-dot glue** between short facts.
- A backend reason is never spliced into a sentence: it arrives already translated
  through `resolveErrorMessage`, or the caller shows its own generic line.

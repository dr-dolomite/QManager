# Connection Watchdog (`qmanager_watchcat`)

`qmanager_watchcat` is QManager's connection health daemon. It monitors internet reachability via the ping daemon's output and, when connectivity fails or degrades, executes a tiered recovery ladder: network re-registration → radio toggle → SIM failover → system reboot. The daemon is opt-in and disabled by default on fresh installs.

---

## Quick Reference

| Item | Value |
|---|---|
| Daemon | `scripts/usr/bin/qmanager_watchcat` → `/usr/bin/qmanager_watchcat` |
| CGI endpoint | `GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh` |
| CGI script | `scripts/www/cgi-bin/quecmanager/monitoring/watchdog.sh` |
| UCI section | `quecmanager.watchcat` |
| Daemon state file | `/tmp/qmanager_watchcat.json` |
| Reachability input | `/tmp/qmanager_ping.json` (written by `qmanager_ping`) |
| Quality input | `/tmp/qmanager_status.json` `.connectivity` (written by `qmanager_poller`) |
| Recovery active flag | `/tmp/qmanager_recovery_active` |
| Maintenance lock | `/tmp/qmanager_watchcat.lock` |
| Config reload flag | `/tmp/qmanager_watchcat_reload` |
| Reboot log | `/etc/qmanager/crash.log` |
| Reboot? | Tier 4 only (deferred via `sleep 1 && reboot` after state write) |
| Frontend hook | `hooks/use-watchdog-settings.ts` |
| Frontend card | `components/monitoring/watchdog/watchdog-settings-card.tsx` |
| Audit reference | `docs/2026-05-12-watchdog-sim-failover-audit-fixes.md` |

---

## How It Works (End-to-End)

The watchdog has **two independent ways to decide "the connection is bad," and both pull the same recovery lever.** They are not two features — they are two *triggers* feeding one engine. This is why the settings UI merges them into one tabbed card with a single save.

```
        ┌─────────────────────────────────────────────────┐
        │         CONNECTION WATCHDOG (enabled = 0/1)       │
        └─────────────────────────────────────────────────┘
                              │
              master OFF → daemon exits at the enable gate.
              Nothing below runs (neither trigger evaluates).
                              │ master ON
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │            qmanager_watchcat  (single while-loop)         │
   │                                                            │
   │   TRIGGER A: Reachability        TRIGGER B: Quality        │
   │   (always on)                    (opt-in — green tab dot)  │
   │   reads qmanager_ping.json       reads status.json         │
   │   "can I reach anything?"        ".connectivity"           │
   │   fail × max_failures            "is it good enough?"      │
   │        │                         latency OR loss breach    │
   │        │                         × quality_consecutive     │
   │        │                              │                    │
   │        └──────────────┬───────────────┘                    │
   │     recovery_reason=          recovery_reason=             │
   │       "unreachable"             "quality"                  │
   │                       ▼                                    │
   │            find_next_tier 1 → do_recovery                  │
   │                                                            │
   │   THE SHARED LADDER (climbs on repeat failure):           │
   │     Tier 1 ─ Network re-registration (AT+COPS)            │
   │     Tier 2 ─ Radio toggle (AT+CFUN)                       │
   │     Tier 3 ─ SIM failover (off by default)               │
   │     Tier 4 ─ System reboot ◄── BOTH triggers can reach    │
   │                                this, gated only by the     │
   │                                Tier 4 enable flag + the    │
   │                                reboot-per-hour token bucket│
   │   After acting → COOLDOWN (reason-aware success test) →    │
   │   restored? back to MONITOR : escalate to next tier.      │
   └──────────────────────────────────────────────────────────┘
```

**Both triggers share the ladder all the way to the top.** The trigger source (`recovery_reason`) does **not** cap the ladder height — `find_next_tier` and `do_recovery` never inspect it. A sustained Connection Quality breach that Tier 1 (re-register) and Tier 2 (radio toggle) fail to fix **will escalate to Tier 4 (reboot)**, exactly as a full outage would, provided Tier 4 is enabled (the default). This is deliberate: a degraded link is often a stuck RF/attach condition that only a radio cycle or reboot clears, so capping quality at the gentle tiers would let the watchdog watch the link rot without applying the fix that works.

The only thing that stops a quality breach from rebooting is therefore **not** the trigger — it is (1) the Tier 4 **enable flag** (uncheck it and *neither* trigger can reboot) and (2) the **`max_reboots_per_hour` token bucket**, which auto-disables the daemon when exhausted (§8). "Can quality reboot?" reduces to "is Tier 4 enabled and is the token bucket unexhausted?", never to which sensor fired.

The trigger source changes only two things, both at cooldown time, never the ladder:

| Aspect | Reachability (`"unreachable"`) | Quality (`"quality"`) |
|---|---|---|
| Ladder range | Tier 1 → 4 | **Tier 1 → 4 (identical)** |
| Cooldown success test | fresh ping `reachable = true` | fresh `read_quality` not breaching ceilings |
| Tier 3 SIM-failover finalization | runs | **skipped** (meaningless for latency/loss) |
| Tier 4 token bucket | applies | **applies identically** |

See §5 (Reason-aware cooldown) for *why* the success test must differ: a degraded link reports `reachable = true` the whole time, so judging a quality recovery by reachability would always declare false success and the daemon would burn through every tier in seconds.

---

## Dual-Trigger Model

The watchdog has two independent paths into the recovery ladder.

**Reachability trigger (always active when watchdog is enabled):** The daemon reads `qmanager_ping.json` every cycle. If `streak_fail` rises above `max_failures` consecutive cycles, the reachability path fires, sets `recovery_reason="unreachable"`, and runs `do_recovery`.

**Quality trigger (opt-in, `quality_enabled=0` by default):** On every cycle while in `monitor` or `suspect` state, the daemon also calls `evaluate_quality`. If either `avg_latency_ms` or `packet_loss_pct` exceeds its ceiling for `quality_consecutive` consecutive cycles, the quality path fires, sets `recovery_reason="quality"`, and runs the same `do_recovery` engine. `avg_latency_ms` reflects TCP-connect RTT (ICMP-comparable, not HTTP transaction time) — see the [probe mechanics note in connection-quality.md](connection-quality.md#probe-mechanics).

The two paths are independent. Each has its own counter. A quality breach does not advance the reachability `failure_counter`, and vice versa.

---

## State Machine

```
MONITOR ──── streak_fail > 0 ─────────────────→ SUSPECT
   ↑                                                │
   │           quality breach × consecutive         │ failure_counter >= max_failures
   │         ↗ (evaluate_quality)                   │   (or quality threshold)
   │ (restored)                                     ▼
   │                                         SSR_HOLD ── grace expired? ──→ RECOVERY
   │                                             │                              │
   │                                    connectivity                            │
   │                                     returned                               │
   │ ←──────────────────────────────────────────┘                              │
   │ (restored)                              RECOVERY → do_recovery() → COOLDOWN
   │                                                                        │
   └──────────────── connectivity/quality restored ────────────────────────┘
   └──────────────── escalate: find_next_tier ─────→ SUSPECT (re-enter)

LOCKED  ← any maintenance condition (lock file / long-running AT / profile apply)
DISABLED ← Tier 4 auto-disabled after max_reboots_per_hour exhausted
```

`evaluate_quality` runs only in `monitor` and `suspect` states, never during `cooldown`, `locked`, or `ssr_hold`.

---

## Recovery Tier Ladder

| Tier | Action | AT commands | Skip condition |
|---|---|---|---|
| 1 | Network re-registration | `AT+COPS=2` → 2 s → `AT+COPS=0` | None — always runs if enabled |
| 2 | Radio toggle | `AT+CFUN=0` → 3 s → `AT+CFUN=1` | Tower lock active; long-running AT flag |
| 3 | SIM failover | `AT+CFUN=0` → `AT+QUIMSLOT=N` → `AT+CFUN=1` (Golden Rule) | No backup slot; already on backup slot |
| 4 | System reboot | `sleep 1 && reboot` | Token bucket: `max_reboots_per_hour`; auto-disables on breach |

**Why Tier 1 uses AT+COPS, not ifdown/ifup:** `ifdown wan; ifup wan` bounces only the host-side network interface. It has no effect on a stalled modem attach — the modem's radio connection to the cell tower is independent of the host interface state. `AT+COPS=2` (forced manual mode, deregisters) followed by `AT+COPS=0` (auto mode, re-registers) tells the modem to drop and re-initiate the network registration procedure, which is the correct action for a stalled attach.

**Why Tier 2 is skipped under tower lock:** `AT+CFUN=0/1` power-cycles the radio subsystem and clears all tower lock state. Doing that while the user has a tower lock configured would silently undo their lock.

**Why Tier 3 is off by default (`tier3_enabled=0`):** SIM failover requires a backup SIM to be configured and present. Enabling it without a backup slot results in the tier being skipped silently every cycle. The frontend requires a backup slot to be selected before Tier 3 can be saved as enabled.

---

## UCI Configuration Schema

### Full watchcat section

Seeded by `ensure_watchcat_config()` in `watchdog.sh` on first CGI GET, and by `install.sh`'s `seed_uci_defaults()` for the quality keys specifically.

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `enabled` | 0/1 | 0 | Master on/off for the daemon |
| `max_failures` | int 1–20 | 5 | Consecutive failed ping cycles before recovery |
| `check_interval` | int 5–60 | 10 | Seconds between cycles |
| `cooldown` | int 10–300 | 60 | Seconds to wait after a recovery action before evaluating success |
| `tier1_enabled` | 0/1 | 1 | Enable Tier 1 (re-registration) |
| `tier2_enabled` | 0/1 | 1 | Enable Tier 2 (radio toggle) |
| `tier3_enabled` | 0/1 | 0 | Enable Tier 3 (SIM failover) |
| `tier4_enabled` | 0/1 | 1 | Enable Tier 4 (reboot) |
| `backup_sim_slot` | 1/2 | (empty) | SIM slot for Tier 3 failover |
| `max_reboots_per_hour` | int 1–10 | 3 | Tier 4 token bucket; auto-disables at limit |

### Quality trigger keys

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `quality_enabled` | 0/1 | 0 | Master opt-in for quality triggering |
| `latency_ceiling_ms` | int 0–10000 | 800 | `avg_latency_ms` ceiling (TCP-connect RTT, ICMP-comparable); **0 = ignore latency** |
| `loss_ceiling_pct` | int 0–100 | 20 | `packet_loss_pct` ceiling; **0 = ignore loss** |
| `quality_consecutive` | int 1–60 | 5 | Consecutive breach cycles before recovery fires |

### SSR-aware hold keys

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `ssr_aware` | 0/1 | **1 (ON)** | Hold the recovery ladder while a recoverable baseband restart self-heals |
| `ssr_grace` | int 10–120 | 45 | Seconds to hold before falling through to the normal ladder |

Both SSR keys are seeded in `install.sh`'s `seed_uci_defaults()` (idempotent, preserves user choice on upgrade) **and** lazily seeded in `ensure_watchcat_config()` on the first CGI GET. Missing keys in `read_config()` in the daemon default to `CFG_SSR_AWARE=1` / `CFG_SSR_GRACE=45`, so existing installs that have not yet received the CGI GET benefit from the hold behaviour immediately after upgrade, even before any settings page visit.

> ℹ️ NOTE: The installer seeds only the quality keys and SSR keys via `seed_uci_defaults()`, not the full watchcat section. The rest of the section is seeded lazily on the first CGI GET by `ensure_watchcat_config()`. This preserves existing user configuration on upgrade.

---

## SSR-Aware Hold

### What an MPSS SSR is

The Qualcomm RM551E (and RM520N-class) modems run their radio firmware on a separate processor called the MPSS (Modem Processor SubSystem). Under certain radio conditions, the MPSS can encounter a fatal error and restart itself — logged in the kernel ring buffer as:

```
4080000.remoteproc-mss: fatal error received
```

This is a **recoverable** baseband subsystem restart (SSR). The remoteproc framework brings the MPSS back up automatically in ~3–4 seconds; the data path is restored in roughly 10–25 seconds. The modem self-heals. This is a firmware-level event that QManager does not cause and cannot prevent.

### The amplification problem

The watchdog's quality trigger (if enabled with an aggressive profile) or the reachability trigger both check connectivity on every cycle. During a self-healing SSR, the ~10–25 second data-path interruption looks identical to a stuck connection: reachability fails, the failure counter climbs, and the watchdog fires Tier 1 (`AT+COPS=2 → AT+COPS=0`) or Tier 2 (`AT+CFUN=0/1`) recovery actions. Each of those commands forces a network detach — ON TOP of a modem that is already mid-self-heal. The result: what should have been a 30–60 second self-correcting outage becomes a multi-minute thrash loop because QManager keeps deregistering the modem before it can re-attach.

### The hold mechanism

When `ssr_aware=1` (the default), the daemon intercepts at BOTH recovery initiation sites — the reachability threshold in the main loop's `suspect|ssr_hold` branch AND the quality threshold inside `evaluate_quality` — and calls `ssr_hold_gate()` before proceeding to `do_recovery`.

**`ssr_in_progress()` — the dmesg evidence check:**

The function runs `dmesg` once and greps for the shared crash prefix:

```
4080000.remoteproc-mss: fatal error received
```

This prefix is chosen deliberately to be firmware-variant-agnostic — it does NOT match the per-build `.c:line` suffix that varies across RM520N/RM551E builds. It takes the last matching line (`tail -n 1`), extracts the leading integer seconds from the BusyBox dmesg timestamp format (`[ 12345.678901]`) via awk field-splitting on `[][. ]+`, and compares to `/proc/uptime` (integer seconds since boot). If the crash line exists and its timestamp is within `CFG_SSR_GRACE` seconds of now, the function returns true.

Graceful-degradation rule: **if dmesg yields nothing, the crash line was evicted from the ring buffer, or the timestamp fails to parse, `ssr_in_progress()` returns false and the daemon behaves exactly as before this feature existed.** The hold is best-effort; it is never a correctness dependency.

**Hold posture:**

When `ssr_hold_gate()` decides to hold (either starting a new hold or continuing an existing one):

- State is set to `"ssr_hold"`.
- `ssr_hold_started` records the monotonic uptime in integer seconds.
- `last_ssr_detected` records the same value (written to the state file).
- `do_recovery` is skipped for that cycle. `current_tier` is NOT advanced. No AT commands are issued. No cooldown is entered.

While holding, each cycle re-evaluates. The merged `suspect|ssr_hold` case in the main loop checks reachability every cycle:

- **Connectivity returns (modem self-healed):** The `ping_reachable=true && ping_streak_fail=0` branch runs, `ssr_hold_clear()` is called, and state returns to `monitor`. No recovery ladder ran; no forced detach occurred.
- **Grace window expires (`held >= CFG_SSR_GRACE`):** `ssr_hold_gate()` resets `ssr_hold="false"` and returns 1 (do NOT hold). The normal ladder runs from `current_tier` (which was found by `find_next_tier` before the hold began, so there is no tier-skip on fall-through). This handles the genuine stuck/AP-hang case where the modem did NOT self-recover.

`ssr_hold` is also cleared unconditionally on LOCKED-state entry and exit (via `ssr_hold_clear()`), so a maintenance window never carries stale hold state in or out.

**Quality-path nuance:** When the quality trigger fires and `ssr_hold_gate()` returns hold, `evaluate_quality` returns 0 (triggering caller skips), leaving state as `"ssr_hold"` and returning to the main loop's `write_state + sleep`. On the next cycle, the merged `suspect|ssr_hold` case re-evaluates reachability. If the modem has self-healed and the link is both reachable AND the quality breach counter has already been reset (it was reset to 0 before `ssr_hold_gate` was called), the hold clears naturally. This is safe: the dominant amplification risk (forced COPS/CFUN detach on the reachability ladder) is fully held, and a quality-triggered hold that resolves via the reachability path is correct because the modem is healthy again.

**Why this defaults ON:** Users affected by the amplification problem will not know to enable the feature. A user who has never seen an MPSS SSR pays no cost (the dmesg grep runs only at escalation decision time, not every cycle), while an affected user benefits immediately on upgrade.

---

## Quality Trigger Invariants

### 1. Ceiling 0 means ignore that metric

Setting `latency_ceiling_ms=0` skips the latency check entirely. Setting `loss_ceiling_pct=0` skips the loss check. If both are 0 while `quality_enabled=1`, the trigger can never fire. The frontend blocks saving this combination when quality is enabled — at least one ceiling must be greater than 0.

### 2. Data source and staleness guard

Latency and loss come from `status.json` `.connectivity.avg_latency_ms` and `.connectivity.packet_loss_pct`, which are written by the poller. `avg_latency_ms` is TCP-connect RTT (milliseconds), not HTTP transaction time — values are ICMP-comparable (typically 35–65 ms on a healthy cellular link). The default `latency_ceiling_ms` of 800 ms is therefore very generous headroom (~10–20× normal RTT). The `.connectivity` object has no timestamp of its own, so freshness is judged from the root `.timestamp` field against `STATUS_STALE_THRESHOLD=30` seconds.

A stale or missing `status.json` is treated as NO-SIGNAL: the `evaluate_quality` function returns early, and the breach counter is left unchanged. A stale poller is never treated as a healthy 0% loss reading.

**Why:** The poller could have crashed or been restarted. Treating the absence of data as 0% loss would mean a dead poller looks like a perfect connection, causing the quality trigger to never fire even when the link is genuinely bad. The NO-SIGNAL policy is the conservative choice.

### 3. Float comparison must use awk

`avg_latency_ms` in `status.json` is a decimal string (e.g. `"1241.4"`). BusyBox `[ "1241.4" -gt 800 ]` returns exit code 2 — it does not evaluate the comparison, it errors. Latency comparison therefore uses awk:

```sh
awk -v a="$q_avg_latency" -v c="$CFG_LATENCY_CEILING_MS" \
    'BEGIN{ exit !((a+0) > (c+0)) }'
```

`packet_loss_pct` is an integer in the source; it is safe to use `[ -ge ]` after null/empty → 0 sanitisation.

> ⚠️ WARNING: This is a reusable BusyBox gotcha. Any shell script that compares a value sourced from the poller's `avg_latency_ms` with `[ -gt ]` will silently misbehave. Always use awk for float comparisons.

### 4. Separate counter, shared ladder

The quality path maintains `quality_breach_counter` independently of the reachability path's `failure_counter`. On reaching `quality_consecutive` breaches, `evaluate_quality` resets `quality_breach_counter` to 0, sets `recovery_reason="quality"`, and calls `do_recovery` — the same Tier 1→4 engine used by the reachability path. The reachability path sets `recovery_reason="unreachable"`.

### 5. Reason-aware cooldown

`finish_cooldown()` branches on `recovery_reason` to choose its success criterion.

- **`recovery_reason="unreachable"`:** Success = `ping_reachable=true` from a fresh `qmanager_ping.json` read. If this was Tier 3, finalize SIM failover state.
- **`recovery_reason="quality"`:** A degraded-but-reachable link reports `reachable=true` throughout, so the reachability check would always declare success. Instead, success is a fresh `read_quality` call that does NOT breach the configured ceilings (`!quality_breached`). Tier-3 SIM failover finalization is NOT run from the quality path — that finalization is only meaningful for connectivity failures, not latency/loss scenarios.

**Why:** Without this branch, a quality-triggered recovery on a link that is reachable but slow would always be declared "restored" at cooldown, even if the link is still slow. The daemon would cycle through all tiers in quick succession.

### 6. States where evaluate_quality runs

`evaluate_quality` is called at the bottom of the main loop only when `state = "monitor"` or `state = "suspect"`. It does not run during `cooldown`, `locked`, `recovery`, or `ssr_hold`. The `ssr_hold` exclusion is intentional — running quality evaluation while the modem is mid-SSR-self-heal would re-trigger the quality path and immediately re-enter the hold or the ladder, defeating the purpose. The quality breach counter is reset on:
- Natural `suspect → monitor` recovery.
- LOCKED state entry and exit.
- Quality trigger firing (counter resets to 0 before `do_recovery`).
- Quality cooldown success.

### 7. Effective detection latency

`avg_latency_ms` and `packet_loss_pct` in `status.json` are already computed as windowed averages over approximately 60 samples by the poller. Setting `quality_consecutive=5` with `check_interval=10` means the watchdog requires 50 seconds of consecutive breaches of an already-smoothed metric. Real detection time is roughly `quality_consecutive × check_interval` on top of the poller's averaging window. Do not expect instant reaction to a brief spike.

### 8. Reboot-loop safety

A persistently degraded link that escalates to Tier 4 is bounded by the existing `max_reboots_per_hour` token bucket. On reaching the limit, the daemon auto-disables by writing `quecmanager.watchcat.enabled=0` to UCI and exiting. `quality_enabled` being default-off is the first safety layer; the token bucket is the second.

---

## Daemon State File (`/tmp/qmanager_watchcat.json`)

Written atomically via `STATE_TMP` → `mv`. The CGI GET passes the full file contents through as the `status` field in the response, so the frontend settings page receives it automatically.

| Field | Type | Meaning |
|---|---|---|
| `timestamp` | int (epoch) | When state was last written |
| `enabled` | bool | Whether daemon is enabled |
| `state` | string | Current state: `monitor`/`suspect`/`recovery`/`cooldown`/`locked`/`disabled`/`ssr_hold` |
| `current_tier` | int | Active recovery tier (0 = none) |
| `failure_count` | int | Reachability failure counter |
| `last_recovery_time` | int or null | Epoch of last recovery action |
| `last_recovery_tier` | int or null | Tier of last recovery action |
| `total_recoveries` | int | Total recovery actions since daemon start |
| `cooldown_remaining` | int | Seconds remaining in cooldown |
| `sim_failover_active` | bool | Whether modem is currently on the backup SIM |
| `original_sim_slot` | int or null | SIM slot before Tier 3 |
| `current_sim_slot` | int or null | Current SIM slot |
| `reboots_this_hour` | int | Reboots from crash.log in last 3600s |
| `quality_breach_count` | int | Current consecutive quality breach counter |
| `quality_enabled` | bool | Reflects `CFG_QUALITY_ENABLED` at time of write |
| `last_recovery_reason` | string | `"unreachable"` or `"quality"` |
| `ssr_hold` | bool | Whether the daemon is currently holding the recovery ladder for an in-progress SSR self-heal |
| `last_ssr_detected` | int or null | Monotonic seconds since boot when the most recent MPSS crash line was detected; null if no SSR has been seen this session |

> ℹ️ NOTE: The poller re-emits a `watchcat` object into `status.json`, but it does NOT yet carry `quality_breach_count`, `quality_enabled`, `last_recovery_reason`, `ssr_hold`, or `last_ssr_detected`. The overview card reads `state` from the poller's re-emit (the poller passes `.state` verbatim, so `"ssr_hold"` flows from daemon → state file → poller → `modemStatus.watchcat.state` → the overview card without any poller change). The breach counter and SSR timestamp are available only via the CGI GET passthrough of the full state file. A live breach-counter readout in the watchdog status card is a deliberate follow-up feature, out of scope for this change.

---

## CGI Envelope

### GET `/cgi-bin/quecmanager/monitoring/watchdog.sh`

Returns current UCI settings, live daemon state, SIM failover state, SIM swap detection, and auto-disabled flag.

**Response shape:**

```json
{
  "success": true,
  "settings": {
    "enabled": false,
    "max_failures": 5,
    "check_interval": 10,
    "cooldown": 60,
    "tier1_enabled": true,
    "tier2_enabled": true,
    "tier3_enabled": false,
    "tier4_enabled": true,
    "backup_sim_slot": null,
    "max_reboots_per_hour": 3,
    "quality_enabled": false,
    "latency_ceiling_ms": 800,
    "loss_ceiling_pct": 20,
    "quality_consecutive": 5,
    "ssr_aware": true,
    "ssr_grace": 45
  },
  "status": { ... },
  "sim_failover": { "active": false },
  "sim_swap": { "detected": false },
  "auto_disabled": false
}
```

`status` is the raw contents of `/tmp/qmanager_watchcat.json`; it is `{}` if the file is absent (daemon not yet started). `settings.backup_sim_slot` is `null` if the UCI value is empty.

### POST `/cgi-bin/quecmanager/monitoring/watchdog.sh`

Three actions are supported.

**`save_settings`** — validate and write all settings fields to UCI, touch the reload flag, and restart or stop the daemon as appropriate.

```json
{
  "action": "save_settings",
  "enabled": true,
  "max_failures": 5,
  "check_interval": 10,
  "cooldown": 60,
  "tier1_enabled": true,
  "tier2_enabled": true,
  "tier3_enabled": false,
  "tier4_enabled": true,
  "backup_sim_slot": null,
  "max_reboots_per_hour": 3,
  "quality_enabled": true,
  "latency_ceiling_ms": 800,
  "loss_ceiling_pct": 20,
  "quality_consecutive": 5,
  "ssr_aware": true,
  "ssr_grace": 45
}
```

**`dismiss_sim_swap`** — sets `.dismissed = true` in `/tmp/qmanager_sim_swap_detected`.

**`revert_sim`** — writes `/tmp/qmanager_watchcat_revert_sim`; the running daemon picks it up within one cycle.

**POST success:**

```json
{ "success": true }
```

**POST validation errors:**

```json
{ "success": false, "error": "invalid_field", "field": "latency_ceiling_ms", "reason": "must be integer 0-10000" }
```

| Field | Validation |
|---|---|
| `max_failures` | int 1–20 |
| `check_interval` | int 5–60 |
| `cooldown` | int 10–300 |
| `max_reboots_per_hour` | int 1–10 |
| `backup_sim_slot` | 1 or 2, or null/absent to clear |
| `latency_ceiling_ms` | int 0–10000 |
| `loss_ceiling_pct` | int 0–100 |
| `quality_consecutive` | int 1–60 |
| `ssr_grace` | int 10–120 |
| `ssr_aware` | boolean |

> ℹ️ NOTE: The CGI error envelope uses `reason` rather than `detail` for field validation errors (field-level errors need to name the field). The hook `useWatchdogSettings` passes `json.reason` as the `detail` argument to `resolveErrorMessage`.

---

## Apply / Reload Pipeline

```
POST save_settings
  ↓
Validate fields
uci commit quecmanager
touch /tmp/qmanager_watchcat_reload
  ↓
if enabled:
    /etc/init.d/qmanager_watchcat enable
    /etc/init.d/qmanager_watchcat restart (fire-and-forget)
    rm -f /tmp/qmanager_watchcat_disabled
else:
    /etc/init.d/qmanager_watchcat stop
    /etc/init.d/qmanager_watchcat disable
  ↓
Running daemon: checks RELOAD_FLAG at top of each loop iteration,
calls read_config(), removes flag.
```

Config changes take effect within one `check_interval` cycle (5–60 s). No full daemon restart is needed for quality ceiling or consecutive changes when the daemon is already running.

---

## Frontend Files

The page was redesigned (June 2026) from one monolithic settings card into a
uniform grid of grouped cards (the Custom SIM Profiles shape), split along the
backend's own dual-trigger model: Status → Recovery Triggers → Recovery Ladder.
The two triggers (reachability + quality) share one card via tabs. Because the
backend save is atomic (one `save_settings` POST), all cards share a single
form-state coordinator and one save action, and the Save / Discard pair lives in
the Triggers card footer (it commits every pending change on the page, not just
that card's tab).

| File | Purpose |
|---|---|
| `hooks/use-watchdog-settings.ts` | Fetch (30s poll) + save + SIM-dismiss/revert; types `WatchdogSettings`, `WatchdogLiveStatus` |
| `components/monitoring/watchdog/watchdog.tsx` | Page coordinator: owns `useWatchdogSettings`, remounts the form on a settings signature, lays out the card grid |
| `components/monitoring/watchdog/use-watchdog-form.ts` | Single form-state coordinator: all 16 fields, validation (mirrors CGI ranges), dirty check, `submit`, `discard` |
| `components/monitoring/watchdog/watchdog-overview-card.tsx` | Master toggle (in `CardAction`) + live state hero + pill-tiles + SIM-failover revert; reads `useModemStatus` (5s) |
| `components/monitoring/watchdog/watchdog-triggers-card.tsx` | Tabbed card: Reachability (always-on) + Connection Quality (opt-in, with live tab dot); owns the shared Save / Discard footer |
| `components/monitoring/watchdog/watchdog-recovery-ladder.tsx` | Numbered Tier 1→4 escalation stepper; backup-SIM picker nested in Tier 3, reboot cap in Tier 4. The SSR-aware gate control ("step zero") sits above the numbered ladder on a muted surface. |
| `components/monitoring/watchdog/sim-swap-banner.tsx` | SIM swap / SIM failover toast (rendered globally in `app-layout.tsx`) |

**`WatchdogSettings`** added `ssr_aware: boolean` and `ssr_grace: number`.

**`WatchdogLiveStatus`** added optional `ssr_hold?: boolean` and `last_ssr_detected?: number | null`. These are typed optional because older daemon versions will not emit them. The existing optional fields `quality_breach_count`, `quality_enabled`, and `last_recovery_reason` follow the same rule — consumers must handle their absence.

**`WatchcatState`** in `types/modem-status.ts` has `"ssr_hold"` as a union member. The poller passes the daemon's `.state` field verbatim, so `"ssr_hold"` reaches `modemStatus.watchcat.state` without any poller-side change.

**SSR-aware gate control (Recovery Ladder card):** The gate control lives at the top of `WatchdogRecoveryLadder` on a `bg-muted/20` surface, above the numbered `<ol>`. It renders a Switch (`ssr_aware`) with a `TbInfoCircleFilled` tooltip, and when the Switch is on, an animated-in grace-seconds `Input` field (range 10–120). This surface is disabled when the master watchdog switch is off (`masterOff`).

**SSR hold hero state (Overview card):** `STATE_META["ssr_hold"]` uses `tone: "info"`, `ActivityIcon`, and `pulse: true`. The badge reads "Letting Modem Self-Recover" and the blurb explains the modem is restarting its radio firmware. Info tone is deliberate — this is calm, expected behaviour, not a destructive state.

**i18n:** English keys in `public/locales/en/monitoring.json`: `status_badge_ssr_hold`, `state_blurb_ssr_hold`, `ssr_aware_label`, `ssr_aware_description`, `ssr_aware_tooltip`, `ssr_aware_more_info_aria`, `ssr_grace_label`, `ssr_grace_placeholder`, `ssr_grace_description`, `ssr_grace_error`. The `id`, `it`, `zh-CN`, and `zh-TW` locales are not yet translated; 40 i18n warnings appear at build time (fallback to `en` is configured via `fallbackLng: "en"`). A translation sweep for these locales is a tracked follow-up — not a bug.

---

## Known Gotchas

- **Float comparison is a hard requirement.** `avg_latency_ms` is decimal. BusyBox `[ "1241.4" -gt 800 ]` exits 2 (error), not false. Any future code path that reads this field and compares it with `[ -gt ]` or `[ -ge ]` will silently fail to compare. Use awk as shown in the `quality_breached` function.

- **Ceiling 0 is a disable, not a zero threshold.** `latency_ceiling_ms=0` does not mean "trigger if any latency is above 0 ms." It means ignore the latency metric entirely. This is intentional to allow users to watch only loss, or only latency, but it is counterintuitive.

- **Detection is not instantaneous.** The status.json latency/loss values are windowed averages over ~60 poller samples. A brief spike will be absorbed by the window. Only a sustained degradation lasting across `quality_consecutive × check_interval` seconds (on top of the poller's window) will trigger recovery.

- **Quality breach counter in the status card is a follow-up.** The status card currently reads from the poller's `watchcat` re-emit in `status.json`, which does not yet carry `quality_breach_count`. The actual counter is in `/tmp/qmanager_watchcat.json` and available via the CGI GET, but no status-card widget displays it yet. This is a known gap.

- **Stale poller = NO-SIGNAL, not healthy.** If `qmanager_poller` is dead or crashed, `status.json` goes stale. The quality trigger treats this as no-signal and freezes the breach counter. This is correct behavior, but it means a dead poller silently disables quality triggering. Check `/tmp/qmanager_status.json` root `.timestamp` if the quality trigger appears to not be evaluating.

- **Auto-disable persists across reboots (UCI).** When Tier 4 exhausts `max_reboots_per_hour`, it writes `quecmanager.watchcat.enabled=0` to UCI. This survives a reboot — the daemon won't restart even though procd is configured to do so (the init.d script checks `enabled` in UCI). Re-enabling via the settings page clears the disabled flag and restarts the daemon.

- **SSR hold is best-effort: dmesg ring-buffer eviction.** The kernel ring buffer is fixed-size. On a busy modem (e.g. a QCMAP bringup storm filling dmesg with interface events), the `4080000.remoteproc-mss: fatal error received` line can be evicted before `ssr_in_progress()` reads it. In that case `ssr_in_progress()` returns false and the daemon behaves exactly as if the feature did not exist — it falls straight through to the ladder. The hold is a de-amplifier, not a correctness requirement. The existing `max_reboots_per_hour` token bucket is the backstop.

- **Quality-triggered hold clears via the reachability path.** When a quality breach triggers an SSR hold, the hold resolves via the `suspect|ssr_hold` reachability check on subsequent cycles. If the modem self-heals and `ping_reachable=true && ping_streak_fail=0`, the hold clears and state returns to `monitor` — even though the recovery was quality-triggered, not reachability-triggered. This is intentional: the dominant amplification risk is the forced detach that happens during SSR self-heal, and the modem returning to a reachable state means the SSR self-heal succeeded. Do not be surprised if a quality-path hold shows a `suspect→monitor` transition in the log instead of a `ssr_hold→monitor` state label.

---

## On-Device Test Plan (Pending Live Modem)

The static audit passed. On-device verification was skipped in this round due to no SSH access. The following scenarios must be run on a real device when available.

**Scenario 1 — SSR detected, hold engaged:**
Trigger a real MPSS SSR (or wait for one on an affected RM551E). Within one `check_interval` after the SSR log line appears, check `/tmp/qmanager_watchcat.json` for `"state":"ssr_hold"` and `"ssr_hold":true`. Confirm the watchdog log (`/tmp/qmanager.log`) shows "Recoverable baseband SSR detected; holding recovery ladder" and that NO `AT+COPS` or `AT+CFUN` commands appear in the `qcmd` log during the grace window.

**Scenario 2 — Natural recovery during the hold:**
If the modem self-heals within the grace window, confirm `/tmp/qmanager_watchcat.json` transitions back to `"state":"monitor"` with `"ssr_hold":false`, and that the UI overview card returns to the green "Monitoring" hero without passing through a recovery or cooldown state.

**Scenario 3 — Grace window expiry, fallthrough to ladder:**
Extend the outage artificially past `ssr_grace` seconds (e.g. set `ssr_grace=10` and use a test mode that keeps connectivity down). Confirm the log shows "SSR-hold grace expired without recovery; releasing to ladder" and that Tier 1 (`AT+COPS=2 → AT+COPS=0`) then runs normally.

**Scenario 4 — Hold clears correctly on LOCKED entry and exit:**
While in `ssr_hold`, trigger a maintenance lock (create `/tmp/qmanager_watchcat.lock`). Confirm the log shows LOCKED state entered, `ssr_hold` cleared, and that removing the lock brings the daemon back to `monitor` with `ssr_hold=false` (no stale hold carried through).

**UI verification:** Save `ssr_aware=false` and confirm the CGI GET round-trips it correctly. Save `ssr_grace=30` and confirm it persists in UCI. Trigger the `ssr_hold` state (on a real SSR or by injecting state) and confirm the "Letting Modem Self-Recover" hero appears with the info tone and pulse.

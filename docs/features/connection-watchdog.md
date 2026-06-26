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
| Reachability input | `/tmp/qmanager_ping.json` `.ping_streak_fail` (raw probe count; written by `qmanager_ping`) |
| Quality input | `/tmp/qmanager_status.json` `.connectivity.avg_latency_ms` + `.packet_loss_pct` (windowed averages; written by `qmanager_poller`) |
| Quality thresholds | `quecmanager.quality_thresholds.*` (shared with Connection Quality Network Events) |
| Ping reload flag | `/tmp/qmanager_ping_reload` (touched by watchdog save when interval changes) |
| Recovery active flag | `/tmp/qmanager_recovery_active` |
| Maintenance lock | `/tmp/qmanager_watchcat.lock` |
| Config reload flag | `/tmp/qmanager_watchcat_reload` |
| SIM revert flag | `/tmp/qmanager_watchcat_revert_sim` (written by CGI `revert_sim` POST; consumed by daemon in `check_revert_request`) |
| SIM failover state | `/tmp/qmanager_sim_failover` (written when failover is finalized in cooldown) |
| Reboot log | `/etc/qmanager/crash.log` |
| Tier-3 settle floor | `SIM_SETTLE_SECS=90` s (hard-coded constant — not a UCI key); applies to both forward Tier-3 swap and user-requested revert |
| Reboot? | Tier 4 only (deferred via `sleep 1 && reboot` after state write) |
| Frontend hook | `hooks/use-watchdog-settings.ts` |
| Frontend card | `components/monitoring/watchdog/watchdog-settings-card.tsx` |

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
   │   ping_streak_fail >= fail_threshold "is it good enough?"  │
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

The thresholds that the quality trigger compares against come from the **shared `quecmanager.quality_thresholds.*` UCI section** — the same keys read by the Connection Quality Network Events. The watchdog resolves them via a local `resolve_quality_thresholds()` that handles the `custom` preset arm identical to the poller's resolver. There are no watchdog-private ceiling keys.

The trigger source changes only two things, both at cooldown time, never the ladder:

| Aspect | Reachability (`"unreachable"`) | Quality (`"quality"`) |
|---|---|---|
| Ladder range | Tier 1 → 4 | **Tier 1 → 4 (identical)** |
| Cooldown success test | fresh ping `reachable = true` | fresh `read_quality` not breaching ceilings |
| Tier 3 SIM-failover finalization | runs (via `finalize_sim_failover`) | **runs identically** (shared `finalize_sim_failover` call) |
| Tier 4 token bucket | applies | **applies identically** |

See §5 (Reason-aware cooldown) for *why* the success test must differ: a degraded link reports `reachable = true` the whole time, so judging a quality recovery by reachability would always declare false success and the daemon would burn through every tier in seconds.

---

## Dual-Trigger Model

The watchdog has two independent paths into the recovery ladder.

**Reachability trigger (always active when watchdog is enabled):** The daemon reads `qmanager_ping.json` every cycle and inspects the RAW `ping_streak_fail` integer — NOT the debounced `.reachable` boolean. If `ping_streak_fail` rises above `fail_threshold` consecutive failed probes, the reachability path fires, sets `recovery_reason="unreachable"`, and runs `do_recovery`.

**Why raw streak, not debounced reachable:** Before this change the watchdog read the debounced `.reachable` boolean and maintained its own `failure_counter` on top. Under a slow profile (e.g. `quiet` at 10 s interval), a single probe failure that already caused the ping daemon to flip `.reachable=false` was then counted AGAIN by the watchdog's counter — a double-debounce / re-count bug. Reading `ping_streak_fail` directly means the watchdog counts individual failed probes regardless of profile interval, and `fail_threshold` has a single canonical meaning: N consecutive failed probes, not N poller-cycle runs where `.reachable=false` happened to be sampled.

**Quality trigger (opt-in, `quality_enabled=0` by default):** On every cycle while in `monitor` or `suspect` state, the daemon also calls `evaluate_quality`. It compares `avg_latency_ms` and `packet_loss_pct` from `status.json` against the shared `quecmanager.quality_thresholds.*` UCI thresholds (the same thresholds that drive the Connection Quality Network Events). If either metric exceeds its resolved threshold for `quality_consecutive` consecutive cycles, the quality path fires, sets `recovery_reason="quality"`, and runs the same `do_recovery` engine. `avg_latency_ms` is the windowed average TCP-connect RTT (ICMP-comparable, not HTTP transaction time) — see the [probe mechanics note in connection-quality.md](connection-quality.md#probe-mechanics).

> ℹ️ NOTE: `packet_loss_pct` is maturity-gated by the poller. The poller suppresses loss% to 0 until the ping history ring buffer holds at least `PING_MIN_SAMPLES=10` samples (~20–100 s post-reboot depending on profile). A freshly-rebooted or freshly-restarted ping daemon cannot produce an inflated `packet_loss_pct` that trips this trigger. See the [Packet-loss maturity guard section in connection-quality.md](connection-quality.md#packet-loss-maturity-guard-ping_min_samples) for the full invariant and the root-cause history.

**Why shared thresholds:** The watchdog previously kept its own `latency_ceiling_ms` and `loss_ceiling_pct` keys in the watchcat UCI section. This meant two separate threshold stores that could silently diverge — the quality event would fire at one level and the watchdog would trigger at a different level on the same link. Unifying them onto `quecmanager.quality_thresholds.*` means one save in the Connection Quality UI adjusts both the event log and the recovery trigger simultaneously. Each side still maintains its own separate debounce counter (`quality_consecutive` for the watchdog; the poller's per-events consecutive gate for Network Events), so they can respond at different cadences without interfering.

The two paths are independent. Each has its own counter. A quality breach does not advance the reachability `failure_counter`, and vice versa.

---

## State Machine

```
MONITOR ──── streak_fail > 0 ─────────────────→ SUSPECT
   ↑                                                │
   │           quality breach × consecutive         │ ping_streak_fail >= fail_threshold
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
| 3 | SIM failover | `AT+CFUN=0` → `AT+QUIMSLOT=N` → `AT+CFUN=1` (Golden Rule); enforces ≥90 s cooldown settle floor | No backup slot; already on backup slot |
| 4 | System reboot | `sleep 1 && reboot` | Token bucket: `max_reboots_per_hour`; auto-disables on breach |

**Why Tier 1 uses AT+COPS, not ifdown/ifup:** `ifdown wan; ifup wan` bounces only the host-side network interface. It has no effect on a stalled modem attach — the modem's radio connection to the cell tower is independent of the host interface state. `AT+COPS=2` (forced manual mode, deregisters) followed by `AT+COPS=0` (auto mode, re-registers) tells the modem to drop and re-initiate the network registration procedure, which is the correct action for a stalled attach.

**Why Tier 2 is skipped under tower lock:** `AT+CFUN=0/1` power-cycles the radio subsystem and clears all tower lock state. Doing that while the user has a tower lock configured would silently undo their lock.

**Why Tier 3 is off by default (`tier3_enabled=0`):** SIM failover requires a backup SIM to be configured and present. Enabling it without a backup slot results in the tier being skipped silently every cycle. The frontend requires a backup slot to be selected before Tier 3 can be saved as enabled.

**Tier-3 settle floor (`SIM_SETTLE_SECS=90`):** A physical SIM swap on the RM551E takes ~90 seconds to reach stable connectivity. After any Tier-3 recovery action, the effective cooldown before the first success ping is `max(CFG_COOLDOWN, 90)`. This prevents `finish_cooldown` from firing the reachability check while the modem is still mid-attach — which would declare a false failure and escalate toward Tier 4 (reboot) on a swap that was actually fine. `cooldown_remaining` in the state file reflects the longer value so the UI countdown is honest. The 90 s is a hard-coded constant (`SIM_SETTLE_SECS=90` in the daemon) — it is NOT a UCI key and cannot be changed from the settings page.

---

## UCI Configuration Schema

### Full watchcat section

Seeded by `ensure_watchcat_config()` in `watchdog.sh` on first CGI GET, and by `install.sh`'s `seed_uci_defaults()` for the quality and probe-interval keys specifically.

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `enabled` | 0/1 | 0 | Master on/off for the daemon |
| `fail_threshold` | int 1–20 | 5 | Consecutive failed **probes** before reachability recovery fires. Counts raw `ping_streak_fail`, not poller cycles. Renamed from `max_failures` (migration in `install.sh`). |
| `check_interval` | int 5–60 | 10 | Seconds between watchdog evaluation cycles |
| `cooldown` | int 10–300 | 60 | Seconds to wait after a recovery action before evaluating success |
| `tier1_enabled` | 0/1 | 1 | Enable Tier 1 (re-registration) |
| `tier2_enabled` | 0/1 | 1 | Enable Tier 2 (radio toggle) |
| `tier3_enabled` | 0/1 | 0 | Enable Tier 3 (SIM failover) |
| `tier4_enabled` | 0/1 | 1 | Enable Tier 4 (reboot) |
| `backup_sim_slot` | 1/2 | (empty) | SIM slot for Tier 3 failover |
| `max_reboots_per_hour` | int 1–10 | 3 | Tier 4 token bucket; auto-disables at limit |
| `primary_recheck_enabled` | 0/1 | **0 (OFF)** | Enable automatic blind recheck of the primary SIM while running on the backup. Opt-in because each recheck is a real (brief) outage — the inactive primary slot cannot be passively health-checked. |
| `primary_recheck_interval` | int 5–1440 | 30 | Minutes between primary-SIM rechecks. Not seconds — a seconds cadence would cause a continuous outage loop. |

> ⚠️ WARNING: The RM551E uses a hard single-slot SIM mux (`AT+QUIMSLOT=?` → `(1,2)`). The inactive primary slot receives no radio signal and cannot be tested passively. Auto-failback is therefore a BLIND periodic swap-back-to-primary + retest. Every recheck attempt causes a brief connectivity interruption. This is why the feature is opt-in with a minutes-granularity interval, not seconds.

### Probe-interval ownership keys

The watchdog is the **sole writer** of `ping_profile.interval_override`. When an override is active, the Connection Sensitivity card in Connection Quality shows an informational Alert explaining that the watchdog is enforcing a custom interval. The profile Tabs in that card are NOT disabled — the selection becomes the fallback once the override is cleared.

| UCI Key | Section | Range | Default | Meaning |
|---|---|---|---|---|
| `probe_profile` | `watchcat` | `sensitive`/`regular`/`relaxed`/`quiet` | (unset) | Named profile the watchdog UI has selected; written to `ping_profile.profile` when saved |
| `interval_override` | `ping_profile` | int 1–60, or unset | unset | When set, overrides the profile-derived interval for `qmanager_ping`. Cleared by writing JSON `null` via the watchdog POST (which tests `has("interval_override")` to distinguish null-clear from absent). |

**Effective interval resolution** (in `qmanager_ping`): `interval_override` if set, else the profile→seconds map: `sensitive=1`, `regular=2`, `relaxed=5`, `quiet=10`. The GET response from `watchdog.sh` exposes both `interval_override` (raw) and `effective_interval` (resolved). The GET response from `ping_profile.sh` also surfaces both.

> ⚠️ WARNING: Only the watchdog writes `interval_override`. `ping_profile.sh` POST never touches this key — it writes only `profile`/targets and touches the ping reload flag. Hand-editing UCI or calling `ping_profile.sh` POST cannot override the interval; only a watchdog save can.

### Quality trigger keys

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `quality_enabled` | 0/1 | 0 | Master opt-in for quality triggering |
| `quality_consecutive` | int 1–60 | 5 | Consecutive breach cycles before recovery fires |

> ℹ️ NOTE: The old `latency_ceiling_ms` and `loss_ceiling_pct` keys in the `watchcat` section are **retired**. Thresholds now come from the shared `quecmanager.quality_thresholds.*` section described below. The migration in `install.sh`'s `seed_uci_defaults()` seeds any old ceiling values into `quality_thresholds` as the `custom` preset (800 ms latency / 20 % loss) so that users who had non-default values don't silently lose them.

### Shared quality threshold keys (owned by `quality_thresholds.sh`)

These live in `quecmanager.quality_thresholds` and are shared by both the watchdog and the Connection Quality Network Events. The watchdog resolves them at runtime via `resolve_quality_thresholds()`.

| UCI Key | Values | Default (absent) | Meaning |
|---|---|---|---|
| `latency_preset` | `standard`/`tolerant`/`very-tolerant`/`custom` | `tolerant` | Named latency threshold preset |
| `latency_custom_ms` | int 1–10000 | — | Custom latency ceiling in ms; present only when `latency_preset=custom` |
| `loss_preset` | `standard`/`tolerant`/`very-tolerant`/`custom` | `tolerant` | Named loss threshold preset |
| `loss_custom_pct` | int 0–100 | — | Custom loss ceiling in %; present only when `loss_preset=custom` |

The `quecmanager.quality_thresholds` section is never seeded by the installer and never lazily created on GET. Its absence signals "factory default / unmodified" (`isDefault=true`). The `custom` preset is new — it was not present in the old schema; existing devices that stored ceiling overrides in the retired `watchcat` keys receive a seeded `custom` preset during migration.

### SSR-aware hold keys

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `ssr_aware` | 0/1 | **1 (ON)** | Hold the recovery ladder while a recoverable baseband restart self-heals |
| `ssr_grace` | int 10–120 | 45 | Seconds to hold before falling through to the normal ladder |

Both SSR keys are seeded in `install.sh`'s `seed_uci_defaults()` (idempotent, preserves user choice on upgrade) **and** lazily seeded in `ensure_watchcat_config()` on the first CGI GET. Missing keys in `read_config()` in the daemon default to `CFG_SSR_AWARE=1` / `CFG_SSR_GRACE=45`, so existing installs that have not yet received the CGI GET benefit from the hold behaviour immediately after upgrade, even before any settings page visit.

> ℹ️ NOTE: The installer seeds the quality keys, SSR keys, and `primary_recheck_*` keys via `seed_uci_defaults()` (idempotent, preserves existing values). The full watchcat section is seeded lazily on the first CGI GET by `ensure_watchcat_config()` (which also sets `primary_recheck_*`). This two-layer seeding ensures the new keys are available both on fresh installs and on upgrades where the settings page may not have been visited yet.

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

This prefix is chosen deliberately to be firmware-variant-agnostic — it does NOT match the per-build `.c:line` suffix that varies across RM520N/RM551E builds. It takes the last matching line (`tail -n 1`), extracts the leading integer seconds from the dmesg timestamp, and compares to `/proc/uptime` (integer seconds since boot). If the crash line exists and its timestamp is within `CFG_SSR_GRACE` seconds of now, the function returns true.

Timestamp extraction uses `sed 's/^\[[ ]*\([0-9]*\)\..*/\1/'`, **not** `awk -F`. On this kernel (Linux 5.15, `CONFIG_PRINTK_CALLER`) real dmesg lines are *double-bracketed* — `[ 30585.353287][T23188] msg` — not the single-bracket `[ 12345.678901] msg` form. The `sed` expression matches the leading bracket and the seconds before the first dot, so it handles both layouts. An earlier `awk -F'[][. ]+'` implementation was replaced after on-device testing: **BusyBox awk 1.36.1 rejects a bracket-class field separator with `bad regex '[][. ]+': Unknown collating element`** (it parses the `[. ]` fragment as a POSIX collating-element reference it does not implement), so the awk form silently returned empty and the feature was inert. See Known Gotchas. The corrected `sed` form was verified live on an RM551E: a synthetic `/dev/kmsg` crash line was parsed to its integer seconds correctly.

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

### 1. Custom preset and threshold resolution

The quality trigger resolves thresholds via `resolve_quality_thresholds()`. For named presets (`standard`/`tolerant`/`very-tolerant`) the function returns the hard-coded preset value. For `custom` it reads `latency_custom_ms` / `loss_custom_pct`. If the `quality_thresholds` UCI section is absent the resolver returns the `tolerant` defaults (250 ms / 30 %).

The old `latency_ceiling_ms=0`/`loss_ceiling_pct=0` "disable that metric" escape hatch is retired. Under the preset model, choosing `very-tolerant` (500 ms / 50 %) or a high custom value effectively disables triggering. The frontend requires at least one threshold to be actively configured when quality is enabled.

### 2. Data source and staleness guard

Latency and loss come from `status.json` `.connectivity.avg_latency_ms` and `.connectivity.packet_loss_pct`, which are written by the poller. `avg_latency_ms` is the **windowed average** TCP-connect RTT (milliseconds) — the poller computes a rolling average over approximately 60 samples, not the last single RTT. Values are ICMP-comparable (typically 35–65 ms on a healthy cellular link). The `tolerant` default threshold of 250 ms provides ~4–7× normal RTT headroom. The `.connectivity` object has no timestamp of its own, so freshness is judged from the root `.timestamp` field against `STATUS_STALE_THRESHOLD=30` seconds.

A stale or missing `status.json` is treated as NO-SIGNAL: the `evaluate_quality` function returns early, and the breach counter is left unchanged. A stale poller is never treated as a healthy 0% loss reading.

**Why:** The poller could have crashed or been restarted. Treating the absence of data as 0% loss would mean a dead poller looks like a perfect connection, causing the quality trigger to never fire even when the link is genuinely bad. The NO-SIGNAL policy is the conservative choice.

### 3. Float comparison must use awk

`avg_latency_ms` in `status.json` is a decimal string (e.g. `"1241.4"`). BusyBox `[ "1241.4" -gt 800 ]` returns exit code 2 — it does not evaluate the comparison, it errors. Latency comparison therefore uses awk:

```sh
awk -v a="$q_avg_latency" -v c="$resolved_latency_threshold" \
    'BEGIN{ exit !((a+0) > (c+0)) }'
```

The resolved threshold value comes from `resolve_quality_thresholds()` — a plain integer regardless of whether a preset or custom value was stored. `packet_loss_pct` is an integer in the source; it is safe to use `[ -ge ]` after null/empty → 0 sanitisation.

> ⚠️ WARNING: This is a reusable BusyBox gotcha. Any shell script that compares a value sourced from the poller's `avg_latency_ms` with `[ -gt ]` will silently misbehave. Always use awk for float comparisons.

### 4. Separate counter, shared ladder

The quality path maintains `quality_breach_counter` independently of the reachability path's `failure_counter`. On reaching `quality_consecutive` breaches, `evaluate_quality` resets `quality_breach_counter` to 0, sets `recovery_reason="quality"`, and calls `do_recovery` — the same Tier 1→4 engine used by the reachability path. The reachability path sets `recovery_reason="unreachable"`.

### 5. Reason-aware cooldown

`finish_cooldown()` branches on `recovery_reason` to choose its success criterion.

- **`recovery_reason="unreachable"`:** Success = `ping_reachable=true` from a fresh `qmanager_ping.json` read. If this was Tier 3, finalize SIM failover state.
- **`recovery_reason="quality"`:** A degraded-but-reachable link reports `reachable=true` throughout, so the reachability check would always declare success. Instead, success is a fresh `read_quality` call that does NOT breach the resolved thresholds from `resolve_quality_thresholds()` (`!quality_breached`). On Tier-3 success, `finalize_sim_failover` is called — identical to the reachability arm. Without finalization, a quality-triggered swap strands the modem on the backup SIM with no failover state and no revert path.

**Why:** Without this branch, a quality-triggered recovery on a link that is reachable but slow would always be declared "restored" at cooldown, even if the link is still slow. The daemon would cycle through all tiers in quick succession. The quality path previously skipped Tier-3 finalization; that was reversed — finalization now runs on both success arms via the shared `finalize_sim_failover()` function.

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
| `sim_failover_active` | bool | Whether modem is currently on the backup SIM. Written via `--arg sf_active "$sim_failover_active"` and compared `($sf_active == "true")` so the JSON output is a real boolean. |
| `original_sim_slot` | int or null | SIM slot before Tier 3 |
| `current_sim_slot` | int or null | Current SIM slot |
| `reboots_this_hour` | int | Reboots from crash.log in last 3600s |
| `quality_breach_count` | int | Current consecutive quality breach counter |
| `quality_enabled` | bool | Reflects `CFG_QUALITY_ENABLED` at time of write |
| `last_recovery_reason` | string | `"unreachable"` or `"quality"` |
| `ssr_hold` | bool | Whether the daemon is currently holding the recovery ladder for an in-progress SSR self-heal |
| `last_ssr_detected` | int or null | Monotonic seconds since boot when the most recent MPSS crash line was detected; null if no SSR has been seen this session |

> ℹ️ NOTE: `revert_settle_active` is an in-process shell variable only — it is NOT written to the state file. The UI sees the settle as a normal `cooldown` state with `cooldown_remaining` set to `SIM_SETTLE_SECS` (90 s); there is no separate field to distinguish a post-revert settle from a post-recovery cooldown in the state file.

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
    "fail_threshold": 5,
    "check_interval": 10,
    "cooldown": 60,
    "tier1_enabled": true,
    "tier2_enabled": true,
    "tier3_enabled": false,
    "tier4_enabled": true,
    "backup_sim_slot": null,
    "max_reboots_per_hour": 3,
    "quality_enabled": false,
    "quality_consecutive": 5,
    "ssr_aware": true,
    "ssr_grace": 45,
    "primary_recheck_enabled": false,
    "primary_recheck_interval": 30,
    "probe_profile": "relaxed",
    "interval_override": null,
    "effective_interval": 5,
    "quality_thresholds": {
      "latency": { "preset": "tolerant", "custom_ms": null },
      "loss": { "preset": "tolerant", "custom_pct": null }
    }
  },
  "status": { ... },
  "sim_failover": { "active": false },
  "sim_swap": { "detected": false },
  "auto_disabled": false
}
```

`status` is the raw contents of `/tmp/qmanager_watchcat.json`; it is `{}` if the file is absent (daemon not yet started). `settings.backup_sim_slot` is `null` if the UCI value is empty. `settings.interval_override` is `null` when not set. `settings.quality_thresholds` is a read-only passthrough of the shared `quecmanager.quality_thresholds.*` keys — it is included for display purposes; changes to it must be saved via `quality_thresholds.sh`, not via the watchdog POST.

### POST `/cgi-bin/quecmanager/monitoring/watchdog.sh`

Three actions are supported.

**`save_settings`** — validate and write all settings fields to UCI, touch the reload flag, and restart or stop the daemon as appropriate. When the probe interval changed (i.e. `probe_profile` or `interval_override` differs from the current UCI value), the CGI also touches `/tmp/qmanager_ping_reload` so the running ping daemon picks up the new interval within one probe cycle.

```json
{
  "action": "save_settings",
  "enabled": true,
  "fail_threshold": 5,
  "check_interval": 10,
  "cooldown": 60,
  "tier1_enabled": true,
  "tier2_enabled": true,
  "tier3_enabled": false,
  "tier4_enabled": true,
  "backup_sim_slot": null,
  "max_reboots_per_hour": 3,
  "quality_enabled": true,
  "quality_consecutive": 5,
  "ssr_aware": true,
  "ssr_grace": 45,
  "primary_recheck_enabled": false,
  "primary_recheck_interval": 30,
  "probe_profile": "relaxed",
  "interval_override": null
}
```

Send `"interval_override": null` to clear a custom override and revert to the profile-derived interval. The CGI uses `has("interval_override")` to distinguish an explicit null-clear from a missing field — always include the key when you intend to modify the override.

**`dismiss_sim_swap`** — sets `.dismissed = true` in `/tmp/qmanager_sim_swap_detected`.

**`revert_sim`** — writes `/tmp/qmanager_watchcat_revert_sim`; the running daemon picks it up within one cycle.

**POST success:**

```json
{ "success": true }
```

**POST validation errors:**

```json
{ "success": false, "error": "invalid_field", "field": "fail_threshold", "reason": "must be integer 1-20" }
```

| Field | Validation |
|---|---|
| `fail_threshold` | int 1–20 |
| `check_interval` | int 5–60 |
| `cooldown` | int 10–300 |
| `max_reboots_per_hour` | int 1–10 |
| `backup_sim_slot` | 1 or 2, or null/absent to clear |
| `quality_consecutive` | int 1–60 |
| `ssr_grace` | int 10–120 |
| `ssr_aware` | boolean |
| `primary_recheck_enabled` | boolean |
| `primary_recheck_interval` | int 5–1440 (minutes) |
| `probe_profile` | one of: `sensitive`, `regular`, `relaxed`, `quiet` |
| `interval_override` | int 1–60 to set; JSON `null` to clear; field must be present if intent is to change |

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
if probe interval changed (probe_profile or interval_override):
    touch /tmp/qmanager_ping_reload   ← qmanager_ping picks this up within one probe cycle
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

Config changes take effect within one `check_interval` cycle (5–60 s). No full daemon restart is needed for quality consecutive or probe-interval changes when the daemon is already running.

> ⚠️ WARNING: **`quality_thresholds.sh` POST touches TWO reload flags.** Because the shared quality thresholds feed both the poller (Network Events) and the watchdog, `quality_thresholds.sh` must touch BOTH `/tmp/qmanager_quality_reload` AND `/tmp/qmanager_watchcat_reload` on every successful POST. Missing either flag means one of the two daemons continues running the old threshold until it is restarted. This is the dual reload-flag invariant — verify it is present in any future edit to `quality_thresholds.sh`.

---

## Recovery-Lifecycle Network Events

The watchdog writes events to the Network Events log for the full recovery lifecycle. These events use the **existing** event-type strings — no new types were introduced:

| Lifecycle point | Event type | Notes |
|---|---|---|
| Recovery started | `watchcat_recovery` | Written at the start of a recovery action; reason field carries `"unreachable"` or `"quality"` |
| Step outcome (success/escalation) | `watchcat_recovery` | Written after each tier completes and cooldown evaluates |
| SIM failover leg | `sim_failover` | Reuses the existing SIM failover event type for Tier 3 |
| Recovery exhausted | `watchcat_recovery` | Written when the ladder reaches Tier 4 and auto-disables |

> ℹ️ NOTE: The decision to reuse existing event-type strings rather than introduce new ones is intentional — the event log consumer (Network Events UI + any alerting) already knows how to render `watchcat_recovery` and `sim_failover`. Adding new strings would require a UI update and i18n additions before the events displayed correctly.

---

## SIM Failover Lifecycle

Tier 3 handles both the forward swap (primary → backup SIM) and the user-requested revert (backup → primary). The two paths share the same Golden Rule AT sequence (`AT+CFUN=0` → `AT+QUIMSLOT=N` → `AT+CFUN=1`) and the same 90 s settle floor.

### Known-SIM tracking (`sim_db_add`)

Every SIM that the watchdog lands on — whether via a successful forward swap, an inline fallback, or a revert — is recorded in the known-SIM database via `sim_db_add` from `sim_db.sh`. This tells the poller's boot-time SIM-swap detector that the ICCID is expected, so it does not fire a spurious "New SIM card detected" alert after a revert or a reboot.

> ℹ️ NOTE: The retired `last_iccid` write (from earlier versions) has been replaced by `sim_db_add`. The `known_iccids` persistent set is the canonical source of truth. If you see references to `last_iccid` in older notes, they are superseded.

### ICCID read — 3×retry pattern

After any SIM transition, reading the ICCID is attempted up to three times with 1 s sleeps between attempts (`for _try in 1 2 3`). A slow-to-respond modem may not expose the new SIM at `AT+QCCID` immediately after `AT+CFUN=1`. If all three attempts fail, the daemon logs a warning and continues — a missing ICCID never blocks recovery or a revert.

### Forward swap (`execute_tier3` + cooldown finalization)

1. Read current slot via `AT+QUIMSLOT?`.
2. Capture the original slot's ICCID via 3×1s-retry `AT+QCCID` read (into `original_sim_iccid`) BEFORE detaching. Best-effort: if unreadable after 3 tries, `original_sim_iccid` remains `""` and the swap continues.
3. Stop the tower-failover daemon (its lock state is meaningless on the backup SIM).
4. Golden Rule sequence: `AT+CFUN=0` → 2 s → `AT+QUIMSLOT=N` → 2 s → `AT+CFUN=1`.
5. `wait_for_modem` (up to 60 s). On failure, call `sim_failover_fallback` and enter cooldown.
6. `AT+CPIN?` SIM-presence guard — if the backup slot returns an error, call `sim_failover_fallback` and enter cooldown.
7. Enter cooldown with `cooldown_remaining = max(CFG_COOLDOWN, SIM_SETTLE_SECS)`.
8. **Finalization via `finalize_sim_failover()`** — called from the success arm of BOTH `recovery_reason="unreachable"` and `recovery_reason="quality"` paths in `finish_cooldown`. The function is self-guarded (no-op unless `current_tier==3` && slot moved && `original_sim_slot != "null"`), so both arms may call it unconditionally. It: sets `sim_failover_active="true"`, writes `/tmp/qmanager_sim_failover` (including `original_iccid` and `reason` field — `"connectivity_failure"` or `"quality_degradation"`), calls `sim_db_add` on the backup ICCID (3×retry), auto-applies a matching custom profile (`auto_apply_profile … "watchdog"`), and records `last_recheck_time` to start the auto-failback clock.

The state is NOT finalized during `execute_tier3` itself — finalization waits for the cooldown success test so a false-positive connectivity return does not prematurely lock in the failover state.

**`/tmp/qmanager_sim_failover` shape:**

```json
{
  "active": true,
  "original_slot": 1,
  "current_slot": 2,
  "switched_at": 1718900000,
  "reason": "connectivity_failure",
  "original_iccid": "89014103211118510720",
  "current_iccid": "89012303211118510720"
}
```

`reason` is `"connectivity_failure"` for reachability-triggered swaps, `"quality_degradation"` for quality-triggered swaps. `original_iccid` is the ICCID of the primary SIM read before the swap; it is `""` only if the 3×retry `AT+QCCID` read failed entirely.

### Fallback (`sim_failover_fallback`)

Called when the backup SIM is unreachable or `wait_for_modem` times out during the forward swap. Performs the Golden Rule sequence back to the original slot, then:

- **Normal modem path** (`wait_for_modem` succeeds): 3×retry ICCID read → `sim_db_add` → `auto_apply_profile … "watchdog_revert"` → restart tower-failover daemon.
- **Slow-modem path** (`wait_for_modem` times out): 3×retry ICCID read → `sim_db_add` (best-effort) → log warning → continue. Auto-apply and tower-failover restart are skipped; the slot command was already sent. This path still calls `sim_db_add` so the next boot does not false-fire "New SIM detected".

> ℹ️ NOTE: Without the slow-modem `sim_db_add`, the poller's boot-time swap detector would fire "New SIM card detected" after a reboot following a slow revert — a regression that was introduced by an earlier refactor and has been restored. The ICCID read on the slow path is best-effort: if genuinely unreadable after 3 retries, only a warning is logged; the revert never blocks.

### Revert semantics (`check_revert_request`)

A user-requested revert (`POST action=revert_sim`) writes `/tmp/qmanager_watchcat_revert_sim`. The daemon checks this flag each loop iteration via `check_revert_request`, which has three branches:

| Branch | Condition | Action |
|---|---|---|
| Safe to revert now | `sim_failover_active="true"` AND state is NOT `recovery` or `cooldown` | Delete flag, call `sim_failover_fallback`, enter cooldown as `revert_settle_active=true` for `SIM_SETTLE_SECS` |
| Defer | `sim_failover_active="true"` AND state is `recovery` or `cooldown` | Keep flag; logged as "deferring to next cycle" |
| Swap mid-flight | `original_sim_slot != "null"` AND `current_sim_slot != original_sim_slot` (slot moved but cooldown hasn't finalized yet) | Keep flag pending — consumed after finalization |
| Nothing to revert | Neither of the above | Delete flag silently |

**Why defer instead of silently drop:** A `revert_sim` POST that arrives during the post-swap cooldown window was previously deleted unconditionally, and the user's request was silently lost. The current logic keeps the flag pending until the daemon is in a quiescent state. The defer guard (`state = "recovery"` or `"cooldown"`) prevents the revert from racing an in-flight AT sequence.

### Post-revert settle floor (`revert_settle_active`)

After `sim_failover_fallback` completes during a user revert, the daemon enters the `cooldown` state with `cooldown_remaining=SIM_SETTLE_SECS` and `revert_settle_active="true"`. The `finish_cooldown` function has a top guard (arm 2, after the primary-recheck arm): when `revert_settle_active="true"`, it clears the flag, resets counters, and returns to `monitor` WITHOUT running the reason-aware success/escalation logic. This is correct — a revert has no tier to validate and must not escalate.

`revert_settle_active` is also cleared on LOCKED-state entry (along with the rest of the recovery state) so a maintenance window cannot strand the daemon in a phantom settle.

The `cooldown_remaining` value in the state file reflects `SIM_SETTLE_SECS` (90 s) during a revert settle, so the UI countdown is honest.

### Auto-failback: blind primary-SIM recheck

When `primary_recheck_enabled=1` and the daemon is in an active failover (`sim_failover_active="true"`), the main loop accrues time since `last_recheck_time` (epoch). On reaching `primary_recheck_interval` minutes, `initiate_primary_recheck()` fires — provided: state is `monitor`, no `primary_recheck_active` settle is already in progress, and no user-revert flag is pending (user revert takes precedence).

**`initiate_primary_recheck()` sequence:**

1. Record `recheck_return_slot = current_sim_slot` (backup slot to return to if primary fails).
2. Golden Rule swap to the primary slot: `AT+CFUN=0` → 2 s → `AT+QUIMSLOT=$original_sim_slot` → 2 s → `AT+CFUN=1`.
3. `wait_for_modem` (best-effort; failure continues to the settle rather than hard-aborting).
4. Set `primary_recheck_active="true"`, `cooldown_remaining=SIM_SETTLE_SECS`, `state="cooldown"`.
5. `recovery_reason` is left unchanged so the health test uses quality criteria if the failover was quality-driven.

**`finish_cooldown` primary-recheck arm** (runs before the `revert_settle_active` and reason-aware arms):

- Reads fresh ping data. If reachable AND (if quality failover: also `!quality_breached`; stale data = unhealthy):
  - **Primary healthy:** clear failover state, `rm $SIM_FAILOVER_FILE`, 3×retry ICCID read → `sim_db_add`, `auto_apply_profile "$iccid" "watchdog_failback"`, restart tower-failover daemon, reset counters, return to `monitor`. Record `last_recheck_time` to start the next interval.
  - **Primary still unhealthy:** Golden Rule swap BACK to `recheck_return_slot`, rewrite `$SIM_FAILOVER_FILE`, `sim_db_add`, stop tower-failover daemon, reset `last_recheck_time`, set `revert_settle_active="true"` for a benign 90 s settle.

> ℹ️ NOTE: `primary_recheck_active` is an in-process shell variable only — it is NOT written to the state file (same pattern as `revert_settle_active`). The UI sees a recheck settle as a normal `cooldown` countdown. There is no separate state-file field to distinguish a primary-recheck settle from a post-recovery cooldown.

**Why opt-in and minutes-only:** The inactive SIM slot is hard-muxed off — it receives no radio signal and cannot be tested without physically switching the modem's SIM selection. Every recheck is a real connectivity interruption. A seconds-granularity interval would loop the modem in and out of brief outages. The minimum 5-minute interval is enforced by both the UCI validation range (5–1440) and the daemon's fallback default (30 minutes).

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

**`WatchdogSettings`** (in `hooks/use-watchdog-settings.ts`):
- `max_failures` renamed to `fail_threshold` (int, 1–20).
- `latency_ceiling_ms` and `loss_ceiling_pct` **removed** — thresholds now come from the shared `quality_thresholds` object surfaced from the GET.
- Added `probe_profile: PingProfile`, `interval_override: number | null`, `effectiveInterval: number` (derived client-side from `interval_override` ?? profile→seconds map), and `qualityThresholds: QualityThresholdsSettings` (read from the GET's `quality_thresholds` passthrough; changes to it are saved via `useQualityThresholds`, not the watchdog save).
- `ssr_aware: boolean` and `ssr_grace: number` remain unchanged.
- Added `primary_recheck_enabled: boolean` and `primary_recheck_interval: number` (int, 5–1440 minutes). The form validates the interval range and blocks save when `primary_recheck_enabled=true` but no valid interval is entered.

**`WatchdogLiveStatus`** added optional `ssr_hold?: boolean` and `last_ssr_detected?: number | null`. These are typed optional because older daemon versions will not emit them. The existing optional fields `quality_breach_count`, `quality_enabled`, and `last_recovery_reason` follow the same rule — consumers must handle their absence.

**`WatchcatState`** in `types/modem-status.ts` has `"ssr_hold"` as a union member. The poller passes the daemon's `.state` field verbatim, so `"ssr_hold"` reaches `modemStatus.watchcat.state` without any poller-side change.

**Probe-interval Select (Triggers card):** The Reachability tab gained a probe-interval Select showing the 4 named profiles plus a "Custom" option that reveals a numeric Input (1–60 s). Choosing a profile writes `probe_profile`; choosing Custom writes `interval_override`. A derived live preview ("Declares the connection down after about Ns") is displayed below the threshold controls, where N = `effectiveInterval × fail_threshold`.

**Connection Sensitivity alert:** `connectivity-sensitivity-card.tsx` shows an informational Alert when `interval_override` is set, explaining that the watchdog is enforcing a custom probe interval and that the profile choice becomes the fallback once the override is cleared. The profile Tabs are NOT disabled — they remain interactive so the user can pre-select a profile to fall back to. The daemon ignores the profile while an override is active.

**`use-quality-thresholds.ts`** was updated to flatten `latency.custom_ms` / `loss.custom_pct` onto the POST body when `preset=custom`.

**SSR-aware gate control (Recovery Ladder card):** The gate control lives at the top of `WatchdogRecoveryLadder` on a `bg-muted/20` surface, above the numbered `<ol>`. It renders a Switch (`ssr_aware`) with a `TbInfoCircleFilled` tooltip, and when the Switch is on, an animated-in grace-seconds `Input` field (range 10–120). This surface is disabled when the master watchdog switch is off (`masterOff`).

**SSR hold hero state (Overview card):** `STATE_META["ssr_hold"]` uses `tone: "info"`, `ActivityIcon`, and `pulse: true`. The badge reads "Letting Modem Self-Recover" and the blurb explains the modem is restarting its radio firmware. Info tone is deliberate — this is calm, expected behaviour, not a destructive state.

**i18n:** English keys in `public/locales/en/monitoring.json` include: `status_badge_ssr_hold`, `state_blurb_ssr_hold`, `ssr_aware_label`, `ssr_aware_description`, `ssr_aware_tooltip`, `ssr_aware_more_info_aria`, `ssr_grace_label`, `ssr_grace_placeholder`, `ssr_grace_description`, `ssr_grace_error`; and (from the auto-failback feature) `watchdog.primary_recheck_enabled` and `watchdog.primary_recheck_interval` family keys. The `id`, `it`, `zh-CN`, and `zh-TW` locales are not yet translated for either the SSR or auto-failback keys; build-time i18n warnings fall back to `en` via `fallbackLng: "en"`. A translation sweep for these locales is a tracked follow-up — not a bug.

---

## Known Gotchas

- **`jq --argjson` parses shell `"true"`/`"false"` strings into JSON booleans; never compare them with `== "true"`.** The `sim_failover_active` state-file field was previously written via `--argjson sf_active "$sim_failover_active"` then tested with `($sf_active == "true")`. Because `--argjson` parses the value as JSON, `"true"` becomes the JSON boolean `true`, and `(true == "true")` is always false in jq — a type mismatch. The fix is `--arg sf_active "$sim_failover_active"` (emits a JSON string) so `($sf_active == "true")` works. The sibling fields `ssr_hold` and `last_ssr_detected` use `--argjson` correctly — they emit the value directly into the output without a string comparison: `ssr_hold: $ssr_hold`. `enabled` and `quality_enabled` compare against a numeric `== 1`, not a string, so they are also safe. Pattern rule: use `--arg` when you need to string-compare in jq; use `--argjson` only when you want the parsed JSON value emitted directly.

- **Float comparison is a hard requirement.** `avg_latency_ms` is decimal. BusyBox `[ "1241.4" -gt 800 ]` exits 2 (error), not false. Any future code path that reads this field and compares it with `[ -gt ]` or `[ -ge ]` will silently fail to compare. Use awk as shown in the `quality_breached` function.

- **`fail_threshold` counts raw probe failures, not poller cycles.** The watchdog reads `ping_streak_fail` directly from `qmanager_ping.json`. Under a slow profile (`quiet`, 10 s interval), a `fail_threshold=5` means the connection must fail 5 consecutive probes — approximately 50 seconds — before recovery fires. This is intentional: the threshold is independent of profile speed.

- **Detection is not instantaneous.** The status.json `avg_latency_ms` and `packet_loss_pct` values are windowed averages over ~60 poller samples. A brief spike will be absorbed by the window. Only a sustained degradation lasting across `quality_consecutive × check_interval` seconds (on top of the poller's averaging window) will trigger quality recovery.

- **`custom` preset requires explicit save to take effect.** If you change `latency_custom_ms` or `loss_custom_pct` in UCI directly without also writing `latency_preset=custom`, `resolve_quality_thresholds()` will use the named preset and ignore the custom value. Always save via `quality_thresholds.sh` POST to keep the preset and custom value in sync.

- **Quality breach counter in the status card is a follow-up.** The status card currently reads from the poller's `watchcat` re-emit in `status.json`, which does not yet carry `quality_breach_count`. The actual counter is in `/tmp/qmanager_watchcat.json` (field `failure_counter` mirrors `ping_streak_fail`; `quality_breach_count` mirrors the quality breach counter) and available via the CGI GET passthrough. No status-card widget displays either counter directly yet. This is a known gap.

- **Stale poller = NO-SIGNAL, not healthy.** If `qmanager_poller` is dead or crashed, `status.json` goes stale. The quality trigger treats this as no-signal and freezes the breach counter. This is correct behavior, but it means a dead poller silently disables quality triggering. Check `/tmp/qmanager_status.json` root `.timestamp` if the quality trigger appears to not be evaluating. Note: the poller's Adaptive Polling deep tier (see [`docs/features/adaptive-polling.md`](../adaptive-polling.md)) does not affect the watchdog — `write_cache` and `read_ping_data` run at the 2 s base cadence in all tiers regardless of AT-read gating, so `.timestamp` and `.connectivity` stay fresh even while the device is deep-idle.

- **Wall-clock staleness checks are corrupted by NITZ/NTP clock steps.** When the modem's data path is restored after an MPSS SSR, the NITZ `time_daemon` and BusyBox `ntpd` both issue a STEP (abrupt jump) of the system wall clock — typically ~90 s forward. Any staleness check that computes `age = date+%s − cached_timestamp` across that step produces a corrupted age (it shows ~90 s of extra staleness). Before the monotonic fix this caused `read_ping_data` in the poller and `read_ping` / `read_quality` in the watchdog to log "Ping data stale (age=90s), marking unknown" or "skipping cycle" and reset connectivity state to unknown — on a connection that had just recovered cleanly.

  The fix: `mono_now()` in `scripts/usr/lib/qmanager/qlog.sh` reads `/proc/uptime` (kernel monotonic counter, immune to NTP/NITZ steps) and returns the integer seconds since boot. Writers (`qmanager_ping` `write_cache`, `qmanager_poller` `write_cache`) emit an **additive integer `mono` field** in `/tmp/qmanager_ping.json` and `/tmp/qmanager_status.json` alongside the existing wall-clock `timestamp`. The three reader sites — `read_ping_data` in `qmanager_poller` and `read_ping` / `read_quality` in `qmanager_watchcat` — compute `age_mono = mono_now() − .mono` and use that instead. A wall-clock fallback runs whenever `.mono` is absent, zero, or non-numeric (safe partial deploy — old writer, new reader). Staleness thresholds are unchanged: `PING_STALE_THRESHOLD=10` in the poller, `PING_STALE_THRESHOLD=15` in the watchdog's `read_ping`, `STATUS_STALE_THRESHOLD=30` in the watchdog's `read_quality`.

  > ⚠️ WARNING: `read_ping` in `qmanager_watchcat` extracts the 4 core ping fields via a single batched `jq -r ... @tsv` call into `_pdata` (cuts off columns 1–4), then reads `.mono` with a **separate** `jq -r '.mono ...'` call. The separate call is intentional — inserting `.mono` into the `@tsv` batch would shift the `cut -f` column indices for `ping_ts`, `ping_streak_fail`, `ping_reachable`, and `ping_during_recovery`, breaking the parse. Any future edit to that `jq` block must keep the `.mono` read separate.

- **Auto-disable persists across reboots (UCI).** When Tier 4 exhausts `max_reboots_per_hour`, it writes `quecmanager.watchcat.enabled=0` to UCI. This survives a reboot — the daemon won't restart even though procd is configured to do so (the init.d script checks `enabled` in UCI). Re-enabling via the settings page clears the disabled flag and restarts the daemon.

- **SSR hold is best-effort: dmesg ring-buffer eviction.** The kernel ring buffer is fixed-size. On a busy modem (e.g. a QCMAP bringup storm filling dmesg with interface events), the `4080000.remoteproc-mss: fatal error received` line can be evicted before `ssr_in_progress()` reads it. In that case `ssr_in_progress()` returns false and the daemon behaves exactly as if the feature did not exist — it falls straight through to the ladder. The hold is a de-amplifier, not a correctness requirement. The existing `max_reboots_per_hour` token bucket is the backstop.

- **BusyBox awk rejects a bracket-class field separator (reusable gotcha).** Parsing the dmesg timestamp with `awk -F'[][. ]+'` looks correct and is valid POSIX, but BusyBox awk 1.36.1 (on the RM551E) errors with `bad regex '[][. ]+': Unknown collating element` — it reads the `[. ]` fragment as a POSIX collating-element reference (`[.ch.]` syntax) it does not implement. The failure is to *stderr* with empty *stdout*, so the extraction silently yields nothing and the consuming feature goes inert with no error. `ssr_in_progress()` therefore uses `sed 's/^\[[ ]*\([0-9]*\)\..*/\1/'` instead, verified on-device. Avoid bracket-class `-F` separators in any BusyBox awk; prefer `sed`, `cut`, or a single-char `-F`. Also note dmesg lines here are double-bracketed (`[ secs.usec][ Tthread]`, `CONFIG_PRINTK_CALLER`), so a parser must anchor on the *first* bracket only.

- **Quality-triggered hold clears via the reachability path.** When a quality breach triggers an SSR hold, the hold resolves via the `suspect|ssr_hold` reachability check on subsequent cycles. If the modem self-heals and `ping_reachable=true && ping_streak_fail=0`, the hold clears and state returns to `monitor` — even though the recovery was quality-triggered, not reachability-triggered. This is intentional: the dominant amplification risk is the forced detach that happens during SSR self-heal, and the modem returning to a reachable state means the SSR self-heal succeeded. Do not be surprised if a quality-path hold shows a `suspect→monitor` transition in the log instead of a `ssr_hold→monitor` state label.

---

## On-Device Test Plan (Pending Live Modem)

The static audit passed. On-device verification was skipped for some scenarios in this round (Globe backup SIM returned `ERROR` on `AT+CPIN?` during testing). The following scenarios require a live environment with both SIM slots registered.

**Scenario 1 — SSR detected, hold engaged:**
Trigger a real MPSS SSR (or wait for one on an affected RM551E). Within one `check_interval` after the SSR log line appears, check `/tmp/qmanager_watchcat.json` for `"state":"ssr_hold"` and `"ssr_hold":true`. Confirm the watchdog log (`/tmp/qmanager.log`) shows "Recoverable baseband SSR detected; holding recovery ladder" and that NO `AT+COPS` or `AT+CFUN` commands appear in the `qcmd` log during the grace window.

**Scenario 2 — Natural recovery during the hold:**
If the modem self-heals within the grace window, confirm `/tmp/qmanager_watchcat.json` transitions back to `"state":"monitor"` with `"ssr_hold":false`, and that the UI overview card returns to the green "Monitoring" hero without passing through a recovery or cooldown state.

**Scenario 3 — Grace window expiry, fallthrough to ladder:**
Extend the outage artificially past `ssr_grace` seconds (e.g. set `ssr_grace=10` and use a test mode that keeps connectivity down). Confirm the log shows "SSR-hold grace expired without recovery; releasing to ladder" and that Tier 1 (`AT+COPS=2 → AT+COPS=0`) then runs normally.

**Scenario 4 — Hold clears correctly on LOCKED entry and exit:**
While in `ssr_hold`, trigger a maintenance lock (create `/tmp/qmanager_watchcat.lock`). Confirm the log shows LOCKED state entered, `ssr_hold` cleared, and that removing the lock brings the daemon back to `monitor` with `ssr_hold=false` (no stale hold carried through).

**UI verification:** Save `ssr_aware=false` and confirm the CGI GET round-trips it correctly. Save `ssr_grace=30` and confirm it persists in UCI. Trigger the `ssr_hold` state (on a real SSR or by injecting state) and confirm the "Letting Modem Self-Recover" hero appears with the info tone and pulse.

**Scenario 5 — `sim_failover_active` state-field correctness (verified):**
Trigger a Tier-3 forward swap and let it finalize. Read `/tmp/qmanager_watchcat.json` via `curl http://127.0.0.1/cgi-bin/quecmanager/monitoring/watchdog.sh`. Confirm `"sim_failover_active": true` (JSON boolean, not the string `"true"`). Also confirm `original_iccid` in `/tmp/qmanager_sim_failover` is populated (non-empty string) when the original SIM was readable before the swap. This scenario was live-validated on the RM551E (`--arg sf_active` fix confirmed).

**Scenario 6 — Quality-triggered Tier-3 finalization (PENDING live environment):**
Configure quality thresholds to trigger on the current link, let a quality-path recovery escalate to Tier 3 and succeed, and confirm `/tmp/qmanager_sim_failover` is written with `"reason": "quality_degradation"` and `"active": true`. Confirm `"sim_failover_active": true` in the watchcat state file. This path was structurally validated but NOT live-exercised (backup SIM unresponsive during test session).

**Scenario 7 — Auto-failback full loop (PENDING live environment):**
Enable `primary_recheck_enabled=1` with `primary_recheck_interval=5` (minimum). After a verified Tier-3 failover, wait 5 minutes. Confirm the daemon initiates a primary recheck: the log should show "PRIMARY RECHECK: temporary swap-back" and a `cooldown` state for 90 s. If primary is healthy, confirm `sim_failover_active` clears, the failover file is deleted, and the daemon returns to `monitor`. If primary is still unhealthy, confirm the daemon swaps back to the backup and rewrites the failover file. This loop was NOT live-exercised this session.

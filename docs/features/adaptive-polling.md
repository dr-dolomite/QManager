# Adaptive Polling

Adaptive Polling makes the QManager AT poller ease off modem interrogation when no browser session is active, and instantly resumes full-rate reads when the dashboard is opened. The base poll rate is 2 s; during an unattended idle stretch the poller steps down through graduated tiers that reduce the AT-port cadence to ~60 s per read, cutting accumulated background load by ~97% without making the dashboard sluggish for a returning user.

**Origin:** this feature is the productised mitigation for the RM551E MPSS-SSR root cause — sustained 2 s polling of the modem's data-plane/config subsystem (`CGCONTRDP`, `QMAP="WWAN"`, `QNWCFG`) drives a periodic Qualcomm MPSS baseband subsystem restart (~every 100 min) on v4-only carriers, confirmed by captured `dmesg` evidence and the `QCMAP:bringup v6` retry storm. A blanket `POLL_INTERVAL=15` diagnostic patch was retired in favour of Adaptive Polling. v0.1.28 then completed the fix by gating the entire Tier-2 block (identity + data-plane) to Active-only — the `[ "$ap_tier" = "active" ] || return 0` guard is now the first statement in `poll_tier2()`, so unattended polling is strictly signal-only (see Invariant 6).

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/system-settings/adaptive-polling` |
| CGI | `GET/POST /cgi-bin/quecmanager/system/adaptive_polling.sh` |
| UCI section | `quecmanager.poller.{enabled,active_grace,idle_interval,idle_threshold,deep_idle_interval}` |
| Heartbeat file | `/tmp/qmanager_ui_active` (epoch seconds, written by status CGIs) |
| Poller reload flag | `/tmp/qmanager_poller_reload` |
| Force-active flag | `/tmp/qmanager_force_tier2` |
| Tier field in status.json | `.device.poller_tier` — `"active"` | `"idle"` | `"deep"` |
| Reboot required | No |

---

## Tier Architecture

The poller reads `heartbeat_age = now − contents_of(/tmp/qmanager_ui_active)` at the start of each cycle and selects a tier:

| Tier | Condition | AT-port cadence |
|---|---|---|
| Active | `heartbeat_age ≤ active_grace` (default 20 s) | Every base cycle (2 s) |
| Idle | `heartbeat_age ≤ idle_threshold` (default 300 s) | Every `idle_interval` (default 15 s) |
| Deep | `heartbeat_age > idle_threshold` | Every `deep_idle_interval` (default 60 s) |

**AT-due gating:** the AT block runs when `cycle_count % (interval / POLL_INTERVAL) == 0`. Both interval values are clamped `>= POLL_INTERVAL` so the divisor is always ≥ 1, preventing a divide-by-zero and ensuring the interval is a meaningful multiple of the base rate.

**Full-refresh on re-entry:** when an idle or deep AT touch fires, the poller runs Tier 1 + Tier 1.5 + Tier 2 unconditionally (ignoring their individual per-tier modulo counters). This guarantees that the first data a returning user sees is a complete, current snapshot rather than a partial one.

**Measured impact:** at the 2 s baseline, deep tier produces ~9 AT calls/min vs ~270 AT/min at full rate — a ~97% reduction in unattended AT traffic.

---

## Heartbeat

Two CGIs write `date +%s > /tmp/qmanager_ui_active` on every response:

- `at_cmd/fetch_data.sh` — authenticated; fires only for real browser sessions.
- `public/overview.sh` — unauthenticated; fires on any hit (e.g. third-party integrations).

Any hit to either endpoint resets the heartbeat clock, extending the Active window.

> ℹ️ NOTE: The heartbeat file contains a plain epoch integer. If the file is absent or unreadable (e.g. corrupted write), the poller treats the age as effectively infinite and may enter Deep immediately. Boot seeding (see Invariant 3 below) prevents this on a fresh start.

---

## UCI Configuration

```
quecmanager.poller=poller
quecmanager.poller.enabled=1
quecmanager.poller.active_grace=20
quecmanager.poller.idle_interval=15
quecmanager.poller.idle_threshold=300
quecmanager.poller.deep_idle_interval=60
```

**The section is never seeded by the installer.** Absence means defaults — the same `isDefault` pattern used by `quecmanager.quality_thresholds`. The poller's `resolve_poller_config()` applies the defaults when the section is missing, so the feature works correctly on a fresh install before the user has ever opened the settings page.

> ℹ️ NOTE: If you need to reset to factory defaults, remove the UCI section: `uci delete quecmanager.poller && uci commit quecmanager`. The next poller cycle will revert to the hardcoded defaults.

Live reload: the CGI drops `/tmp/qmanager_poller_reload`; the poller's `resolve_poller_config()` consumes the flag within one base cycle (~2 s). No daemon restart, no procd touch.

---

## Apply / Reload Pipeline

```
UI card  ──POST──▶  CGI  ──uci commit──▶  /etc/config/quecmanager
                     │
                     └──touch /tmp/qmanager_poller_reload
                                │
                  (within ≤1 base cycle, ~2 s)
                                │
         qmanager_poller  ──▶  resolve_poller_config()  ──▶  rm flag
```

---

## Invariants

These are non-obvious constraints verified on-device. Violating any of them produces silent failures.

### 1. `write_cache` and `read_ping_data` run every base cycle regardless of tier

The connection watchdog (`qmanager_watchcat`) keys its freshness check on the root `.timestamp` field in `status.json` and reads `.connectivity.*` for quality-trigger decisions. Both fields are populated by `write_cache` and `read_ping_data` respectively. If the poller were to skip `write_cache` on idle/deep cycles, `status.json` would go stale, and the watchdog's quality trigger would silently stop working.

**Why:** AT backoff applies only to the AT-port read block. The local-only work — `write_cache`, `read_ping_data`, proc metrics — always runs at the 2 s base cadence. The two concerns are deliberately decoupled in the poller loop.

### 2. Force-to-Active flags guarantee exactly one full AT cycle then release

Two conditions pin the poller to Active regardless of heartbeat age:

- `/tmp/qmanager_force_tier2` present — written by `qmanager_profile_apply` (complete/partial finalise block) and by `apn_mgr.sh` (`apply_apn_to_modem` success path), so scenario-cron and ICCID auto-apply changes reflect in `status.json` within ~2–4 s even while the poller is deep-idle.
- `/tmp/qmanager_refresh_policy_band` present — written on SIM-swap to trigger a policy-band re-read.

Both are one-shot: each flag forces exactly one Active cycle, then the poller removes the flag and returns to whatever tier the heartbeat age dictates. Tower-lock state no longer affects tier selection — see Known Gotchas.

### 3. Boot seeds the heartbeat file before entering the poll loop

`main()` in `qmanager_poller` writes the current epoch to `/tmp/qmanager_ui_active` before the loop starts. This guarantees the poller starts in Active for at least one `active_grace` window.

**Why:** without seeding, a freshly-started poller has no heartbeat file. The heartbeat age resolves to "infinite," placing the poller in Deep immediately. A user who opens the dashboard right after a reboot would get stale or absent data for up to 60 s while the poller waited for its first deep AT touch.

### 4. Lifecycle cleanup is the init.d `stop_service()` responsibility

`/etc/init.d/qmanager`'s `stop_service()` removes both `/tmp/qmanager_ui_active` and `/tmp/qmanager_poller_reload`. This prevents stale epoch values from causing a misleading Active state the next time the poller starts before `main()` can re-seed. The CGI is auto-deployed via the `install_tree` cgi-bin copy at install/upgrade time — no UCI seed step and no manual file placement needed.

### 5. Non-baseline `POLL_INTERVAL` collapses idle/active distinction

If `POLL_INTERVAL` were raised to match `idle_interval` (e.g. both at 15 s), the `cycle_count % (15 / 15) == 0` gate would fire every cycle, making Idle behaviorally identical to Active. The feature is only meaningful at the 2 s baseline. The retired 15 s diagnostic patch exhibited this collapse; Adaptive Polling was introduced so the 2 s baseline could be safely restored while still shedding idle AT load.

### 6. The entire Tier-2 block is gated to the Active tier (RM551E-GL SSR fix)

`poll_tier2()` contains two logical groups — identity and data-plane — but both are now skipped unless the poller is in the Active tier. The guard `[ "$ap_tier" = "active" ] || return 0` is the **first executable statement** in `poll_tier2()`; the entire function early-returns when the poller is Idle or Deep.

When unattended (Idle or Deep tier), the only AT commands that run are the Tier-1 signal set:

- `AT+QENG="servingcell"` — serving-cell signal metrics
- `AT+QCAINFO` — carrier-aggregation info
- `AT+CFUN?` — radio function state
- `AT+QRSRP`; `AT+QRSRQ`; `AT+QSINR` — per-antenna RSRP/RSRQ/SINR

The following are **skipped** while unattended:

- **Identity group:** `AT+COPS?` (carrier name), `AT+QUIMSLOT?` (SIM slot), `AT+CNUM` (phone number), `AT+CPIN?` (SIM/PIN status)
- **Data-plane/config group:** `AT+CGCONTRDP` (WAN IP/APN/DNS), `AT+QMAP="WWAN"` (WAN state), `AT+QNWCFG="*_time_advance"` (timing advance / cell distance), mode-gated `AT+QNWCFG="*_mimo_layers"` (active MIMO)

**Why:** On v4-only carriers the modem firmware runs a perpetual `QCMAP:bringup v6` retry storm — the PDP context is `IPV4V6`, the carrier responds with IPv4 only, and QCMAP retries forever with no backoff. Any recurring AT command that reaches into the registration or data-plane subsystem on top of that sustained thrashing correlates with a Qualcomm MPSS baseband subsystem restart (SSR, `qcom_q6v5_pas 4080000.remoteproc-mss: fatal error received ... DALSysLogEvent.c`) on a ~100-minute clock-regular cadence, dropping the data plane for ~15 seconds per event. The predecessor tool (QuecManager) issued none of these commands on a timer — only on UI demand — and did not exhibit the drops. Gating the whole Tier-2 block to Active-only fully restores that proven-safe steady state for unattended operation.

**Stale-but-cached fields while unattended:** carrier name, SIM slot, phone number, SIM/PIN status, WAN IP, APN, DNS servers, timing advance / cell distance, active MIMO layers. All fields hold their last-known values until the dashboard is opened. The cache is valid for display; no feature depends on these values being live while the UI is idle.

**Apply paths are unaffected.** `qmanager_profile_apply` and `apn_mgr.sh` drop `/tmp/qmanager_force_tier2` on success, which pins the poller to Active for one full cycle. An apply therefore always retrieves a fresh snapshot within ~2–4 s even while the poller is deep-idle. `read_sim_state()` and SIM-swap/failover detection are also unaffected — they read from `/tmp/` JSON files, not from AT commands.

**Human verification note:** confirmation that the fix holds is a debug report captured after an extended unattended session showing the clock-regular `remoteproc-mss: fatal error` SSR cadence stretching out or stopping entirely.

> ⚠️ WARNING: Do not move any Tier-2 AT command outside the `poll_tier2()` guard, or remove the `[ "$ap_tier" = "active" ] || return 0` early-return. Either change re-introduces recurring non-signal AT polling that triggered the RM551E-GL SSR.

---

## CGI Envelopes

### `GET /cgi-bin/quecmanager/system/adaptive_polling.sh`

Returns current settings and the live poller tier. Auth-gated.

```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "active_grace": 20,
    "idle_interval": 15,
    "idle_threshold": 300,
    "deep_idle_interval": 60
  },
  "isDefault": true,
  "tier": "active"
}
```

- `isDefault` is `true` when the `quecmanager.poller` UCI section is absent (factory state).
- `tier` is read from `.device.poller_tier` in `status.json`; falls back to `"active"` if the file is absent or the field is missing.
- `enabled` is returned as a boolean (`true`/`false`), not the raw UCI string `"1"`/`"0"`.

### `POST /cgi-bin/quecmanager/system/adaptive_polling.sh`

Save settings. Auth-gated.

**Request (`action: "save"`):**

```json
{
  "action": "save",
  "enabled": true,
  "active_grace": 20,
  "idle_interval": 15,
  "idle_threshold": 300,
  "deep_idle_interval": 60
}
```

**Success response:**

```json
{ "success": true }
```

Commits UCI and drops `/tmp/qmanager_poller_reload`. The running poller picks up the new config within one base cycle (~2 s). No restart, no reboot.

**Error codes:**

| Code | Meaning |
|---|---|
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `"save"` |
| `invalid_value` | Any numeric field is non-positive, non-integer, or out of the allowed range |
| `method_not_allowed` | Request was not GET or POST |

---

## Frontend

| File | Purpose |
|---|---|
| `app/system-settings/adaptive-polling/page.tsx` | Route entry point |
| `components/system-settings/adaptive-polling/adaptive-polling-card.tsx` | Settings card with tier badge and save flow |
| `hooks/use-adaptive-polling.ts` | Fetch + save adaptive polling settings |

The live-tier badge uses the status-badge pattern: `active` → success variant, `idle` → warning variant, `deep` → muted/secondary variant. The badge sources `.device.poller_tier` from the polled `status.json` response, not from a separate fetch.

Sidebar entry key: `adaptive_polling`. Available in all 5 shipped locales.

---

## status.json Surface

The poller writes `.device.poller_tier` as one of `"active"`, `"idle"`, or `"deep"` on every `write_cache` call. Consumers (the frontend tier badge, the CGI GET fallback) should treat the field as optional — it is absent on older builds and on the first write if the poller starts before the cache is populated.

---

## Known Gotchas

- **Tower lock follows the UI heartbeat, not a fixed pin.** A tower lock no longer forces the poller to stay in Active. When the dashboard is idle, the poller graduates to Idle then Deep even with a tower lock active. `qmanager_tower_failover` (which loops every 20 s and reads `.lte.rsrp` / `.nr.rsrp` from `status.json`) may therefore act on RSRP up to one deep interval (default 60 s) stale while the UI is idle. This is acceptable for slow signal-degradation failover; when the dashboard is open, RSRP is fresh at the 2 s cadence. Band failover (`qmanager_band_failover`) is unaffected — it is a one-shot actor that issues its own live `AT+QCAINFO` query and never relied on the poller's cadence.
- **`write_cache` skipped = watchdog quality trigger dies silently.** Any future modification to the poller loop must preserve the invariant that `write_cache` and `read_ping_data` run every base cycle. The AT-block gating should wrap only the AT reads.
- **Removing or relocating the `ap_tier` gate in `poll_tier2()` re-introduces the RM551E-GL SSR.** The `[ "$ap_tier" = "active" ] || return 0` guard is the first statement in `poll_tier2()` and covers the entire function — both the identity group and the data-plane group. Moving it below any AT call, or removing it, lets that call run on a timer while unattended. See Invariant 6.
- **Idle tier at non-2s baseline collapses to Active.** If `POLL_INTERVAL` is ever raised for diagnostic purposes, `idle_interval=15` (default) at a 15 s base becomes `15 / 15 = 1` — every cycle fires. The feature must be re-tuned if the base interval changes.
- **Heartbeat file is not atomic.** The shell redirect `date +%s > /tmp/qmanager_ui_active` is a truncate-then-write, not an atomic rename. A poller read that races with a CGI write may see an empty file; the poller treats an empty/unreadable file as maximum age and may briefly drop to Deep before the next cycle. This is benign — the next heartbeat write recovers it within 2 s.
- **`isDefault: true` is lost on first save, even with default values.** Once the user saves any settings (even unchanged defaults), the `quecmanager.poller` section exists and `isDefault` is always `false`. To restore the "never configured" state, delete the section directly in UCI.

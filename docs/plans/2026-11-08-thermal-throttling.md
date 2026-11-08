# Thermal Throttling — plan (2026-11-08)

Scope: dashboard chip, events, alert trigger, Health Check item, headroom-to-throttling (ideas 1–4 + 7). Prometheus and the slowdown explanation are out of scope.

## What the live modem shows (RM551E, read-only probe)

- 26 cooling devices under `/sys/class/thermal/cooling_device*`, all at `cur_state` 0.
- **Driven by the kernel** (bound to a thermal zone via `cdevN` links):
  | Device | Zone | Trip |
  |---|---|---|
  | `modem_lte_dsc`, `modem_nr_dsc` | mdmss-0/1/2 | trip1 111 °C, trip2 115 °C (hyst 3 °C) |
  | `modem_nr_scg_dsc` | mdmss-0/1/2 | trip1 111 °C |
  | `cpu-hotplug1..3` | cpuss-1..3 | 110 °C |
  | `ethernet-usxgmii`, `ethernet-sgmii` | ethphy-0 | 135 °C |
  | `modem_vdd` | `zeroc` | ~0 °C — **cold** protection, not heat |
- **Not bound** to any zone, and no thermal-engine daemon is running (only `thermal-eth-netlink`): `pa_*`, `sdr0_*`, `mmw0_*`, `modem_tj`, `modem_pa`, `*_sub1_*`, `cpufreq-cpu0`, `cpu-cluster0`. They will most likely always read 0 on this firmware. We read them anyway (cheap; future firmware may drive them).
- The current zone temperatures are about 44 °C, so the headroom is roughly 65 °C.

## Data contract — `status.json` → `thermal` (new, optional)

```json
"thermal": {
  "throttling": false,
  "parts": [],                 // active parts: "lte" | "nr" | "mmwave" | "modem" | "cpu" | "ethernet"
  "active": [],                // [{ "device": "modem_nr_dsc", "part": "nr", "level": 40, "max": 255 }]
  "cold_protection": false,    // modem_vdd > 0; never counts as throttling
  "headroom_c": 65,            // min over watched zones of (lowest bound passive trip − temp); null if unknown
  "trip_c": 110,               // the trip that headroom is measured against
  "trip_part": "cpu"           // which part that trip throttles
}
```

How device types map to parts (case glob): `modem_lte*|sdr0_lte*|pa_lte*` → lte; `modem_nr*|sdr0_nr*|pa_nr*` → nr; `mmw*` → mmwave; `modem_tj|modem_pa` → modem; `cpu*` → cpu; `ethernet-*` → ethernet; `modem_vdd` → cold. Anything unknown → modem.

## Build order (bottom-up)

### 1. Poller — `parse_at.sh` + `qmanager_poller`
- `parse_thermal()` goes next to `parse_temperature()`. It uses only builtins (`read`, no cat or awk) and sets `t1_thermal_*` globals.
- The zone-to-trip binding is discovered once at poller start (`_thermal_discover`): it walks the `cdevN` links, keeps zones bound to non-cold devices, and records each zone's lowest bound passive trip. Trips are static, so each later cycle only reads ~26 `cur_state` files and the watched zones' `temp` (about 10).
- It runs every 10 s in **every tier** (the local block, not the modem-touch block), because sysfs needs no AT and throttling must not wait for a full refresh.
- The sysfs root is `QM_THERMAL_ROOT` (default `/sys/class/thermal`), so the harness can point the poller at a fake tree.
- The `thermal` block is added to **both** composers, `_wc_compose_pf` and `write_cache_jq` (Invariant 9). The parity scenarios in `tools/poller-parity/` (`status_parity.sh`, fixtures, `README.md`) are extended to cover it.

### 2. Events — `events.sh`
- `detect_thermal_events()` uses the streak + latch pattern from latency and packet loss:
  - It enters after 2 throttled samples (~20 s) and emits `thermal_throttled` (warning), e.g. "5G data rate limited by heat".
  - It exits after 3 clear samples (~30 s) and emits `thermal_recovered` (info), "…after 6m".
  - A change in which parts are throttled during an episode does not emit a new event.
- Frontend: `NetworkEventType`, `EVENT_TAB_CATEGORIES`, `RESOLVED_BY`/`RECOVERY_TYPES`/`FAMILY_GLYPHS`, plus `events.json` and `dashboard.json` copy in all 5 locales.

### 3. Alerts — `alert_routing.sh`, `alert_engine.sh`, `monitoring/alerts.sh`
- New trigger `thermal_throttling`. It is capable on SMS and email and **off by default**.
- The engine sends one message per episode, once throttling has lasted `alert_after_min`. It re-arms after `thermal_recovered`. Hold time uses `mono_now`.
- End-to-end touch list (from the code map):
  - Backend: default routing, load vars, `alert_capable`, `alert_route_enabled`, `alert_capabilities_json` (lib and the CGI fallback string), CGI GET/POST, the backup restore (`apply_alert_routing`), and SMS/email message text.
  - Frontend: `AlertEventKey`, `ALERT_EVENT_ORDER`, `EVENT_GLYPH`, and `monitoring.json` copy in 5 locales.
- Routing schema: a new event key in the existing v2 file. A missing key reads as false (null-safe jq, no `//` on booleans), so old files need no migration.

### 4. Health Check — `qmanager_health_check`
- New check `svc.thermal` (category services; the count goes from 49 to 50):
  - pass: no throttling, with headroom shown in the detail.
  - warn: throttling now, with the parts listed.
  - skip: no cooling devices found.
- It reads `status.json` the way `t_cfg_poller_fresh` does, so it stays read-only.
- Bump `CATEGORY_TEST_COUNT.services` in `shapes.ts` and add `health_check.tests.svc.thermal` in 5 locales.

### 5. Dashboard
- `types/modem-status.ts`: add `thermal?: ThermalStatus`, optional because older pollers won't send it.
- `status-rail.tsx`: new chip, shown **only while throttling**, warning tone with a glyph, e.g. "Throttling (5G)". If more than one part is throttled it reads "Throttling (5G, LTE)". It's hidden when the modem is unreachable or the data is stale.
- `device-metrics.tsx` temperature row (headroom, idea 7):
  - A quiet sub-line, "Throttles at 110 °C".
  - Within 10 °C of the trip it switches to warning ink, "8 °C below throttling".
  - It's hidden when `headroom_c` is null.
  - Also fix the stale AT+QTEMP comment at :322.
- Glyphs: dashboard and `/monitoring/alerts` use different icon sets (Material on dashboard, lucide on monitoring); run `bun run icons:check`.

### 6. Docs
- New `docs/features/thermal-throttling.md`, covering the device map, which devices are bound vs unbound, the cold exclusion, the debounce, and the harness.
- One line each in `CLAUDE.md` and `docs/features/README.md`.
- Updates to `alerts.md`, `system-health-check.md` (count 50) and `adaptive-polling.md` (the new block).
- An entry in `RELEASE_NOTE.md`.

## Validation

- **Static:** CRLF check, BusyBox/POSIX audit, and the poller parity suite (both composers byte-identical). Then `bunx tsc --noEmit`, lint, `bun run i18n:check` and `bun run icons:check`.
- **On-device, normal state:** deploy (with `sync`) and confirm `thermal` in `status.json` shows `throttling:false` and `headroom_c` around 65. Run the Health Check and confirm the new item passes.
- **On-device, simulated throttle:** run the poller against a fake `QM_THERMAL_ROOT` copy in `/tmp`, with `modem_nr_dsc/cur_state=40`. Expect, in order:
  1. The chip appears.
  2. `thermal_throttled` is logged after ~20 s.
  3. The alert fires after N min (sending SMS to the test number is a live write, so I'll ask first).
  4. Reset to 0 → `thermal_recovered` after ~30 s and the chip clears.
- **Optional real test (needs your OK; it actually throttles data for a moment):** write `emul_temp=112000` on mdmss-0 so the kernel really throttles, then write 0 to clear it.

## Risks / rollback

- **The poller is the core daemon.** A mistake there means "Modem status unavailable". The safeguards are parity tests, deploying with `sync`, and keeping the previous binary to put back.
- **Cost per cycle:** discovery runs once, and each cycle does ~36 `read` builtins every 10 s, which is small.
- **Unbound devices may never move.** The UI only says what is actually measured, never "not throttled by the modem". The modem's own internal mitigation isn't visible to Linux; this goes in the doc.
- **Rollback:** each layer is its own commit on `feat/thermal-throttling` (worktree off `development-home`), so revert the commits and redeploy the old poller and libs. The optional routing key needs no cleanup.

## Decisions to confirm

1. **Alert hold time:** reuse the existing `alert_after_min` (one setting on the page, recommended), or give thermal its own setting.
2. **Headroom display:** always show the quiet "Throttles at X °C" line (recommended), or show it only within 10 °C of the trip.

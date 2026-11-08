# Thermal Throttling

QManager reports when the modem is slowing part of its radio, processor or Ethernet PHY because it is hot, and how far the hottest watched sensor is from its throttling point. The poller reads the kernel's cooling devices from sysfs (no AT command, no modem lock), publishes a `thermal` block in `status.json`, and the rest of the product reads that block: a dashboard chip, a headroom line under the temperature meter, two Activity events, an opt-in SMS/email alert and a System Health Check item. Plan: `docs/plans/2026-11-08-thermal-throttling.md` (some details changed in the build; this doc follows the code).

## Quick Reference

| Item | Value |
|---|---|
| Sampler | `parse_thermal`, `_thermal_discover`, `_thermal_part`, `_thermal_int` in `scripts/usr/lib/qmanager/parse_at.sh` |
| Globals | `thermal_available`, `thermal_sampled`, `thermal_throttling`, `thermal_parts`, `thermal_cold`, `thermal_active_json`, `thermal_headroom_c`, `thermal_trip_c`, `thermal_trip_part` |
| Sysfs root | `${QM_THERMAL_ROOT:-/sys/class/thermal}` |
| Poller call site | `poll_cycle` local block in `qmanager_poller`, every `TIER1_5_EVERY` (5) cycles of `POLL_INTERVAL` (2 s) = every 10 s |
| status.json | `.thermal` (object or `null`), written by both composers (`_wc_compose_pf`, `write_cache_jq`) |
| Events | `detect_thermal_events` in `scripts/usr/lib/qmanager/events.sh`: `thermal_throttled` (warning), `thermal_recovered` (info) |
| Latch globals | `ev_thermal_active`, `ev_thermal_since_mono`, `ev_thermal_parts` (read by the alert engine) |
| Alert | trigger `thermal_throttling` (SMS + email), `_ae_thermal_check` in `alert_engine.sh`; see [`alerts.md`](alerts.md#thermal-throttling-alert) |
| Health Check | `svc.thermal` in `qmanager_health_check` (`t_svc_thermal`) |
| Frontend | `types/modem-status.ts` (`ThermalStatus`, `ThermalPart`, `ThermalActiveDevice`); chip in `components/dashboard/status-rail.tsx`; headroom line in `components/dashboard/device-metrics.tsx`; event labels in `constants/network-events.ts` + `lib/event-presentation.ts` |
| Dev tools | `tools/thermal-sim/make_fake_tree.sh`, `tools/poller-parity/thermal_expect.sh` + `fixtures/thermal__*` |
| Install / uninstall | Nothing to add: no new files, UCI keys or `/tmp` state. The routing seed already carries the new alert cell |
| Reboot required | No |

## Data Flow

```
/sys/class/thermal/{cooling_device*,thermal_zone*}
  -> parse_thermal (parse_at.sh)            every 10 s, every tier
  -> thermal_* globals
       |-> _wc_compose_pf / write_cache_jq  -> status.json .thermal
       |      |-> dashboard chip + headroom line (use-modem-status)
       |      |-> t_svc_thermal (Health Check svc.thermal)
       |-> detect_thermal_events (events.sh) -> thermal_throttled / thermal_recovered
              |-> ev_thermal_* latch -> _ae_thermal_check (alert_engine.sh) -> SMS / email
       `-> thermal_headroom_c read directly by the alert engine for the message text
```

**Why sysfs and not AT:** the kernel already exposes the throttling state, so a sample costs a handful of `read` builtins and never touches `/dev/smd11` or the broker. That is why it can run in every tier and while a scan holds the AT lane.

## Sampling and Discovery

- `_thermal_discover` walks the tree once. It records every `cooling_device*` (`path:type:part:max_state`) and, for each `thermal_zone*`, the lowest passive/active trip bound to a non-cold cooling device (`zone:trip_mC:part`).
- A sample (`parse_thermal`) then only reads each recorded `cur_state` and each watched zone's `temp`. Trips are static and are not re-read.
- Discovery runs once per poller start. After a change to cooling-device bindings or trips, restart the poller; `cur_state` and `temp` are read every sample.
- An empty discovery (no cooling devices) is retried every 30th sample (about 5 minutes). Until a device is found `thermal_available=0` and `.thermal` is `null`.
- Paths with characters outside `[A-Za-z0-9_./-]` and device types outside `[A-Za-z0-9_.-]` are skipped, because the lists are space- and colon-separated and the type is written into JSON.
- `_thermal_int` strips leading zeros (ash would read `08` as octal) and rejects anything that is not an integer of at most 13 digits. A rejected `cur_state` counts as 0; a rejected `temp` skips that zone for the sample.

### Cadence

`poll_cycle` calls `parse_thermal` and then `detect_thermal_events` when `cycle_count % TIER1_5_EVERY == 0`, in the always-every-cycle local block (after `read_dns_data`, before `detect_data_connection_events` and `alert_engine_check`). It sits above the scan / SIM-switch early return, so it also runs during scans and in the Idle and Deep tiers (see [`adaptive-polling.md`](adaptive-polling.md) Invariant 1).

`thermal_sampled` is set to 0 immediately before that cadence check and to 1 inside `parse_thermal`, so it is 1 only in a cycle that sampled. `detect_thermal_events` returns at once when it is 0. **Why:** the debounce counts samples, not poll cycles. Calling the detector on every 2 s cycle would otherwise count the same sample five times.

> ℹ️ NOTE: The poller comment says `thermal_sampled` is cleared "at the top of each cycle". The reset is in the local block right before the cadence check. The effect is the same.

## Parts

`_thermal_part` maps a cooling-device `type` to one of six fixed tokens. Only these tokens (never modem text) reach `.thermal.parts`.

| Type pattern | Part | UI name |
|---|---|---|
| `modem_lte*`, `sdr0_lte*`, `pa_lte*` | `lte` | LTE |
| `modem_nr*`, `sdr0_nr*`, `pa_nr*` | `nr` | 5G |
| `mmw*` | `mmwave` | mmWave |
| `modem_tj`, `modem_pa`, any unknown type | `modem` | Modem |
| `cpu*` | `cpu` | CPU |
| `ethernet-*` | `ethernet` | Ethernet |
| `modem_vdd` | `cold` (never published as a part) | n/a |

`thermal_parts` is always in canonical order `lte nr mmwave modem cpu ethernet`.

## The `.thermal` Contract

`status.json` `.thermal` is `null` when no sample has been taken yet or the tree has no cooling devices. Otherwise:

```json
"thermal": {
  "throttling": true,
  "parts": ["lte", "nr"],
  "active": [
    { "device": "modem_nr_dsc", "part": "nr", "level": 40, "max": 255 },
    { "device": "modem_lte_dsc", "part": "lte", "level": 3, "max": 255 }
  ],
  "cold_protection": false,
  "headroom_c": -2,
  "trip_c": 111,
  "trip_part": "lte"
}
```

| Key | Type | Meaning |
|---|---|---|
| `throttling` | boolean | Any non-cold cooling device has `cur_state > 0` |
| `parts` | string[] | Distinct parts of those devices, canonical order; `[]` when not throttling |
| `active` | object[] | One entry per engaged non-cold device: `device` (kernel type), `part`, `level` (`cur_state`), `max` (`max_state`, 0 if unreadable) |
| `cold_protection` | boolean | `modem_vdd` is engaged. Never counts as throttling |
| `headroom_c` | integer or `null` | Whole degrees C below the nearest trip, floored; negative when over the trip; `null` when no watched sensor reads |
| `trip_c` | integer or `null` | The trip (degrees C) that `headroom_c` is measured against |
| `trip_part` | string or `null` | The part that trip slows |

Key order is part of the contract and is identical in both composers: `throttling, parts, active, cold_protection, headroom_c, trip_c, trip_part`. In the printf composer `thermal_headroom_c` / `thermal_trip_c` are numeric-guarded (non-numeric becomes `null`); `thermal_active_json` is built by `parse_thermal` from sanitized parts only.

The TypeScript type is optional and nullable (`thermal?: ThermalStatus | null`): an older poller emits no block.

## Invariants

1. **Discovery is once per poller start.** Binding or trip changes need a poller restart (see above).
2. **Sampling is every 5th cycle (about 10 s) in every tier**, in the local block, including during scans and SIM switches. **Why:** it reads no AT, so the tier backoff that protects the RM551E from AT traffic does not apply.
3. **`thermal_sampled` gates the detector.** `detect_thermal_events` must only be called after `parse_thermal`, in the same cycle.
4. **Debounce: 2 samples to enter, 3 to exit**, counted in samples (`_EV_THERMAL_ENTER=2`, `_EV_THERMAL_EXIT=3`). That is about 20 s to log a start and about 30 s to log the end. A single throttled sample, or a single clear sample mid-episode, changes nothing.
5. **`modem_vdd` is cold protection, not heat.** Its zone (`zeroc`) trips near 0 C. It sets only `cold_protection`; it never sets `throttling` or `parts`, never appears in `active`, and its zone is never a headroom source. **Why:** otherwise a cold start would read as an overheating modem.
6. **Only passive and active trips are used, never critical.** A critical trip is a shutdown point, not a throttling point. Zones with only a critical trip bound are ignored for headroom.
7. **Headroom = min over watched zones of (lowest bound trip - temp), floored to whole degrees.** Shell division truncates toward zero, so negative values are floored explicitly (`-1500 mC` becomes `-2`). A watched zone is one with at least one non-cold device bound through a passive/active trip above 0.
8. **Disconnected sensors are ignored.** Readings of `-273000`, `-40960`, empty or non-numeric (anything at or below `-40000` mC) are skipped. If every watched sensor is disconnected, `headroom_c`, `trip_c` and `trip_part` are `null` while `throttling` still reflects the devices.
9. **The UI never claims that unbound devices are inactive.** Only devices the kernel binds to a thermal zone are watched for headroom. A cooling device with no binding can still raise `throttling` (its `cur_state` is read), but it contributes no headroom. The UI shows a chip only while `throttling` is true and says nothing about what is not throttling.
10. **A latch holds through a missing block.** `detect_thermal_events` returns early when `thermal_available != 1`, so an episode already latched stays latched until a sample shows it clear.
11. **The latch is poller memory.** `ev_thermal_*` reset on a poller respawn; see the alert caveat in [`alerts.md`](alerts.md#thermal-throttling-alert).

## RM551E Device Map (probed 2026-11-08)

26 cooling devices exist. The kernel binds these to thermal zones:

| Cooling device | Part | Zone | Trip(s) |
|---|---|---|---|
| `modem_lte_dsc`, `modem_nr_dsc` | lte, nr | `mdmss-0/1/2` | 111 C / 115 C, 3 C hysteresis |
| `modem_nr_scg_dsc` | nr | not recorded | 111 C |
| `cpu-hotplug1..3` | cpu | `cpuss-1..3` | 110 C |
| `ethernet-usxgmii`, `ethernet-sgmii` | ethernet | `ethphy-0` | 135 C |
| `modem_vdd` | cold | `zeroc` | about 0 C (cold protection, excluded from heat) |

Not bound, so they likely always read 0 on this firmware: `pa_*`, `sdr0_*`, `mmw0_*`, `modem_tj`, `modem_pa`, `*_sub1_*`, `cpufreq-cpu0`, `cpu-cluster0`.

- No thermal-engine daemon runs; the only thermal process is `thermal-eth-netlink`. The kernel does the throttling, so `cur_state` is authoritative.
- Sensors that read `-273000`, `-40960` or empty are disconnected.
- With every sensor idle the live result was `throttling:false`, `headroom_c` about 70, `trip_c` 110, `trip_part` `cpu` (the lowest bound trip is the 110 C CPU hotplug trip).
- Cooling-device and zone numbers are firmware specific. Match on `type` files, not numbers.

## Events

`detect_thermal_events` (`events.sh`) is a streak plus latch, the same shape as the latency and packet-loss detectors.

| Event | Severity | Message |
|---|---|---|
| `thermal_throttled` | warning | `Thermal throttling started (5G, LTE)`; without the part list when none is named |
| `thermal_recovered` | info | `Thermal throttling ended after 1m` (duration as `45s` / `6m` / `1h 5m`, from the mono clock) |

- A change in which parts are throttled during an episode updates `ev_thermal_parts` (a union over the episode) and logs nothing.
- Both types are in the Data Connection tab (`EVENT_TAB_CATEGORIES`). `thermal_recovered` resolves `thermal_throttled` (`RESOLVED_BY` in `lib/event-presentation.ts`). UI labels: "Heat Throttling" and "Heat Throttling Cleared".
- `ev_thermal_since_mono` is on the `mono_now` clock, so wall-clock steps (NITZ/ntpd after an SSR) cannot distort the duration or the alert wait.

## Alert

The `thermal_throttling` trigger is documented with the rest of the engine in [`alerts.md`](alerts.md#thermal-throttling-alert): one send per episode per channel after the single `alert_after_min` wait, default off on both channels, no recovered message.

## Dashboard

- **Chip** (`DashboardStatusRail`): a warning-tone `Chip` with a filled `thermostat` glyph, "Throttling (5G, LTE)" (`dashboard.json` `thermal.chip`, parts localized one by one) or the bare "Throttling" when `parts` is empty. It renders only while `thermal.throttling` is true **and** `modem_reachable` and not `isStale`, like the Radio chip: a throttle nobody can re-read is not asserted from a stale snapshot.
- **Headroom line** (`DeviceMetricsComponent`, under the temperature meter): "Throttles at 110 C" while `headroom_c` is above 10, then warning-ink "8 C below throttling" at 10 or less, and "Throttling point reached" at 0 or below. Fahrenheit users get the delta scaled by 9/5 with no +32 offset (`formatTempDelta`) and the trip converted as a temperature. Nothing is shown when the device is unreachable or `trip_c` is `null`.

## Health Check: `svc.thermal`

Category `services` (now 10 checks, 50 in total). `t_svc_thermal` reads `/tmp/qmanager_status.json` only; it never touches the modem.

| Condition | Result |
|---|---|
| Cache missing, older than 30 s, or `.thermal` is `null` | `skip` ("poller cache missing" / "poller cache stale (Ns)" / "No thermal data from the poller") |
| `throttling` true | `warn`: "Throttling now (5G, LTE)" |
| `throttling` false, headroom known | `pass`: "No throttling; 70 °C below the throttling point" |
| `throttling` false, headroom `null` | `pass`: "No throttling" |

The evidence file also holds `.thermal` and one `cooling_deviceN type=... cur_state=... max_state=...` line per live device (read from the real `/sys/class/thermal`, not `QM_THERMAL_ROOT`). See [`system-health-check.md`](system-health-check.md).

## Test Tools

### Fake sysfs tree: `tools/thermal-sim/make_fake_tree.sh`

Dev-only, never installed (`build.sh` excludes `tools/`). It copies the real thermal layout into a plain directory so the poller can be pointed at it and `cur_state` / `temp` edited by hand.

```sh
sh make_fake_tree.sh [src] [dst]       # defaults: /sys/class/thermal /tmp/qm_thermal_fake; dst must be under /tmp
```

It copies `cooling_deviceN/{type,max_state,cur_state}` and `thermal_zoneN/{type,temp,trip_point_K_temp,trip_point_K_type,cdevM_trip_point}`, and recreates `cdevM` as a relative symlink to `../cooling_deviceX`. A sensor whose `temp` cannot be read is copied as an empty file.

`init.d` does not pass `QM_THERMAL_ROOT`, so run the poller by hand for a test, then restore the service:

```sh
/etc/init.d/qmanager stop
QM_THERMAL_ROOT=/tmp/qm_thermal_fake /usr/bin/qmanager_poller >/dev/null 2>&1 &
echo 40 > /tmp/qm_thermal_fake/cooling_device10/cur_state     # modem_nr_dsc
echo 105000 > /tmp/qm_thermal_fake/thermal_zone23/temp        # mdmss-0, 6 C below trip
jq .thermal /tmp/qmanager_status.json                          # within ~10 s
echo 0 > /tmp/qm_thermal_fake/cooling_device10/cur_state
kill <poller pid>; /etc/init.d/qmanager start
```

Check the `type` files first (`grep . /tmp/qm_thermal_fake/*/type`); the device and zone numbers above are the RM551E's on one firmware.

> ⚠️ WARNING: While the poller runs against the fake tree, the real tree is not watched. Always restart the service afterwards.

### Parity harness

`tools/poller-parity/thermal_expect.sh <parse_at.sh> [fixture_dir]` runs every `fixtures/thermal__*.txt` tree spec through `dump_globals.sh` and requires the nine `thermal_*` globals to match `<fixture>.txt.expect` exactly. Cases: `none`, `idle` (the RM551E layout, with the cold zone, a dead sensor and a critical-only trip excluded), `throttle_two` (LTE + NR, floor to -2), `unknown_headroom`, `cold_and_junk` (cold alone, leading zeros, negative and text `cur_state`, a hostile type). `parity.sh` skips them when either library predates `parse_thermal`. `status_parity.sh` covers the composer side (see [`adaptive-polling.md`](adaptive-polling.md#15-the-thermal-block-is-published-by-both-composers)). Details: `tools/poller-parity/README.md` (Thermal).

## On-Device Validation (RM551E, 2026-11-08)

- Deployed, poller restarted: `.thermal` showed not throttling, headroom about 70, trip 110 (cpu).
- Health Check `svc.thermal`: pass, "No throttling; 70 °C below the throttling point".
- Fake tree with `modem_nr_dsc=40` and `mdmss-0` at 105 C: `.thermal` showed throttling, parts `[nr]`, headroom 6, trip 111. `thermal_throttled` "Thermal throttling started (5G)" was logged about 20 s later and the alert engine logged the episode start (wait 5m). Clearing it logged `thermal_recovered` "ended after 1m" about 30 s later, and the engine logged the episode over.
- The alerts GET advertises `thermal_throttling` as sms + email capable. The existing routing file without the key reads as off.

**Not validated:** a real SMS or email send, a real kernel throttle (for example via `emul_temp`), and the dashboard / Alerts UI in a browser against the device.

## Gotchas

- Unbound cooling devices stay at 0 on this firmware. "Not throttling" means the bound devices are idle; it says nothing about the rest.
- Headroom is a distance to the nearest bound passive/active trip, not to a hardware limit or a critical (shutdown) trip.
- `thermal_available` is empty before the first sample, `0` for an empty tree and `1` otherwise; only `1` produces a block.
- The sampler uses `{ read -r x < file; } 2>/dev/null` and shell arithmetic only: no `cat`, `awk` or `jq` per sample. Keep it that way; it runs in the poller's 2 s loop.

## Cross-References

- [Alerts](alerts.md): the `thermal_throttling` trigger and engine step 2b.
- [Adaptive Polling](adaptive-polling.md): the always-every-cycle local block and the `status.json` composers.
- [System Health Check](system-health-check.md): the 50-check catalog.
- [Connection Quality](connection-quality.md): the other `events.sh` detectors (`ev_link_state`) this one sits beside.

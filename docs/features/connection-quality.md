# Connection Quality Settings

The Connection Quality settings page (System Settings → Connection Quality) controls two things: how aggressively the ping daemon probes for internet reachability (Connection Sensitivity / ping profile), and at what latency/loss levels QManager fires a Network Event notification (quality thresholds). Both settings live in `/etc/config/quecmanager` and take effect without a reboot.

**Responsibility boundary (important):** The Connection Sensitivity card owns ONLY the probe interval (profile name + custom targets). It does NOT own fail thresholds or recovery — those belong to the Connection Watchdog. The Connection Watchdog is the sole writer of `quecmanager.ping_profile.interval_override`; when an override is active, the Sensitivity card shows an informational Alert explaining that the watchdog controls the interval. The profile Tabs remain interactive (not disabled) — the selected profile becomes the fallback once the override is cleared.

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/system-settings/connection-quality` |
| Ping profile CGI | `GET/POST /cgi-bin/quecmanager/system/ping_profile.sh` |
| Quality thresholds CGI | `GET/POST /cgi-bin/quecmanager/system/quality_thresholds.sh` |
| UCI package | `quecmanager` (not `qmanager`) |
| UCI section — ping | `quecmanager.ping_profile.{profile,target_ipv4,target_ipv6,interval_override}` |
| UCI section — thresholds | `quecmanager.quality_thresholds.{latency_preset,latency_custom_ms,loss_preset,loss_custom_pct}` |
| Ping daemon reload flag | `/tmp/qmanager_ping_reload` |
| Poller reload flag | `/tmp/qmanager_quality_reload` |
| Watchdog reload flag | `/tmp/qmanager_watchcat_reload` (touched by `quality_thresholds.sh` POST — dual reload invariant) |
| Interval override owner | `quecmanager.watchcat` (watchdog is sole writer of `ping_profile.interval_override`) |
| Ping daemon output | `/tmp/qmanager_ping.json` |
| Reboot required | No |

---

## Probe Mechanics

`qmanager_ping` is an ICMP probe daemon — not HTTP/curl. Each cycle it issues a `ping -c 1 -W 2 <target>` (BusyBox ICMP) call. RTT is parsed from the summary line `round-trip min/avg/max = a/b/c` (taking the avg field), with a fallback to the per-packet `time=<n>` field when no summary line appears. The RTT is then normalized to one decimal place. A probe succeeds only when a numeric RTT > 0 is extracted. 100% packet loss produces no round-trip summary line and therefore no RTT, so the probe is counted as a failure — this is the fail-safe.

**Why the switch from curl/HTTP to ICMP:** The curl HTTP probe was the single biggest behavioral difference between the old QuecManager and the new QManager, and a disconnection bug present in QManager but absent from the predecessor pointed squarely at it. Reverting to ICMP eliminates the curl probe as a suspect AND fixes a concrete IPv6-only false positive: on an IPv6-only cellular bearer the IPv4 HTTP probe targets were unreachable, so curl failed and the watchdog declared the connection down — incorrectly. The ICMP v4-primary / v6-fallback model handles that case correctly.

### IPv4-primary / IPv6-fallback (`probe_cycle`)

Each probe cycle runs as follows. IPv4 is tried first (`ping` against `target_ipv4`). Only if that fails, and only if an IPv6 ping command is available and `target_ipv6` is set, does the daemon try IPv6. Reachability stays `true` if EITHER family answers. This either-family-up logic means an IPv6-only bearer is never falsely reported offline.

Results travel via the `PROBE_RTT` and `last_family` globals — not stdout from a command substitution. A command-substitution subshell (`rtt=$(probe_cycle)`) would discard `last_family` when the subshell exits; using globals avoids that.

### IPv6 detection (`detect_ping6`)

At startup and on every reload-flag trip, the daemon runs `detect_ping6()`. It probes `::1` (the loopback address, always answerable when the kernel has IPv6) using `ping -6` first; if that is absent or fails, it tries the `ping6` applet. If neither works, `PING6_CMD` is set to empty, IPv6 probing is unavailable, and the daemon logs a single warn-once message. The daemon then runs IPv4-only. Running `detect_ping6` on reload means that OpenWRT IPv6 configuration changes are picked up without a daemon restart.

### RTT parser

`do_ping_icmp()` runs:

```sh
$cmd -c 1 -W 2 "$target"
```

and extracts the average RTT from the BusyBox summary line:

```
round-trip min/avg/max = 12.3/15.6/18.9 ms
```

using `grep -oE 'min/avg/max[^=]*= ...'` followed by `cut -d'/' -f2`. If that line is absent (100% loss, BusyBox variant), it falls back to `grep -oE 'time=[0-9.]+'`. The extracted value is then passed through `awk printf "%.1f"` to normalize precision and checked `> 0`. A zero or non-numeric result is treated as failure.

### ping.json schema

```json
{
  "timestamp": 1710700000,
  "mono": 86400,
  "profile": "relaxed",
  "targets": ["1.1.1.1", "2606:4700:4700::1111"],
  "interval_sec": 5,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "during_recovery": false,
  "last_family": "ipv4"
}
```

`targets` is `[target_ipv4, target_ipv6]`. `last_rtt_ms` is a JSON number or `null`. `last_family` is `"ipv4"`, `"ipv6"`, or `"none"` — `"none"` when both families failed. Statistics (avg/min/max/jitter/loss) and the history array are NOT written here; they are computed by the poller from `/tmp/qmanager_ping_history`.

---

## Ping Profiles

The daemon holds the profile→parameters table. UCI stores the **profile name**, two probe targets, and optionally an `interval_override`. Changing the profile name in UCI (or via the CGI) is sufficient — the daemon re-derives the internal parameters from the name. **`interval_override`, if set, supersedes the profile-derived interval entirely.** The `interval_override` key is written and cleared only by the Connection Watchdog — never by `ping_profile.sh` POST.

### Profile Table

| Profile | Interval | Fail (secs → samples) | Recover (secs → samples) |
|---|---|---|---|
| sensitive | 1 s | 6 s → 6 | 3 s → 3 |
| regular | 2 s | 10 s → 5 | 6 s → 3 |
| relaxed | 5 s | 15 s → 3 | 10 s → 2 |
| quiet | 10 s | 30 s → 3 | 20 s → 2 |

The profile→interval mapping (`sensitive=1 s`, `regular=2 s`, `relaxed=5 s`, `quiet=10 s`) is also used by the watchdog to compute `effective_interval` when no `interval_override` is set.

**Why ceil division:** The daemon converts seconds to sample counts via `ceil(secs/interval)`. This keeps the real-world time-to-fail and time-to-recover stable when the interval changes — a 6-second fail window at 1 s interval and the same 6 s at 2 s interval still declare failure after roughly the same wall-clock time.

**Why the daemon owns this table:** The UI uses the profile name as an opaque key. Only the daemon needs to know what the numbers mean. Storing interval in UCI would create a second source of truth that could drift from the daemon's internal logic.

### UCI defaults (seeded by installer)

`install.sh`'s `seed_uci_defaults()` writes:

```
quecmanager.ping_profile=ping_profile
quecmanager.ping_profile.profile=relaxed
quecmanager.ping_profile.target_ipv4=1.1.1.1
quecmanager.ping_profile.target_ipv6=2606:4700:4700::1111
```

The `ping_profile.sh` CGI also seeds these defaults on-read (via `ensure_ping_profile_config`) if the section is absent — so the section always exists after the first GET.

**Why Cloudflare DNS as the default targets:** Both `1.1.1.1` and `2606:4700:4700::1111` are anycast DNS resolvers that respond to ICMP reliably across carriers worldwide. They produce low-noise RTT baselines. The IPv4 target is pinged first every cycle; the IPv6 target is the fallback. Either can be replaced with any ICMP-reachable host using the Sensitivity card's Probe Target inputs.

**Migration on upgrade:** `install.sh seed_uci_defaults()` seeds `target_ipv4` and `target_ipv6` only when those keys are absent — user customizations are left untouched. The legacy `target_1` and `target_2` keys (HTTP URLs from the old curl probe) are deleted unconditionally on upgrade; they are useless as ICMP targets and the old probe engine is gone. No reload flag needs to be touched for the deletion since the daemon does not read those keys.

---

## Quality Thresholds

Quality thresholds control when `events.sh` fires `high_latency`, `latency_recovered`, `high_packet_loss`, and `packet_loss_recovered` events into the Recent Activities log. They also drive the Connection Watchdog's quality trigger — the same resolved threshold applies to both paths. See [connection-watchdog.md](connection-watchdog.md) for the watchdog's own debounce (`quality_consecutive`) which is independent.

**Latency basis:** both the Network Events path in `events.sh` and the watchdog's quality trigger compare against `avg_latency_ms` — the **windowed average** RTT from `status.json`. The old `events.sh` path previously used the last single RTT (`latency_ms`); it was unified to `conn_avg_latency` (which maps to `avg_latency_ms`) so that a single noisy probe cannot fire a latency event.

### Preset Table

**Latency**

| Preset | Threshold | Debounce (consecutive readings) |
|---|---|---|
| standard | 150 ms | 3 |
| tolerant | 250 ms | 3 |
| very-tolerant | 500 ms | 2 |
| custom | user-defined (1–10000 ms) | 3 (same as tolerant) |

**Packet Loss**

| Preset | Threshold | Debounce (consecutive readings) |
|---|---|---|
| standard | 15 % | 3 |
| tolerant | 30 % | 3 |
| very-tolerant | 50 % | 2 |
| custom | user-defined (0–100 %) | 3 (same as tolerant) |

The `custom` preset stores the user-supplied value in `latency_custom_ms` / `loss_custom_pct` in UCI. The `QUALITY_PRESETS` constant in `types/modem-status.ts` is `["standard", "tolerant", "very-tolerant", "custom"]`.

### Why absence == default (never seeded)

The `quecmanager.quality_thresholds` UCI section is **never seeded by the installer** and is **never created by `ensure_*` on read**. Its absence is the "user has not changed this" signal. The GET endpoint reports `isDefault: true` when the section is absent and returns `tolerant/tolerant` in the response body — the frontend displays a "Using defaults" notice instead of a "saved" state. The poller also falls back to `tolerant/tolerant` when the section is absent (see `resolve_quality_thresholds()` in `qmanager_poller`).

When the user saves thresholds for the first time, `quality_thresholds.sh` creates the section then. From that point on, `isDefault` is always `false` even if the user picks the same tolerant/tolerant values.

> ℹ️ NOTE: If you need to reset a device back to "default" state (isDefault=true), remove the UCI section: `uci delete quecmanager.quality_thresholds && uci commit quecmanager`.

---

## Apply / Reload Pipeline

```
ping_profile.sh POST
  ──uci commit──▶ /etc/config/quecmanager
  ──touch /tmp/qmanager_ping_reload
                 │
  qmanager_ping reads flag ──▶ load_config() + detect_ping6() ──▶ rm flag

quality_thresholds.sh POST
  ──uci commit──▶ /etc/config/quecmanager
  ──touch /tmp/qmanager_quality_reload     (poller + events.sh path)
  ──touch /tmp/qmanager_watchcat_reload    (watchdog quality trigger)
                 │
  qmanager_poller reads quality flag ──▶ resolve_quality_thresholds() ──▶ rm flag
  qmanager_watchcat reads watchcat flag ──▶ read_config() ──▶ rm flag
```

> ⚠️ WARNING: **`quality_thresholds.sh` must always touch BOTH reload flags** — `/tmp/qmanager_quality_reload` and `/tmp/qmanager_watchcat_reload`. The quality thresholds now feed two daemons. Omitting either flag means one daemon continues running stale thresholds until its next restart. This is the dual reload-flag invariant.

All daemons check for their respective flag at the **top of their main loop**, before the next probe/cycle. A saved change therefore takes effect in at most one cycle — at most 10 seconds on `quiet`, at most 1 second on `sensitive`. No daemon restart, no procd touch.

On ping profile reload, `load_config()` re-reads UCI and `detect_ping6()` re-probes `::1` to refresh the IPv6 ping invocation. Both run synchronously before the next probe cycle begins.

---

## CGI Envelopes

### `ping_profile.sh`

**GET response**

```json
{
  "success": true,
  "profile": "relaxed",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111",
  "interval_override": null,
  "effective_interval": 5
}
```

`interval_override` is `null` when not set. `effective_interval` is the resolved probe interval in seconds: `interval_override` if set, else the profile-derived value (sensitive=1, regular=2, relaxed=5, quiet=10). Both GET and POST use the same `target_ipv4`/`target_ipv6` snake_case keys — there is no GET/POST asymmetry in this endpoint (unlike the old `target1`/`target_1` split that existed in the prior HTTP-probe version).

> ⚠️ WARNING: `ping_profile.sh` POST does NOT write `interval_override`. That key is owned exclusively by the watchdog. Only a watchdog `save_settings` POST can set or clear `interval_override`.

**POST request**

```json
{
  "action": "save",
  "profile": "sensitive",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111"
}
```

**POST success**

```json
{ "success": true }
```

**Error codes**

| Code | Meaning |
|---|---|
| `invalid_profile` | `profile` not one of: `sensitive`, `regular`, `relaxed`, `quiet` |
| `invalid_target` | `target_ipv4` or `target_ipv6` failed per-family host validation: empty, >128 chars, interior whitespace, shell/HTML metacharacters, or characters outside the family charset (`[0-9A-Za-z.-]` for IPv4; `[0-9A-Fa-f:.%]` for IPv6) |
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `save` |

**Validation detail:** `validate_target()` applies common rules first (trim, non-empty, length ≤ 128, no interior whitespace, no shell/HTML metacharacters: `` ` $ ( ) ; | < > " \ ``), then a per-family charset whitelist. The error detail message names the offending field (`target_ipv4` or `target_ipv6`). No URL scheme is prepended — targets are bare hosts or IP literals.

---

### `quality_thresholds.sh`

**GET response (section present, named preset)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "tolerant" },
    "loss": { "preset": "tolerant" }
  },
  "isDefault": false
}
```

**GET response (section present, custom preset)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "custom", "custom_ms": 400 },
    "loss": { "preset": "custom", "custom_pct": 10 }
  },
  "isDefault": false
}
```

`custom_ms` and `custom_pct` are present only when the respective preset is `"custom"`.

**GET response (section absent — factory state)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "tolerant" },
    "loss": { "preset": "tolerant" }
  },
  "isDefault": true
}
```

**POST request (named preset)**

```json
{
  "action": "save",
  "latency_preset": "standard",
  "loss_preset": "tolerant"
}
```

**POST request (custom preset)**

```json
{
  "action": "save",
  "latency_preset": "custom",
  "latency_custom_ms": 400,
  "loss_preset": "custom",
  "loss_custom_pct": 10
}
```

`latency_custom_ms` and `loss_custom_pct` are required in the POST body when the corresponding preset is `"custom"`. The hook `useQualityThresholds` flattens the nested client type (`QualityThresholdsSettings`) to these flat wire keys before posting.

> ℹ️ NOTE: The POST body uses flat keys (`latency_preset`, `loss_preset`, `latency_custom_ms`, `loss_custom_pct`) even though the GET response uses a nested shape (`thresholds.latency.{preset,custom_ms}`). This asymmetry is intentional — the GET was shaped for front-end destructuring; the POST mirrors UCI field names.

**POST success**

```json
{ "success": true }
```

**Error codes**

| Code | Meaning |
|---|---|
| `invalid_preset` | `latency_preset` or `loss_preset` not one of: `standard`, `tolerant`, `very-tolerant`, `custom` |
| `invalid_custom_ms` | `latency_custom_ms` not an integer 1–10000 (required when `latency_preset=custom`) |
| `invalid_custom_pct` | `loss_custom_pct` not an integer 0–100 (required when `loss_preset=custom`) |
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `save` |

---

## status.json / Poller Surface

The poller merges `connectivity.profile` into `status.json` from `/tmp/qmanager_ping.json`. Consumers should treat it as optional — it is absent on older poller output and on the first write before the ping daemon has run. The `connectivity` object in the response holds both the live profile name and all latency/loss stats.

The poller also passes `last_family` from `ping.json` through into `status.json` as `connectivity.last_family`. Values: `"ipv4"` (IPv4 probe answered), `"ipv6"` (IPv4 failed, IPv6 fallback answered), `"none"` (both failed), `""` (older poller output before the field existed). The frontend reads this to show the "Currently reachable via IPv6" indicator next to the IPv6 DNS Server input.

### Packet-loss maturity guard (`PING_MIN_SAMPLES`)

The poller's `read_ping_data()` function computes `packet_loss_pct` via an awk pass over the raw history ring buffer at `/tmp/qmanager_ping_history`. The computation is `int(lost*100/n)`. A constant `PING_MIN_SAMPLES=10` gates this: the poller reports `packet_loss_pct=0` whenever the sample count `n` is below 10, regardless of how many failures the window contains. The all-null arm (total-outage path) likewise suppresses `100%` to `0` until `n >= 10`. All other output — `min_rtt_ms`, `avg_latency_ms`, `max_rtt_ms`, `jitter_ms`, and the `history` array — is unaffected.

**Why this guard exists:** `qmanager_ping` truncates `/tmp/qmanager_ping_history` on every (re)start. In the first ~20–100 seconds after a reboot or daemon restart (depending on profile — 100 s at `quiet`/10 s interval, 50 s at `relaxed`, 20 s at `regular`), the window may hold only a handful of samples. Two transient boot-attach null probes in a 4-sample window produce 50% reported loss, which is above the default watchdog quality threshold (30% for `tolerant` preset). At 5 consecutive breach cycles that is enough to trip the Connection Watchdog's quality-LOSS trigger → Tier 1 recovery (`AT+COPS=2`) → `/tmp/qmanager_ping_history` truncates again on reconnect → loop. Live evidence: 0% real loss on sustained probing; all false breaches clustered in the first ~78 s after daemon start; no recurrence once the window filled. The guard costs nothing on a stable connection — once the window has 10 samples the math is unaffected.

Genuine total outages are independently caught by the reachability/`streak_fail` path, which reads raw `ping_streak_fail` from `qmanager_ping.json` and is unaffected by this guard.

Both `/tmp/qmanager_ping.json` (written by `qmanager_ping`) and `/tmp/qmanager_status.json` (written by `qmanager_poller`) carry a root-level **`mono`** integer field alongside the existing wall-clock `timestamp`. The value is `mono_now()` from `scripts/usr/lib/qmanager/qlog.sh` — integer seconds since boot read from `/proc/uptime` (kernel monotonic counter, immune to NTP/NITZ steps). The poller's `read_ping_data` and the watchdog's `read_ping` / `read_quality` compute staleness from this field when it is valid, falling back to wall-clock age only when `.mono` is absent, zero, or non-numeric. This guards against the ~90 s false-stale event caused by the NITZ `time_daemon` + `ntpd` stepping the system clock after MPSS SSR `rmnet` re-registration.

---

## Frontend

| File | Purpose |
|---|---|
| `app/system-settings/connection-quality/page.tsx` | Route entry point |
| `components/system-settings/connection-quality/connection-quality.tsx` | Page shell: heading + 2-col card grid |
| `components/system-settings/connection-quality/connectivity-sensitivity-card.tsx` | Ping profile selector + probe target inputs + IPv6 reachability indicator |
| `components/system-settings/connection-quality/quality-thresholds-card.tsx` | Latency/loss preset selectors |
| `hooks/use-ping-profile.ts` | Fetch + save ping profile |
| `hooks/use-quality-thresholds.ts` | Fetch + save quality thresholds |
| `components/ui/meta-panel.tsx` | `MetaPanel` / `MetaPair` — info grid used for preset preview |
| `lib/motion-presets.ts` | Re-exports `containerVariants`/`itemVariants` from `lib/motion.ts` |

Types are in `types/modem-status.ts`: `PING_PROFILES`, `PingProfile`, `QUALITY_PRESETS`, `QualityPreset`, `QualityThresholdsSettings`. `QUALITY_PRESETS` is `["standard", "tolerant", "very-tolerant", "custom"]`. `QualityThresholdsSettings` has the shape `{ latency: { preset, custom_ms?: number }, loss: { preset, custom_pct?: number } }`. The save hook flattens this to flat wire keys (`latency_custom_ms`, `loss_custom_pct`) before posting. `ConnectivityStatus` has `last_family?: "ipv4" | "ipv6" | "none" | ""`.

**`use-ping-profile.ts`** exposes `targetIpv4: string | undefined` and `targetIpv6: string | undefined` (the old `target1`/`target2` fields are gone). It also exposes `intervalOverride: number | null` and `effectiveInterval: number | undefined` from the GET response.

**`connectivity-sensitivity-card.tsx`** has two target inputs — "IPv4 DNS Server" and "IPv6 DNS Server" — with per-family client-side validation mirroring the CGI's `validate_target()`. When `connectivity.last_family === "ipv6"` in `status.json`, a subtle "Currently reachable via IPv6" label appears next to the IPv6 input so the user can see when the fallback is actively carrying the connection. When `interval_override` is set, an informational Alert explains that the watchdog is enforcing a custom probe interval and that the profile selection becomes the fallback once the override is cleared. The profile Tabs are NOT disabled.

---

## Known Gotchas

- **ICMP RTT reads lower than the old TCP-connect RTT.** The previous probe measured TCP three-way handshake time; ICMP skips the TCP stack entirely. On the same connection, ICMP readings are typically 5–20 ms lower. The quality preset thresholds (150/250/500 ms) were already generous relative to the prior TCP readings, so they have even more headroom now. If you are calibrating custom thresholds, use ICMP readings from the dashboard as the baseline.
- **Some carriers rate-limit ICMP.** A small number of cellular networks deprioritize ICMP echo-reply, producing slightly elevated or occasionally dropped probe results independent of actual internet access. If your modem is consistently reachable (data works) but the ping daemon intermittently counts failures, the watchdog's `fail_threshold` (number of consecutive failures before declaring a drop) is the right lever, not the probe profile.
- **100% loss = probe failure, not null RTT.** When `ping` reports 100% packet loss, no round-trip summary line is emitted. The RTT parser finds nothing, so `last_rtt_ms` is `null` and the probe is counted as a failure. This is the fail-safe — the daemon cannot emit a false-zero latency reading.
- **`detect_ping6` runs on every reload.** Dropping the reload flag (`/tmp/qmanager_ping_reload`) causes the daemon to re-run `detect_ping6` as well as re-read UCI. If you later disable IPv6 in OpenWRT, the next ping profile save will make the daemon pick that up and stop issuing IPv6 probes.
- **Latency events now use windowed average (`avg_latency_ms`), not last single RTT.** `events.sh` sources `conn_avg_latency` (which maps to `avg_latency_ms` in `status.json`) rather than `latency_ms`. A single high-latency probe will not fire the event; it must be sustained across the debounce window. This is consistent with the watchdog quality trigger.
- **`last_family` uses globals, not stdout.** `probe_cycle()` stores results in the `PROBE_RTT` and `last_family` shell globals rather than echoing to stdout. This is intentional: assigning `rtt=$(probe_cycle)` would run `probe_cycle` in a subshell, and the subshell's assignments to `last_family` would be lost when it exits.
- **Quality preset thresholds (150/250/500 ms) have generous headroom.** Against honest ICMP RTT they comfortably exceed 3× normal cellular RTT on a healthy link. `tolerant` (250 ms) is the shipping default.
- **`quality_thresholds.sh` POST must touch two reload flags.** Both `/tmp/qmanager_quality_reload` (poller) and `/tmp/qmanager_watchcat_reload` (watchdog) must be touched on every successful save. Omitting either leaves one daemon on stale thresholds.
- **The `quality_thresholds` section must not be pre-seeded in new installs.** If it is, the frontend will never show `isDefault: true` and users won't know they haven't customised it. The installer intentionally skips seeding it. Exception: the `install.sh` migration from old watchcat ceiling keys seeds a `custom` preset for users who had non-default ceilings — this is a one-time idempotent migration, not routine seeding.
- **The Connection Sensitivity card shows an informational alert when `interval_override` is active.** The profile Tabs remain interactive — the user can pre-select a profile to fall back to. The daemon ignores the profile-derived interval while an override is active; to change the override itself, use the Connection Watchdog settings page (the watchdog is the sole writer of `interval_override`).
- **Reload is flag-file per loop, not a signal.** If the daemon is in the middle of a probe (`ping -c 1 -W 2`, up to 2 s) when the flag is written, the reload happens at the start of the *next* cycle. The effective delay after save is `0 → PROBE_TIMEOUT + PING_INTERVAL` (at most `2 + 10 = 12 s` on `quiet`).
- **Unknown profile names fall back to `relaxed`.** If you hand-edit UCI to an unrecognised profile name, the daemon silently resets to `relaxed` and continues. No error is logged.
- **False high-packet-loss immediately after a reboot is structurally prevented by `PING_MIN_SAMPLES=10`.** The poller suppresses `packet_loss_pct` to `0` until the ring-buffer window holds at least 10 samples (~20–100 s depending on profile). Without this guard, two transient boot-attach null probes in a 4-sample window report 50% loss, which trips the Connection Watchdog quality trigger and can cause a reboot loop. Do not remove this guard. Real outages are still caught by the independent `streak_fail` reachability path.

> ℹ️ NOTE: On-device validation of the updated daemon and poller is deferred — the test modem was offline at time of writing. The analysis above is based on static source review only. Verify live RTT readings and the `last_family` field in `/tmp/qmanager_ping.json` on-device before relying on these numbers in production calibration.

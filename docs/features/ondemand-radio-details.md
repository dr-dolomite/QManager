# On-Demand Radio Details

Layer-1-adjacent and data-plane AT reads (MIMO layers, timing advance, APN/DNS, WAN IP) were removed from the recurring poller and relocated behind a dedicated CGI endpoint. The endpoint is polled only while the page that displays these values is open; when the page is closed the reads stop entirely. This matches the approach taken by the predecessor app (QuecManager), which lacks the RM551E modem-drop problem.

**Why this exists:** On the RM551E-GL with IPv4-only carriers, the modem firmware runs a perpetual `QCMAP:bringup v6` retry storm — the PDP context is `IPV4V6` but the carrier returns only IPv4, so QCMAP retries forever. Issuing AT commands that reach into the QCMAP/PDP subsystem or the L1 measurement stack on a repeating timer eventually lands one mid-RAT-transition or mid-cell-reselection, which correlates with a Qualcomm MPSS baseband subsystem restart (SSR). The fix — reading these values only on UI demand — restores the lighter-touch behaviour of the predecessor.

## Quick Reference

| Item | Value |
|---|---|
| CGI endpoint | `GET /cgi-bin/quecmanager/cellular/radio_details.sh` |
| Lib | `/usr/lib/qmanager/ondemand_radio.sh` |
| On-demand cache | `/tmp/qmanager_ondemand.json` (+ `.tmp` for atomic write) |
| Hook | `hooks/use-radio-details.ts` · `useRadioDetails()` |
| Types | `RadioDetails`, `RadioDetailsResponse`, `RadioDetailsErrorResponse` in `types/modem-status.ts` |
| Poll interval (frontend) | 7 s while page is mounted; stops on unmount |
| Reboot required | No |

---

## CGI Endpoint

`GET /cgi-bin/quecmanager/cellular/radio_details.sh` — auth-gated, no request parameters.

Each call to the endpoint triggers a full on-demand AT read via `ondemand_radio_fetch()`, updates `/tmp/qmanager_ondemand.json`, then returns the result.

### Success Response

```json
{
  "success": true,
  "stale": false,
  "details": {
    "mimo": "LTE 1x4 | NR 2x4",
    "lte_ta": "12",
    "nr_ta": "8",
    "apn": "internet",
    "wan_ipv4": "10.1.2.3",
    "wan_ipv6": "2001:db8::1",
    "primary_dns": "8.8.8.8",
    "secondary_dns": "8.8.4.4",
    "primary_dns_v4": "8.8.8.8",
    "primary_dns_v6": "",
    "secondary_dns_v4": "8.8.4.4",
    "secondary_dns_v6": "",
    "updated_at": 1718539200
  }
}
```

**Field invariants:**
- Every `details` string field is **always present** — never JSON null. Empty string `""` means unknown or not applicable.
- `lte_ta` and `nr_ta` are numeric strings (`"0"`–`"1282"`) or `""`.
- `mimo` is a human-readable display label (`"LTE 1x4 | NR 2x4"`, `"LTE 1x4"`, `""`, etc.) — not a raw AT value.
- `updated_at` is a Unix epoch integer (seconds). `0` means the cache was never populated (first call and modem unreachable simultaneously).

**`stale: true`:** The modem was unreachable on this call. `details` contains the last-known values from the cache file. The UI should display them (with an optional "as of" hint) — not an empty state.

**All-empty response:** Returned when `stale: true` and the cache file does not yet exist (i.e. the page was opened for the first time and the modem is unreachable). Every field is `""` and `updated_at` is `0`.

### Error Response

```json
{ "success": false, "error": "internal_error", "detail": "parse library unavailable" }
```

Returned only if a required library fails to source. Normal AT errors produce `stale: true`, not a failure envelope.

---

## Backend Library — `ondemand_radio.sh`

`/usr/lib/qmanager/ondemand_radio.sh` exports three functions. Source it after `parse_at.sh` and a logging library.

### `load_ondemand_cache()`

Reads `/tmp/qmanager_ondemand.json` and populates 12 shell variables:

```
t2_mimo, lte_ta, nr_ta,
t2_apn, t2_wan_ipv4, t2_wan_ipv6,
t2_primary_dns, t2_secondary_dns,
t2_primary_dns_v4, t2_primary_dns_v6,
t2_secondary_dns_v4, t2_secondary_dns_v6
```

Uses positional `sed -n 'Np'` extraction (not `jq` key lookup) to guarantee empty fields for missing keys without triggering the device jq's known absence of regex support.

No-op if the cache file is absent or empty — callers retain whatever their variables were before the call.

**Called by:** `qmanager_poller` during `boot_cmd` and inside `write_cache()` so the public `status.json` retains last-known values for every poll cycle between on-demand fetches.

### `ondemand_radio_fetch()`

Issues the full set of relocated AT reads: serving cell (RAT probe), APN/DNS/WAN, timing advance, and (conditionally) MIMO layers. Writes the result to the cache file. Returns 0 if any AT response was received, 1 if the modem was entirely unreachable.

**RAT-gate hardening — the critical invariant:**

The `lte_mimo_layers` AT command crashes the modem firmware when issued while the modem is in SA (5G Standalone) mode, and `nr5g_mimo_layers` does the same in LTE/NSA mode. The function always re-reads the serving cell first (fresh AT call, not cached RAT) to learn the current RAT before deciding which MIMO command to issue. If the RAT is empty or transitioning (neither `LTE`, `5G-NSA`, nor `5G-SA`), the MIMO read is skipped entirely.

> ⚠️ WARNING: Never issue `lte_mimo_layers` or `nr5g_mimo_layers` without confirming the RAT first. The RAT read inside `ondemand_radio_fetch()` is the gate — do not bypass it or invert the condition.

**Partial-read resilience:** `load_ondemand_cache()` is called at the top of `ondemand_radio_fetch()` so a skipped MIMO read (RAT transition) does not blank the previously-good display value. The prior cached value is preserved.

AT reads issued, in order:
1. `AT+QENG="servingcell"` — learn current RAT (gates mimo)
2. `AT+CGCONTRDP;+QMAP="WWAN"` — APN, DNS, WAN IP (always, mode-independent)
3. `AT+QNWCFG="nr5g_time_advance"` (+ `AT+QNWCFG="nr5g_mimo_layers"` if SA) — NR TA and SA MIMO
4. `AT+QNWCFG="lte_time_advance"` (+ `AT+QNWCFG="lte_mimo_layers"` if LTE or NSA) — LTE TA and LTE/NSA MIMO

### `ondemand_dataplane_refresh()`

A lighter variant for apply paths: reads only `AT+CGCONTRDP;+QMAP="WWAN"` (APN / DNS / WAN IP) — no MIMO, no timing advance, no serving-cell probe. Returns 0 if the read succeeded, 1 otherwise.

**Why apply paths use this and not `ondemand_radio_fetch()`:** After a COPS detach/attach cycle (APN apply, profile apply), the modem is mid-radio-attach. Issuing a MIMO or timing-advance read at that moment is exactly the dangerous timing `ondemand_radio_fetch()` guards against with its RAT probe. `ondemand_dataplane_refresh()` deliberately omits those reads — CGCONTRDP and QMAP are QCMAP/PDP reads, not L1 measurements, and are safe in any RAT.

Loads last-known cache first, so the MIMO and TA fields it does not touch are preserved when the cache file is rewritten.

**Called from (both backgrounded with double-fork to avoid blocking CGI response):**
- `scripts/usr/lib/qmanager/apn_mgr.sh` — `apply_apn_to_modem` success path
- `scripts/usr/bin/qmanager_profile_apply` — complete/partial finalise block

> ℹ️ NOTE: After the data-plane group was removed from Tier 2, the old `touch /tmp/qmanager_force_tier2` at these chokepoints would no longer re-read CGCONTRDP (because Tier 2 no longer has it). `ondemand_dataplane_refresh()` restores the fast post-apply APN refresh without reintroducing the L1 reads.

---

## Cache File — `/tmp/qmanager_ondemand.json`

Written atomically (`jq` → `.tmp` → `mv`). Schema:

```json
{
  "mimo": "LTE 1x4 | NR 2x4",
  "lte_ta": "12",
  "nr_ta": "",
  "apn": "internet",
  "wan_ipv4": "10.1.2.3",
  "wan_ipv6": "",
  "primary_dns": "8.8.8.8",
  "secondary_dns": "8.8.4.4",
  "primary_dns_v4": "8.8.8.8",
  "primary_dns_v6": "",
  "secondary_dns_v4": "8.8.4.4",
  "secondary_dns_v6": "",
  "updated_at": 1718539200
}
```

The cache file does not exist until the first successful `ondemand_radio_fetch()` call (either via the CGI or an apply chokepoint that calls `ondemand_dataplane_refresh()`). A fresh boot with no browser open will have no cache file; `load_ondemand_cache()` no-ops in that case and the poller emits empty strings for these fields.

The cache is **not cleared on reboot** (lives in `/tmp/`, which is RAM — cleared on power cycle, not daemon restart). A hotplug restart of `qmanager_poller` will find a still-valid cache if the file exists, and `load_ondemand_cache()` in `boot_cmd` loads it so the first `write_cache()` emits the prior values rather than blanks.

---

## Poller Integration

`qmanager_poller` no longer issues any of the relocated AT commands. The relevant reads have been removed from both the `boot_cmd` block and `poll_tier2()`.

`write_cache()` calls `load_ondemand_cache()` before building the `status.json` payload. This means `.device.mimo`, `.lte.ta`, `.nr.ta`, `.device.apn`, `.device.wan_ipv4`, `.device.wan_ipv6`, and the DNS fields in `status.json` always reflect the last-known on-demand values — never blank just because the page is closed.

**Consumers must not require these fields to be live** while the UI is idle. The expected contract is: live while the page is mounted (via `useRadioDetails`), last-known while the page is closed (via `status.json`).

> ⚠️ WARNING: Do not add any of the relocated AT commands back to the poller's Tier-2 block or the boot block. Doing so reintroduces recurring L1-adjacent reads on a background timer, which is the pattern associated with RM551E baseband restarts. See [`docs/features/adaptive-polling.md`](adaptive-polling.md) Invariant 6 for the full SSR root-cause analysis.

> ⚠️ WARNING: `ondemand_radio.sh` must be co-deployed with any poller or CGI version that sources it. On devices that upgraded from an old install without running the new `install.sh`, the library may be absent. Any script that dot-sources it without an `[ -f ]` existence guard will silently kill the shell when the file is missing (BusyBox `ash` dot-source behaviour — see "BusyBox `ash`: dot-sourcing a missing file kills the shell" in [`docs/BACKEND.md`](../BACKEND.md)). The `install.sh` `install_dir_flat "usr/lib/qmanager"` step must remain in place and run on every upgrade.

---

## Frontend Hook — `useRadioDetails`

`hooks/use-radio-details.ts` · `useRadioDetails(options?)`

Polls `GET /cgi-bin/quecmanager/cellular/radio_details.sh` every 7 seconds while mounted, clears the interval on unmount. Each poll triggers a fresh on-demand AT read on the device.

```ts
const {
  details,   // RadioDetails | null
  stale,     // true = last-known returned by backend
  lteTa,     // number | null — lte_ta parsed to integer
  nrTa,      // number | null — nr_ta parsed to integer
  isLoading, // true before first successful fetch
  error,     // string | null — auth/network/envelope error message
  refresh,   // () => void — trigger an immediate re-fetch
} = useRadioDetails({ pollInterval: 7000, enabled: true });
```

**Options:**
- `pollInterval` (default `7000` ms) — interval between polls. Deliberately slower than the dashboard poller (2 s); these are heavier modem reads.
- `enabled` (default `true`) — set to `false` to pause polling without unmounting.

**Error handling:** On a transient network error, the hook preserves the last-good `details` in state and surfaces the error string only. The UI should continue displaying the prior values — consumers already fall back to the poller's `status.json` snapshot before the first fetch returns, so the same mental model applies during errors.

**`stale` flag:** When the backend's AT reads fail but the cache file exists, the CGI returns `stale: true` with the prior values. The hook surfaces this as `stale: boolean`. Render the values as normal; optionally show an "as of" indicator.

### Consumers

| Component | What it uses |
|---|---|
| `components/dashboard/home-component.tsx` | Fetches `{ details: radioDetails, lteTa, nrTa }` and passes down to device-status, device-metrics, and cell-data children |
| `components/cellular/cellular-information.tsx` | Fetches `{ details: radioDetails }` and passes to `CellDataComponent` |
| `components/dashboard/device-status.tsx` | Displays MIMO label from `radioDetails` (falls back to poller snapshot) |
| `components/dashboard/device-metrics.tsx` | Converts `lteTa` / `nrTa` to distance estimate |
| `components/cellular/cell-data.tsx` | Displays MIMO, TA, APN, WAN IP, DNS from `radioDetails` |

The preference / fallback pattern is consistent across all consumers: prefer the live `radioDetails` from the hook; fall back to the equivalent field in the poller's `status.json` snapshot (via `useModemStatus`) before the first on-demand fetch returns or when the hook is in an error state.

---

## Known Gotchas

- **Cache file absent on first boot with no browser:** `load_ondemand_cache()` is a no-op. The first `write_cache()` emits empty strings for all on-demand fields. This is correct — the UI will start a fetch as soon as the page mounts and fill the values within 7 s.
- **`updated_at: 0` in the response:** Occurs when the cache file is absent and the modem was unreachable on the first call. The UI should treat `0` as "never fetched" — not as epoch 0 (1970).
- **MIMO skipped during RAT transition:** If `network_type` is empty after the serving-cell re-read (modem is switching between LTE and SA), neither MIMO command is issued. The prior cached value is kept in the cache file. The UI will see the last-known MIMO label until the next successful fetch resolves a definite RAT.
- **`ondemand_dataplane_refresh` called during COPS re-attach:** The command it issues (`AT+CGCONTRDP;+QMAP="WWAN"`) may return empty or partial results if the PDP context is not yet re-established. The function checks for responses before writing — if no response arrives it returns 1 and leaves the cache untouched.
- **The `force_tier2` flag no longer re-reads CGCONTRDP.** After the data-plane group was removed from Tier 2, `touch /tmp/qmanager_force_tier2` does not trigger an APN refresh. Apply chokepoints now call `ondemand_dataplane_refresh()` directly (backgrounded) for that purpose.

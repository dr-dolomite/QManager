# NAS 0x006C Config Signal Info v2: evaluation (RM551E, 2026-10-22)

> **Status (2026-10-23):** implemented in `qmanager_atd` 0.5.0 ([`qmi-lane.md`](../features/qmi-lane.md#signal-config-hold-nas-0x006c-broker-050)). Two deviations from the recommendation below: the feed polls `0x004F` instead of consuming `0x0051` indications, and the signal config state is `qmi_sig_config` in the JSON sidecar instead of `sig2=1` in the capability file. Device validation is pending.

Follow-up to [`qmi-phase0-results.md`](qmi-phase0-results.md), which found NAS `0x004F` Get Signal Info cached when polled. The question was whether `0x006C` makes it live, and whether that is safe to hold for the long run. The user approved the write conditionally ("I approve it now if its good for the long run").

**Verdict: GO (green-lit by the user, 2026-10-22).** The config is not persisted, the indication stream is per-client, and the only global side effect is benign and volatile. The user waived the proposed 24 h pre-integration soak, so the SSR rate becomes a watch item (see [Risk](#risk-one-ssr-during-the-test)).

**Setup**
- **Device:** RM551E-GL, fw RM551EGL00AAR02A01M8G, TNT 515-03, 5G-NSA (B1 LTE anchor + N41), RRC idle (`NOCONN`) in every run.
- **Probe:** `native/qmi_probe` `siginfo2` command, run as `/tmp/qmi_probe2`. `0x006C` is behind `--allow-config`; without the flag it is refused.
- **Broker:** `qmanager_atd` 0.3.0 was untouched and kept serving AT and its own `0x004F` sampler throughout.
- **Comparison:** a read-only AT sampler (`AT+QENG="servingcell"` + `AT+QRSRP` via `qcmd`, every 5 s) ran beside each probe run.

## What 0x006C carries

The IDL decode of `/usr/lib/libqmiservices.so` has 61 optional request TLVs (0x10–0x4D). The response is the result TLV only, and NAS has **no matching getter**, so there is no read-back. libqmi (`qmi-service-nas.json`, since 1.32) names 0x10–0x3B. ModemManager sends the same message on its own NAS client at every modem enable, with RSSI deltas of 50 (5 dB), and never undoes it.

The relevant TLVs (deltas are `u16`, units 0.1 dB; threshold lists are `i16[]`, max 32):

| TLV | Field |
|---|---|
| 0x22 / 0x23 | LTE RSSI threshold list / delta |
| 0x24 / 0x25 | LTE SNR threshold list / delta |
| 0x26 / 0x27 | LTE RSRQ threshold list / delta |
| 0x28 / 0x29 | LTE RSRP threshold list / delta |
| 0x2A | LTE report config `{rate, avg_period}`: two enum8, 2 bytes on the wire |
| 0x33 / 0x34 | NR5G SNR threshold list / delta |
| 0x35 / 0x36 | NR5G RSRP threshold list / delta |
| 0x37 | NR5G report config `{rate, avg_period}` |
| 0x38 / 0x39 | NR5G RSRQ threshold list / delta |

0x3C–0x4D (`{u32,u16}[8]` arrays and more deltas) are newer than libqmi and stay unused.

## Runs

"Changes" counts consecutive polled `0x004F` values that differed, over about 180 one-per-second polls. Indications are `0x0051` on the run's own client after Indication Register (`0x0003` TLV 0x19 = 1).

| Run | Condition | LTE RSRP changes | NR RSRP changes | 0x0051 / min | AT LTE RSRP changes (5 s) |
|---|---|---|---|---|---|
| base | no config since the last SSR | **0** | 7 | 0.3 | 11 |
| A | client A applies `live` (1 dB deltas + report config 1/1) | 25 | 88 | **70.7** (gap p50 0.84 s, max 2.9 s) | 18 |
| B | plain client B alongside A | 25 | 83 | **0** | 18 |
| C | fresh client, A closed | 28 | 84 | 0.7 | 9 |
| D | +10 min, 300 s | 56 | 163 | 1.8 | 27 |
| E | +15 min | 26 | 98 | 0.3 | n/a |
| *SSR* | MPSS crash #4 (see Risk) | | | | |
| post1 | after SSR, no config | **0** | 1 | 0.3 | 9 |
| post2 X | deltas only (no report config) | 9 | 86 | **52.9** (gap p50 0.98 s, max 5.1 s) | 6 |
| post2 Y | plain client alongside X | 9 | 84 | **0** | 6 |
| post3 | X closed | 20 | 113 | 0 | 15 |
| post4 | `live` applied by a 5 s client, then plain polls | 24 | 117 | 1.0 | n/a |

LTE RSRQ and RSSI follow the LTE RSRP pattern, from 0 changes when cached to 30–126 when live. SINR (LTE and NR) moves even when cached, so its cache is refreshed by something else.

## Findings

### 1. Persistence and scope: two layers, neither persisted

- **Per-client: indication filtering.** Only the configuring client gets the fast `0x0051` stream. B and Y were registered for the same indication on their own sockets and received none. Closing the socket releases it, and C's rate fell back to the default.
- **Modem-global, volatile: the shared signal cache.** While any client holds a fine config, `0x004F` is live for every client: B, Y and the broker's sampler all saw it. It **stays live after the client closes**, checked at +0, +10 and +15 min, and after deltas-only. The MPSS restart (SSR) cleared it: post1 was frozen exactly like the first baseline. EFS/NV survives an SSR, so a persisted write would have survived, and this did not. A reboot restarts the same MPSS image, so it clears it too.
- The likely mechanism: NAS pushes the finest threshold any client requested down to the lower layers, and does not raise it again when that client leaves.

### 2. Interference

- **Other clients' indication streams are unchanged:** per-client filtering held, with 0 extra indications to B and Y. About 20 processes map the QCCI libraries: netmgrd, QCMAP, qmuxbridge (host QMI), mbimd, ql_nw_service, quectel_daemon, atfwd-daemon, qms, location_hal_daemon, among others. None configures `0x006C` by name, but QCCI addresses messages by ID, so a static grep cannot prove it. A host ModemManager behind qmuxbridge would apply its own 5 dB deltas on its own client, which is compatible.
- **Other clients' polled `0x004F` gets fresher.** That is the same quantity at finer granularity, not a different meaning, so it is benign for every reader.
- **Logs:** nothing new in `logread` and nothing in `qmanager.log` beyond routine lines.
- **Modem power:** not measurable here. In RRC idle the measurement cadence is set by DRX, and the config changes reporting and filtering, not how often the radio measures. The extra cost is internal messages, about 1 per second.

### 3. Reversibility

- **Read-back:** none (no getter; result-only response). An empty `0x006C` is rejected with `QMI_ERR_MISSING_ARG` (0x0011) and changes nothing.
- **Restore, per-client part:** close the socket.
- **Restore, global part:** there is no message for it. It returns to default at the next SSR or reboot. Uninstalling QManager would therefore leave a finer-grained cache until then. This is harmless, and the device restarts the MPSS often enough anyway (4 SSRs in 6 h on this boot).
- **Across SSR:** both layers are lost, and the client socket gets `ECONNRESET` (Phase 0). A holder must re-apply after NAS comes back.

### 4. Value

- **Indications:** about 1 Hz (53–71 per minute) of `0x0051` carrying LTE RSSI/RSRQ/RSRP/SNR (TLV 0x14), NR5G RSRP/SNR (0x17) and NR5G RSRQ (0x18) in NSA. Default indications carry no NR TLVs at all.
- **AT agreement while live** (indication-latest vs AT, ±3 dB):

  | Field | Agreement | Note |
  |---|---|---|
  | LTE RSRP | 91–100 % | |
  | LTE RSRQ | 97–100 % | |
  | NR SINR | 94 % | |
  | NR RSRQ | 100 % | whole dB, nearly constant |
  | NR RSRP | 40–74 % vs QENG | definition difference, not staleness (see below) |

- **NR RSRP is a definition difference, not staleness.** QENG reports the strongest of the four RX chains. QMI tracks the **mean** of the `AT+QRSRP` NR chains: 94–100 % within ±3 dB while live, bias +0.8 to +1.9. Whatever consumes it should label it as the chain mean.
- **LTE SINR** is live from `0x0051`. This was the Phase 0 NO-GO field.
- Not tested: SA mode, and RRC connected (every run was `NOCONN`).

### 5. Cost

- **Probe CPU:** a client holding the config with 1 Hz polls used 110 ms per 180 s (0.06 %). A plain polling client used 40–60 ms, so roughly 200 indications cost about 50 ms, or 0.25 ms each.
- **Request:** the `0x006C` round trip is 1.1 ms.

## Risk: one SSR during the test

At uptime 20445 s the MPSS crashed with `nr_rx_ctl_agc.c:7563:RXCTL_IUSS: RFG 0 rx 0 state is wrong`. That is the known RF IU fault, crash #4 of this boot. Crashes #1–#3 (1051 s, 2414 s, 8455 s) all came before any `0x006C` write, and #1 came before any QMI traffic. #4 came 16 min after the first apply. One event can't separate cause from coincidence, and NR RX AGC is not obviously connected to reporting thresholds. The pre-integration soak was waived. Instead, after the broker integration ships, compare SSRs per hour (`handling crash #N` in `dmesg`) against this device's history. If the rate goes up, back the config out of the broker.

## Recommended design

1. **Holder:** `qmanager_atd` applies `0x006C` on its own long-lived NAS client:
   - when the QMI registry is built;
   - after every rebuild, because an SSR wipes both layers. It re-applies once NAS reappears in the name server, before registering indications.
2. **TLVs** (deltas only, 1 dB; the report-config TLVs are left out because their enum mapping is unverified and they buy only about 30 % more indications):

   ```
   0x23 02 00 0A 00   LTE RSSI delta  10 (1.0 dB)
   0x25 02 00 0A 00   LTE SNR delta   10
   0x27 02 00 0A 00   LTE RSRQ delta  10
   0x29 02 00 0A 00   LTE RSRP delta  10
   0x34 02 00 0A 00   NR5G SNR delta  10
   0x36 02 00 0A 00   NR5G RSRP delta 10
   0x39 02 00 0A 00   NR5G RSRQ delta 10
   ```

   Then send Indication Register `0x0003` with `19 01 00 01` (Signal Info on) on the same client.
3. **Feed:** `0x0051` indications update the snapshot sampler's signal fields, latest-wins. They are valid only while `0x0024` reports `registered`, which is the gating Phase 0 already uses. The file cadence stays the sampler's. Live tiers can read the indication-fed values at about 1 Hz without extra polling. The 2 s `0x004F` poll also turns live once the config is held, so it remains a fallback.
4. **Allow-list:** `0x006C` is a broker-internal call with compiled-in TLVs. It is never reachable through the `QMI` verb or `qcmd`, which keeps the read-only allow-list for clients.
5. **Failure handling:**
   - A non-OK result logs once per registry build and leaves the sampler on cached `0x004F`.
   - `QMI_ERR_INVALID_QMI_CMD` or not-supported on other firmware: fall back to doing nothing. Don't fall back to `0x0050` v1; it is untested here.
6. **Fields for Phase 2 live tiers:** LTE RSRP/RSRQ/RSSI/SINR and NR RSRP (chain mean)/SINR/RSRQ, all from `0x0051`.

## Artifacts

- **Probe:** `native/qmi_probe` `siginfo2` (`--allow-config`, presets `live` or raw `tt=hex` TLVs). On the device it is `/tmp/qmi_probe2` (tmpfs).
- **Device state at the end:** the global cache is live (post4 re-applied it) until the next SSR or reboot. No other state was changed, and all `/tmp/qsi_*` files were removed.

# QMI CA gap-fill: evaluation and recommendation (NO-GO)

Status: **recommendation, awaiting user decision.** No code written, nothing deployed, modem touched read-only.
Inputs: `qmi_merge.sh`, `qmanager_poller` (`poll_tier2` region ~2885-2925, `write_cache`), `parse_at.sh` `parse_ca_info`, `events.sh` `_ev_ca_check`, `adaptive-polling.md` s13 + CA hold-last-known, `qmi-lane.md`, phase 2 plan D1.

## 1. How stale is CA today?

| Tier / situation | CA source | Staleness |
|---|---|---|
| Active | `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0` **every base cycle** (poller header: "QCAINFO runs every cycle") | 0-2 s. Nothing to fill |
| Idle (AT every 15 s) | same, on each AT touch | up to 15 s |
| Deep (AT every 60 s) | QCAINFO **skipped**, CA held at last known | unbounded, but every consumer (UI heartbeat, public overview, Prometheus scrape, fetch_data) wakes the poller to Active/Idle with a full refresh, so deep CA is read by no one in steady state |
| AT busy (rc 3) | last known kept | a few seconds |
| Scan / SIM switch | early-return `write_cache`, overlay forbidden by D2 (mid-scan QMI rows follow scanned carriers) | not fillable by design |

The staleness is already labelled: `device.ca_read_mono` (Prometheus exports `qmanager_carrier_components_age_seconds`). The only real beneficiary is the first `status.json` frame after a deep to active wake (shows hours-old CA for about one 2 s cycle) and the 15 s idle window.

## 2. Live evidence (read-only, RM551E, tier `deep`, LTE only)
`qmi.env`: `qmi_ca_count=2`, PCC B28/9485/PCI 135/20 MHz, SCC1 B3/1350/PCI 135/15 MHz, `active=0` (configured, not activated). `status.json`: `ca_count=1`, carrier_components PCC B28 + SCC B3 with identical identity, plus per-carrier rsrp/rsrq/rssi/sinr AT-only. So identity parity holds and SCC count = `qmi_ca_count - 1`; AT counts configured SCCs too. NSA with an NR leg was not observed (no NR on the unit now).

## 3. What a safe narrow form would have to be
Only the LTE entries of `t2_carrier_components`, `t2_ca_count/active`, `t2_total_bandwidth_mhz`, `t2_bandwidth_details` can come from QMI. To honour the hard constraints the overlay would need to:
1. rebuild the JSON array in pure ash (zero forks, no jq): carry each existing carrier's AT rsrp/rsrq/rssi/sinr by (earfcn, pci) lookup, give brand-new carriers null signal, keep every NR entry byte-for-byte from the AT string (needs splitting a JSON string on `},{` in ash);
2. recompute total bandwidth and details including the preserved NR entries;
3. gate on a new `_QCA_PARSED` (QCAINFO parsed this cycle), the existing sidecar gates, PCC PCI/EARFCN = AT serving cell, AT list free of... or NR preserved, and `qmi_ca_count` non-empty (empty in NSA when 0x00AC answers 0x4A);
4. add `network.ca_source` (`at|qmi`) to both composers + type, extend `dump_globals`/`status_parity`/`sidecar_parity`, then save/restore all five globals around `write_cache`.
Risks: parity-gated poller hot path; ash JSON string surgery is the class of code that shipped broken before; CA list flips between AT-signal-bearing and QMI-built values; the UI then shows fresh identity with up-to-15 s-old signal in the same row.

## 4. Recommendation: NO-GO
Benefit is one wake frame plus the idle 15 s window; cost is a non-trivial hot-path rewrite touching every status consumer. The existing `ca_read_mono` already makes staleness visible. Revisit only if deep-tier CA becomes user-visible (e.g. a consumer that reads without waking the poller) or if the idle interval is raised well beyond 15 s.

If the user wants it anyway, the cheapest honest increment is a **deep/idle-only, LTE-only, no-NR-in-AT-list** form: skip steps 1-2's NR handling by refusing to overlay whenever the AT list contains an NR entry (NSA then keeps last-known, labelled by `ca_read_mono`), which removes the ash-JSON NR splice. Estimated: `qmi_merge.sh` +~70 lines, poller composers + type +6 lines, parity scripts, docs; rollback = delete the lib (stubs make the overlay a no-op).

## 5. Docs follow-up (if no-go is accepted)
Replace the "Not built: CA gap-fill" wording in `qmi-lane.md` ("what is left") and `adaptive-polling.md` s13 "Not merged: CA" with a one-line pointer to this note; the docs/housekeeping session currently edits `qmi-lane.md`, so do this after its merge.

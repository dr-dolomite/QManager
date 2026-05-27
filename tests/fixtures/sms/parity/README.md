# SMS Parity Baselines

Pre-change reference samples captured before the native-SMS migration (`feature/sms-native-backend`).
These frozen snapshots are diffed against in Task 17 (Phase 1 verification) and Task 32 (final
verification) to prove the new native QMI-based stack (`qmsms` + awk PDU codec) produces
functionally identical output to the old `sms_tool`-based pipeline.

> **Directory layout:** Codec unit fixtures for PDU decoding and encoding live at
> `tests/fixtures/sms/decode/` and `tests/fixtures/sms/encode/` (populated by Tasks 1+).
> This `parity/` directory is reserved exclusively for end-to-end behavioral baselines — not
> codec unit fixtures.

## Capture metadata

- **Date captured:** 2026-05-28
- **Git SHA at capture:** `2773f0e8df7e1cc4c74a66acfbd6366246d5b1c3` (branch: `feature/sms-native-backend`)
- **Capture method:** SSH to live test modem; commands run directly on device

## Device info

```
Linux Russel 5.15.170-perf #1 SMP PREEMPT Wed Aug 6 06:04:42 UTC 2025 aarch64 GNU/Linux
DISTRIB_DESCRIPTION='RM551EGL00AAR02A01M8G_2025_9_25_iamromulan_basic_eth'
```

## Files

| File | Command used | Description |
|---|---|---|
| `baseline.recv.json` | `sms_tool -d /dev/smd11 recv -j` | Raw JSON from sms_tool — 73 message slots, pretty-printed |
| `baseline.status.txt` | `sms_tool -d /dev/smd11 status` | Plain-text storage status: `Storage type: ME, used: 73, total: 255` |
| `baseline.cgi.json` | `_SKIP_AUTH=1 REQUEST_METHOD=GET /www/cgi-bin/quecmanager/cellular/sms.sh` | Full CGI response body (headers stripped); 51 merged messages after multi-part assembly |

## Known pre-change behavior / anomalies

- **`baseline.cgi.json` storage shows `{used: 0, total: 0}`** — this is a pre-existing bug in
  `sms.sh`: the grep pattern `[0-9]*/[0-9]*` expects `N/M` format, but `sms_tool status` outputs
  `used: 73, total: 255`. The native migration should fix this by using `WMS_GET_STORE_INFO` directly.
  Task 17/32 diff instructions should account for this: `storage.used` and `storage.total` are
  expected to **change** from `0` to the real values post-migration.

- **Message count:** 73 raw slots assembled into 51 logical messages (multi-part SMS groups merged
  by the CGI's `group_by(.sender + "|" + (.reference | tostring))` jq pipeline).

- **`sms_tool` path on device:** `/usr/bin/sms_tool`

## Diff guidance for Task 17 / Task 32

The `.storage.used` and `.storage.total` fields in `baseline.cgi.json` will
intentionally change from `0/0` to real values after the migration — the new
native pipeline fixes the pre-existing parser bug. When running parity diffs,
strip these fields first:

    jq -S 'del(.storage)' baseline.cgi.json > /tmp/baseline.nostorage.json
    jq -S 'del(.storage)' <new-cgi-output>    > /tmp/current.nostorage.json
    diff /tmp/baseline.nostorage.json /tmp/current.nostorage.json

Any remaining diff is a real regression and must be investigated before the
phase tag advances.

For `baseline.recv.json` (raw sms_tool output) vs the post-migration cache
(`/tmp/qmanager_sms_inbox.json`), the .msg array shape should match
byte-for-byte modulo field ordering. Diff with:

    diff <(jq -S '.msg' baseline.recv.json) \
         <(ssh modem 'jq -S ".msg" /tmp/qmanager_sms_inbox.json')

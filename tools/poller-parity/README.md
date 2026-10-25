# poller-parity

Dev-only parse-parity gate for ledger row B5.29. It proves that a rewritten
`scripts/usr/lib/qmanager/parse_at.sh` sets **byte-identical globals** to the
current one for every input, and that the helper functions keep the same
echo output for external callers (`radio_details.sh`, `ondemand_radio.sh`,
`apn_mgr.sh`, `qmanager_profile_apply` all source `parse_at.sh`).

POSIX sh, LF only, BusyBox ash safe. The authority is the device shell; run it
there. Nothing here is installed by the product.

## Files

| File | Purpose |
|---|---|
| `dump_globals.sh <lib> <parser> <fixture>` | one parser, one fixture, fresh shell; prints the parser-owned globals |
| `parity.sh <old> <new> <fixture_dir>` | every fixture through old and new; `PASS`/`FAIL` + diff; exit 0 only if no diffs |
| `parity.sh --tap <new> <tap_dir>` | replay poller tap records through the new parsers (see below) |
| `tap_replay.sh` | implementation of `--tap` |
| `shim.sh` | qlog stubs + the poller's call shapes (`qcmd_exec` strip, `poll_*` guards) + sentinel / default initialisers |
| `sinr_expect.sh <parse_at>` | table test for `_lte_sinr_db_g` (QENG LTE raw `<SINR>` X to `2X-20` dB, 0..25 only, else empty); the Rust port that carried the same table was removed 2026-10-25 |
| `measure.sh [seconds]` | on-device poller cost sampler (one summary line) |
| `gen_fixtures.sh [dir]` | regenerates the whole fixture corpus byte for byte (device or Git Bash) |
| `status_parity.sh` | Phase C gate for the status.json composers: printf composer vs the jq composer (`write_cache_jq`) over synthetic scenarios, seeded random values, hostile text and the write_cache safety net; and the live 200-pair capture from the deployed poller (`arm` / `compare` / `live`) |
| `sidecar_parity.sh` | Phase C gate for the `.env` sidecars (`ping.env`, `dns.env`, `ondemand.env`) and the `-nt`-gated watchcat / SIM state readers, in a scratch dir; also asserts the sidecar paths fork no `jq` / `date` / `touch` / `awk`. An optional 5th argument (`qmi_merge.sh`) adds the `qmi.env` gate: a valid env loads, truncated / stray-line / hostile-value / older-than-stamp envs are rejected, the overlay applies and restores, and the path forks nothing |

### Status composer gate (Phase C)

Stage the poller under test, `qmanager_ping`, `conn_state.sh`, `ondemand_radio.sh`
and both scripts flat in `/tmp/pcx` (absolute paths: `.` does not search the
current directory), then:

```
sh status_parity.sh all /tmp/pcx/qmanager_poller 500     # synthetic + hostile + safety net
sh sidecar_parity.sh /tmp/pcx/qmanager_poller /tmp/pcx/qmanager_ping /tmp/pcx/conn_state.sh /tmp/pcx/ondemand_radio.sh /tmp/pcx/qmi_merge.sh   # last arg optional (QMI overlay)

# live, after the orchestrator deploys the poller (about 7 minutes: 200 cycles of 2 s)
sh status_parity.sh live 900        # arm, wait for the 200 pairs, compare
```

The live capture needs the deployed poller; `arm` creates
`/var/run/qmanager/wc_parity`, the poller writes `wcp/<n>.jq.json` and
`<n>.pf.json` (same globals, both composers) for n = 0..199 and removes the flag.
`init.d/qmanager` `stop_service` clears the flag and the capture dir.
| `fixtures/` | corpus, CRLF bytes preserved (`.gitattributes`: `fixtures/** -text`) |

`dump_globals.sh` prints `set | grep -E '^(lte_|nr_|t1_|t2_|sig_|network_type=|service_status=|_cid_)' | sort`
after pre-setting every poller-initialised name to `SENT_<name>` (so "left
unchanged" shows), then also the full `t2_carrier_components` value (the grep
is line oriented and would otherwise cut the pretty-printed multi-line jq JSON
after its first line). A sidecar `<fixture>.txt.env` (shell assignments) is
sourced after the sentinels, used to pin `network_type` / `lte_state` /
`nr_state` for the `parse_ca_info` reconciliation cases.

Fixture name = `<parser>__<case>.txt`; parser is one of `serving_cell qrsrp
qrsrq qsinr signal ca_info carrier sim_slot sim_status tier2 temperature
helpers`. Pre-processing is the poller's: `serving_cell` and `ca_info` go
through the `qcmd_exec` strip (`grep -v '^AT'|'^OK$'|'^$'`, which leaves
`OK<CR>` and `<CR>` lines in place on CRLF data) plus its rc rules (empty /
`ERROR`); `ca_info` falls back to the reset block unless rc==0 and non-empty;
`qrsrp/qrsrq/qsinr/signal/carrier/sim_slot` get the raw reply guarded by
`[ -n ]`; `sim_status` gets only the first `+CPIN:` line (`tier2` runs the
`poll_tier2` sequence, including the `CME ERROR` -> `error` branch).

`helpers__*.txt`: one call per line, `helper arg1 arg2`; tab-separated when an
argument contains spaces; tokens `<empty>` and `<CR>`. Output
`helper(args)=[stdout] [rc=N]`; `_compute_cell_parts` prints its `_cid_*` globals.

## Run on the device

```
# from the dev box (Posh-SSH Set-SCPItem or scp), flat into /tmp/pp:
#   tools/poller-parity/*.sh   +   scripts/usr/lib/qmanager/parse_at.sh (old)  +  new parse_at.sh
ssh root@modem 'mkdir -p /tmp/pp && cd /tmp/pp && chmod +x *.sh && sh gen_fixtures.sh /tmp/pp/fixtures'

cd /tmp/pp
sh parity.sh parse_at.sh parse_at.sh fixtures        # sanity: old vs old, must be all PASS
sh parity.sh parse_at.sh parse_at_new.sh fixtures    # the gate
sh parity.sh --tap parse_at_new.sh /var/run/qmanager/tap
PARITY_FILTER=ca_info sh parity.sh old new fixtures  # subset
PARITY_ALLOW_SINR=1 sh parity.sh pre_sinr.sh new fixtures  # old predates the LTE SINR dB conversion
sh measure.sh 60                                     # poller cost over a window
```

Fixtures are CR-sensitive: generate them on the device with `gen_fixtures.sh`
(or copy with scp); `modem_write` strips CRs and must not be used for them.
A full 206-fixture run takes about 90 s on the device (about 6k forks); it runs
under `nice -n 19` (`PARITY_NICE=0` to disable). `parse_at.sh`'s
`/tmp/qmanager_*.tmp` scratch files are rewritten to private `/tmp/ppx_<pid>_*`
names while sourcing, so a run cannot collide with the live poller's
`parse_ca_info` (`PARITY_NO_TMP_REWRITE=1` disables the rewrite). Hostile
fixtures try to `touch /tmp/pp_pwned`; `parity.sh` fails the run if that file
appears.

## Temperature

`parse_temperature` reads `/sys/class/thermal` through paths hard-coded in
`parse_at.sh` and cannot be redirected without editing the library, so it only
runs live: `temperature__live.txt` (content ignored) makes `parity.sh` run
old, new, old back-to-back and PASS if new equals either old reading, retrying up to 5 times (sysfs
jitter between calls is tolerated).

## Tap replay (`--tap`)

Records are written by `_tap_at` / `_tap_end` in `qmanager_poller` while
`/var/run/qmanager/poller_tap` exists (ring of 200 files `N.rec`). Replay walks
cycles in numeric order, runs each recorded reply through the new parsers in
poller order with the poller's pre-processing, and compares the parser-owned
globals with the recorded `GLOBALS` block (both sorted, same `set` quoting).

Compared: `lte_{state,band,earfcn,bandwidth,pci,rsrp,rsrq,sinr,rssi,cell_id,enodeb_id,sector_id,tac}`,
`nr_{state,band,arfcn,pci,rsrp,rsrq,sinr,scs,cell_id,enodeb_id,sector_id,tac}`,
`t2_{carrier,sim_status,sim_slot,ca_active,ca_count,nr_ca_active,nr_ca_count,total_bandwidth_mhz,bandwidth_details,carrier_components}`,
`sig_*`, `network_type`.

Not compared (poller-side or not replayable): `service_status` (overwritten by
`determine_service_status`), `t1_temperature` (sysfs), `lte_ta`/`nr_ta`
(on-demand cache), `t1_cfun`, `modem_reachable`, `errors`, `boot_phone_number`,
`_cid_*`.

Limits: the tap's line-oriented `grep` records only the first line of the
multi-line `t2_carrier_components` JSON (`'[` = non-empty), so the tap checks
emptiness only; component content is covered by the fixtures. State carries
over between cycles as in the poller; the first record and any record after a
cycle gap is seeded from its own recorded values (marked `(reseeded)`), which
cannot catch a stale-value bug in that single cycle. Tap records contain the
SIM phone number (`+CNUM`, `boot_phone_number`): redact digits before copying
any record into the repo.

## measure.sh

Prints one line, e.g.
`window=60s ticks=N cpu_pct_core=X forks_per_s=Y status_period_avg=Z min=.. max=.. mono_age_max=.. tiers=active:n,idle:n,deep:n changes=.. samples=.. own_forks=.. elapsed=.. hb_age_min=.. hb_age_max=.. hb_n=..`
- `ticks`: utime+stime+cutime+cstime delta of the poller (`/proc/<pid>/stat` 14-17, CLK_TCK 100); `cpu_pct_core` = ticks / elapsed seconds.
- `forks_per_s`: system `processes` delta from `/proc/stat` minus the sampler's own forks (one `sleep 0.25` per sample plus one `date +%s` per 10 s; everything else is a builtin; `own_forks` is printed).
- `status_period_*`: seconds between changes of the whole-second `.mono` in `/tmp/qmanager_status.json` (resolution 0.25 s; `.mono` is line 3 of the pretty-printed file, read with builtins).
- `mono_age_max`: max of (`/proc/uptime` seconds - `.mono`).
- `tiers`: `.network.poller_tier` sampled every 10 s; `hb_age_*`: now - epoch in `/tmp/qmanager_ui_active`, every 10 s.

## Coverage (206 fixtures)

- serving_cell (about 60): LTE NOCONN/CONNECT/LIMSRV FDD/TDD, 17/16/10-field short lines (trailing-CR retention), trailing comma, dash/empty/space-padded fields, lowercase / invalid / empty / `0x` / 28-bit-max / overflowing hex, no `servingcell` line, SEARCH with and without an LTE tag, bare NOCONN/LIMSRV/CONNECT, unknown state, WCDMA, two servingcell lines, LF-only / bare-CR / no final EOL, empty / OK-only / ERROR / CME ERROR / garbage, hostile strings (`$(id)`, backticks, `;`, `'`, `"`, `\`); NSA (LTE+NR5G-NSA lines, SCS enum and unknown, 15-field LTE line, short / dash / negative-SNR / trailing-comma NR line, missing LTE or NR line, bad / lowercase hex); SA (state variants, 16/15-field lines, 36-bit NCI `FFFFFFFFF`, lowercase / bad / empty / zero hex, SCS 0/3/unknown, dash and negative SNR, trailing comma, hostile, LF-only, SA+NSA tags mixed).
- ca_info (about 60): LTE PCC/SCC, every resource-block value, short / dash / empty / trailing-comma lines, empty freq, non-numeric / float / exponent / `+3` SINR, `1-2` PCI, `-115-` RSRP, hostile freq / band / type, huge and zero-padded numbers, tab inside a field; NR short forms (5-8 fields) and long forms (9-13 fields), the 8/9-field boundary, trailing commas, SNR raw 1235 / -5 / 5 / 0 / -32768 / `-` / empty / `abc` / 1255 / 1245 / -1235 / 32767 / 150 in both forms, awk-numeric edge cases (`0x10`, `1e4`, `+250`, `nan`, `inf`, `.5`, 20-digit), all NR bandwidth enums plus empty, NRDC band; NSA (single / double NR SCC), SA, NR PCC while QENG says LTE (reconcile, with `.env` sidecars for every `nr_state`/`lte_state`/`network_type` branch and the NSA no-reconcile branch); unrecognised band skipped, SCC count vs component mismatch, no QCAINFO lines, SCC without PCC, unanchored `+QCAINFO` text, blank lines between, duplicate PCC, no space after prefix, `LTEBAND` spelling, LF-only, empty / OK-only / ERROR / CME ERROR / ERROR after data.
- signal (about 30): live capture, 4RX, 2RX with -32768 on ports 3/4, NR only, NSA both lines, NR ports 3/4 inactive, all inactive, missing QRSRQ or QSINR, trailing / empty fields, fewer than four values, RAT-only lines, no RAT suffix, no space after colon, extra spaces, non-numeric / hostile values, duplicate lines, both RATs on one line, other RAT tags, more than four values, CR inside, LF-only, bare-CR, no final EOL, empty / OK-only / ERROR / CME ERROR; plus single-parser `qrsrp` / `qrsrq` / `qsinr` fixtures.
- tier2 + carrier / sim_slot / sim_status (about 40): live capture (phone redacted), COPS shapes (no commas, one / two commas, deregistered, empty name, comma in name, numeric format, spaces, no space after colon, two lines, hostile, UTF-8, trailing fields), QUIMSLOT shapes (1, 2, 3, `1 2`, empty, missing, hostile, trailing space), CPIN shapes (READY, SIM PIN / PUK / PIN2, NOT READY, NOT INSERTED, ERROR, unknown, lowercase, two lines), SIM absent (`+CME ERROR: 10` last / first), empty / OK-only / ERROR.
- temperature: live only.
- helpers: `_sig_val`, `_antenna_to_json_array`, `_antenna_line_to_json`, `_hex_to_dec`, `_compute_cell_parts` (lte and `nr`), `map_scs_to_khz`, `_lte_rb_to_mhz`, `_nr_bw_to_mhz` (about 190 calls including CR, empty, overflow and non-numeric arguments).

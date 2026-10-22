# Config Signal Info v2 integration (broker 0.5.0)

Implements the GO verdict in [`../research/qmi-signal-info-v2.md`](../research/qmi-signal-info-v2.md). Branch `claude/qmi-siginfo-v2-build` in its own worktree `.claude/worktrees/qmi-siginfo-v2-build` (Phase 2 tip + the evaluation merged from `development-home`). Phase 2 is still being tested in parallel; new Phase 2 commits get merged in, and conflicts in `qmi_snapshot.rs` / `live.rs` are resolved with that session.

## What recon found

- The model already maps `0x004F` into LTE SINR and NR RSRP/RSRQ/SINR (`Signal::build`, `model.rs`), but `model::bundle` passes `sig_info: None`. The snapshot and live samplers never issue `0x004F`; only the one-shot `qmi signal` read does.
- The registry already replays a stored Indication Register (`ind_reg`) on every rebuilt socket (`on_found`), and `demux` already publishes `KIND_IND` packets undecoded. Nothing calls either in production.
- `0x006C` is on neither allow-list; tests assert clients are refused.
- `qmi.env` deliberately carries no signal fields (test asserts no `lte_`/`nr_` keys); the poller overlay stays AT-authoritative for signal.

## Design (one deviation from the research, flagged)

1. **Hold the config in the broker.** New `Registry::hold_config(svc, msg, tlvs)` stored beside `ind_reg` and replayed in `on_found` **before** `ind_reg`, on every (re)build, so an SSR re-applies it once NAS reappears. Compiled-in TLVs only (the 7 deltas = 1.0 dB, no report-config TLVs). `0x006C` goes into a new `BROKER_CONFIG` const in `allow.rs`, never `CLIENT_ALLOWED`; client refusal tests stay.
2. **Failure handling:** non-OK result logs once per build (`qmi: sig config rejected err=0x..`) and changes nothing else; `INVALID_QMI_CMD` / not-supported = do nothing, no `0x0050` fallback.
3. **Feed: poll `0x004F` in the bundle instead of consuming `0x0051` indications** (deviation). Once any client holds the config the global cache is live, so a polled `0x004F` is exactly as fresh as the indication stream, costs ~1 ms per sample, and needs no latest-wins staleness rules (cell change, reg loss, SSR). `0x004F` becomes the 5th bundle request, optional like CA/RF. Indication Register is not sent. If you prefer the research's indication feed, say so: it adds a decoder for `0x0051`, a subscriber in the sampler and staleness gating (~1 extra day).
4. **Live file (`v` stays 1, additive fields):** each sample gains optional flat x10-int fields `sinr` (LTE), `nr_rsrp`, `nr_rsrq`, `nr_sinr` (null when absent). NR RSRP is documented as the **mean of the NR chains** (differs from QENG's strongest-chain value). Still identifier-free; nulls under the same reg/scan gate.
5. **Capability:** proto line gains `sig2=1` only after a successful apply in the current registry build (lets the doc/health check see it). Version 0.5.0. Wire stays proto 3.
6. **Frontend: deferred.** The live-signal store, hook, dashboard `signal-*` and antenna-alignment files belong to Phase 2 while it is under test. This build only adds the fields to `types/live-signal.ts` (optional, nullable). Showing LTE SINR live on the dashboard is a follow-up once Phase 2 merges.
7. **Unchanged:** poller, `qmi.env`, `qmi_merge.sh`, CGIs, install/uninstall (no new files). Uninstall cannot undo the global cache; it clears at the next SSR/reboot (documented, harmless).

## Team and build order

| Step | Who | Model |
|---|---|---|
| A. `allow.rs` const + registry `hold_config` + replay + tests (fake transport: applied before ind_reg, re-applied after rebuild, rejection logged once) | backend-writer | Sonnet |
| B. Bundle 5th request + live renderer fields + sidecar `sig2` + tests (fixture `r1_3_0x004F`) | backend-writer | Sonnet |
| C. Version bump, `cargo test` (own `CARGO_TARGET_DIR`, not Phase 2's `~/qm_atd_target`), cross build, readelf static check. `dependencies/qmanager_atd` is committed only on Phase 2's final tip (binaries can't merge) | main / Haiku | Haiku |
| D. `types/live-signal.ts` optional fields, `bunx tsc --noEmit` | main | Haiku |
| E. Docs: `qmi-lane.md` (0x006C internal), `live-signal.md` (fields, chain mean), `at-broker.md`, `dependencies/README.md`, `RELEASE_NOTE.md` | docs-writer | Haiku |
| Review of A/B diffs (sensitive: config write path) | me | Opus |

A and B touch different files and run in parallel.

## Validation

- `cargo test` (all), clippy clean; parity `tools/atd-parity` differs only in new live fields.
- **On-device: blocked** until the Phase 2 session reports its OTA, browser and 6 h A/B SSR soak are done (a `0x006C` apply would invalidate the soak), and the modem bridge reconnects. Read-only probes only until then. Then: deploy 0.5.0, check `sig2=1`; LTE RSRP/SINR in the live file change across samples (vs 0 changes cached); trigger nothing else; confirm re-apply after the next natural SSR (`handling crash #N` then `sig2=1` again and live values); broker CPU within the 0.4.0 budget (+0.80 %).
- **SSR watch item:** record SSRs/hour for 24 h after deploy vs this boot's history; if higher, back the config out (rollback = reinstall 0.4.0; cache clears at next SSR).

## Rollback

Each step is its own commit. Reinstall 0.4.0: no `sig2`, the live file lacks the new fields, the UI's nullable fields render as before.

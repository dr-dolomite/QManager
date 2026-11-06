# Persistent-write sweep (B5.29 Phase A, report only)

A read-only sweep of `scripts/` on 2026-10-19 for writes to persistent storage
(`/etc/qmanager`, `/etc/config`, `/usrdata`, crontab, firewall rule files).
Nothing was changed. It supports Section 13 of
[`poller-on-broker.md`](poller-on-broker.md): after a hang and a power cut, a
write that was never synced can come back as a 0-byte file.

> **Status update (2026-11-06).** Some findings below are now fixed. Each row and
> bullet carries its current status. Items not marked fixed were not re-audited.

## Headline

- ~~**No script calls `sync`.**~~ **Fixed since the sweep.** `sync` is now used in
  the installer (`flush_storage`, `install.sh`), `qm_durable_write` (`safe_tmp.sh`),
  `profile_mgr.sh`, `config_backup_sections.sh`, `qlog.sh`, `data_used.sh`,
  `qmanager_language_install`, `qmanager_update`, `qmanager_config_restore` and the
  reboot path in `cgi_base.sh`.
- `qm_atomic_write` (`safe_tmp.sh`) writes a temp file in the target directory
  and renames it, but **still does not sync** (`_qm_replace ... 0`). The synced
  variant is `qm_durable_write` (`... 1`), which syncs before and after the rename.
  Callers still on `qm_atomic_write` keep the 0-byte risk. Switching them to
  `qm_durable_write` fixes them.
- About 55 lines containing `uci commit` in `scripts/www` and `scripts/usr` (count of
  2026-11-06). libuci's durability is not verifiable from this repo; a `sync` after
  the commit is the cheap guard.
- **Periodic persistent writers exist.** The poller, watchcat, ping and SMS
  forwarding loops write tmpfs only. `data_used.sh` persists its counter to
  `/usrdata/qmanager/data_used.json` every 10 samples (about 5 min at the 30 s
  sample cadence) when counts moved, using `sync && mv`. The sites monitor appends
  to `/usrdata/qmanager/sites/*.jsonl` hourly. Flash wear is still low.

## Most important writes

| # | File | Writer | Risk |
|---|---|---|---|
| 1 | `/etc/qmanager/crash.log` | `qmanager_watchcat` Tier 4 appends, trims with `mv`, then reboots about 1 s later; `qlog.sh` `record_planned_reboot` | the row is lost in exactly the window before a reboot, so the per-hour reboot cap can undercount |
| 2 | `/etc/qmanager/known_iccids` | `sim_db.sh` append, truncate-then-write clear | 0 bytes makes every SIM look new |
| 3 | `/etc/config/quecmanager` | every settings CGI via `uci commit` | loss reverts watchdog, ping profile, DPI, SIM and band settings |
| 4 | `/etc/qmanager/active_profile`, `profiles/*.json` | `profile_mgr.sh` direct truncate, tmp + mv | a 0-byte active profile reads as "none" at boot. **Fixed:** `profile_mgr.sh` now syncs before the `mv`. |
| 5 | `/etc/qmanager/auth.json` | `cgi_auth.sh` direct write | an empty file breaks login; check whether it reopens first-time setup. **Fixed:** now written with `qm_durable_write ... 0600`. |
| 6 | `/usrdata/qmanager/sms_sent.json` | `sms_sent.sh` via `qm_atomic_write` | the outbound history is lost |
| 7 | `/etc/qmanager/tower_lock.json` | `tower_lock_mgr.sh` tmp + mv | tower lock and failover config are lost |
| 8 | `/etc/qmanager/msmtprc` and the alert JSON files | `monitoring/alerts.sh` (heredoc for msmtprc) | email alerts stop silently |
| 9 | `/usrdata/qmanager/apn_profiles.json` | `apn_mgr.sh` tmp + mv, also on a GET-time migration | APN profiles are lost |
| 10 | `/etc/firewall.user.ttl`, `/etc/firewall.user.mtu` | `ttl.sh`, `mtu.sh`, restore path | TTL / MTU rules vanish at the next firewall reload |

Direct truncating writers worth converting to the helper (`cgi_auth.sh` and
`profile_mgr.sh` `active_profile` are fixed, see the table):
`alert_engine.sh` (`last_boot_id`), `sim_db.sh`, `config_backup_sections.sh` (profiles,
active profile, IMEI backup, band failover flag, SMS storage),
`scenario_mgr.sh` (`active_scenario`), `monitoring/alerts.sh` (msmtprc),
`bands/failover_toggle.sh`, `cellular/sms_storage.sh` fallback,
`init.d/qmanager` (`long_commands.list` seed), `install.sh` default seeds.

## Suggested fix (a separate change, not part of B5.29)

1. `qm_atomic_write`: `sync` after writing the temp file and before `mv`.
2. Convert the direct writers above to `qm_atomic_write`.
3. `sync` after `uci commit` in the CGIs, and in the crash.log writers before
   any reboot.

Not traced in full: `qmanager_sms_storage`'s preference write, the tower-lock
default seed caller, `qmanager_config_restore` internals, `alert_routing.sh`.

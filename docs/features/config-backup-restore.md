# Configuration Backup and Restore

CGI: `system/config-backup/{collect,apply,apply_status,apply_cancel}.sh` · Hooks: `use-config-backup.ts`, `use-config-restore.ts` · Types: `config-backup.ts` · Reboot: Deferred (dialog + banner for IMEI/profile)

- Route: `/system-settings/config-backup`. 9 sections: Network Mode + APN, LTE/5G bands, Tower Lock, TTL/HL, IMEI, Custom SIM Profiles, SMS Alerts, Alert Routing, Watchdog.
- **Bands section** (`collect_bands`/`apply_bands`): captures/restores `lte_bands`, `nsa_bands`, `sa_bands` plus the failover flag. **NR-DC (`nrdc_nr5g_band`) is intentionally excluded** — the modem manages it and coerces manual writes, so it is neither backed up nor restored (see `docs/features/band-locking.md`).
- **Overlap rule**: Custom SIM Profiles is mutex with APN/TTL/HL/IMEI — profile activation owns those.
- **Encryption**: mandatory passphrase, AES-256-GCM via WebCrypto. PBKDF2-SHA256 200k iters, 16-byte salt, 12-byte IV. Header bound as AES-GCM AAD via `canonicalHeaderAad()`. Passphrase never leaves browser.
- **File**: `.qmbackup` JSON envelope — plaintext header + base64 ciphertext (+ appended GCM tag). Filename: `qmanager-<model>-<YYYYMMDD-HHMMSS>.qmbackup` (UTC).
- **Section library**: `/usr/lib/qmanager/config_backup_sections.sh` — one `collect_<key>`/`apply_<key>` pair per section + `cfg_backup_{collect,apply}` dispatcher. Sourced by `collect.sh` CGI + worker. **Caller owns `qlog_init`**.
- **Apply order (fixed)**: `sms_alerts → alert_routing → watchdog → network_mode_apn → bands → tower_lock → ttl_hl → imei → profiles`. Safe first, reboot-queuing last. `alert_routing` sits next to `sms_alerts` (both trivial JSON writes) and re-clamps `connection_lost.email=false` on apply — see [`docs/features/alerts.md`](alerts.md).
- **Async worker**: `/usr/bin/qmanager_config_restore` (double-fork via `apply.sh`). PID `/var/run/qmanager_config_restore.pid`; progress `/tmp/qmanager_config_restore.json`; input `/tmp/qmanager_config_restore_input.json`; cancel `/tmp/qmanager_config_restore.cancel`.
- **Retry**: 3 retries, backoff 1s/2s/4s, only on rc=1. rc=2 (unsupported) / rc=3 (SIM mismatch) bypass retries. Cancel checked between sections.
- **States**: `pending`, `running`, `retrying:N`, `success`, `failed`, `skipped:incompatible`, `skipped:not_in_backup`, `skipped:sim_mismatch`. Frontend `RestoreProgressList` uses `min-w-[7.5rem] justify-center` on all badges for width stability.
- **Deferred reboot (CRITICAL — QManager runs ON the modem)**: `apply_imei` writes IMEI via `AT+EGMR=1,7,"<imei>"` but does NOT `AT+CFUN=1,1`. `apply_profiles` writes `active_profile` marker but does NOT spawn `qmanager_profile_apply`. Both `touch /tmp/qmanager_config_restore.reboot_required`. Worker surfaces `reboot_required: true`. Frontend shows reboot AlertDialog + persistent banner (localStorage `qmanager_pending_reboot`). **One reboot total** — on next reboot, poller's boot-time `auto_apply_profile` picks up the marker, finds IMEI already correct.
- Reboot dialog handlers in `restore-backup-card.tsx` / `config-backup.tsx` check `res.ok` and rethrow on non-2xx (`authFetch` only throws on network errors).
- Guards: `apply.sh` returns 409 on active PID. `apply.sh`/`apply_cancel.sh` reject non-POST. 256 KiB cap via `CONTENT_LENGTH`.
- Cross-device: backup records `device.{model,firmware,imei}`. Browser compares `device.model` → `model_warning` state on mismatch. Appliers still silently downgrade unsupported items to `skipped:incompatible`.
- Profile auto-activation: ICCID match (`profile_iccid` vs `/tmp/qmanager_status.json::current_iccid`); mismatch → rc=3 → `skipped:sim_mismatch`, marker NOT written.
- Events (`dataConnection` tab): `config_backup_collected`, `config_restore_{started,section_success,section_failed,section_skipped,completed}`.
- Tests: `lib/config-backup/{crypto,format,sections}.test.ts` via `bun test`. Project's first Bun test setup — `tsconfig.json` excludes `**/*.test.ts` so `bun tsc --noEmit` doesn't choke on `bun:test` imports.
- TS 5.9 quirk: `crypto.ts` public API accepts bare `Uint8Array`; private `toFixedBuffer()` coerces to `Uint8Array<ArrayBuffer>` for `crypto.subtle.*`.

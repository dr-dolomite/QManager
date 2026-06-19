# Tower Lock Failover (v0.1.18+)

- Route: `/cellular/tower-locking`.
- **Contract**: LTE/NR-SA cell lock does NOT auto-enable Signal Failover — user must explicitly flip switch in `tower-settings.tsx`. Unlocking still auto-stops + auto-disables failover.
- Default: `TOWER_DEFAULT_CONFIG.failover.enabled = false`. Existing configs preserved by `tower_config_init` on upgrade.
- Install gating: `qmanager_tower_failover` in `UCI_GATED_SERVICES` (install.sh) — fresh install cannot auto-run; upgrade preserves prior symlink.
- **Unlock hardening**: init.d `stop` = SIGTERM → poll `is_daemon_pid_running` up to 2s via `sleep_fractional` (`usleep 100000` fallback to `sleep 1`) → `kill -9`. Always clears `$PID_FILE` + `$ACTIVATED_FLAG`, `return 0`.
- **Self-heal**: `failover_status.sh` (polled 3s) checks `.lte.enabled`/`.nr_sa.enabled`. Orphan watcher with no active lock → inline `stop` (NOT `disable` — preserve user's `failover.enabled` intent).
- **Spawn gating**: `tower_spawn_failover_watcher()` is the single choke point — early-returns `"false"` when `.failover.enabled != "true"`. All callers (`lock.sh`, `settings.sh`, `qmanager_tower_schedule`) go through it.
- **RSRP source in deep-idle**: `qmanager_tower_failover` reads `.lte.rsrp` / `.nr.rsrp` from `status.json`. These scalars come from `AT+QENG="servingcell"` (via `parse_serving_cell`), which the poller continues to run in the Adaptive Polling deep tier — it is the only AT command kept in that tier. RSRP may be up to one `deep_idle_interval` (default 60 s) stale when the UI is idle; this is the accepted staleness window. See [`docs/features/adaptive-polling.md`](../adaptive-polling.md) Invariant 7.
- Frontend: `use-tower-locking.ts::sendLockRequest` does NOT force `config.failover.enabled = true` from `data.failover_armed`. Config flows only from `fetchStatus()` / `updateSettings()`.
- UX hint: `tower-settings.tsx` shows "Failover is off — enable it to auto-unlock on poor signal." when `hasActiveLock && !failover.enabled`.
- `settings.sh` disable-on-off + unlock-when-no-locks paths still run init.d `disable` (user intent). Band failover (`bands/lock.sh`) is out of scope — separate feature.

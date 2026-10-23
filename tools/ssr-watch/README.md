# SSR watcher (dev-only)

A reboot-proof counter of baseband crash-restarts (SSRs, `handling crash #N` in `dmesg`) for the test modem. Built for the broker 0.5.0 SSR-rate watch ([`docs/features/live-signal.md`](../../docs/features/live-signal.md#config-signal-hold-050-device-gate-2026-10-23)). `build.sh` never packages `tools/`, so this is never part of a QManager install.

- `ssrwatch.sh`: the daemon. Checks every 60 s, writes one line per SSR to `/usrdata/ssr_watch/ssr.log` plus a re-apply check 90 s later and an hourly heartbeat. State is on flash, so a reboot resumes the count. Line format is in the script header.
- `ssr_watch.init`: procd service (`/etc/init.d/ssr_watch`, respawn, boot-enabled).
- `ssrwatch_summary.sh`: SSRs per hour by broker version, from the heartbeats.
- `ssrwatch_install.sh <stage_dir>`: installs all of it and copies the 0.4.1 rollback broker from `/tmp/qm_atd_041` to `/usrdata/ssr_watch/qmanager_atd.041` (md5-checked).

Install: copy the four files flat to `/tmp/ssrw` on the device, then `sh /tmp/ssrw/ssrwatch_install.sh /tmp/ssrw`. Read: `sh /usrdata/ssr_watch/bin/ssrwatch_summary.sh`.

Remove: `/etc/init.d/ssr_watch stop; /etc/init.d/ssr_watch disable; rm -f /etc/init.d/ssr_watch; rm -rf /usrdata/ssr_watch`.

Testing off-device: `SSRW_DMESG` points the daemon at a fake ring (BusyBox `sh` runs its own `dmesg` applet before `PATH`); `SSRW_DIR`, `SSRW_EVERY`, `SSRW_HB` and `SSRW_REAPPLY` shrink the paths and timings.

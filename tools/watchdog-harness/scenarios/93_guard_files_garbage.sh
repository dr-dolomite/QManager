# R3: garbage in the persistent files reads as absent. The guard file
# ("12ab") is removed at start (warn line) and Tier 4 does not rest; the
# link-up file ("junk") counts as no stamp, so the first reachable read after
# the watchdog reboot 100 s ago overwrites it with the epoch.
SC_PASSES=4
sc_setup() {
    crash_log_add 100 tier4_escalation
    printf '12ab\n' > "$H_ROOT/etc/qmanager/wd_reboot_guard"
    printf 'junk\n' > "$H_ROOT/etc/qmanager/wd_link_up"
}
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}

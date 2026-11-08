# The link-up stamp cannot be written (read-only state dir). One watchdog
# reboot 100 s ago: the first reachable read tries the write once and warns
# once; the stamp is kept in memory (mem), so the per-minute recounts and the
# later reachable reads (also after a short outage) neither retry nor re-log.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
    crash_log_add 100 tier4_escalation
}
sc_post_source() { chmod 555 "$H_ROOT/etc/qmanager"; }
sc_pass_5() { mset reachable false; }
sc_pass_7() { mset reachable true; }
sc_pass_16() { chmod 755 "$H_ROOT/etc/qmanager"; }
sc_snap_extra() {
    echo "link_up=$_wd_link_up mem=$_wd_link_up_mem file=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}

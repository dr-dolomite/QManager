# R5: a Tier 1 cooldown goes inconclusive (stale cache) and keeps Tier 1; the
# cache returns with the link up, which is a natural recovery: tier and
# tiers_tried are cleared, so the next outage starts at Tier 1 again.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { mset ping_stale 0; mset reachable true; }
sc_pass_15() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0)
            if [ "$(mget cops_n 0)" = "0" ]; then mset ping_stale 1; else mset reachable true; fi
            mset cops_n 1
            printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier tried=[$tiers_tried] until=$step_wait_until"
}

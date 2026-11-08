# R5: as 110, a Tier 1 cooldown goes inconclusive (stale cache) and keeps
# Tier 1. The cache returns at pass 12 with a fresh ping run (reachable=true,
# streak_success=0, streak_fail=0, no probe has answered yet): the kept tier
# holds. At pass 14 a probe answers (streak_success 3): natural recovery clears
# the tier and tiers_tried.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { mset ping_stale 0; mset reachable true; mset streak_success 0; mset streak_fail 0; }
sc_pass_14() { mset streak_success 3; mset streak_fail ""; }
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

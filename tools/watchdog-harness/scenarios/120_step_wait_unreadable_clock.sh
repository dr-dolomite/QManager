# R5 follow-up: /proc/uptime turns unreadable (mono_now prints 0) right after
# the Tier 1 action. The Tier 1 cooldown (deadline set on a good clock) still
# ends by pass count (30 s = 3 passes); Tier 2 starts its cooldown on the bad
# clock (step_wait_until 0) and also ends by pass count, with the link back.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset uptime_bad 1; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier until=$step_wait_until left=$cooldown_remaining mono=$(mono_now)"
}

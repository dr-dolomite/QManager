# R2: a quality pause never blocks an outage ladder. A quality ladder (Tier 1
# only) is exhausted at pass 13 (15 minute quality pause from pass 14). The link
# drops at pass 16: state suspect (the outage is not paused), and once the outage
# age reaches act_after the outage Tier 1 runs; its COPS=0 brings the link back
# and the outage cooldown succeeds. The quality pause is still running afterwards
# (state holdoff, holdoff_reason quality).
SC_PASSES=26
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_16() { mset reachable false; mset arm_cops 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0)
            [ "$(mget arm_cops 0)" = "1" ] && mset reachable true
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}

# R9d: the retired fail_threshold / cooldown / quality_consecutive / ssr_grace
# keys are not read. With absurd values stored, the outage still acts after the
# 15 s act_after_sec and the Tier 1 cooldown is the 30 s step_wait_sec.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.fail_threshold 99
    uci_set quecmanager.watchcat.cooldown 999
    uci_set quecmanager.watchcat.quality_consecutive 99
    uci_set quecmanager.watchcat.ssr_grace 999
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}

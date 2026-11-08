# R9d: check_interval is no longer a config key (internal constant 10 s). A
# stored check_interval of 60 is not read: the passes stay 10 s apart, the
# config log line says interval=10s, and the outage is handled on the usual
# 15 s act_after timeline (Tier 1 restores the link).
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.check_interval 60
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}

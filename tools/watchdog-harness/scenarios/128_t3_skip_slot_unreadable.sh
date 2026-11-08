# R9c: the current SIM slot cannot be read (AT+QUIMSLOT? answers ERROR): Tier 3
# is skipped with a log line naming the reason and no swap is attempted.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        "AT+QUIMSLOT?") printf 'ERROR\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active"; }

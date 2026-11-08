# Round-3 M1: as 48 (primary recheck, the primary is still down and the swap back to
# the backup is swallowed, so the modem stays on the primary), but AT+QCCID answers
# ERROR. The failback is handled the same way (record cleared, tower failover
# restarted, benign settle) without the known-SIM write or the profile apply, and no
# "manual check needed" error is raised.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
sc_qcmd() {
    case "$1" in
        AT+QUIMSLOT=2) printf 'OK\r\n'; return 0 ;;
        AT+QCCID) printf 'ERROR\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active original_sim_slot=$original_sim_slot"; }

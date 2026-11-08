# Primary recheck swaps to the primary, which is still down; the swap back to
# the backup slot is swallowed. The daemon reads the real slot (still the
# primary), records it in the failover file and raises an error event.
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
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1)"; }

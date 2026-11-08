# Primary recheck comes due but AT+QUIMSLOT= is swallowed: the swap to the
# primary cannot be verified, so the daemon stays on the backup, restarts the
# recheck clock, enters no settle and the failover record is untouched.
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset quimslot_swallow 1
    failover_write true 1 2
}
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "cfun=$(mget cfun 1) slot=$(mget slot 1)"; }

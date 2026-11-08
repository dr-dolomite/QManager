# R9a: the watchdog's own Tier 3 swap raises the SIM-switch flag; it must not
# lock the daemon out. check_locked is asked in the middle of the swap (flag
# up, WD_SWAP_FLAG_OWNED=1) and answers "not locked"; the swap is confirmed on
# slot 2 with no LOCKED entry.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        AT+QUIMSLOT=*)
            if [ -f "$H_ROOT/tmp/qmanager_sim_switch_active" ]; then
                check_locked
                echo "own swap: flag up, owned=$WD_SWAP_FLAG_OWNED check_locked rc=$?" >> "$H_OUT/calls.log"
            fi
            ;;
    esac
    return 100
}

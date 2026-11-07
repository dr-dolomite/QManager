# Link stays reachable but packet loss breaches the shared ceiling: once the
# window holds 10 samples (pass 6) and the breach has lasted quality_after_sec
# (30 s, pass 9) a quality-triggered Tier 1 runs, loss clears, cooldown(quality)
# waits 60 s (10 samples at 5 s, R5 quality floor) and succeeds without an extension.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}

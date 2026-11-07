# R5: step_wait_sec 10 is below the floor recover_secs + 20 (relaxed, 10 s):
# the Tier 1 cooldown waits 30 s. step_wait_until is a mono deadline and
# cooldown_remaining = deadline - mono on every cooldown pass.
SC_PASSES=10
sc_setup() {
    uci_set quecmanager.watchcat.step_wait_sec 10
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "cfg=$CFG_STEP_WAIT_SEC eff=$(wd_step_wait_secs) t3=$(wd_step_wait_secs "$SIM_SETTLE_SECS") until=$step_wait_until left=$cooldown_remaining mono=$(mono_now) tried=[$tiers_tried]"
}

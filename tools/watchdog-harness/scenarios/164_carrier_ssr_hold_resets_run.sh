# R11b: the carrier trigger comes due while an MPSS crash is inside the SSR
# window (the line is 5 s old at pass 32, the grace is 10 s). Two carriers at
# pass 1 arm the trigger; one carrier from pass 2 starts the run, and 300 s
# later (pass 32) the start gate says go, so the run is spent (since=0), the
# ladder picks Tier 1 and the SSR-aware hold takes it: state ssr_hold for that
# one pass, no AT command, no event for a tier. At pass 33 the link is reachable
# with no failures, so the hold ends as a natural recovery (monitor, tier 0,
# tiers_tried empty); the carrier count is back to two there (the modem
# re-aggregated after the restart), which resets the run to 0. No tier is ever
# executed: no state-changing AT (the one AT+CFUN? at T+340 is the start gate's
# read-only radio check), no AT+COPS, no AT+QUIMSLOT, no reboot.
SC_PASSES=36
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    uci_set quecmanager.watchcat.ssr_grace_sec 10
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_32() { dmesg_crash 5; }
sc_pass_33() { mset cc 2; }
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} since=$carrier_single_since tier=$current_tier reason=$recovery_reason ssr_hold=$ssr_hold held_id=$_wd_ssr_held_id"
}

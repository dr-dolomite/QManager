# R11b: carrier_enabled=0 reads nothing. plat_cc_count is replaced by a stub that
# logs each call; two carriers then one for 400 s: no call, no tier,
# carrier_cc null. carrier_enabled=1 + a reload at pass 42: reads start, but one
# carrier does not count until two are seen (pass 45 arms it).
SC_PASSES=48
sc_setup() {
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc 2
}
sc_post_source() {
    plat_cc_count() {
        echo "plat_cc_count" >> "$H_OUT/calls.log"
        PLAT_CC=$(mget cc "")
        PLAT_CC_RAT=lte
    }
}
sc_pass_2() { mset cc 1; }
sc_pass_42() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    h_touch qmanager_watchcat_reload
}
sc_pass_45() { mset cc 2; }
sc_snap_extra() {
    echo "enabled=$CFG_CARRIER_ENABLED cc=${carrier_cc:-unknown} armed=$carrier_armed since=$carrier_single_since tier=$current_tier"
}

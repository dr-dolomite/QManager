# R11b: an LTE tower lock pins the cell on purpose, so one carrier under it never
# counts (armed at pass 1, one carrier from pass 2, lock until pass 40: the run
# stays at 0 for 400 s). The lock ends at pass 41: the run starts there and Tier
# 1 starts 300 s later (pass 71).
SC_PASSES=74
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    printf '{"lte":{"enabled":true},"nr_sa":{"enabled":false}}\n' > "$H_ROOT/etc/qmanager/tower_lock.json"
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_41() { rm -f "$H_ROOT/etc/qmanager/tower_lock.json"; }
sc_snap_extra() {
    echo "cc=$carrier_cc armed=$carrier_armed since=$carrier_single_since tier=$current_tier"
}

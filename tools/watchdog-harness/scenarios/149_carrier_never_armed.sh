# R11b: a modem that never aggregates is never "stuck". carrier_enabled=1 and a
# fresh single-carrier read from the first pass: the trigger is never armed, so
# 400 s of one carrier (carrier_after_min=5) start nothing: no AT, no event,
# carrier_single_secs stays 0, carrier_cc reads 1.
SC_PASSES=40
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 1
}
sc_snap_extra() {
    echo "cc=$carrier_cc armed=$carrier_armed since=$carrier_single_since tier=$current_tier"
}

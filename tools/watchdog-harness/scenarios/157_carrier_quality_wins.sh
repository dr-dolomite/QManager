# R11b: quality and carrier due on the same pass: quality wins. The quality
# breach (loss 50 %, quality_after_sec=300) and the single-carrier run both
# start at pass 6 (the first full quality window) and are both due at pass 36:
# the quality ladder starts (reason quality) and the carrier run is reset by the
# recovery that follows.
SC_PASSES=40
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 300
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset q_loss 50
    mset cc_src qmi
    mset cc 2
}
sc_pass_6() { mset cc 1; }
sc_snap_extra() {
    echo "q_since=$quality_breach_since c_since=$carrier_single_since tier=$current_tier reason=$recovery_reason"
}

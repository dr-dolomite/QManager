# The radio comes back (AT+CFUN=1) but the link never returns. The outage age
# counts from the resume (fail_elapsed_sec carried over from airplane mode does
# not count): recovery starts act_after_sec (40 s) after it, not on the first pass.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.act_after_sec 40
}
sc_pass_2() { mset reachable false; mset cfun 4; }
sc_pass_10() { mset cfun 1; }
sc_snap_extra() {
    echo "outage_age=$wd_outage_age resume=$wd_resume_mono offline=$wd_offline_secs"
}

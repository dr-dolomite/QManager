# The radio comes back (AT+CFUN=1) after a long airplane-mode spell, and the data
# link needs about 30 s to re-attach. fail_elapsed_sec kept growing while the
# radio was off, so it is far past act_after_sec on the first pass after the
# resume. The outage age counts from the resume: no COPS / CFUN recovery runs,
# and the daemon returns to monitor once the link is back.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.act_after_sec 40
}
sc_pass_2() { mset reachable false; mset cfun 4; }
sc_pass_10() { mset cfun 1; }
sc_pass_13() { mset reachable true; }
sc_snap_extra() {
    echo "outage_age=$wd_outage_age resume=$wd_resume_mono offline=$wd_offline_secs"
}

# R1: a maintenance lock holds the daemon for about 6 minutes while the link is
# down. On the LOCKED exit fail_elapsed_sec is long past act_after_sec, but the
# outage age restarts at the exit: Tier 1 runs act_after_eff (30 s) after it,
# not on the exit pass.
SC_PASSES=46
sc_setup() {
    uci_set quecmanager.watchcat.act_after_sec 30
}
sc_pass_2() { mset reachable false; h_touch qmanager_watchcat.lock; }
sc_pass_40() { h_rm qmanager_watchcat.lock; }
sc_snap_extra() {
    echo "outage_age=$wd_outage_age resume=$wd_resume_mono offline=$wd_offline_secs eff=$wd_act_after_eff"
}

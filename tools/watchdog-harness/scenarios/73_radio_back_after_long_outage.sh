# R1: the radio is off for 10 minutes (AT+CFUN=4) while the link is down, then
# comes back on with the link still down. fail_elapsed_sec is past 10 minutes,
# but the outage age counts from the resume: no Tier 1 until act_after_eff
# (30 s here) after it (pass 66 = resume + 30 s), not on the first pass.
SC_PASSES=68
sc_setup() {
    uci_set quecmanager.watchcat.act_after_sec 30
}
sc_pass_2() { mset reachable false; mset cfun 4; }
sc_pass_63() { mset cfun 1; }
sc_snap_extra() {
    echo "outage_age=$wd_outage_age resume=$wd_resume_mono offline=$wd_offline_secs eff=$wd_act_after_eff"
}

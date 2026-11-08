# R1: the link is down while the ping daemon's attach warm-up flag exists: the
# outage age stays 0 and nothing runs. The first pass without the flag (pass 12)
# is a resume point; Tier 1 runs once the outage age reaches act_after_eff
# (default seed 15 s = fail_secs 15) after it.
SC_PASSES=16
sc_pass_2() { mset reachable false; mset attaching 1; }
sc_pass_12() { mset attaching 0; }
sc_snap_extra() {
    echo "outage_age=$wd_outage_age resume=$wd_resume_mono offline=$wd_offline_secs eff=$wd_act_after_eff attach_seen=$_wd_attach_seen"
}

# R2 / spec 5.6: the outage pause ends on a real answer, not on a fresh ping
# run. As 77, the Tier 1 ladder is exhausted and the 15 minute outage pause
# starts. At pass 14 the ping daemon reads reachable=true with streak_success=0
# and streak_fail=0 (how every run starts, before any probe answers): the pause
# holds. At pass 16 a probe answers (streak_success 2): the pause ends.
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_14() { mset reachable true; mset streak_success 0; mset streak_fail 0; }
sc_pass_16() { mset streak_success 2; mset streak_fail ""; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}

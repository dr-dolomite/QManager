# R6: the link goes down at pass 2 and the cache stops at pass 3 (its last
# write says down). The cache is stale from pass 4: the dead prober fires at
# pass 35 but no tier runs (no AT+COPS / AT+CFUN), state stays suspect.
SC_PASSES=40
sc_pass_2() { mset reachable false; }
sc_pass_3() { mset ping_stale 1; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

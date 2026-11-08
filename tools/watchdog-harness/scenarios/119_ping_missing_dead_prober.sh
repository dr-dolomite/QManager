# R6: the ping cache file disappears at pass 2 and is never rewritten. A missing
# file counts as stale: ping_stale at pass 33, one event, one service start.
SC_PASSES=35
sc_pass_2() { mset ping_stale 1; h_rm qmanager_ping.json; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

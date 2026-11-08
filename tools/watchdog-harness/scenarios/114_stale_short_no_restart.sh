# R6: the ping cache is stale for about 190 s (passes 3-21), then fresh again.
# Under the 300 s limit: ping_stale stays false, no wd_ping_stale event, no
# start of the ping service; the fresh read at pass 22 ends the episode.
SC_PASSES=26
sc_pass_2() { mset ping_stale 1; }
sc_pass_22() { mset ping_stale 0; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

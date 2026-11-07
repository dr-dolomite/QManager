# R6: the ping cache stays stale for 30 min. The ping service is started at
# pass 34 (310 s) and again at pass 124 (900 s later), never in between; one
# wd_ping_stale event for the whole episode.
SC_PASSES=190
sc_pass_2() { mset ping_stale 1; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

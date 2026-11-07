# R6: first stale episode (passes 3-39) raises ping_stale and starts the ping
# service at pass 34; the fresh read at pass 40 clears it. The second episode
# (from pass 46) logs a second wd_ping_stale event at pass 77, but the start
# waits for the 900 s spacing from the last one (pass 124).
SC_PASSES=126
sc_pass_2() { mset ping_stale 1; }
sc_pass_40() { mset ping_stale 0; }
sc_pass_45() { mset ping_stale 1; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

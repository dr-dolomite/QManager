# R6: the ping cache goes stale at pass 3 and stays stale. At pass 34 (310 s
# into the episode) ping_stale turns true, one wd_ping_stale warning event, one
# "qmanager start" (calls.log: qmanager_init start). No recovery decision.
SC_PASSES=36
sc_pass_2() { mset ping_stale 1; }
sc_snap_extra() {
    echo "stale_since=$wd_stale_since ping_stale=$wd_ping_stale restart_at=$wd_stale_restart_at mono=$(mono_now)"
}

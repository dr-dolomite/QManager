# The real main loop: slot 1 answers twice, then everything goes dark. The ring
# keeps "<rtt> 1" lines then "null -" lines; ping.json ends with last_leg 0 and
# family none; slots.json shows every probed slot as a miss.
sc_setup() {
    h_cfg ping_profile.profile sensitive
    h_ping 1.1.1.1 0.1 ok:12.3
    h_ping 8.8.8.8 0.1 ok:20.0
    h_ping 2606:4700:4700::1111 0.1 ok:30.0
    h_ping cloudflare.com 0.1 ok:40.0 104.16.133.229
}
sc_run() {
    h_main_start
    h_wait_ring 2
    : > "$H_STATE/pingtab"
    h_ping 1.1.1.1 0.1 fail
    h_ping 8.8.8.8 0.1 fail
    h_ping 2606:4700:4700::1111 0.1 fail
    h_ping cloudflare.com 0.1 fail 104.16.133.229
    h_wait_ring 4
    h_main_stop
    h_state_dump
    h_orphans
}

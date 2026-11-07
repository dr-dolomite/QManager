# The real main loop (1 s cadence): slot 1 is down, slot 2 answers. Ring lines are
# "<rtt> 2", ping.json carries last_leg 2, slots.json shows 1 miss, 2 ok, the
# rest standby; ping.env carries _cq_leg.
sc_setup() {
    h_cfg ping_profile.profile sensitive
    h_ping 1.1.1.1 0.1 fail
    h_ping 8.8.8.8 0.1 ok:20.0
    h_ping 2606:4700:4700::1111 2.5 ok:30.0
    h_ping cloudflare.com 2.5 ok:40.0 104.16.133.229
}
sc_run() {
    h_main_start
    h_wait_ring 3
    h_main_stop
    h_state_dump
    h_orphans
}

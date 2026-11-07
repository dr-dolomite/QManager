# No non-lo ::/0 route: the IPv6 literal slot is skipped (never probed, not a
# failure) and the fan-out runs over slots 2 and 4 only.
sc_setup() {
    h_route none
    h_ping 1.1.1.1 0.2 fail
    h_ping 8.8.8.8 0.2 fail
    h_ping 2606:4700:4700::1111 0.2 ok:30.0
    h_ping cloudflare.com 0.4 ok:40.0 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "no v6 route" 200
}

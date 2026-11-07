# Nothing answers: last_leg 0, family none, every probed slot is a miss.
sc_setup() {
    h_ping 1.1.1.1 0.2 fail
    h_ping 8.8.8.8 0.3 fail
    h_ping 2606:4700:4700::1111 0.4 fail
    h_ping cloudflare.com 0.5 fail 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "all fail" 300
}

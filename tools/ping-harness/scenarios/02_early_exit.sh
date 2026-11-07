# Slot 1 fails, slot 2 answers fast while slots 3 and 4 are slow: the cycle ends
# as soon as slot 2 answers and the slow legs (and their sleeps) are killed.
sc_setup() {
    h_ping 1.1.1.1 0.3 fail
    h_ping 8.8.8.8 0.3 ok:20.0
    h_ping 2606:4700:4700::1111 2.5 ok:30.0
    h_ping cloudflare.com 2.5 ok:40.0 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "early exit" 160 50
}

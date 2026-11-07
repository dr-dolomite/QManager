# Slot 2 finishes with a miss after slot 3 already answered: slot 3 wins as soon
# as slot 2 has finished, not before; slot 4 (slow) is cut short.
sc_setup() {
    h_ping 1.1.1.1 0.3 fail
    h_ping 8.8.8.8 1.0 fail
    h_ping 2606:4700:4700::1111 0.3 ok:30.0
    h_ping cloudflare.com 2.5 ok:40.0 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "lower fails" 220 120
}

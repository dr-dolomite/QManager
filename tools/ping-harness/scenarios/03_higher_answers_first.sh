# Slot 3 answers before slot 2 has finished, then slot 2 answers: slot 2 wins
# (lowest answering slot, decided once slot 2 has finished); slot 3 keeps its own
# answer in the slot states; slot 4 (slow) is cut short.
sc_setup() {
    h_ping 1.1.1.1 0.3 fail
    h_ping 8.8.8.8 1.0 ok:20.0
    h_ping 2606:4700:4700::1111 0.3 ok:30.0
    h_ping cloudflare.com 2.5 ok:40.0 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "higher first" 220 120
}

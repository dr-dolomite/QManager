# No timeout applet (plat_timeout runs the command unbounded) and slot 2, a
# hostname, hangs. Slots 3 and 4 answer, but slot 2 is lower and never finishes,
# so no winner is decided before the hard stop (HOST_DEADLINE + 1 = 5 s). At that
# stop the lowest slot that answered (3) wins; the hung slot reads miss.
sc_setup() {
    h_route default
    h_cfg_list ping_profile.targets 1.1.1.1 hang.example.org 2606:4700:4700::1111 8.8.4.4
    h_ping 1.1.1.1 0.1 fail
    h_ping hang.example.org 12 ok:50.0 192.0.2.7
    h_ping 2606:4700:4700::1111 0.3 ok:30.0
    h_ping 8.8.4.4 0.3 ok:40.0
}
sc_run() {
    _PF_TMO_MODE=none
    load_config
    detect_ping6
    h_cycle "hard stop, lower slot pending" 700 450
}

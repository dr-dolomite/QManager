# Slot 1 is an IPv6 literal and there is no IPv6 route: it is skipped, slot 2 is
# promoted to "alone" (one probe, no fan-out), and its answer is the leg.
sc_setup() {
    h_route none
    h_cfg_list ping_profile.targets 2606:4700:4700::1111 8.8.8.8 1.1.1.1 cloudflare.com
    h_ping 8.8.8.8 0.1 ok:21.5
    h_ping 1.1.1.1 0.1 ok:12.3
}
sc_run() {
    load_config
    detect_ping6
    echo "slots: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
    h_cycle "promoted" 100
}

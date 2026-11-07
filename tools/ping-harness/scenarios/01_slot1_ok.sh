# Slot 1 answers: a healthy cycle sends exactly one probe; the others stand by,
# slot 3 (IPv6 literal) only reads standby because the box has a ::/0 route.
sc_setup() {
    h_ping 1.1.1.1 0.1 ok:12.3
    h_ping 8.8.8.8 0.1 ok:20.0
}
sc_run() {
    load_config
    detect_ping6
    echo "slots: $PING_T1 $PING_T2 $PING_T3 $PING_T4 ping6=${PING6_CMD:-none}"
    h_cycle "healthy" 100
}

# No working ping -6 / ping6 on this build: the IPv6 literal slot is skipped even
# with a ::/0 route.
sc_setup() {
    h_no6
    h_ping 1.1.1.1 0.2 fail
    h_ping 8.8.8.8 0.3 ok:20.0
    h_ping 2606:4700:4700::1111 0.2 ok:30.0
}
sc_run() {
    load_config
    detect_ping6
    echo "ping6=${PING6_CMD:-none}"
    h_cycle "no ping6" 200
}

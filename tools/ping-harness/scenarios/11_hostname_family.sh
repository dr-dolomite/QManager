# A hostname slot takes its family from the ping banner: an IPv6 address in the
# banner reads ipv6, an IPv4 one ipv4.
sc_setup() {
    h_cfg_list ping_profile.targets dual.example.org 8.8.8.8 2606:4700:4700::1111 cloudflare.com
    h_ping dual.example.org 0.1 ok:15.2 2606:4700::6810:84e5
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "banner ipv6" 100
    h_ping dual.example.org 0.1 ok:16.8 104.16.132.229
    h_cycle "banner ipv4" 100
}

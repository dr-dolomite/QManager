# Slot 1 is a hostname whose probe hangs past the hostname deadline: plat_timeout
# 4 ends it (no orphan), the cycle counts it as a miss and the fan-out answers.
sc_setup() {
    h_cfg_list ping_profile.targets slow.example.org 8.8.8.8 2606:4700:4700::1111 cloudflare.com
    h_ping slow.example.org 9 ok:50.0 192.0.2.7
    h_ping 8.8.8.8 0.3 ok:20.0
    h_ping 2606:4700:4700::1111 2.5 ok:30.0
    h_ping cloudflare.com 2.5 ok:40.0 104.16.133.229
}
sc_run() {
    load_config
    detect_ping6
    h_cycle "hostname timeout" 520 400
}

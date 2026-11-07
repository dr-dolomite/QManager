# The real main loop with nothing answering from the start: the attach warm-up
# keeps the failed cycles out of the ring (and leaves the marker flag up until the
# daemon is stopped, when its cleanup removes it). slots.json still reports the
# probed slots as misses.
sc_setup() {
    h_cfg ping_profile.profile sensitive
    h_ping 1.1.1.1 0.1 fail
    h_ping 8.8.8.8 0.1 fail
    h_ping 2606:4700:4700::1111 0.1 fail
    h_ping cloudflare.com 0.1 fail 104.16.133.229
}
sc_run() {
    h_main_start
    sleep 3.2
    if [ -f "$H_ROOT/tmp/qmanager_ping_attaching" ]; then echo "attach flag: up"; else echo "attach flag: absent"; fi
    echo "ring lines: $(h_ring_lines)"
    h_dump "$H_ROOT/tmp/qmanager_ping_slots.json" "slots.json"
    h_main_stop
    if [ -f "$H_ROOT/tmp/qmanager_ping_attaching" ]; then echo "attach flag after stop: up"; else echo "attach flag after stop: absent"; fi
    h_orphans
}

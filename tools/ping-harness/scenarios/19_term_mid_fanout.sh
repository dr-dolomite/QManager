# SIGTERM while the fan-out legs are in flight: the trap kills the whole leg
# tree (no orphan ping or sleep), removes the fan dir and the pid file, and the
# daemon exits.
sc_setup() {
    h_cfg ping_profile.sensitivity sensitive
    h_ping 1.1.1.1 0.1 fail
    h_ping 8.8.8.8 4 ok:20.0
    h_ping 2606:4700:4700::1111 4 ok:30.0
    h_ping cloudflare.com 4 ok:40.0 104.16.133.229
}
sc_run() {
    h_marks_reset
    h_main_start
    _t=0
    while [ ! -f "$H_STATE/ran/8.8.8.8.start" ] && [ "$_t" -lt 200 ]; do
        sleep 0.05
        _t=$((_t + 1))
    done
    if [ -d "$FAN_DIR" ]; then echo "fan dir present while legs run: yes"; else echo "fan dir present while legs run: NO"; fi
    if [ -f "$PID_FILE" ]; then echo "pid file present while running: yes"; else echo "pid file present while running: NO"; fi
    h_main_stop
    if [ -d "$FAN_DIR" ]; then echo "fan dir after TERM: present"; else echo "fan dir after TERM: gone"; fi
    if [ -f "$PID_FILE" ]; then echo "pid file after TERM: present"; else echo "pid file after TERM: gone"; fi
    if kill -0 "$H_MAINPID" 2>/dev/null; then echo "daemon after TERM: alive"; else echo "daemon after TERM: gone"; fi
    h_marks_report
    h_orphans
}

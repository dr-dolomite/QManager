# The ring is trimmed only when the count passes size + 10, and then back to
# size. The table's ring size is forced to 3 so the real main loop reaches the
# trim in about 14 cycles; the table itself is covered by 16_sensitivity_table.
sc_setup() {
    h_cfg ping_profile.sensitivity sensitive
    h_ping 1.1.1.1 0.05 ok:12.3
}
sc_run() {
    HISTORY_SIZE_FORCE=3
    resolve_sensitivity() {
        conn_state_resolve "$PING_SENS"
        PING_SENS="$CQ_CFG_SENSITIVITY"
        PING_INTERVAL="$CQ_CFG_INTERVAL_SEC"
        PING_FAIL_SECS="$CQ_CFG_FAIL_SECS"
        PING_RECOVER_SECS="$CQ_CFG_RECOVER_SECS"
        HISTORY_SIZE="$HISTORY_SIZE_FORCE"
    }
    h_main_start
    _max=0
    _trimmed=no
    _t=0
    while [ "$_t" -lt 600 ]; do
        sleep 0.05
        _t=$((_t + 1))
        _n=$(h_ring_lines)
        [ "$_n" -gt "$_max" ] && _max="$_n"
        if [ "$_max" -ge 13 ] && [ "$_n" -lt "$_max" ]; then _trimmed=yes; break; fi
    done
    h_main_stop
    if [ "$_max" -le 13 ]; then _ok=yes; else _ok=NO; fi
    echo "ring never exceeded size + 10 (13): $_ok"
    echo "trimmed back after passing it: $_trimmed"
    if [ "$(h_ring_lines)" -le 4 ]; then _ok=yes; else _ok=NO; fi
    echo "lines after the trim (3 + at most one new cycle): $_ok"
    h_orphans
}

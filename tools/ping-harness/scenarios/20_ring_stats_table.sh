# cq_ring_stats over rings of 0/9/10/60/61/300/600 lines (lines with i % 7 == 0
# are "null -", the rest "<10 + i % 50>.0 1"), at the table's own ring sizes,
# plus a ring whose newest bucket is entirely lost.
sc_setup() { :; }
_sc_ring() { # lines
    : > "$H_ROOT/ring"
    _i=1
    while [ "$_i" -le "$1" ]; do
        if [ $((_i % 7)) -eq 0 ]; then echo "null -"; else echo "$((10 + _i % 50)).0 1"; fi
        _i=$((_i + 1))
    done >> "$H_ROOT/ring"
}
_sc_show() { # label interval ring_size
    cq_ring_stats "$H_ROOT/ring" "$2" "$3" 10
    _h=$(printf '%s' "$CQ_RS_HISTORY" | cut -d, -f1-3)
    _t=$(printf '%s' "$CQ_RS_HISTORY" | awk -F, 'NF >= 3 { print $(NF-2) "," $(NF-1) "," $NF }')
    echo "$1: min=$CQ_RS_MIN avg=$CQ_RS_AVG max=$CQ_RS_MAX jit=$CQ_RS_JITTER loss=$CQ_RS_LOSS points=$CQ_RS_HIST_SIZE every=${CQ_RS_HIST_INTERVAL_SEC}s head=$_h tail=$_t"
}
sc_run() {
    for _n in 0 9 10 60 61; do
        _sc_ring "$_n"
        _sc_show "relaxed ring 60, $_n lines" 5 60
    done
    _sc_ring 300
    _sc_show "sensitive ring 300, 300 lines" 1 300
    _sc_ring 600
    _sc_show "sensitive ring 300, 600 lines" 1 300
    _sc_show "quiet window ring 600, 600 lines" 1 600
    _sc_ring 150
    _sc_show "regular ring 150, 150 lines" 2 150
    # newest 9 samples lost: the last bucket (3 wide) is all null
    _sc_ring 141
    _i=1
    while [ "$_i" -le 9 ]; do echo "null -" >> "$H_ROOT/ring"; _i=$((_i + 1)); done
    _sc_show "regular ring 150, newest bucket lost" 2 150
    : > "$H_ROOT/ring"
    _i=1
    while [ "$_i" -le 12 ]; do echo "null -" >> "$H_ROOT/ring"; _i=$((_i + 1)); done
    _sc_show "relaxed, every sample lost" 5 60
}

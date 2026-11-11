#!/bin/sh
# history_read.sh — read side of the history store (docs/features/history.md §6).
#
# Sourced by the history/ CGIs. Read-only: the poller (history.sh) is the only
# writer. Rows are filtered with an anchored grep (torn lines never reach awk)
# and merged by bucket start t (rows are partial aggregates).

[ -n "$_QM_HISTORY_READ_LOADED" ] && return 0
_QM_HISTORY_READ_LOADED=1

: "${HIST_LIB_DIR:=/usr/lib/qmanager}"
: "${HIST_STORE:=/usrdata/qmanager/history}"
: "${HIST_RUN:=/var/run/qmanager/history}"
: "${HIST_BOOT_ID_FILE:=/proc/sys/kernel/random/boot_id}"
: "${HIST_BUCKET:=1800}"
: "${HIST_ALIVE_SEC:=90}"
: "${HIST_UPTIME_FILE:=/proc/uptime}"
# The event journal (qmanager_logd): client, capability file, EVQ page size.
: "${HIST_QLOG:=/usr/bin/qlog}"
: "${HIST_LOGD_PROTO:=${QLOGD_PROTO:-/var/run/qmanager_logd.proto}}"
: "${HIST_EVQ_PAGE:=2000}"

# hr_param NAME -> _HP = the query value (only %2C is decoded; values are
# validated by the caller against fixed sets).
hr_param() {
    _HP=""
    case "&${QUERY_STRING:-}" in
        *"&$1="*) _HP="&${QUERY_STRING}"; _HP="${_HP#*&"$1="}"; _HP="${_HP%%&*}" ;;
    esac
    while :; do
        case "$_HP" in
            *%2C*|*%2c*) _HP="${_HP%%%2[Cc]*},${_HP#*%2[Cc]}" ;;
            *) break ;;
        esac
    done
}

# hr_series ID -> 0 and the provider's HIST_<id>_* loaded, or 1.
hr_series() {
    case "$1" in
        ''|[!a-z]*|*[!a-z0-9_]*) return 1 ;;
    esac
    [ "${#1}" -le 24 ] || return 1
    [ -f "$HIST_LIB_DIR/history_series_$1.sh" ] || return 1
    HIST_SERIES=""
    . "$HIST_LIB_DIR/history_series_$1.sh"
    _hist_in "$1" "$HIST_SERIES"
}

_hist_in() {
    case " $2 " in *" $1 "*) return 0 ;; esac
    return 1
}

# hr_range RANGE -> HR_B (bucket seconds), HR_N (bucket count), HR_FINE (1 =
# read the RAM sample ring <id>.fine, not the 30-minute rows), or 1.
hr_range() {
    HR_FINE=0
    case "$1" in
        5m) HR_B=10; HR_N=30; HR_FINE=1 ;;
        1h) HR_B=60; HR_N=60; HR_FINE=1 ;;
        24h) HR_B=1800; HR_N=48 ;;
        7d) HR_B=10800; HR_N=56 ;;
        15d) HR_B=21600; HR_N=60 ;;
        30d) HR_B=43200; HR_N=60 ;;
        *) return 1 ;;
    esac
}

# hr_fine_rows ID: every sample row of the RAM ring (k "f"), on stdout. The
# anchored grep drops a line torn by a concurrent append or trim.
hr_fine_rows() {
    [ -f "$HIST_RUN/$1.fine" ] || return 0
    grep '^{"k":"f","t":[0-9][0-9]*,"dt":[0-9][0-9]*,.*}$' "$HIST_RUN/$1.fine" 2>/dev/null
}

# hr_clock -> HR_TRUSTED (0/1), HR_NOW (collector now), HR_OFF, HR_ALIVE (0/1).
hr_clock() {
    local _k
    local _v
    local _boot
    local _up
    local _r
    local hist_boot
    local hist_trusted
    local hist_offset
    local hist_mono
    HR_TRUSTED=0
    HR_NOW=0
    HR_OFF=0
    HR_ALIVE=0
    HR_UP=0
    hist_boot=""
    hist_trusted=""
    hist_offset=""
    hist_mono=""
    if [ -f "$HIST_RUN/clock.env" ]; then
        while IFS='=' read -r _k _v; do
            _v="${_v#\'}"
            _v="${_v%\'}"
            case "$_k" in
                hist_boot) hist_boot="$_v" ;;
                hist_trusted) hist_trusted="$_v" ;;
                hist_offset) hist_offset="$_v" ;;
                hist_mono) hist_mono="$_v" ;;
            esac
        done < "$HIST_RUN/clock.env"
    fi
    _boot=""
    { read -r _boot < "$HIST_BOOT_ID_FILE"; } 2>/dev/null
    _up=""
    { read -r _up _r < "$HIST_UPTIME_FILE"; } 2>/dev/null
    _up="${_up%%.*}"
    case "$_up" in ''|*[!0-9]*) return 0 ;; esac
    HR_UP="$_up"
    [ -n "$_boot" ] && [ "$hist_boot" = "$_boot" ] || return 0
    case "$hist_mono" in
        ''|*[!0-9]*) ;;
        *) [ $((_up - hist_mono)) -le "$HIST_ALIVE_SEC" ] && HR_ALIVE=1 ;;
    esac
    [ "$hist_trusted" = "1" ] || return 0
    case "$hist_offset" in ''|*[!0-9-]*) return 0 ;; esac
    HR_TRUSTED=1
    HR_OFF="$hist_offset"
    HR_NOW=$((_up + hist_offset))
}

# hr_rows ID KIND FIRST_T: every stored + queued (+ open, for b) row of KIND
# (b|e|r, or a grep bracket class such as [er]) whose day file can hold
# t >= FIRST_T, on stdout.
hr_rows() {
    local _d
    local _f
    local _n
    local _first_day
    _d="$HIST_STORE/$1"
    _first_day=$(( $3 / 86400 ))
    {
        for _f in "$_d"/d*.jsonl; do
            [ -f "$_f" ] || continue
            _n="${_f##*/d}"
            _n="${_n%.jsonl}"
            case "$_n" in ''|*[!0-9]*) continue ;; esac
            [ "$_n" -ge "$_first_day" ] && cat "$_f"
        done
        [ -f "$HIST_RUN/$1.queue" ] && cat "$HIST_RUN/$1.queue"
        [ "$2" = "b" ] && [ -f "$HIST_RUN/$1.open" ] && head -n 1 "$HIST_RUN/$1.open"
    } 2>/dev/null | grep "^{\"k\":\"$2\",\"t\":[0-9][0-9]*,.*}\$"
}

# hr_files ID FIRST_T -> _HF = the files hr_rows ID e|r|[er] FIRST_T reads,
# in its order (day files that can hold t >= FIRST_T, then the RAM queue),
# one path per line, for a reader that opens them itself (no cat fork).
hr_files() {
    local _f
    local _n
    local _first_day
    _HF=""
    _first_day=$(( $2 / 86400 ))
    for _f in "$HIST_STORE/$1"/d*.jsonl; do
        [ -f "$_f" ] || continue
        _n="${_f##*/d}"
        _n="${_n%.jsonl}"
        case "$_n" in ''|*[!0-9]*) continue ;; esac
        [ "$_n" -ge "$_first_day" ] && _HF="$_HF$_f
"
    done
    [ -f "$HIST_RUN/$1.queue" ] && _HF="$_HF$HIST_RUN/$1.queue
"
    return 0
}

# hr_logd_evq -> 0 when qmanager_logd answers EVQ (capability line evq=1).
# Builtins only.
hr_logd_evq() {
    local _l
    [ -x "$HIST_QLOG" ] && [ -f "$HIST_LOGD_PROTO" ] || return 1
    while IFS= read -r _l; do
        [ "$_l" = "evq=1" ] && return 0
    done < "$HIST_LOGD_PROTO" 2>/dev/null
    return 1
}

# HR_EVQ_AWK: awk functions that read the journal (qlog evq fmt=hist), for
# the events CGI to prepend to its pairing program, so that the journal is
# read, de-duplicated against the day files and paired in one awk pass.
#
#   hr_evq(q, types, lo, hi, lim): EVQ[1..n] = the journal's k:"e" rows of
#   TYPES (comma list) with t in [lo, hi], in the order logd answers (record
#   order, oldest first); returns n. q = the qlog client, lim = the page.
#   hr_rtype(l), hr_rt(l), hr_rmsg(l): a row's type, t, and message tail.
#
# Since Phase 3 an event is in one store only: logd's journal while logd is
# alive, the day files while it is not (hist_event falls back), so both are
# read. The caller drops a day-file event that the journal also holds (type
# and message equal, within 2 s: rows from builds that wrote both).
#
# EVQ answers the newest PAGE rows in [since, until]. A full page is split in
# two halves of the time range until each answer fits, so a range holding
# more than a page (2000 events/day cap, 31 days) still comes back whole,
# with one qlog fork per window. Untrusted-time rows are not served. logd
# unreachable (qlog exit 3, no output) = the journal adds nothing.
HR_EVQ_AWK='
# The row helpers cut with index(), not a regex (several times faster in
# BusyBox awk), with the same result: a key that occurs twice falls back to
# the greedy regex the readers always used (last occurrence).
function hr_rtype(l,  x, p) {
    p = index(l, "\"type\":\"")
    if (p) {
        x = substr(l, p + 8)
        if (index(x, "\"type\":\"")) { x = l; sub(/.*"type":"/, "", x) }
    } else x = l
    p = index(x, "\""); if (p) x = substr(x, 1, p - 1)
    return x
}
function hr_rt(l,  x, p) {
    x = l
    if (substr(x, 1, 1) == "X") x = substr(x, 2)
    if (substr(x, 1, 13) == "{\"k\":\"e\",\"t\":") x = substr(x, 14)
    else x = l
    p = index(x, ","); if (p) x = substr(x, 1, p - 1)
    return x + 0
}
function hr_rmsg(l,  x, p) {
    p = index(l, ",\"message\":")
    if (!p) return l
    x = substr(l, p + 11)
    if (index(x, ",\"message\":")) { x = l; sub(/.*,"message":/, "", x) }
    return x
}
function hr_evq(q, types, lo, hi, lim,  sp, SL, SH, a, b, m, cmd, ln, nb, B, n, i) {
    n = 0; sp = 1; SL[1] = lo; SH[1] = hi
    while (sp > 0) {
        a = SL[sp]; b = SH[sp]; sp--
        cmd = q " evq fmt=hist types=" types " since=" a " until=" b " limit=" lim " 2>/dev/null"
        nb = 0
        while ((cmd | getline ln) > 0)
            if (ln ~ /^\{"k":"e","t":[0-9]+,"type":"[a-z0-9_]+",.*\}$/) B[++nb] = ln
        close(cmd)
        if (nb >= lim && b > a) {
            m = int((a + b) / 2)
            SL[++sp] = a; SH[sp] = m
            SL[++sp] = m + 1; SH[sp] = b
            continue
        }
        for (i = 1; i <= nb; i++) EVQ[++n] = B[i]
    }
    return n
}
'

# hr_since ID -> HR_SINCE = when collecting began (the collector's since
# marker), moved up to the oldest kept row once retention has trimmed past it.
hr_since() {
    local _f
    local _t
    local _mk
    HR_SINCE=""
    _mk=""
    { read -r _mk < "$HIST_STORE/$1/since"; } 2>/dev/null
    case "$_mk" in ''|*[!0-9]*) _mk="" ;; esac
    _hr_oldest "$1"
    if [ -n "$_mk" ]; then
        if [ -n "$HR_SINCE" ] && [ "$HR_SINCE" -gt "$_mk" ]; then
            return 0
        fi
        HR_SINCE="$_mk"
    fi
}

# _hr_min_t FILE -> _HT = smallest bucket-row t in FILE (rows are not in time
# order: back-dated and merged rows can land after newer ones), or empty.
_hr_min_t() {
    _HT=$(grep '^{"k":"b","t":[0-9][0-9]*,' "$1" 2>/dev/null | awk '
        { t = $0; sub(/^\{"k":"b","t":/, "", t); sub(/,.*/, "", t); t += 0
          if (m == "" || t < m) m = t }
        END { if (m != "") print m }')
    case "$_HT" in ''|*[!0-9]*) _HT="" ;; esac
}

# _hr_oldest ID -> HR_SINCE = t of the oldest stored bucket row, or empty.
_hr_oldest() {
    local _f
    HR_SINCE=""
    for _f in "$HIST_STORE/$1"/d*.jsonl "$HIST_RUN/$1.queue" "$HIST_RUN/$1.open"; do
        [ -f "$_f" ] || continue
        _hr_min_t "$_f"
        [ -n "$_HT" ] || continue
        HR_SINCE="$_HT"
        return 0
    done
}

# hr_json_words "a b c" -> _HJ = ["a","b","c"]
hr_json_words() {
    local _w
    local _sep
    _HJ="["
    _sep=""
    for _w in $1; do
        _HJ="${_HJ}${_sep}\"${_w}\""
        _sep=","
    done
    _HJ="${_HJ}]"
}

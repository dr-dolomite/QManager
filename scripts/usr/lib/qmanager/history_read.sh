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

# hr_range RANGE -> HR_B (bucket seconds), HR_N (bucket count), or 1.
hr_range() {
    case "$1" in
        24h) HR_B=1800; HR_N=48 ;;
        7d) HR_B=10800; HR_N=56 ;;
        30d) HR_B=43200; HR_N=60 ;;
        *) return 1 ;;
    esac
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

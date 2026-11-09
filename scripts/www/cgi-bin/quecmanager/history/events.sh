#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# history/events.sh — CGI Endpoint: a history series' events, paged (GET)
# =============================================================================
# GET ?series=<id>&range=24h|7d|30d[&types=a,b][&limit=1..100][&offset=N]
#   → {success, series, range, total, counts:{type:N}, events:[{timestamp,
#      type, severity, radio, message}]} newest first.
# counts ignore the type filter; total honours it. Read-only. Contract:
# docs/features/history.md §6.
#
# Endpoint: GET /cgi-bin/quecmanager/history/events.sh
# Install location: /www/cgi-bin/quecmanager/history/events.sh
# =============================================================================

qlog_init "cgi_history_events"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
    exit 0
fi

HIST_READ_LIB="${HIST_LIB_DIR:-/usr/lib/qmanager}/history_read.sh"
if [ ! -f "$HIST_READ_LIB" ]; then
    cgi_error "internal_error" "history reader missing"
    exit 0
fi
. "$HIST_READ_LIB"

hr_param series
series="$_HP"
if ! hr_series "$series"; then
    cgi_error "invalid_series" "unknown history series"
    exit 0
fi
hr_param range
range="${_HP:-24h}"
if ! hr_range "$range"; then
    cgi_error "invalid_range" "range must be 24h, 7d or 30d"
    exit 0
fi
eval "evtypes=\$HIST_${series}_EVENTS"

hr_param types
types=""
if [ -n "$_HP" ]; then
    oldifs="$IFS"
    IFS=","
    for ty in $_HP; do
        if ! _hist_in "$ty" "$evtypes"; then
            IFS="$oldifs"
            cgi_error "invalid_param" "types must be event types of this series"
            exit 0
        fi
        types="$types $ty"
    done
    IFS="$oldifs"
fi

hr_param limit
limit="${_HP:-25}"
case "$limit" in ''|*[!0-9]*) limit=0 ;; esac
hr_param offset
offset="${_HP:-0}"
case "$offset" in ''|*[!0-9]*) offset=-1 ;; esac
if [ "$limit" -lt 1 ] || [ "$limit" -gt 100 ] || [ "$offset" -lt 0 ]; then
    cgi_error "invalid_param" "limit must be 1..100 and offset 0 or more"
    exit 0
fi

hr_clock
if [ "$HR_TRUSTED" != "1" ]; then
    printf '{"success":true,"series":"%s","range":"%s","total":0,"counts":{},"events":[]}\n' "$series" "$range"
    exit 0
fi

now="$HR_NOW"
last=$((now / HR_B * HR_B))
first=$((last - (HR_N - 1) * HR_B))

body=$(hr_rows "$series" e "$first" | awk -v first="$first" -v now="$now" \
    -v evtypes="$evtypes" -v types="$types" -v limit="$limit" -v offset="$offset" '
BEGIN {
    ne = split(evtypes, ET, " ")
    nt = split(types, T, " "); for (i = 1; i <= nt; i++) WANT[T[i]] = 1
    n = 0
}
{
    t = $0; sub(/^\{"k":"e","t":/, "", t); sub(/,.*/, "", t); t += 0
    if (t < first || t > now + 60) next
    ty = $0; sub(/.*"type":"/, "", ty); sub(/".*/, "", ty)
    C[ty]++
    if (nt && !(ty in WANT)) next
    row = $0; sub(/^\{"k":"e","t":/, "{\"timestamp\":", row)
    R[++n] = row; RT[n] = t
}
END {
    # Newest first: rows arrive in record order; a stable insertion pass on
    # t keeps that order for ties (a backward clock step can interleave).
    for (i = 2; i <= n; i++) {
        r = R[i]; rt = RT[i]; j = i - 1
        while (j >= 1 && RT[j] > rt) { R[j + 1] = R[j]; RT[j + 1] = RT[j]; j-- }
        R[j + 1] = r; RT[j + 1] = rt
    }
    printf "\"total\":%d,\"counts\":{", n
    sep = ""
    for (i = 1; i <= ne; i++) { printf "%s\"%s\":%d", sep, ET[i], C[ET[i]] + 0; sep = "," }
    printf "},\"events\":["
    sep = ""
    for (k = n - offset; k >= 1 && k > n - offset - limit; k--) { printf "%s%s", sep, R[k]; sep = "," }
    printf "]"
}')

printf '{"success":true,"series":"%s","range":"%s",%s}\n' "$series" "$range" "$body"

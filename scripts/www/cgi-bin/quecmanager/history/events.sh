#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# history/events.sh — CGI Endpoint: a history series' events, paged (GET)
# =============================================================================
# GET ?series=<id>&range=5m|1h|24h|7d|15d|30d[&types=a,b][&limit=1..100][&offset=N]
#   → {success, series, range, total, counts:{type:N}, events:[{timestamp,
#      type, severity, radio, message[, end]}]} newest first.
# counts ignore the type filter; total honours it. An onset type named in
# HIST_<id>_PAIRS="onset:recovery ..." carries end = t of the next matching
# recovery, unless a break comes first: the next onset of its type, a
# restart row ("k":"r", observation stopped) or a device_reboot row of the
# system series (at t - off). Then end = that break; null while ongoing.
# Paired over the whole retention window before the window, type filter and
# paging. Events come from qmanager_logd's journal (qlog evq fmt=hist) merged
# with the day files, or from the day files alone when logd has no EVQ.
# Read-only. Contract: docs/features/history.md §6.
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
    cgi_error "invalid_range" "range must be 5m, 1h, 24h, 7d, 15d or 30d"
    exit 0
fi
eval "evtypes=\$HIST_${series}_EVENTS; pairs=\${HIST_${series}_PAIRS:-}; resume=\${HIST_${series}_RESUME:-}"

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
# Pairing looks at every retained row, not just the range window.
scan=$first
if [ -n "$pairs" ]; then
    scan=$(( (now / 86400 - ${HIST_RETAIN_DAYS:-31}) * 86400 ))
    [ "$scan" -lt "$first" ] || scan=$first
fi

# Rows: the series' events and restart rows, plus (paired series other than
# system) the system series' device_reboot rows, marked X: breaks only.
xtypes=""
[ -n "$pairs" ] && [ "$series" != "system" ] && xtypes="device_reboot"
ev_rows() {
    hr_rows "$series" '[er]' "$scan"
    if [ -n "$xtypes" ]; then
        hr_rows system e "$scan" | grep '"type":"device_reboot"' | sed 's/^/X/'
    fi
}

# Pairing, counts and paging. stdin = the day-file rows (ev_rows). With
# EV_Q set (logd answers EVQ, history.md §6 Event source) the same awk reads
# the journal first (HR_EVQ_AWK, history_read.sh), then the day files
# itself (EV_CF / EV_XF, stdin unused), dropping the day-file events the
# journal also holds: every row is parsed once, no forks but qlog, and the
# pairing is the same for both sources. Rows are cut with substr/index, not
# regexes, and sorted on an index array: BusyBox awk pays per array
# operation.
EV_Q=""
ev_pair() {
awk -v first="$first" -v now="$now" \
    -v evtypes="$evtypes" -v types="$types" -v pairs="$pairs" -v resume="$resume" \
    -v limit="$limit" -v offset="$offset" \
    -v q="$EV_Q" -v jtypes="$jtypes" -v xt="$xtypes" -v lo="$scan" -v hi="$((now + 60))" \
    -v lim="$HIST_EVQ_PAGE" "$HR_EVQ_AWK"'
# row LINE TYPE EXT T: one stored row (no X prefix) into R/RT/RY (events)
# or BT/BB (breaks). EXT = 1: a break only. TYPE and T = its type and t
# when the caller has them (hr_rtype, hr_rt), else "".
function row(line, ty, ext, t,  o, r) {
    if (t == "") {
        # The anchored prefix, then up to the first comma.
        t = line; o = substr(line, 7, 1)
        if (substr(line, 1, 6) == "{\"k\":\"" && (o == "e" || o == "r") && substr(line, 8, 6) == "\",\"t\":") t = substr(line, 14)
        o = index(t, ","); if (o) t = substr(t, 1, o - 1)
        t += 0
    }
    if (t > now + 60) return
    # Breaks: BT = when observation stopped; BB = 1 for a new boot (ends
    # every state), 0 for a same-boot poller restart (spares KEEP types).
    if (substr(line, 1, 7) == "{\"k\":\"r") {
        BT[++nb] = t; BB[nb] = (line ~ /"boot":1[,}]/) ? 1 : 0
        return
    }
    if (ty == "") ty = hr_rtype(line)
    if (ty == "device_reboot") {
        # Down off seconds before the boot moment t; unknown off: at t.
        o = line
        if (sub(/.*"message":"[^"]*off=/, "", o) && o ~ /^[0-9]+/) {
            sub(/[^0-9].*/, "", o); BT[++nb] = t - o
        } else BT[++nb] = t
        BB[nb] = 1
    }
    if (ext) return
    r = line
    if (substr(r, 1, 13) == "{\"k\":\"e\",\"t\":") r = "{\"timestamp\":" substr(r, 14)
    R[++n] = r; RT[n] = t; RY[n] = ty
}
function rowx(l) {
    if (substr(l, 1, 1) == "X") row(substr(l, 2), "", 1, "")
    else row(l, "", 0, "")
}
# held LINE TYPE T -> 1 when the journal holds this day-file event: same
# type and message within 2 s (rows from builds that wrote both stores).
# JS[t] = a second the journal holds; JM[type, t] = the messages of that
# type and second, one per line (a row never holds one). Built on the
# first call.
function held(l, ty, t,  i, k, mg, u) {
    if (!jm) {
        jm = 1
        for (i = 1; i <= nq; i++) {
            JS[EJ[i]] = 1
            k = EY[i] SUBSEP EJ[i]; JM[k] = JM[k] "\n" hr_rmsg(EVQ[i]) "\n"
        }
    }
    mg = ""
    for (u = t - 2; u <= t + 2; u++) {
        if (!(u in JS)) continue
        k = ty SUBSEP u
        if (!(k in JM)) continue
        if (mg == "") mg = "\n" hr_rmsg(l) "\n"
        if (index(JM[k], mg)) return 1
    }
    return 0
}
# psort -> P[1..n] = the rows in ascending t, ties in arrival order (what
# one stable sort gives); 0 when they arrived sorted (P unused: row k is k).
# Rows arrive in record order, so nearly sorted: a back-dated block or a
# clock step leaves a few rows below the running maximum. Those late rows
# are sorted on their own and merged back; an earlier row wins a tie (the
# kept rows at that t all arrived before the late row).
function psort(  i, j, k, ns, nk, mx, S, K, x, kt) {
    ns = 0; nk = 0; mx = ""
    for (i = 1; i <= n; i++) {
        if (mx == "" || RT[i] >= mx) { S[++ns] = i; mx = RT[i] }
        else K[++nk] = i
    }
    if (!nk) return 0
    for (i = 2; i <= nk; i++) {
        x = K[i]; kt = RT[x]; j = i - 1
        while (j >= 1 && RT[K[j]] > kt) { K[j + 1] = K[j]; j-- }
        K[j + 1] = x
    }
    i = 1; j = 1
    for (k = 1; k <= n; k++) {
        if (j > nk || (i <= ns && RT[S[i]] <= RT[K[j]])) P[k] = S[i++]
        else P[k] = K[j++]
    }
    return 1
}
# logd_rows: the journal first, then the day-file rows it does not hold.
# The day files (EV_CF, EV_XF: hr_files lists) are read here, no cat/grep/
# sed forks, with the filters ev_rows applies: the series rows of kind e
# and r, then the system device_reboot rows (breaks only). Breaks are a
# set: their order does not matter.
function logd_rows(  i, nf, F, l, ty, t) {
    nq = hr_evq(q, jtypes, lo, hi, lim)
    for (i = 1; i <= nq; i++) {
        ty = hr_rtype(EVQ[i]); EY[i] = ty; EJ[i] = hr_rt(EVQ[i])
        row(EVQ[i], ty, (ty in XS) ? 1 : 0, EJ[i])
    }
    nf = split(ENVIRON["EV_CF"], F, "\n")
    for (i = 1; i <= nf; i++) {
        while ((getline l < F[i]) > 0) {
            if (l !~ /^\{"k":"[er]","t":[0-9]+,.*\}$/) continue
            if (substr(l, 1, 7) == "{\"k\":\"r") { row(l, "", 0, ""); continue }
            ty = hr_rtype(l); t = hr_rt(l)
            if (!held(l, ty, t)) row(l, ty, 0, t)
        }
        close(F[i])
    }
    nf = split(ENVIRON["EV_XF"], F, "\n")
    for (i = 1; i <= nf; i++) {
        while ((getline l < F[i]) > 0) {
            if (l !~ /^\{"k":"e","t":[0-9]+,.*\}$/ || !index(l, "\"type\":\"device_reboot\"")) continue
            ty = hr_rtype(l); t = hr_rt(l)
            if (!held(l, ty, t)) row(l, ty, 1, t)
        }
        close(F[i])
    }
}
BEGIN {
    ne = split(evtypes, ET, " ")
    nt = split(types, T, " "); for (i = 1; i <= nt; i++) WANT[T[i]] = 1
    np = split(pairs, PR, " ")
    for (i = 1; i <= np; i++) {
        if (split(PR[i], AB, ":") != 2) continue
        ON[AB[1]] = AB[2]
    }
    nk = split(resume, RS, " "); for (i = 1; i <= nk; i++) KEEP[RS[i]] = 1
    nx = split(xt, XA, " "); for (i = 1; i <= nx; i++) XS[XA[i]] = 1
    n = 0; nb = 0; nq = 0; jm = 0
    if (q != "") logd_rows()
}
{ rowx($0) }
END {
    ps = psort()
    # Newest to oldest: NEXT[type] is the t of the next row of that type.
    # An onset ends at its next recovery unless a break comes first: the
    # next onset of its type, or a break at or after it (a recovery in the
    # same second as the break still pairs).
    m = 0
    for (k = n; k >= 1; k--) {
        x = ps ? P[k] : k
        ty = RY[x]; r = R[x]; t = RT[x]
        if (ty in ON) {
            c = (ty in NEXT) ? NEXT[ty] : ""
            for (i = 1; i <= nb; i++) {
                if (BT[i] < t || (!BB[i] && (ty in KEEP))) continue
                if (c == "" || BT[i] < c) c = BT[i]
            }
            e = (ON[ty] in NEXT) ? NEXT[ON[ty]] : ""
            if (e == "" || (c != "" && e > c)) e = c
            if (e == "") e = "null"
            sub(/\}$/, ",\"end\":" e "}", r)
        }
        NEXT[ty] = t
        if (t < first) continue
        C[ty]++
        if (nt && !(ty in WANT)) continue
        O[++m] = r
    }
    printf "\"total\":%d,\"counts\":{", m
    sep = ""
    for (i = 1; i <= ne; i++) { printf "%s\"%s\":%d", sep, ET[i], C[ET[i]] + 0; sep = "," }
    printf "},\"events\":["
    sep = ""
    for (k = offset + 1; k <= m && k <= offset + limit; k++) { printf "%s%s", sep, O[k]; sep = "," }
    printf "]"
}'
}

# Events come from qmanager_logd's journal when it answers EVQ, merged with
# the day files (events recorded while logd was not alive); else from the
# day files alone.
if hr_logd_evq; then
    EV_Q="$HIST_QLOG"
    jtypes=""
    for ty in $evtypes $xtypes; do jtypes="${jtypes:+$jtypes,}$ty"; done
    hr_files "$series" "$scan"
    EV_CF="$_HF"
    EV_XF=""
    if [ -n "$xtypes" ]; then
        hr_files system "$scan"
        EV_XF="$_HF"
    fi
    export EV_CF EV_XF
    body=$(ev_pair < /dev/null)
else
    body=$(ev_rows | ev_pair)
fi

printf '{"success":true,"series":"%s","range":"%s",%s}\n' "$series" "$range" "$body"

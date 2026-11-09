#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# history/series.sh — CGI Endpoint: one history series as merged buckets (GET)
# =============================================================================
# GET ?series=<id>&range=24h|7d|30d
#   → {success, series, range, bucket_sec, now, clock_trusted, since, states,
#      fault, metrics, current, last_fault, buckets:[{t,len,st,x,m}]}
# Read-only; the poller's history.sh is the only writer. Contract:
# docs/features/history.md §6.
#
# Endpoint: GET /cgi-bin/quecmanager/history/series.sh
# Install location: /www/cgi-bin/quecmanager/history/series.sh
# =============================================================================

qlog_init "cgi_history_series"
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

eval "states=\$HIST_${series}_STATES; fault=\$HIST_${series}_FAULT; metrics=\$HIST_${series}_METRICS"
hr_json_words "$states"; j_states="$_HJ"
hr_json_words "$fault"; j_fault="$_HJ"
hr_json_words "$metrics"; j_metrics="$_HJ"

hr_clock
hr_since "$series"
j_since="${HR_SINCE:-null}"

if [ "$HR_TRUSTED" != "1" ]; then
    printf '{"success":true,"series":"%s","range":"%s","bucket_sec":%s,"now":null,"clock_trusted":false,"since":%s,"states":%s,"fault":%s,"metrics":%s,"current":null,"last_fault":null,"buckets":[]}\n' \
        "$series" "$range" "$HR_B" "$j_since" "$j_states" "$j_fault" "$j_metrics"
    exit 0
fi

now="$HR_NOW"
last=$((now / HR_B * HR_B))
first=$((last - (HR_N - 1) * HR_B))

# Current run: only while the collector is alive in this boot.
j_current=null
if [ "$HR_ALIVE" = "1" ] && [ -f "$HIST_RUN/$series.run" ]; then
    run_state=""
    run_mono=""
    while IFS='=' read -r k v; do
        v="${v#\'}"
        v="${v%\'}"
        case "$k" in
            run_state) run_state="$v" ;;
            run_mono) run_mono="$v" ;;
        esac
    done < "$HIST_RUN/$series.run"
    case "$run_mono" in
        ''|*[!0-9]*) ;;
        *)
            if _hist_in "$run_state" "$states"; then
                j_current="{\"state\":\"$run_state\",\"since\":$((run_mono + HR_OFF))}"
            fi
            ;;
    esac
fi

j_fault_last=null
if [ -f "$HIST_STORE/$series/last_fault" ]; then
    lf_s=""
    lf_e=""
    { read -r lf_s lf_e < "$HIST_STORE/$series/last_fault"; } 2>/dev/null
    case "$lf_s$lf_e" in
        ''|*[!0-9]*) ;;
        *) j_fault_last="{\"start\":$lf_s,\"end\":$lf_e}" ;;
    esac
fi

buckets=$(hr_rows "$series" b "$first" | awk -v first="$first" -v B="$HR_B" -v N="$HR_N" \
    -v now="$now" -v states="$states" -v metrics="$metrics" '
BEGIN {
    ns = split(states, S, " "); nm = split(metrics, M, " ")
    for (j = 1; j <= nm; j++) MI[M[j]] = j
}
{
    line = $0
    t = line; sub(/^\{"k":"b","t":/, "", t); sub(/,.*/, "", t); t += 0
    if (t < first || t > now) next
    i = int((t - first) / B)
    if (i < 0 || i >= N) next
    st = line; sub(/.*"st":\{/, "", st); sub(/\}.*/, "", st)
    np = split(st, P, ",")
    for (p = 1; p <= np; p++) {
        split(P[p], kv, ":"); k = kv[1]; gsub(/"/, "", k); ST[i, k] += kv[2] + 0
    }
    x = line; sub(/.*"x":/, "", x); sub(/,.*/, "", x); X[i] += x + 0
    m = line; sub(/.*"m":\{/, "", m)
    while (match(m, /"[a-z0-9_]+":\[-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+\]/)) {
        e = substr(m, RSTART, RLENGTH); m = substr(m, RSTART + RLENGTH)
        name = e; sub(/^"/, "", name); sub(/".*/, "", name)
        if (!(name in MI)) continue
        j = MI[name]
        v = e; sub(/.*\[/, "", v); sub(/\].*/, "", v); split(v, a, ",")
        N1[i, j] += a[1]; SU[i, j] += a[2]
        if (!((i, j) in LO) || a[3] + 0 < LO[i, j]) LO[i, j] = a[3] + 0
        if (!((i, j) in HI) || a[4] + 0 > HI[i, j]) HI[i, j] = a[4] + 0
    }
}
END {
    for (i = 0; i < N; i++) {
        t = first + i * B
        len = (i == N - 1) ? now - t : B
        if (len < 0) len = 0
        tot = 0
        for (j = 1; j <= ns; j++) tot += ST[i, S[j]]
        f = (tot > len && tot > 0) ? len / tot : 1
        out = (i ? "," : "") "{\"t\":" t ",\"len\":" len ",\"st\":{"
        for (j = 1; j <= ns; j++) out = out (j > 1 ? "," : "") "\"" S[j] "\":" int(ST[i, S[j]] * f)
        out = out "},\"x\":" (X[i] + 0) ",\"m\":{"
        sep = ""
        for (j = 1; j <= nm; j++) if (N1[i, j] > 0) {
            out = out sep "\"" M[j] "\":{\"n\":" N1[i, j] ",\"avg\":" sprintf("%.1f", SU[i, j] / N1[i, j]) ",\"min\":" LO[i, j] ",\"max\":" HI[i, j] "}"
            sep = ","
        }
        printf "%s}}", out
    }
}')

printf '{"success":true,"series":"%s","range":"%s","bucket_sec":%s,"now":%s,"clock_trusted":true,"since":%s,"states":%s,"fault":%s,"metrics":%s,"current":%s,"last_fault":%s,"buckets":[%s]}\n' \
    "$series" "$range" "$HR_B" "$now" "$j_since" "$j_states" "$j_fault" "$j_metrics" \
    "$j_current" "$j_fault_last" "$buckets"

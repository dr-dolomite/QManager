#!/bin/sh
# logd-stub.sh — a stand-in for qmanager_logd's event side, sourced by the
# history tests when HIST_TEST_MODE=logd (docs/features/history.md §10).
#
#   jsetup DIR      journal run dir (alive marker, spool), capability file
#                   (evq=1) and a stub qlog on HIST_QLOG; exports the env the
#                   writers (QLOGD_RUN_DIR) and the readers (HIST_*,
#                   QLOGD_PROTO) use, so nothing reaches a live logd
#   jnone DIR       legacy mode: points the same env at paths under DIR that
#                   never exist, so on a device with logd alive the writers
#                   and readers still see logd as down (no live spool writes)
#   jingest WOFF    ingest the spool like logd does at write time: wall =
#                   mono + WOFF once WOFF is a real clock; before that the row
#                   waits and is back-dated with the first real offset
#
# `qlog logq kind=K ... fmt=mono` answers the last line of DIR/kmsg_ts (the
# kernel SSR stamp); the proto file only advertises kmsg=1 when a test adds it.
#
# The stub serves `qlog evq fmt=hist [types=] [since=] [until=] [limit=]`
# from the ingested rows: the newest `limit` matches in record order, oldest
# first, one k:"e" row per line with logd's radio rule (writer radio= field,
# else the message prefix / nr_anchor for the cellular types). Exit 3 with no
# output while DIR/down exists (logd unreachable).

jsetup() {
    J="$1"
    mkdir -p "$J/run" "$J/bin"
    : > "$J/run/alive"
    : > "$J/rows"
    : > "$J/pend"
    printf 'proto=1\nversion=stub\nlogq=1\nevq=1\n' > "$J/proto"
    printf '0\n' > "$J/clock"
    cat > "$J/bin/qlog-ingest" <<'EOF'
#!/bin/sh
# qlog-ingest DIR: spool -> rows (trusted) or pend (untrusted), like logd.
J="$1"
off=""
read -r off < "$J/clock"
[ -s "$J/run/spool" ] && mv -f "$J/run/spool" "$J/run/spool.work"
[ -f "$J/run/spool.work" ] || [ -s "$J/pend" ] || exit 0
touch "$J/run/spool.work"
awk -F'\t' -v off="$off" -v rows="$J/rows" -v pend="$J/pend.new" '
function cell(t) {
    return t == "signal_lost" || t == "signal_restored" || t == "nr_anchor" || t == "pci_change" \
        || t == "scc_pci_change" || t == "band_change" || t == "ca_change"
}
function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
FILENAME ~ /pend$/ { P[++np] = $0; next }
$1 != "E" { next }
{
    msg = $7; for (i = 8; i <= NF; i++) msg = msg "\t" $i
    sev = ($4 == "warning" || $4 == "error") ? $4 : "info"
    r = ""
    n = split($6, F, ";")
    for (i = 1; i <= n; i++) if (F[i] == "radio=lte" || F[i] == "radio=nr") r = substr(F[i], 7)
    if (r == "" && cell($3)) {
        if (msg ~ /^LTE/) r = "lte"
        else if (msg ~ /^NR/ || msg ~ /^5G/) r = "nr"
        else if ($3 == "nr_anchor") r = "nr"
    }
    m = $2; sub(/\..*/, "", m)
    rest = "\"type\":\"" $3 "\",\"severity\":\"" sev "\",\"radio\":" (r == "" ? "null" : "\"" r "\"") ",\"message\":\"" esc(msg) "\"}"
    P[++np] = m "\t" rest
}
END {
    trusted = (off + 0 > 1000000000)
    for (i = 1; i <= np; i++) {
        split(P[i], A, "\t")
        if (trusted) print "{\"k\":\"e\",\"t\":" (A[1] + off) "," substr(P[i], length(A[1]) + 2) >> rows
        else print P[i] > pend
    }
    printf "" > pend
}' "$J/pend" "$J/run/spool.work"
mv -f "$J/pend.new" "$J/pend"
rm -f "$J/run/spool.work"
EOF
    cat > "$J/bin/qlog" <<'EOF'
#!/bin/sh
J="${QLOG_STUB_DIR:?}"
[ -e "$J/down" ] && exit 3
if [ "$1" = "logq" ]; then
    # kind=K ... fmt=mono: the newest SSR stamp, from $J/kmsg_ts (one uptime
    # second per line, oldest first); empty answer when the file is empty.
    echo "$*" >> "$J/calls"
    [ -s "$J/kmsg_ts" ] && tail -n 1 "$J/kmsg_ts"
    exit 0
fi
[ "$1" = "evq" ] || exit 2
shift
types=""; since=""; until=""; limit=50; fmt=json
for kv in "$@"; do
    case "$kv" in
        types=*) types="${kv#types=}" ;;
        since=*) since="${kv#since=}" ;;
        until=*) until="${kv#until=}" ;;
        limit=*) limit="${kv#limit=}" ;;
        fmt=*) fmt="${kv#fmt=}" ;;
    esac
done
[ "$fmt" = hist ] || exit 2
echo "$*" >> "$J/calls"
sh "$J/bin/qlog-ingest" "$J"
awk -v types=",$types," -v since="$since" -v until="$until" -v lim="$limit" '
{
    t = $0; sub(/^\{"k":"e","t":/, "", t); sub(/,.*/, "", t); t += 0
    ty = $0; sub(/.*"type":"/, "", ty); sub(/".*/, "", ty)
    if (types != ",," && index(types, "," ty ",") == 0) next
    if (since != "" && t < since + 0) next
    if (until != "" && t > until + 0) next
    R[++n] = $0
}
END { s = n - lim + 1; if (s < 1) s = 1; for (i = s; i <= n; i++) print R[i] }' "$J/rows"
EOF
    QLOGD_RUN_DIR="$J/run"
    QLOG_STUB_DIR="$J"
    HIST_QLOG="$J/bin/qlog"
    HIST_LOGD_PROTO="$J/proto"
    QLOGD_PROTO="$J/proto"
    HIST_EVQ_PAGE="${HIST_EVQ_PAGE:-2}"
    export QLOGD_RUN_DIR QLOG_STUB_DIR HIST_QLOG HIST_LOGD_PROTO QLOGD_PROTO HIST_EVQ_PAGE
    chmod +x "$J/bin/qlog" "$J/bin/qlog-ingest"
}

jnone() {
    QLOGD_RUN_DIR="$1/nologd/run"
    HIST_QLOG="$1/nologd/qlog"
    HIST_LOGD_PROTO="$1/nologd/proto"
    QLOGD_PROTO="$1/nologd/proto"
    export QLOGD_RUN_DIR HIST_QLOG HIST_LOGD_PROTO QLOGD_PROTO
    unset QLOG_STUB_DIR
}

jingest() {
    printf '%s\n' "$1" > "$J/clock"
    sh "$J/bin/qlog-ingest" "$J"
}

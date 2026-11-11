#!/bin/sh
# run-local.sh — run history-test.sh, system-test.sh and journal-test.sh off
# the device, in both event-store modes (legacy day files, logd journal).
#   sh run-local.sh <repo root> [busybox binary]
# Builds a flat dir from scripts/ with a stub cgi_base.sh (the CGIs source
# /usr/lib/qmanager/cgi_base.sh by absolute path; the copies are rewritten to
# source the stub). With a busybox binary every suite runs under its sh.
# Needs jq on PATH. Exit status: 0 when every run passed.

ROOT="${1:?usage: run-local.sh <repo root> [busybox]}"
BB="${2:-}"
L="$ROOT/scripts/usr/lib/qmanager"
C="$ROOT/scripts/www/cgi-bin/quecmanager/history"
H="$ROOT/tools/history-test"
D="${TMPDIR:-/tmp}/qm_hist_flat.$$"
rm -rf "$D"
mkdir -p "$D"
cp "$L/history.sh" "$L/history_read.sh" "$L"/history_series_*.sh "$D/" || exit 1
cp "$L/events.sh" "$D/events_lib.sh" || exit 1
[ -f "$L/parse_at.sh" ] && cp "$L/parse_at.sh" "$D/"
for f in series events; do
    sed 's#^\. /usr/lib/qmanager/cgi_base.sh$#. "$HIST_LIB_DIR/cgi_base.sh"#' "$C/$f.sh" > "$D/$f.sh"
done
cat > "$D/cgi_base.sh" <<'EOF'
qlog_init() { :; }
qlog_info() { :; }
qlog_warn() { :; }
qlog_error() { :; }
qlog_debug() { :; }
cgi_headers() { printf 'Content-Type: application/json\n\n'; }
cgi_handle_options() { [ "$REQUEST_METHOD" = "OPTIONS" ] && exit 0; }
cgi_method_not_allowed() { printf '{"success":false,"error":"method_not_allowed"}\n'; exit 0; }
cgi_error() { printf '{"success":false,"error":"%s","detail":"%s"}\n' "$1" "${2:-}"; }
EOF

if [ -n "$BB" ]; then
    SH="$BB sh"
    # Every applet the suites call resolves to this BusyBox.
    P="$D/bbbin"
    mkdir -p "$P"
    for a in awk sed grep tail head cat mv rm mkdir wc tr cut sort du date printf ls cp; do
        ln -s "$BB" "$P/$a"
    done
    PATH="$P:$PATH"
    export PATH
else
    SH="sh"
fi

# Never the live journal: logd unavailable unless a suite's jsetup points
# the same env at its stub (logd-stub.sh jnone/jsetup do it per suite too).
QLOGD_RUN_DIR="$D/nologd/run"
HIST_QLOG="$D/nologd/qlog"
HIST_LOGD_PROTO="$D/nologd/proto"
QLOGD_PROTO="$D/nologd/proto"
export QLOGD_RUN_DIR HIST_QLOG HIST_LOGD_PROTO QLOGD_PROTO
unset QLOG_STUB_DIR

RC=0
for MODE in legacy logd; do
    for S in history-test system-test journal-test; do
        [ "$S" = journal-test ] && [ "$MODE" = logd ] && continue
        [ -f "$H/$S.sh" ] || continue
        OUT=$(HIST_TEST_MODE="$MODE" $SH "$H/$S.sh" "$D" 2>&1)
        [ $? -eq 0 ] || RC=1
        printf '%s\n' "$OUT" | grep -E '^FAIL|passed' | sed "s/^/[$MODE] /"
    done
done
rm -rf "$D"
exit "$RC"

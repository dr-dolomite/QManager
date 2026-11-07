#!/bin/sh
# inner.sh - runs ONE scenario against the staged daemon (invoked by run.sh).
# Environment from run.sh: H_ROOT (fake filesystem root), H_STAGE (rewritten
# daemon + libs), H_STATE (harness state), H_BIN (fake ping/uci + BusyBox
# applets), H_OUT (output dir), H_SCENARIO, H_HARNESS. PATH holds only H_BIN.
. "$H_HARNESS/lib.sh"

mkdir -p "$H_STATE/ran" "$H_ROOT/tmp" "$H_ROOT/etc/qmanager" "$H_ROOT/etc/config" "$H_ROOT/var/run"
mkdir -m 0700 "$H_ROOT/var/run/qmanager"
# the adapter reports rc 2 (store unavailable) on a missing key while this file is absent
: > "$H_ROOT/etc/config/quecmanager"
: > "$H_STATE/uci.db"
: > "$H_STATE/pingtab"
h_route default

. "$H_SCENARIO"
command -v sc_setup >/dev/null 2>&1 && sc_setup

# Source the daemon without running main.
QM_PING_NO_MAIN=1
export QM_PING_NO_MAIN
. "$H_STAGE/qmanager_ping"

# The detached DNS job is not under test and would add timing noise.
dns_probe_maybe() { :; }

sc_run

#!/bin/sh
# inner.sh - runs ONE scenario against the staged daemon (invoked by run.sh).
# Environment from run.sh: H_ROOT (fake filesystem root), H_STAGE (rewritten
# daemon + libs), H_STATE (harness state), H_OUT (output dir), H_CLOCK0, H_UP0,
# H_SCENARIO (scenario file), H_HARNESS (this directory). PATH holds only
# BusyBox applets + jq.
. "$H_HARNESS/lib.sh"
read -r H_MAINPID _h_rest < /proc/self/stat

# --- defaults ----------------------------------------------------------------
SC_PASSES=10
mkdir -p "$H_STATE/model" "$H_ROOT/tmp" "$H_ROOT/etc/qmanager" "$H_ROOT/etc/config" "$H_ROOT/var/run/qmanager"
# the adapter reports rc 2 (store unavailable) on a missing key while this file is absent
: > "$H_ROOT/etc/config/quecmanager"
printf '%s' "$H_CLOCK0" > "$H_STATE/clock"
printf '%s.00 0.00\n' "$H_UP0" > "$H_ROOT/proc_uptime"
: > "$H_STATE/dmesg.txt"
cat > "$H_STATE/uci.db" <<UCI
quecmanager.watchcat.enabled=1
quecmanager.watchcat.check_interval=10
quecmanager.watchcat.act_after_sec=15
quecmanager.watchcat.cooldown=30
quecmanager.watchcat.tier1_enabled=1
quecmanager.watchcat.tier2_enabled=1
quecmanager.watchcat.tier3_enabled=0
quecmanager.watchcat.tier4_enabled=1
quecmanager.watchcat.max_reboots_per_hour=3
quecmanager.watchcat.quality_enabled=0
quecmanager.watchcat.quality_consecutive=3
quecmanager.watchcat.ssr_aware=1
quecmanager.watchcat.ssr_grace_sec=45
quecmanager.watchcat.primary_recheck_enabled=0
quecmanager.watchcat.primary_recheck_interval=1
UCI
: > "$H_OUT/at.log"
: > "$H_OUT/calls.log"
: > "$H_OUT/passes.txt"

. "$H_SCENARIO"
command -v sc_setup >/dev/null 2>&1 && sc_setup
h_refresh

# --- source the daemon without running main ------------------------------------
WATCHCAT_NO_MAIN=1
export WATCHCAT_NO_MAIN
WD_LIB_DIR="$H_STAGE/lib"
export WD_LIB_DIR
. "$H_STAGE/qmanager_watchcat"

# Must come after the daemon pulled in safe_tmp.sh: the sandbox user is not
# root, so only the root-ownership half of the gate is stubbed open (plan 3.2):
# a missing file must still read as absent (the long-running flag check).
qm_trusted_file() { [ -f "$1" ] && [ ! -L "$1" ]; }

# wd_sleep backgrounds a real sleep, which the fake clock cannot see: map it to
# the synchronous fake `sleep` unless the scenario sets SC_REAL_SLEEP=1 (then it
# also drops the fake `sleep` in sc_post_source, see 27_term_*.sh).
if [ "${SC_REAL_SLEEP:-0}" != "1" ]; then
    wd_sleep() { sleep "$1"; }
fi
command -v sc_post_source >/dev/null 2>&1 && sc_post_source

main

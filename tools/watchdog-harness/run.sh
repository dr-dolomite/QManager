#!/bin/sh
# run.sh - watchdog sourced-mode parity harness (dev-only, never installed).
#
#   run.sh run [-o OUTDIR] [-d DAEMON] [-l LIBDIR] [scenario ...]
#   run.sh compare DIR_A DIR_B
#   run.sh list
#
# Run it under BusyBox ash in WSL, e.g.
#   wsl -e busybox sh "/mnt/d/.../tools/watchdog-harness/run.sh" run -o /tmp/wd-split
#
# What it does, per scenario (scenarios/NN_name.sh):
#   1. builds a throwaway fake root + stage dir under /dev/shm;
#   2. copies the daemon and the libs it sources, rewriting absolute device
#      paths with sed so nothing outside the sandbox is touched. The SAME
#      rewrite is applied to the monolith and to the split files:
#        /usr/lib/qmanager/ -> <stage>/lib/     /etc/init.d/ -> <stage>/initd/
#        /etc/qmanager/ -> <root>/etc/qmanager/ /etc/config/ -> <root>/etc/config/
#        "/etc/qmanager" (PF_STATE_DIR) -> "<root>/etc/qmanager"
#        /tmp/ -> <root>/tmp/
#        /var/run/ -> <root>/var/run/           /proc/uptime -> <root>/proc_uptime
#   3. puts only BusyBox applets (+ jq) on PATH, like the device;
#   4. sources the daemon with WATCHCAT_NO_MAIN=1 (inner.sh) and calls main with
#      stubbed qcmd / uci / date / sleep / dmesg / reboot (lib.sh) and a
#      scenario tape (scenarios/*.sh);
#   5. collects at.log, calls.log, passes.txt (state + file list + failover
#      record after every pass), tree.txt (every file left in the fake root,
#      incl. events, crash.log, qmanager.log) and console.log.
# PIDs are masked, everything else is deterministic (fake clock), so two runs of
# behaviourally identical code give byte-identical output directories.
#
#   -d DAEMON  daemon file to test (default: scripts/usr/bin/qmanager_watchcat
#              of this checkout; for the baseline pass the commit-0 monolith:
#              git show 125b3ce6:scripts/usr/bin/qmanager_watchcat > FILE)
#   -l LIBDIR  directory holding qlog/safe_tmp/events/sim_db/conn_state.sh,
#              qm_platform_cqwd.sh and
#              any wd_*.sh (default: scripts/usr/lib/qmanager of this checkout)
# Env: WDH_KEEP=1 keeps the work dirs; JQ=/path/to/jq overrides jq lookup.

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)

die() { echo "run.sh: $*" >&2; exit 1; }

cmd_list() {
    for f in "$HERE"/scenarios/*.sh; do
        b=$(basename "$f" .sh)
        echo "$b"
    done
}

cmd_compare() {
    [ -d "$1" ] && [ -d "$2" ] || die "usage: run.sh compare DIR_A DIR_B"
    rc=0
    for d in "$1"/*/; do
        s=$(basename "$d")
        if [ ! -d "$2/$s" ]; then
            echo "MISSING  $s (not in $2)"
            rc=1
            continue
        fi
        if diff -r "$1/$s" "$2/$s" > /dev/null 2>&1; then
            echo "IDENTICAL $s"
        else
            echo "DIFFERS  $s"
            diff -r "$1/$s" "$2/$s" | head -40
            rc=1
        fi
    done
    for d in "$2"/*/; do
        s=$(basename "$d")
        [ -d "$1/$s" ] || { echo "MISSING  $s (not in $1)"; rc=1; }
    done
    return $rc
}

find_jq() {
    if [ -n "$JQ" ] && [ -x "$JQ" ]; then echo "$JQ"; return; fi
    j=$(command -v jq 2>/dev/null)
    [ -n "$j" ] && { echo "$j"; return; }
    for j in "$HOME/bin/jq" /usr/local/bin/jq; do
        [ -x "$j" ] && { echo "$j"; return; }
    done
    return 1
}

mask() {
    sed -e 's/\[watchcat:[0-9]*\]/[watchcat:PID]/g' -e 's/(PID [0-9]*)/(PID N)/g'
}

run_one() { # scenario name
    name="$1"
    scfile="$HERE/scenarios/$name.sh"
    [ -f "$scfile" ] || die "no such scenario: $name"
    out="$OUTDIR/$name"
    rm -rf "$out"
    mkdir -p "$out"

    work=$(mktemp -d "${WDH_WORK:-/dev/shm}/wdh.XXXXXX") || die "mktemp failed"
    case "$work" in
        */tmp/*|*/etc/*|*/var/run/*|*/proc/*|*/usr/lib/qmanager/*) die "work dir $work collides with the path rewrite" ;;
    esac
    stage="$work/stage"
    root="$work/root"
    mkdir -p "$stage/lib" "$stage/initd" "$root" "$work/h" "$work/bin"

    # BusyBox-only PATH, like the device
    "$BB" --install -s "$work/bin"
    ln -sf "$BB" "$work/bin/busybox"
    ln -sf "$JQBIN" "$work/bin/jq"

    rewrite() {
        sed -e "s#/usr/lib/qmanager/#$stage/lib/#g" \
            -e "s#/etc/init\\.d/#$stage/initd/#g" \
            -e "s#/etc/qmanager/#$root/etc/qmanager/#g" \
            -e "s#\"/etc/qmanager\"#\"$root/etc/qmanager\"#g" \
            -e "s#/etc/config/#$root/etc/config/#g" \
            -e "s#/tmp/#$root/tmp/#g" \
            -e "s#/var/run/#$root/var/run/#g" \
            -e "s#/proc/uptime#$root/proc_uptime#g" \
            "$1" > "$2"
    }

    rewrite "$DAEMON" "$stage/qmanager_watchcat"
    for lib in qlog safe_tmp events sim_db qm_platform_cqwd conn_state schedule_guard wd_config wd_state wd_detect wd_quality wd_carrier wd_ledger wd_tiers wd_sim; do
        [ -f "$LIBDIR/$lib.sh" ] && rewrite "$LIBDIR/$lib.sh" "$stage/lib/$lib.sh"
    done

    # init.d + profile_mgr stand-ins: log the call, touch nothing else
    cat > "$stage/initd/qmanager_tower_failover" <<STUB
#!/bin/sh
echo "tower_failover \$*" >> "$out/calls.log"
STUB
    chmod 755 "$stage/initd/qmanager_tower_failover"
    cat > "$stage/initd/qmanager_watchcat" <<STUB
#!/bin/sh
echo "watchcat_init \$*" >> "$out/calls.log"
STUB
    chmod 755 "$stage/initd/qmanager_watchcat"
    cat > "$stage/initd/qmanager" <<STUB
#!/bin/sh
echo "qmanager_init \$*" >> "$out/calls.log"
STUB
    chmod 755 "$stage/initd/qmanager"
    cat > "$stage/lib/profile_mgr.sh" <<STUB
auto_apply_profile() { echo "auto_apply_profile \$1 \$2" >> "$out/calls.log"; }
STUB

    (
        cd "$work" || exit 1
        env -i PATH="$work/bin" \
            H_HARNESS="$HERE" H_ROOT="$root" H_STAGE="$stage" H_STATE="$work/h" \
            H_OUT="$out" H_CLOCK0=1790000000 H_UP0=5000 H_SCENARIO="$scfile" \
            "$BB" timeout $TMO "$BB" sh "$HERE/inner.sh"
    ) > "$out/console.raw" 2>&1
    echo "$?" > "$out/exit.code"
    # let a backgrounded "( sleep 1; sync; reboot ) &" finish writing calls.log
    sleep 1

    mask < "$out/console.raw" > "$out/console.log"
    rm -f "$out/console.raw"
    mask < "$out/at.log" > "$out/at.log.m" && mv "$out/at.log.m" "$out/at.log"
    (
        cd "$root" || exit 1
        find tmp etc var -type f 2>/dev/null | sort | while IFS= read -r f; do
            case "$f" in
                tmp/qmanager_ping.json|tmp/qmanager_status.json|tmp/qmanager_ping_history|etc/config/quecmanager) continue ;;
            esac
            echo "=== $f"
            case "$f" in
                *.pid) echo "(pid)" ;;
                *) cat "$f" ;;
            esac
            echo
        done
    ) | mask > "$out/tree.txt"

    [ "$WDH_KEEP" = "1" ] || rm -rf "$work"
    echo "ran $name (exit $(cat "$out/exit.code"))"
}

cmd_run() {
    OUTDIR="$HERE/out/run"
    DAEMON="$REPO/scripts/usr/bin/qmanager_watchcat"
    LIBDIR="$REPO/scripts/usr/lib/qmanager"
    while [ $# -gt 0 ]; do
        case "$1" in
            -o) OUTDIR="$2"; shift 2 ;;
            -d) DAEMON="$2"; shift 2 ;;
            -l) LIBDIR="$2"; shift 2 ;;
            *) break ;;
        esac
    done
    [ -f "$DAEMON" ] || die "daemon not found: $DAEMON"
    [ -d "$LIBDIR" ] || die "lib dir not found: $LIBDIR"
    BB="${WDH_BB:-$(command -v busybox)}"; [ -x "$BB" ] || die "busybox not found"
    # BusyBox < 1.30 timeout takes -t SECS
    if "$BB" timeout 5 true 2>/dev/null; then TMO=300; else TMO="-t 300"; fi
    JQBIN=$(find_jq) || die "jq not found (set JQ=/path/to/jq)"
    mkdir -p "$OUTDIR" || die "cannot create $OUTDIR"
    if [ $# -gt 0 ]; then
        scenarios="$*"
    else
        scenarios=$(cmd_list)
    fi
    for s in $scenarios; do
        run_one "$s"
    done
}

case "$1" in
    run) shift; cmd_run "$@" ;;
    compare) shift; cmd_compare "$@" ;;
    list) cmd_list ;;
    *) sed -n '2,12p' "$0"; exit 2 ;;
esac

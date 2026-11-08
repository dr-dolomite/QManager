#!/bin/sh
# run.sh - qmanager_ping sourced-mode harness (dev-only, never installed).
#
#   run.sh run [-o OUTDIR] [-d DAEMON] [-l LIBDIR] [scenario ...]
#   run.sh compare DIR_A DIR_B
#   run.sh list
#
# Run it under BusyBox ash in WSL, with the BusyBox you want to test as PH_BB
# (default: busybox on PATH), e.g.
#   PH_BB=$HOME/bb/busybox-1.29.3-bin $HOME/bb/busybox-1.29.3-bin sh \
#       "/mnt/d/.../tools/ping-harness/run.sh" run -o /tmp/ph-1.29.3
#
# What it does, per scenario (scenarios/NN_name.sh):
#   1. builds a throwaway fake root + stage dir under /dev/shm;
#   2. copies qmanager_ping and the libs it sources, rewriting absolute device
#      paths with sed so nothing outside the sandbox is touched:
#        /usr/lib/qmanager/ -> <stage>/lib/   /etc/qmanager/ -> <root>/etc/qmanager/
#        /etc/config/ -> <root>/etc/config/   /tmp/ -> <root>/tmp/
#        /var/run/ -> <root>/var/run/         /proc/net/ipv6_route -> <root>/proc_ipv6_route
#      (/proc/uptime stays real: the harness runs in real time, short delays);
#   3. puts only BusyBox applets, jq and the fakes on PATH: a fake `ping` /
#      `ping6` (per-target delay, result and banner address from a table the
#      scenario writes) and a fake `uci` (serves a db file);
#   4. sources the daemon with QM_PING_NO_MAIN=1 (inner.sh) and runs the
#      scenario's sc_run, which calls probe_cycle / load_config / the real main
#      and prints what it observed;
#   5. collects console.log (the scenario's own output) and tree.txt (every file
#      left in the fake root, volatile fields masked).
# Timestamps, PIDs and cycle times are masked, and timing is asserted as
# yes/NO windows with wide margins, so identical code gives byte-identical
# output on every BusyBox version.
#
# Env: PH_BB=/abs/path/to/busybox, PH_KEEP=1 keeps the work dirs, JQ=/path/to/jq.

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)

die() { echo "run.sh: $*" >&2; exit 1; }

cmd_list() {
    for f in "$HERE"/scenarios/*.sh; do
        basename "$f" .sh
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
    sed -e 's/\[ping:[0-9]*\]/[ping:PID]/g' -e 's/(PID [0-9]*)/(PID N)/g' \
        -e 's/^\[[0-9-]* [0-9:]*\]/[TS]/'
}

# The fake ping: table lookup, banner, delay, result. A killed ping never writes
# its .finish marker.
write_fake_ping() { # path
    cat > "$1" <<STUB
#!$BB sh
v6=0
t=""
case "\$0" in *ping6) v6=1 ;; esac
while [ \$# -gt 0 ]; do
    case "\$1" in
        -6) v6=1; shift ;;
        -4) shift ;;
        -c|-W|-w) shift 2 ;;
        -*) shift ;;
        *) t="\$1"; shift ;;
    esac
done
if [ "\$v6" = "1" ] && [ -f "\$H_STATE/no6" ]; then exit 2; fi
if [ "\$t" = "::1" ]; then
    echo "round-trip min/avg/max = 0.1/0.1/0.1 ms"
    exit 0
fi
d=0.1; res=fail; addr=""
while read -r a b c e; do
    if [ "\$a" = "\$t" ]; then d="\$b"; res="\$c"; addr="\$e"; fi
done < "\$H_STATE/pingtab"
[ -n "\$addr" ] || addr="\$t"
mkdir -p "\$H_STATE/ran"
echo > "\$H_STATE/ran/\$t.start"
echo "PING \$t (\$addr): 56 data bytes"
# like the real ping: a TERM ends the wait instead of leaving a sleeper behind
sleep "\$d" &
sp=\$!
trap 'kill \$sp 2>/dev/null; exit 143' TERM
wait \$sp
case "\$res" in
    ok:*)
        rtt="\${res#ok:}"
        echo "64 bytes from \$addr: seq=0 ttl=57 time=\$rtt ms"
        echo
        echo "--- \$t ping statistics ---"
        echo "1 packets transmitted, 1 packets received, 0% packet loss"
        echo "round-trip min/avg/max = \$rtt/\$rtt/\$rtt ms"
        echo > "\$H_STATE/ran/\$t.finish"
        exit 0
        ;;
    *)
        echo
        echo "--- \$t ping statistics ---"
        echo "1 packets transmitted, 0 packets received, 100% packet loss"
        echo > "\$H_STATE/ran/\$t.finish"
        exit 1
        ;;
esac
STUB
    chmod 755 "$1"
}

# The fake uci: -q get / -q show against uci.db ("k=v", "k+=item" lines).
write_fake_uci() { # path
    cat > "$1" <<STUB
#!$BB sh
[ "\$1" = "-q" ] && shift
k="\${2#quecmanager.}"
db="\$H_STATE/uci.db"
v=""
items=""
while IFS= read -r l; do
    case "\$l" in
        "\$k="*) v="\${l#*=}"; have=1 ;;
        "\$k+="*) items="\${items:+\$items }'\${l#*+=}'"; litems="\${litems:+\$litems }\${l#*+=}" ;;
    esac
done < "\$db"
case "\$1" in
    get)
        if [ -n "\$have" ]; then printf '%s\n' "\$v"; exit 0; fi
        if [ -n "\$litems" ]; then printf '%s\n' "\$litems"; exit 0; fi
        exit 1
        ;;
    show)
        if [ -n "\$have" ]; then printf "%s='%s'\n" "\$2" "\$v"; exit 0; fi
        if [ -n "\$items" ]; then printf '%s=%s\n' "\$2" "\$items"; exit 0; fi
        exit 1
        ;;
esac
exit 0
STUB
    chmod 755 "$1"
}

run_one() { # scenario name
    name="$1"
    scfile="$HERE/scenarios/$name.sh"
    [ -f "$scfile" ] || die "no such scenario: $name"
    out="$OUTDIR/$name"
    rm -rf "$out"
    mkdir -p "$out"

    work=$(mktemp -d "${PH_WORK:-/dev/shm}/ph.XXXXXX") || die "mktemp failed"
    case "$work" in
        */tmp/*|*/etc/*|*/var/run/*|*/proc/*|*/usr/lib/qmanager/*) die "work dir $work collides with the path rewrite" ;;
    esac
    stage="$work/stage"
    root="$work/root"
    bin="$work/bin"
    mkdir -p "$stage/lib" "$root" "$work/h" "$bin"

    # BusyBox-only PATH, like the device, with ping/ping6 replaced by the fake
    "$BB" --install -s "$bin"
    ln -sf "$BB" "$bin/busybox"
    ln -sf "$JQBIN" "$bin/jq"
    rm -f "$bin/ping" "$bin/ping6"
    write_fake_ping "$bin/ping"
    ln -s "$bin/ping" "$bin/ping6"
    write_fake_uci "$bin/uci"
    # does this BusyBox run applets before searching PATH?
    PREFER=0
    case $(PATH="$bin" "$BB" sh -c 'type ping' 2>/dev/null) in
        *"$bin/ping"*) ;;
        *) PREFER=1 ;;
    esac

    rewrite() {
        sed -e "s#/usr/lib/qmanager/#$stage/lib/#g" \
            -e "s#/etc/qmanager/#$root/etc/qmanager/#g" \
            -e "s#/etc/config/#$root/etc/config/#g" \
            -e "s#/tmp/#$root/tmp/#g" \
            -e "s#/var/run/#$root/var/run/#g" \
            -e "s#/proc/net/ipv6_route#$root/proc_ipv6_route#g" \
            "$1" > "$2"
    }

    rewrite "$DAEMON" "$stage/qmanager_ping"
    for lib in qlog safe_tmp qm_platform_cqwd conn_state; do
        [ -f "$LIBDIR/$lib.sh" ] && rewrite "$LIBDIR/$lib.sh" "$stage/lib/$lib.sh"
    done

    (
        cd "$work" || exit 1
        env -i PATH="$bin" \
            H_HARNESS="$HERE" H_ROOT="$root" H_STAGE="$stage" H_STATE="$work/h" \
            H_BIN="$bin" H_OUT="$out" H_SCENARIO="$scfile" H_PREFER_APPLETS="$PREFER" \
            "$BB" timeout $TMO "$BB" sh "$HERE/inner.sh"
    ) > "$out/console.raw" 2>&1
    echo "$?" > "$out/exit.code"

    mask < "$out/console.raw" > "$out/console.log"
    rm -f "$out/console.raw"
    (
        cd "$root" || exit 1
        find tmp etc var -type f 2>/dev/null | sort | while IFS= read -r f; do
            case "$f" in
                tmp/qmanager_ping.json.tmp|tmp/qmanager_dns.json) continue ;;
            esac
            echo "=== $f"
            case "$f" in
                *.pid) echo "(pid)" ;;
                tmp/qmanager_ping.json|tmp/qmanager_ping_slots.json)
                    sed -e 's/"timestamp":[0-9]*/"timestamp":T/' -e 's/"mono":[0-9]*/"mono":M/' \
                        -e 's/"cycle_ms":[0-9]*/"cycle_ms":C/' -e 's/"fail_elapsed_sec":[0-9]*/"fail_elapsed_sec":F/' "$f" ;;
                var/run/qmanager/ping.env)
                    sed -e "s/^_cq_ts='[0-9]*'/_cq_ts='T'/" -e "s/^_cq_mono='[0-9]*'/_cq_mono='M'/" \
                        -e "s/^_cq_cyc='[0-9]*'/_cq_cyc='C'/" -e "s/^_cq_fe='[0-9]*'/_cq_fe='F'/" "$f" ;;
                *) cat "$f" ;;
            esac
            echo
        done
    ) | mask > "$out/tree.txt"

    [ "$PH_KEEP" = "1" ] || rm -rf "$work"
    echo "ran $name (exit $(cat "$out/exit.code"))"
}

cmd_run() {
    OUTDIR="$HERE/out/run"
    DAEMON="$REPO/scripts/usr/bin/qmanager_ping"
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
    BB="${PH_BB:-$(command -v busybox)}"
    case "$BB" in /*) ;; *) die "PH_BB must be an absolute path (got '$BB')" ;; esac
    [ -x "$BB" ] || die "busybox not found"
    # BusyBox < 1.30 timeout takes -t SECS
    if "$BB" timeout 5 true 2>/dev/null; then TMO=120; else TMO="-t 120"; fi
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

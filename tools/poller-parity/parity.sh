#!/bin/sh
# parity.sh <old_parse_at> <new_parse_at> <fixture_dir>
# parity.sh --tap <new_parse_at> <tap_dir>
#
# Fixture mode: every <parser>__<name>.txt in <fixture_dir> is run through
# dump_globals.sh with the OLD and NEW library; outputs must be byte-identical.
# Prints "PASS name" / "FAIL name" (+ the diff), then a summary. Exit 0 only if
# there are zero failures. Set PARITY_FILTER=<substring> to run a subset.
# Set PARITY_NICE=0 to skip the low-priority wrapper.
#
# PARITY_ALLOW_SINR=1 (old = a parse_at.sh from before the LTE SINR dB
# conversion): a serving_cell diff passes only if lte_sinr is the sole
# difference and new == 2*old-20 for a CR-stripped old of 1-2 digits in 0..25,
# else new is empty. Every other diff still fails.
#
# temperature__*.txt (content ignored): parse_temperature reads live sysfs, so
# the two libraries are run back-to-back on the device (old, new, old). PASS if
# new matches either old reading (sysfs jitter between calls is tolerated).
#
# thermal__*.txt: a fake sysfs tree spec (see dump_globals.sh); skipped when
# either library has no parse_thermal. thermal_expect.sh checks the values.
#
# Tap mode: delegates to tap_replay.sh (see there for what is compared).

HERE=${0%/*}
[ "$HERE" = "$0" ] && HERE=.

if [ "$1" = "--tap" ]; then
    [ -n "$2" ] && [ -n "$3" ] || { echo "usage: parity.sh --tap <new_parse_at> <tap_dir>" >&2; exit 2; }
    exec sh "$HERE/tap_replay.sh" "$2" "$3"
fi

OLD=$1
NEW=$2
FXD=$3
if [ -z "$OLD" ] || [ -z "$NEW" ] || [ -z "$FXD" ]; then
    echo "usage: parity.sh <old_parse_at> <new_parse_at> <fixture_dir>" >&2
    echo "       parity.sh --tap <new_parse_at> <tap_dir>" >&2
    exit 2
fi
[ -f "$OLD" ] && [ -f "$NEW" ] && [ -d "$FXD" ] || { echo "bad arguments (missing file/dir)" >&2; exit 2; }

. "$HERE/shim.sh"
TMP="${TMPDIR:-/tmp}/pp_run_$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT

NICE=""
if [ "${PARITY_NICE:-1}" = "1" ] && command -v nice >/dev/null 2>&1; then
    NICE="nice -n 19"
fi

rm -f /tmp/pp_pwned
pass=0
fail=0
skip=0
sinr=0
SINR_NOTE=""

run_dump() { # lib parser fixture outfile -> exit code of dump_globals
    $NICE sh "$HERE/dump_globals.sh" "$1" "$2" "$3" > "$4" 2>"$4.err"
}

show_diff() { # old new
    pp_diff "$1" "$2" 2>&1 | sed 's/^/    /'
}

# 0 if the only diff is the expected LTE SINR dB conversion; sets SINR_NOTE.
sinr_expected() { # old new
    SINR_NOTE=""
    grep -v '^lte_sinr=' "$1" > "$TMP/o.x"
    grep -v '^lte_sinr=' "$2" > "$TMP/n.x"
    cmp -s "$TMP/o.x" "$TMP/n.x" || return 1
    _ov=$(grep '^lte_sinr=' "$1")
    _nv=$(grep '^lte_sinr=' "$2")
    [ -n "$_ov" ] && [ -n "$_nv" ] || return 1
    _exp=$(printf '%s\n' "$_ov" | awk '{ v = $0; sub(/^lte_sinr=/, "", v); gsub(/\r/, "", v); gsub(/\047/, "", v)
        if (v ~ /^[0-9][0-9]?$/ && v + 0 <= 25) print v * 2 - 20; else print "" }')
    _got=$(printf '%s\n' "$_nv" | sed "s/^lte_sinr=//; s/'//g")
    SINR_NOTE="lte_sinr $(printf '%s' "${_ov#lte_sinr=}" | tr '\r' '^') -> ${_got:-<empty>}"
    [ "$_exp" = "$_got" ]
}

for f in "$FXD"/*__*.txt; do
    [ -f "$f" ] || continue
    name=${f##*/}
    name=${name%.txt}
    if [ -n "$PARITY_FILTER" ]; then
        case "$name" in *"$PARITY_FILTER"*) ;; *) continue ;; esac
    fi
    parser=${name%%__*}
    case "$parser" in
        serving_cell|qrsrp|qrsrq|qsinr|signal|ca_info|carrier|sim_slot|sim_status|tier2|temperature|thermal|helpers) ;;
        *) skip=$((skip + 1)); continue ;;
    esac
    # thermal: a library from before parse_thermal has nothing to compare.
    if [ "$parser" = "thermal" ]; then
        if ! grep -q '^parse_thermal()' "$OLD" || ! grep -q '^parse_thermal()' "$NEW"; then
            skip=$((skip + 1)); continue
        fi
    fi

    if [ "$parser" = "temperature" ]; then
        try=0 ; ok=0
        while [ $try -lt 5 ] && [ $ok -eq 0 ]; do
            try=$((try + 1))
            run_dump "$OLD" "$parser" "$f" "$TMP/o1"; rc1=$?
            run_dump "$NEW" "$parser" "$f" "$TMP/n";  rc2=$?
            run_dump "$OLD" "$parser" "$f" "$TMP/o2"; rc3=$?
            if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ] || [ $rc3 -ne 0 ]; then break; fi
            if cmp -s "$TMP/o1" "$TMP/n" || cmp -s "$TMP/o2" "$TMP/n"; then ok=1; fi
        done
        if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ] || [ $rc3 -ne 0 ]; then
            echo "FAIL $name (dump exit codes old=$rc1 new=$rc2 old2=$rc3)"
            fail=$((fail + 1))
        elif [ $ok -eq 1 ]; then
            echo "PASS $name (try $try)"
            pass=$((pass + 1))
        else
            echo "FAIL $name (live sysfs: new matched neither old reading in 5 tries)"
            echo "    old1: $(grep '^t1_temperature=' "$TMP/o1")  new: $(grep '^t1_temperature=' "$TMP/n")  old2: $(grep '^t1_temperature=' "$TMP/o2")"
            fail=$((fail + 1))
        fi
        continue
    fi

    run_dump "$OLD" "$parser" "$f" "$TMP/o"; rc1=$?
    run_dump "$NEW" "$parser" "$f" "$TMP/n"; rc2=$?
    if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ]; then
        echo "FAIL $name (dump exit codes old=$rc1 new=$rc2)"
        [ -s "$TMP/o.err" ] && sed 's/^/    old stderr: /' "$TMP/o.err" | head -5
        [ -s "$TMP/n.err" ] && sed 's/^/    new stderr: /' "$TMP/n.err" | head -5
        fail=$((fail + 1))
    elif [ ! -s "$TMP/o" ]; then
        echo "FAIL $name (old produced no output: harness problem)"
        fail=$((fail + 1))
    elif cmp -s "$TMP/o" "$TMP/n"; then
        echo "PASS $name"
        pass=$((pass + 1))
    elif [ "${PARITY_ALLOW_SINR:-0}" = "1" ] && [ "$parser" = "serving_cell" ]             && sinr_expected "$TMP/o" "$TMP/n"; then
        echo "PASS $name (expected: $SINR_NOTE)"
        pass=$((pass + 1))
        sinr=$((sinr + 1))
    else
        echo "FAIL $name"
        [ -n "$SINR_NOTE" ] && echo "    unexpected $SINR_NOTE"
        show_diff "$TMP/o" "$TMP/n"
        fail=$((fail + 1))
    fi
done

echo "----"
if [ -e /tmp/pp_pwned ]; then
    echo "FAIL injection: hostile fixture text was executed (/tmp/pp_pwned exists)"
    rm -f /tmp/pp_pwned
    fail=$((fail + 1))
fi
echo "parity: pass=$pass fail=$fail skipped=$skip sinr_converted=$sinr"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]

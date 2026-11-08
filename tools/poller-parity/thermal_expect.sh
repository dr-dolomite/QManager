#!/bin/sh
# thermal_expect.sh <parse_at.sh> [fixture_dir]
#
# Value gate for parse_thermal: every thermal__<case>.txt (a fake sysfs tree
# spec, see dump_globals.sh) is run through dump_globals.sh and must print
# exactly <fixture>.expect (written by gen_fixtures.sh). POSIX sh, LF only;
# runs on the device, under BusyBox ash in WSL, or Git Bash on an NTFS dir that
# allows symlinks. Exit 0 only when every case matches.

LIB=$1
FXD=${2:-${0%/*}/fixtures}
HERE=${0%/*}
[ "$HERE" = "$0" ] && HERE=.
[ -f "$LIB" ] && [ -d "$FXD" ] || { echo "usage: thermal_expect.sh <parse_at.sh> [fixture_dir]" >&2; exit 2; }

TMP="${TMPDIR:-/tmp}/ppte_$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT
rm -f /tmp/pp_pwned

pass=0
fail=0
for f in "$FXD"/thermal__*.txt; do
    [ -f "$f" ] || continue
    name=${f##*/}
    name=${name%.txt}
    if [ ! -f "$f.expect" ]; then
        echo "FAIL $name (no $name.txt.expect)"
        fail=$((fail + 1))
        continue
    fi
    sh "$HERE/dump_globals.sh" "$LIB" thermal "$f" > "$TMP/got" 2> "$TMP/err"
    if cmp -s "$f.expect" "$TMP/got"; then
        echo "PASS $name"
        pass=$((pass + 1))
    else
        echo "FAIL $name"
        echo "  want only:"; grep -vxFf "$TMP/got" "$f.expect" | sed 's/^/    /'
        echo "  got only:";  grep -vxFf "$f.expect" "$TMP/got" | sed 's/^/    /'
        [ -s "$TMP/err" ] && sed 's/^/  stderr: /' "$TMP/err" | head -5
        fail=$((fail + 1))
    fi
done
if [ -e /tmp/pp_pwned ]; then
    echo "FAIL a fixture string was executed (/tmp/pp_pwned exists)"
    rm -f /tmp/pp_pwned
    fail=$((fail + 1))
fi
echo "thermal_expect: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]

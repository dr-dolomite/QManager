#!/usr/bin/env bash
# sms_pdu_test.sh — fixture-driven test runner for sms_pdu.awk
# Runs from repo root. Compares awk decode output against expected JSON.

set -eu
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required but not found in PATH" >&2; exit 2; }
command -v awk >/dev/null 2>&1 || { echo "ERROR: awk is required but not found in PATH" >&2; exit 2; }
AWK_FILE="scripts/usr/lib/qmanager/sms_pdu.awk"
FIXTURE_ROOT="tests/fixtures/sms"

pass=0
fail=0

for pdu in "$FIXTURE_ROOT"/decode/*.pdu; do
    base="${pdu%.pdu}"
    expected="${base}.expected.json"

    if [ ! -f "$expected" ]; then
        echo "SKIP (no expected): $pdu"
        continue
    fi

    # Pull the index from filename or from a sidecar; for now assume the
    # expected JSON contains the index field and awk emits compatible output.
    meta="${base}.meta"
    stat_arg=""
    idx_arg=""
    if [ -f "$meta" ]; then
        stat_val=$(grep -E '^stat=' "$meta" | head -1 | cut -d= -f2)
        if [ -n "$stat_val" ]; then
            stat_arg="-v stat=$stat_val"
        fi
        idx_val=$(grep -E '^idx=' "$meta" | head -1 | cut -d= -f2)
        if [ -n "$idx_val" ]; then
            idx_arg="-v idx=$idx_val"
        fi
    fi

    # shellcheck disable=SC2086
    actual=$(awk -f "$AWK_FILE" -v op=decode_one $stat_arg $idx_arg "$pdu")
    if diff <(echo "$actual" | jq -S .) <(jq -S . "$expected") > /tmp/sms_test_diff.$$ 2>&1; then
        echo "PASS: $pdu"
        pass=$((pass + 1))
    else
        echo "FAIL: $pdu"
        cat /tmp/sms_test_diff.$$
        fail=$((fail + 1))
    fi
    rm -f /tmp/sms_test_diff.$$
done

for input in "$FIXTURE_ROOT"/list/*.input; do
    [ -f "$input" ] || continue
    base="${input%.input}"
    expected="${base}.expected.json"

    if [ ! -f "$expected" ]; then
        echo "SKIP (no expected): $input"
        continue
    fi

    actual=$(awk -f "$AWK_FILE" -v op=decode_list < "$input")
    if diff <(echo "$actual" | jq -S .) <(jq -S . "$expected") > /tmp/sms_test_diff.$$ 2>&1; then
        echo "PASS: $input"
        pass=$((pass + 1))
    else
        echo "FAIL: $input"
        cat /tmp/sms_test_diff.$$
        fail=$((fail + 1))
    fi
    rm -f /tmp/sms_test_diff.$$
done

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]

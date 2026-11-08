#!/bin/sh
# adapter_cc_check.sh - unit check of plat_cc_count (qm_platform_cqwd.sh,
# contracts section 14). Dev-only, never installed. POSIX sh / BusyBox ash.
#
#   sh adapter_cc_check.sh [path/to/qm_platform_cqwd.sh]
#
# Builds ca.env / qmi.env fixtures under a temp dir stamped with the live
# /proc/uptime (the adapter's clock) and checks PLAT_CC / PLAT_CC_RAT. Exit 0
# only when every case passes.

HERE=$(cd "$(dirname "$0")" && pwd)
LIB="${1:-$HERE/../../scripts/usr/lib/qmanager/qm_platform_cqwd.sh}"
[ -f "$LIB" ] || { echo "adapter_cc_check: no such file: $LIB" >&2; exit 2; }

T="${TMPDIR:-/tmp}/cc_check.$$"
mkdir -p "$T" || exit 2
trap 'rm -rf "$T"' EXIT INT TERM

. "$LIB"
PF_CA_ENV="$T/ca.env"
PF_QMI_ENV="$T/qmi.env"

PASS=0
FAIL=0

up() {
    local _u
    local _r
    { read -r _u _r < /proc/uptime; } 2>/dev/null
    echo "${_u%%.*}"
}

# ca_env <rat> <cc> <age_s> [noend]
ca_env() {
    local _now
    _now=$(up)
    {
        printf "ca_rat='%s'\n" "$1"
        printf "ca_nr_cc='%s'\n" "$2"
        printf "ca_mono='%s'\n" "$((_now - $3))"
        [ "$4" = "noend" ] || printf "qm_sidecar_end='1'\n"
    } > "$PF_CA_ENV"
}

# qmi_env <state> <registered> <count> <age_s>
qmi_env() {
    local _now
    _now=$(up)
    {
        printf "qmi_state='%s'\n" "$1"
        printf "qmi_registered='%s'\n" "$2"
        printf "qmi_ca_count='%s'\n" "$3"
        printf "qmi_mono='%s'\n" "$((_now - $4))"
        printf "qm_sidecar_end='1'\n"
    } > "$PF_QMI_ENV"
}

# check <name> <want cc> <want rat>   ("-" = empty)
check() {
    plat_cc_count
    if [ "${PLAT_CC:--}" = "$2" ] && [ "${PLAT_CC_RAT:--}" = "$3" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $1: got ${PLAT_CC:--}/${PLAT_CC_RAT:--}, want $2/$3"
    fi
}

reset() { rm -f "$PF_CA_ENV" "$PF_QMI_ENV"; }

reset; check "no files" - -

reset; ca_env sa 2 5;  check "ca sa 2 fresh" 2 sa
reset; ca_env sa 3 85; check "ca sa 3 at 85 s" 3 sa

# Complete, fresh SA read with a bad count: unknown, even with a good QMI read.
reset; ca_env sa 0 5;    qmi_env up 1 3 1; check "ca sa 0 + good qmi" - -
reset; ca_env sa '' 5;   qmi_env up 1 3 1; check "ca sa empty + good qmi" - -
reset; ca_env sa abc 5;  qmi_env up 1 3 1; check "ca sa abc + good qmi" - -
reset; ca_env sa 01 5;   qmi_env up 1 3 1; check "ca sa 01 + good qmi" - -
reset; ca_env sa 123 5;  qmi_env up 1 3 1; check "ca sa 123 + good qmi" - -
reset; ca_env sa 0 5;    check "ca sa 0 alone" - -

# Not complete / not fresh / not SA: QMI answers as before.
reset; ca_env sa 2 200;           qmi_env up 1 3 1; check "ca sa stale + qmi" 3 lte
reset; ca_env sa 0 200;           qmi_env up 1 3 1; check "ca sa 0 stale + qmi" 3 lte
reset; ca_env sa 2 5 noend;       qmi_env up 1 3 1; check "ca sa no end marker + qmi" 3 lte
reset; ca_env lte 0 5;            qmi_env up 1 3 1; check "ca lte 0 + qmi" 3 lte
reset; qmi_env up 1 3 1;                            check "qmi only" 3 lte
reset; qmi_env up 1 3 30;                           check "qmi stale" - -
reset; qmi_env up 0 3 1;                            check "qmi not registered" - -
reset; qmi_env down 1 3 1;                          check "qmi down" - -
reset; qmi_env up 1 0 1;                            check "qmi count 0" - -

echo "RESULT adapter_cc_check: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]

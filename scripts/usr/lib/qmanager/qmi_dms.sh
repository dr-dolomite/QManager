#!/bin/sh
# =============================================================================
# qmi_dms.sh - QMI device-service reads (operating mode, IMEI) for shell callers
# =============================================================================
# Sourced (never executed). BusyBox ash safe. Function definitions only.
#
# The broker's `qmi` client answers these from the QMI registry, outside the AT
# lane (no AT lock, no queue behind scans). Every helper fails closed: any miss
# (no client, old broker without qmi=1, SSR window, malformed reply) returns 1
# or prints nothing, and the caller falls back to its AT read.
#
# Functions: qm_qmi_ready, qm_qmi_online, qm_qmi_imei
# =============================================================================

# qm_qmi_ready: the `qmi` client exists and the broker advertises the QMI lane.
qm_qmi_ready() {
    [ -x /usr/bin/qmi ] || return 1
    grep -qx 'qmi=1' /var/run/qmanager_atd.proto 2>/dev/null
}

# qm_qmi_online: rc 0 only when DMS Get Operating Mode reads "online" (code 0).
# Online is exactly AT+CFUN=1 on the RM551E; CFUN=0 and CFUN=4 both read
# "low_power" (code 1), checked live 2026-11-08. Callers that need the exact
# 0 or 4 digit must ask AT+CFUN? when this returns 1.
qm_qmi_online() {
    local _qo
    qm_qmi_ready || return 1
    _qo=$(qmi opmode 2>/dev/null | jq -r 'if .ok == true and (.data.opmode.code // -1) == 0 then "online" else empty end' 2>/dev/null)
    [ "$_qo" = "online" ]
}

# qm_qmi_imei: prints the 15-digit IMEI from DMS Get IDs, or nothing.
qm_qmi_imei() {
    local _qi
    qm_qmi_ready || return 0
    _qi=$(qmi ids 2>/dev/null | jq -r 'if .ok == true then (.data.ids.imei // "") else empty end' 2>/dev/null)
    case "$_qi" in
        ''|*[!0-9]*) return 0 ;;
        ???????????????) printf '%s' "$_qi" ;;
    esac
    return 0
}

QMI_DMS_LOADED=1

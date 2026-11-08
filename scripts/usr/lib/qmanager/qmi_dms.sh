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
# Functions: qm_qmi_ready, qm_qmi_online, qm_qmi_imei, and the IMEI pending-
#            write marker: qm_imei_running, qm_imei_pending, qm_imei_effective,
#            qm_imei_mark_written
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

# --- IMEI pending write ------------------------------------------------------
# AT+EGMR=1,7 writes NVM but the running IMEI (poller cache, AT+CGSN, QMI) only
# changes at the next reboot. The written value is kept in a /tmp marker, which
# a reboot clears at exactly the moment the write takes effect. Writers compare
# against qm_imei_effective, so writing X and then the original back before a
# reboot really writes the original instead of answering "already set".

QM_IMEI_PENDING_FILE="/tmp/qmanager_imei_pending"

# qm_imei_running: the IMEI in effect (poller cache, else QMI), or nothing.
qm_imei_running() {
    local _ir=""
    [ -f /tmp/qmanager_status.json ] && _ir=$(jq -r '.device.imei // ""' /tmp/qmanager_status.json 2>/dev/null)
    case "$_ir" in
        ???????????????) ;;
        *) _ir=$(qm_qmi_imei) ;;
    esac
    printf '%s' "$_ir"
}

# qm_imei_pending: the IMEI written since boot that is not in effect yet, or nothing.
qm_imei_pending() {
    local _ip
    [ -f "$QM_IMEI_PENDING_FILE" ] && [ ! -L "$QM_IMEI_PENDING_FILE" ] || return 0
    if command -v qm_trusted_file >/dev/null 2>&1; then
        qm_trusted_file "$QM_IMEI_PENDING_FILE" || return 0
    fi
    _ip=$(head -c 32 "$QM_IMEI_PENDING_FILE" 2>/dev/null | tr -d '\r\n ')
    case "$_ip" in
        ''|*[!0-9]*) return 0 ;;
        ???????????????) printf '%s' "$_ip" ;;
    esac
    return 0
}

# qm_imei_effective: what the modem will run after the next reboot.
qm_imei_effective() {
    local _ie
    _ie=$(qm_imei_pending)
    [ -n "$_ie" ] || _ie=$(qm_imei_running)
    printf '%s' "$_ie"
}

# qm_imei_mark_written NEW: record a successful AT+EGMR=1,7 write of NEW.
# Writing back the running IMEI cancels the pending change.
qm_imei_mark_written() {
    if [ "$1" = "$(qm_imei_running)" ]; then
        rm -f "$QM_IMEI_PENDING_FILE"
        return 0
    fi
    if command -v qm_atomic_write >/dev/null 2>&1; then
        printf '%s\n' "$1" | qm_atomic_write "$QM_IMEI_PENDING_FILE"
    else
        rm -f "$QM_IMEI_PENDING_FILE"
        printf '%s\n' "$1" > "$QM_IMEI_PENDING_FILE"
    fi
}

QMI_DMS_LOADED=1

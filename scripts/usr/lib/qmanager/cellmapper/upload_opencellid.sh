#!/bin/sh
# =============================================================================
# upload_opencellid.sh — OpenCellID Upload Adapter (STUB)
# =============================================================================
# **Status: STUB / NOT IMPLEMENTED**
#
# This module exists to demonstrate that the CellMapper subsystem's upload
# layer is intentionally extensible (NFR-4 in mockup-v2 §12 — "support
# additional crowd-sourced cell databases without rewriting the uploader").
#
# It defines the interface signatures that a real OpenCellID adapter would
# expose, and it lives next to the active cellmapper.net uploader code so
# the contract is discoverable. It is **not** wired into qmanager_cm_uploader
# in v0.1.21 — `upload_target` only accepts "cellmapper" and "custom" today.
#
# A working OpenCellID adapter would need:
#   1. A user-supplied API key stored in UCI (e.g. quecmanager.cellmapper.opencellid_key).
#   2. A multipart/form-data POST to https://opencellid.org/measure/uploadCsv
#      with a CSV body — completely different format from the cellmapper.net
#      JSON-array-with-trailing-hash protocol.
#   3. A schema mapping function to project measurements into OpenCellID's
#      CSV columns (mcc,mnc,lac,cellid,lon,lat,signal,measured_at,rating,
#      speed,direction,act,ta,psc,tac,pci,sid,nid,bid).
#   4. A test endpoint (typically a no-op POST) for the Settings UI to
#      validate the API key.
#
# These would be implemented in Phase 2 (post-upstream-merge) when there's
# user demand and a pre-flight conversation with the OpenCellID admins about
# rate limits and acceptable CSV cadence.
#
# Install location: /usr/lib/qmanager/cellmapper/upload_opencellid.sh
# Wired into:       (none — this is a stub, see header)
# =============================================================================

[ -n "$_CM_UPLOAD_OPENCELLID_LOADED" ] && return 0
_CM_UPLOAD_OPENCELLID_LOADED=1

# Exit code returned by every stub function. Negative values aren't safe
# in POSIX shell, so we use a high number that's unlikely to collide with
# real upload return codes (the cellmapper uploader uses 0..5).
CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED=99

# ---------------------------------------------------------------------------
# cm_upload_opencellid_init
# Real impl: read API key from UCI, validate format, set module-level state.
# Stub: log a warning and signal not-implemented.
# Returns: CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED
# ---------------------------------------------------------------------------
cm_upload_opencellid_init() {
    command -v qlog_warn >/dev/null 2>&1 && \
        qlog_warn "cm_upload_opencellid_init: not implemented (Phase 2 stub)"
    return "$CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED"
}

# ---------------------------------------------------------------------------
# cm_upload_opencellid_send <batch_json>
# Real impl: convert measurement array to OpenCellID CSV, POST to
#            https://opencellid.org/measure/uploadCsv with the API key.
# Stub: log a warning and signal not-implemented.
# Args:    $1 = batch_json (JSON array of measurement objects, same input
#                shape as cm_upload_cellmapper / cm_upload_custom)
# Returns: CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED
# ---------------------------------------------------------------------------
cm_upload_opencellid_send() {
    command -v qlog_warn >/dev/null 2>&1 && \
        qlog_warn "cm_upload_opencellid_send: not implemented (Phase 2 stub)"
    return "$CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED"
}

# ---------------------------------------------------------------------------
# cm_upload_opencellid_test
# Real impl: send a tiny health-check POST to the OpenCellID test endpoint
#            and return the API key validation result.
# Stub: log a warning and signal not-implemented.
# Returns: CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED
# ---------------------------------------------------------------------------
cm_upload_opencellid_test() {
    command -v qlog_warn >/dev/null 2>&1 && \
        qlog_warn "cm_upload_opencellid_test: not implemented (Phase 2 stub)"
    return "$CM_UPLOAD_OPENCELLID_NOT_IMPLEMENTED"
}

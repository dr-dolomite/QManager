#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# signout.sh — CGI Endpoint: CellMapper Sign-Out (POST only)
# =============================================================================
# Removes the stored CellMapper auth hash cookie and clears the linked
# account metadata from UCI.
#
# POST body: (empty — no fields required)
#
# Response:
#   {"success":true}
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/signout.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/signout.sh
# =============================================================================

qlog_init "cgi_cellmapper_signout"
cgi_headers
cgi_handle_options

CM_HASH_FILE="/overlay/cellmapper/hash"

# --- Enforce POST only -------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

qlog_info "CellMapper sign-out requested"

# --- Remove hash file --------------------------------------------------------
if [ -f "$CM_HASH_FILE" ]; then
    rm -f "$CM_HASH_FILE"
    qlog_info "Removed hash file"
fi

# --- Clear UCI account metadata ----------------------------------------------
uci -q delete quecmanager.cellmapper.username   2>/dev/null
uci -q delete quecmanager.cellmapper.linked_at  2>/dev/null
uci commit quecmanager 2>/dev/null

qlog_info "CellMapper account unlinked"

echo '{"success":true}'

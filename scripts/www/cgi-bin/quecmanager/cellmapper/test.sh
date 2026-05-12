#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# test.sh — CGI Endpoint: CellMapper Auth Token Test (GET only)
# =============================================================================
# Tests whether the stored CellMapper hash cookie is still valid by calling
# the getIsLoggedIn API endpoint.
#
# Response variants:
#   {"success":true,"status":"valid"}    — token accepted
#   {"success":true,"status":"expired"}  — token rejected (need re-login)
#   {"success":false,"error":"not_linked"} — no hash stored at all
#   {"success":false,"error":"..."}      — network or parse error
#
# Endpoint: GET|POST /cgi-bin/quecmanager/cellmapper/test.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/test.sh
# =============================================================================

qlog_init "cgi_cellmapper_test"
cgi_headers
cgi_handle_options

CM_HASH_FILE="/overlay/cellmapper/hash"
CM_CHECK_URL="https://api.cellmapper.net/v6/getIsLoggedIn"
CM_UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 CM Android/5.6.5"

# --- Enforce GET or POST -----------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ] && [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use GET or POST"
    exit 0
fi

qlog_info "CellMapper auth token test requested"

# --- Read stored hash --------------------------------------------------------
if [ ! -f "$CM_HASH_FILE" ] || [ ! -s "$CM_HASH_FILE" ]; then
    qlog_info "No hash file found — not linked"
    echo '{"success":false,"error":"not_linked"}'
    exit 0
fi

CM_HASH=$(cat "$CM_HASH_FILE" 2>/dev/null)

if [ -z "$CM_HASH" ]; then
    qlog_info "Hash file empty — not linked"
    echo '{"success":false,"error":"not_linked"}'
    exit 0
fi

# --- Call CellMapper getIsLoggedIn endpoint ----------------------------------
CM_RESPONSE=$(curl -s \
    -H "Cookie: hash=$CM_HASH" \
    -H "User-Agent: $CM_UA" \
    --max-time 10 \
    "$CM_CHECK_URL" 2>/dev/null)

CURL_RC=$?

if [ $CURL_RC -ne 0 ]; then
    qlog_error "curl failed with rc=$CURL_RC when testing auth token"
    cgi_error "network_error" "Failed to reach CellMapper API (curl rc=$CURL_RC)"
    exit 0
fi

# --- Parse response ----------------------------------------------------------
LOGIN_STATUS=$(printf '%s' "$CM_RESPONSE" | jq -r '.responseData.loginCheckResponseCode // .loginCheckResponseCode // empty' 2>/dev/null)
ERR_FIELD=$(printf '%s' "$CM_RESPONSE" | jq -r '.error // empty' 2>/dev/null)

case "$LOGIN_STATUS" in
    LOGGEDIN)
        qlog_info "CellMapper auth token is valid"
        echo '{"success":true,"status":"valid"}'
        ;;
    NOTLOGGEDIN)
        qlog_info "CellMapper auth token is expired"
        echo '{"success":true,"status":"expired"}'
        ;;
    "")
        # No loginCheckResponseCode field — unexpected response
        if [ -n "$ERR_FIELD" ]; then
            qlog_error "CellMapper auth check error: $ERR_FIELD"
            jq -n --arg err "$ERR_FIELD" '{"success":false,"error":$err}'
        else
            qlog_error "CellMapper auth check returned unexpected response"
            cgi_error "unexpected_response" "No loginCheckResponseCode in API response"
        fi
        ;;
    *)
        qlog_warn "CellMapper auth check: unknown status: $LOGIN_STATUS"
        jq -n --arg status "$LOGIN_STATUS" '{"success":false,"error":"unknown_status","detail":$status}'
        ;;
esac

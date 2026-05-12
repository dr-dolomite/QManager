#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# signin.sh — CGI Endpoint: CellMapper Sign-In (POST only)
# =============================================================================
# Authenticates with the CellMapper API using username + password, extracts
# the "hash" session cookie from the Set-Cookie header, and persists it to
# /overlay/cellmapper/hash for use by the collector daemon.
#
# IMPORTANT: CellMapper returns HTTP 200 for BOTH success and failure.
# We must inspect the JSON body's loginResponseCode field.
#
# POST body (JSON or form-urlencoded):
#   JSON:            {"username":"<user>","password":"<pass>"}
#   form-urlencoded:  username=<user>&password=<pass>
#
# Response on success: {"success":true,"username":"<user>"}
# Response on failure: {"success":false,"error":"<message>"}
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/signin.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/signin.sh
# =============================================================================

qlog_init "cgi_cellmapper_signin"
cgi_headers
cgi_handle_options

CM_HASH_FILE="/overlay/cellmapper/hash"
CM_HASH_DIR="/overlay/cellmapper"
CM_COOKIE_JAR="/tmp/cellmapper_cookies.txt"
CM_HEADERS_DUMP="/tmp/cellmapper_headers.txt"
CM_LOGIN_URL="https://api.cellmapper.net/v6/login"
CM_UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 CM Android/5.6.5"

# --- URL-decode helper (handles %XX and + as space) --------------------------
urldecode() {
    printf '%s' "$1" | sed 's/+/ /g; s/%/\\x/g' | xargs -0 printf '%b' 2>/dev/null || printf '%s' "$1"
}

# --- Parse form-urlencoded key=value&key=value body --------------------------
# Usage: value=$(parse_form_field "$POST_DATA" "fieldname")
parse_form_field() {
    local body="$1"
    local field="$2"
    local raw
    # Extract value after field=  stopping at & or end-of-string
    raw=$(printf '%s' "$body" | sed -n "s/.*[&?]*${field}=\([^&]*\).*/\1/p" | head -1)
    urldecode "$raw"
}

# --- Enforce POST only -------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse credentials (JSON or form-urlencoded) -----------------------------
# Detect JSON body by checking for leading '{'
case "$POST_DATA" in
    '{'*)
        CM_USERNAME=$(printf '%s' "$POST_DATA" | jq -r '.username // empty' 2>/dev/null)
        CM_PASSWORD=$(printf '%s' "$POST_DATA" | jq -r '.password // empty' 2>/dev/null)
        ;;
    *)
        CM_USERNAME=$(parse_form_field "$POST_DATA" "username")
        CM_PASSWORD=$(parse_form_field "$POST_DATA" "password")
        ;;
esac

if [ -z "$CM_USERNAME" ] || [ -z "$CM_PASSWORD" ]; then
    cgi_error "missing_credentials" "username and password are required"
    exit 0
fi

qlog_info "CellMapper sign-in for user: $CM_USERNAME"

# --- Ensure storage directory exists ----------------------------------------
mkdir -p "$CM_HASH_DIR"

# --- Clean up any stale temp files ------------------------------------------
rm -f "$CM_COOKIE_JAR" "$CM_HEADERS_DUMP"

# --- POST to CellMapper login endpoint --------------------------------------
# Note: curl will return HTTP 200 for both success and failure — CellMapper
# signals the result inside the JSON body via loginResponseCode.
CM_RESPONSE=$(curl -s \
    -c "$CM_COOKIE_JAR" \
    -D "$CM_HEADERS_DUMP" \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
    -H "User-Agent: $CM_UA" \
    --data-urlencode "User=$CM_USERNAME" \
    --data-urlencode "Pass=$CM_PASSWORD" \
    --data-raw "code=sad78789789BBB&channel=androidapp" \
    --max-time 15 \
    "$CM_LOGIN_URL" 2>/dev/null)

CURL_RC=$?

if [ $CURL_RC -ne 0 ]; then
    qlog_error "curl failed with rc=$CURL_RC"
    rm -f "$CM_COOKIE_JAR" "$CM_HEADERS_DUMP"
    cgi_error "network_error" "Failed to reach CellMapper API (curl rc=$CURL_RC)"
    exit 0
fi

# --- Check loginResponseCode in response body --------------------------------
# CellMapper nests the code inside responseData: {"responseData":{"loginResponseCode":"OKAY"}}
LOGIN_RC=$(printf '%s' "$CM_RESPONSE" | jq -r '.responseData.loginResponseCode // .loginResponseCode // empty' 2>/dev/null)
LOGIN_ERR=$(printf '%s' "$CM_RESPONSE" | jq -r '.error // empty' 2>/dev/null)

if [ "$LOGIN_RC" != "OKAY" ]; then
    # Build a human-readable error from whatever fields are present
    if [ -n "$LOGIN_ERR" ]; then
        ERR_MSG="$LOGIN_ERR"
    elif [ -n "$LOGIN_RC" ]; then
        ERR_MSG="Login failed: $LOGIN_RC"
    else
        ERR_MSG="Login failed: unexpected response from server"
    fi
    qlog_warn "CellMapper login failed for $CM_USERNAME: $ERR_MSG"
    rm -f "$CM_COOKIE_JAR" "$CM_HEADERS_DUMP"
    jq -n --arg err "$ERR_MSG" '{"success":false,"error":$err}'
    exit 0
fi

# --- Extract hash cookie from cookie jar ------------------------------------
# Netscape cookie jar format: domain  flag  path  secure  expires  name  value
CM_HASH=$(grep -E "[[:space:]]hash[[:space:]]" "$CM_COOKIE_JAR" 2>/dev/null | awk '{print $NF}')

if [ -z "$CM_HASH" ]; then
    qlog_error "CellMapper login OKAY but no hash cookie found in jar"
    rm -f "$CM_COOKIE_JAR" "$CM_HEADERS_DUMP"
    cgi_error "no_hash_cookie" "Login succeeded but no session cookie was returned"
    exit 0
fi

# --- Persist hash to overlay storage ----------------------------------------
printf '%s' "$CM_HASH" > "$CM_HASH_FILE"
chmod 0600 "$CM_HASH_FILE"

# --- Update UCI account metadata --------------------------------------------
LINKED_AT=$(date +%s)
uci -q set "quecmanager.cellmapper.username=$CM_USERNAME"
uci -q set "quecmanager.cellmapper.linked_at=$LINKED_AT"
uci commit quecmanager 2>/dev/null

# --- Clean up temp files ----------------------------------------------------
rm -f "$CM_COOKIE_JAR" "$CM_HEADERS_DUMP"

qlog_info "CellMapper sign-in successful for $CM_USERNAME"

jq -n --arg username "$CM_USERNAME" '{"success":true,"username":$username}'

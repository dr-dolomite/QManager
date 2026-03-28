#!/bin/sh
# site_proxy.sh — Proxy endpoint for Site Manager.
# Authenticates with a remote QManager device and fetches its modem status.
#
# POST {"address":"192.168.1.1","port":80,"password":"..."}
#
# The proxy logs in to the remote device server-side (via wget/curl),
# obtains a session cookie, fetches /cgi-bin/quecmanager/at_cmd/fetch_data.sh,
# and returns the result. This avoids browser cross-origin cookie limitations.

. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_site_proxy"

cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
fi

cgi_read_post

_address=$(printf '%s' "$POST_DATA" | jq -r '.address // empty')
_port=$(printf '%s' "$POST_DATA" | jq -r '.port // empty')
_password=$(printf '%s' "$POST_DATA" | jq -r '.password // empty')

if [ -z "$_address" ]; then
    cgi_error "missing_address" "Remote device address is required"
    exit 0
fi

if [ -z "$_password" ]; then
    cgi_error "missing_password" "Remote device password is required"
    exit 0
fi

# Validate address: allow IPs, hostnames, not URLs or shell metacharacters
case "$_address" in
    *[!a-zA-Z0-9._:-]*)
        cgi_error "invalid_address" "Address contains invalid characters"
        exit 0
        ;;
esac

# Build base URL
_port="${_port:-80}"
case "$_port" in
    443) _proto="https" ;;
    *)   _proto="http" ;;
esac

case "$_port" in
    80|443) _base_url="${_proto}://${_address}" ;;
    *)      _base_url="${_proto}://${_address}:${_port}" ;;
esac

_login_url="${_base_url}/cgi-bin/quecmanager/auth/login.sh"
_data_url="${_base_url}/cgi-bin/quecmanager/at_cmd/fetch_data.sh"

_timeout=8
_cookie_file=$(mktemp /tmp/qm_proxy_XXXXXX)

# Cleanup on exit
trap 'rm -f "$_cookie_file"' EXIT

# ---------------------------------------------------------------------------
# Step 1: Login to the remote device
# ---------------------------------------------------------------------------
_login_body=$(printf '{"password":"%s"}' "$_password")

if command -v curl >/dev/null 2>&1; then
    _login_resp=$(curl -sL --max-time "$_timeout" \
        -c "$_cookie_file" \
        -H "Content-Type: application/json" \
        -d "$_login_body" \
        "$_login_url" 2>/dev/null)
elif command -v wget >/dev/null 2>&1; then
    # BusyBox wget doesn't support cookie jars natively — parse Set-Cookie
    _login_resp=$(wget -qO- -T "$_timeout" \
        --header="Content-Type: application/json" \
        --post-data="$_login_body" \
        --save-headers \
        "$_login_url" 2>/dev/null)

    # Extract qm_session cookie from headers
    _session_token=$(printf '%s' "$_login_resp" | sed -n 's/.*qm_session=\([^;]*\).*/\1/p' | head -1)

    # Strip headers from response body (blank line separates headers from body)
    _login_resp=$(printf '%s' "$_login_resp" | sed '1,/^$/d')

    # Write cookie file in Netscape format for wget
    if [ -n "$_session_token" ]; then
        printf '%s\tFALSE\t/\tFALSE\t0\tqm_session\t%s\n' "$_address" "$_session_token" > "$_cookie_file"
        printf '%s\tFALSE\t/\tFALSE\t0\tqm_logged_in\t1\n' "$_address" >> "$_cookie_file"
    fi
else
    jq -n '{"success":false,"error":"no_http_client","detail":"Neither curl nor wget available"}'
    exit 0
fi

# Check login success
_login_ok=$(printf '%s' "$_login_resp" | jq -r '.success // false' 2>/dev/null)
if [ "$_login_ok" != "true" ]; then
    _login_err=$(printf '%s' "$_login_resp" | jq -r '.error // "login_failed"' 2>/dev/null)
    _login_detail=$(printf '%s' "$_login_resp" | jq -r '.detail // "Remote authentication failed"' 2>/dev/null)
    jq -n --arg err "$_login_err" --arg detail "$_login_detail" \
        '{"success":false,"error":$err,"detail":$detail,"auth_failed":true}'
    exit 0
fi

# ---------------------------------------------------------------------------
# Step 2: Fetch modem data from the remote device using the session
# ---------------------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
    _data_resp=$(curl -sL --max-time "$_timeout" \
        -b "$_cookie_file" \
        "$_data_url" 2>/dev/null)
elif command -v wget >/dev/null 2>&1; then
    if [ -n "$_session_token" ]; then
        _data_resp=$(wget -qO- -T "$_timeout" \
            --header="Cookie: qm_session=${_session_token}; qm_logged_in=1" \
            "$_data_url" 2>/dev/null)
    else
        _data_resp=$(wget -qO- -T "$_timeout" \
            "$_data_url" 2>/dev/null)
    fi
else
    jq -n '{"success":false,"error":"no_http_client"}'
    exit 0
fi

# Validate we got JSON back
if printf '%s' "$_data_resp" | jq empty 2>/dev/null; then
    printf '%s' "$_data_resp"
else
    jq -n '{"success":false,"error":"invalid_response","detail":"Remote device returned non-JSON response"}'
fi

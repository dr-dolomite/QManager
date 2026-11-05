#!/bin/sh
# check.sh — Auth status check (used by login page for setup detection).
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_check"
cgi_headers

# Bodies are printf'd in jq's own pretty layout: every open page polls this
# every 3 s, so constant answers skip the jq start-up.
if is_setup_required; then
    printf '{\n  "authenticated": false,\n  "setup_required": true\n}\n'
    exit 0
fi

qm_cookie_value "$COOKIE_SESSION"
_token="$QM_COOKIE"
if [ -n "$_token" ] && qm_validate_session "$_token"; then
    printf '{\n  "authenticated": true\n}\n'
    exit 0
fi

# Lets the login page disable its button during a lockout instead of
# offering a submit that would just 429. Must stay on the READ-ONLY
# qm_get_rate_limit_status: qm_check_rate_limit mutates the attempts file,
# so a refresh during a lockout would engage or extend it.
if qm_get_rate_limit_status; then
    _rate_limited="false"
else
    _rate_limited="true"
fi

# Integers only, like the --argjson it replaced (which emitted nothing on a
# non-number); a bad value becomes 0 instead of an empty body.
_retry="${RATE_LIMIT_RETRY_AFTER:-0}"
_remaining="${RATE_LIMIT_ATTEMPTS_REMAINING:-0}"
case "$_retry" in ''|*[!0-9]*) _retry=0 ;; esac
case "$_remaining" in ''|*[!0-9]*) _remaining=0 ;; esac
printf '{\n  "authenticated": false,\n  "rate_limited": %s,\n  "retry_after": %s,\n  "attempts_remaining": %s\n}\n' \
    "$_rate_limited" "$_retry" "$_remaining"

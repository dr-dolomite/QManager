#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fetch_events.sh — CGI Endpoint for Recent Activities / Network Events
# =============================================================================
# Serves the network events NDJSON file as a JSON array to the frontend.
# Zero modem contact — reads from RAM only.
#
# The events file is NDJSON (one JSON object per line). This script converts
# it to a proper JSON array for the frontend.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_events.sh
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_events.sh
# =============================================================================

EVENTS_FILE="/tmp/qmanager_events.json"

qlog_init "cgi_fetch_events"
cgi_headers
cgi_handle_options

# --- logd journal fast path ---------------------------------------------------
# Capability file written by qmanager_logd after bind; one key=1 line per verb.
LOGD_PROTO="/var/run/qmanager_logd.proto"

# _qd_cap KEY=1 — true when the capability file carries that exact line.
# `read` is a builtin: no fork.
_qd_cap() {
    local want="$1"
    local line
    [ -r "$LOGD_PROTO" ] || return 1
    while IFS= read -r line; do
        [ "$line" = "$want" ] && return 0
    done < "$LOGD_PROTO" 2>/dev/null
    return 1
}

# try_logd — answer a GET from qmanager_logd (qlog evq). Returns 0 once the
# JSON array is printed; 1 (nothing printed) means "use the legacy NDJSON
# file": no capability, an invalid parameter, logd unreachable (qlog exit 3) or
# any other non-zero qlog exit. Values are validated with case patterns and
# passed as argv elements, never through eval.
try_logd() {
    local rest
    local pair
    local k
    local v
    local p_types=""
    local p_cat=""
    local p_after=""
    local p_before=""
    local p_since=""
    local p_until=""
    local p_limit=""
    local out
    local rc

    _qd_cap "evq=1" || return 1

    rest="${QUERY_STRING}&"
    while [ -n "$rest" ]; do
        pair="${rest%%&*}"
        rest="${rest#*&}"
        [ -n "$pair" ] || continue
        k="${pair%%=*}"
        v=""
        [ "$k" = "$pair" ] || v="${pair#*=}"
        case "$k" in
            types)
                # URLSearchParams encodes the commas as %2C.
                while case "$v" in *%2[Cc]*) true ;; *) false ;; esac; do
                    v="${v%%%2[Cc]*},${v#*%2[Cc]}"
                done
                case "$v" in
                    *[!a-z0-9_,]*) return 1 ;;
                esac
                [ "${#v}" -le 200 ] || return 1
                p_types="$v"
                ;;
            cat)
                case "$v" in
                    '') ;;
                    cellular|connection|system|config|security|lan|alerts|other) p_cat="$v" ;;
                    *) return 1 ;;
                esac
                ;;
            after|before|limit)
                case "$v" in
                    '') ;;
                    *[!0-9]*|???????????????????*) return 1 ;;
                    *)
                        v="${v#"${v%%[!0]*}"}"
                        [ -n "$v" ] || v=0
                        case "$k" in
                            after) p_after="$v" ;;
                            before) p_before="$v" ;;
                            limit)
                                [ "$v" -lt 1 ] && v=50
                                [ "$v" -gt 2000 ] && v=2000
                                p_limit="$v"
                                ;;
                        esac
                        ;;
                esac
                ;;
            since|until)
                case "$v" in
                    '') ;;
                    *[!0-9]*|???????????????????*) return 1 ;;
                    *)
                        if [ "$k" = "since" ]; then p_since="$v"; else p_until="$v"; fi
                        ;;
                esac
                ;;
        esac
    done

    set -- evq
    [ -n "$p_types" ] && set -- "$@" "types=$p_types"
    [ -n "$p_cat" ] && set -- "$@" "cat=$p_cat"
    [ -n "$p_after" ] && set -- "$@" "after=$p_after"
    [ -n "$p_before" ] && set -- "$@" "before=$p_before"
    [ -n "$p_since" ] && set -- "$@" "since=$p_since"
    [ -n "$p_until" ] && set -- "$@" "until=$p_until"
    [ -n "$p_limit" ] && set -- "$@" "limit=$p_limit"

    out=$(/usr/bin/qlog "$@" 2>/dev/null)
    rc=$?
    [ "$rc" -eq 0 ] && [ -n "$out" ] || return 1
    printf '%s\n' "$out"
    return 0
}

[ "$REQUEST_METHOD" = "GET" ] && try_logd && exit 0

serve_ndjson_as_array "$EVENTS_FILE"

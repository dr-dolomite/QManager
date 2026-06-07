#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# call_forwarding.sh — CGI Endpoint: Unconditional Call Forwarding (GET + POST)
# =============================================================================
# Unconditional call forwarding only (CCFC reason 0). Voice class.
#
# GET:           Query current status via AT+CCFC=0,2.
# POST action=set     {number}  -> register forwarding to <number> (CCFC mode 3)
# POST action=disable           -> deactivate forwarding (CCFC mode 0)
#
# AT facts (live recon):
#   - All AT goes through qcmd (echo-stripping). qcmd echoes the command, so the
#     echoed "AT+CCFC=0,2" line contains "CCFC=" (NOT "+CCFC:"); anchoring on
#     "+CCFC:" is therefore safe and won't match the echo.
#   - AT+CCFC=? -> "+CCFC: (0-5)" (supported reasons).
#   - On some carriers AT+CCFC=0,2 returns "+CME ERROR: 257" ("network rejected
#     request"). This is a FIRST-CLASS state, not a bug — the parser MUST check
#     the CME-error path BEFORE trying to read a +CCFC: status line.
#   - Status line: "+CCFC: <status>,<class>[,\"<number>\",<type>]". status 1 =
#     active. Multiple lines (one per class) are possible; we prefer voice
#     (class 1) but accept any active line.
#
# Persisted: quecmanager.call_forwarding.last_number (UI prefill only; NOT the
# live state — the modem/network is the source of truth for active/number).
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/call_forwarding.sh
# Install location: /www/cgi-bin/quecmanager/cellular/call_forwarding.sh
# =============================================================================

qlog_init "cgi_call_forwarding"
cgi_headers
cgi_handle_options

# Validation: E.164-ish — optional +, first digit 1-9, total 7-15 digits.
_validate_phone() {
    _vp=$(printf '%s' "$1" | sed 's/^+//')
    case "$_vp" in
        ''|*[!0-9]*) return 1 ;;
    esac
    _vp_len=${#_vp}
    [ "$_vp_len" -lt 7 ] || [ "$_vp_len" -gt 15 ] && return 1
    _vp_first=$(printf '%s' "$_vp" | cut -c1)
    [ "$_vp_first" = "0" ] && return 1
    return 0
}

# Does the raw AT output indicate a network rejection (CME 257)?
_is_network_rejected() {
    case "$1" in
        *"+CME ERROR: 257"*|*"network rejected"*|*"NETWORK REJECTED"*) return 0 ;;
        *) return 1 ;;
    esac
}

# Does the raw AT output contain a generic error (and no +CCFC: status line)?
_is_generic_error() {
    case "$1" in
        *"+CCFC:"*) return 1 ;;
        *"+CME ERROR"*|*ERROR*) return 0 ;;
        *) return 1 ;;
    esac
}

# =============================================================================
# GET — Query current forwarding status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Querying call forwarding status (AT+CCFC=0,2)"

    last_number=$(uci -q get quecmanager.call_forwarding.last_number 2>/dev/null)
    [ -z "$last_number" ] && last_number=""

    raw=$(qcmd 'AT+CCFC=0,2' 2>/dev/null)

    # 1. Network-rejection path FIRST (expected on some carriers).
    if _is_network_rejected "$raw"; then
        qlog_warn "Call forwarding query rejected by network: $raw"
        cgi_error "cf_network_rejected" "$raw"
        exit 0
    fi

    # 2. Any other hard error with no usable status line.
    if _is_generic_error "$raw"; then
        qlog_error "Call forwarding query failed: $raw"
        cgi_error "cf_query_failed" "$raw"
        exit 0
    fi

    # 3. Parse +CCFC: lines. Prefer an active (status 1) line; capture its
    #    number when present. Anchor on "+CCFC:" (the echo line has "CCFC=").
    active="false"
    number=""

    ccfc_lines=$(printf '%s' "$raw" | grep '+CCFC:')
    if [ -n "$ccfc_lines" ]; then
        # Iterate each +CCFC: line. Fields: status,class[,"number",type]
        # Use a temp file to avoid a subshell swallowing the loop's var writes
        # (BusyBox: a piped `while read` runs in a subshell).
        _cf_tmp="/tmp/qmanager_cf_lines.$$"
        printf '%s\n' "$ccfc_lines" > "$_cf_tmp"
        while IFS= read -r line; do
            # Strip up to and including "+CCFC:" then leading spaces.
            rest=${line#*+CCFC:}
            rest=$(printf '%s' "$rest" | sed 's/^[[:space:]]*//')
            status=${rest%%,*}
            case "$status" in
                1)
                    active="true"
                    # Extract the first double-quoted token as the number.
                    case "$rest" in
                        *'"'*)
                            num=${rest#*\"}
                            num=${num%%\"*}
                            [ -n "$num" ] && number="$num"
                            ;;
                    esac
                    ;;
            esac
        done < "$_cf_tmp"
        rm -f "$_cf_tmp"
    fi

    enabled_json="$active"
    jq -n \
        --argjson active "$enabled_json" \
        --arg number "$number" \
        --arg last_number "$last_number" \
        '{
            success: true,
            supported: true,
            active: $active,
            number: $number,
            last_number: $last_number
        }'
    exit 0
fi

# =============================================================================
# POST — set / disable
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: set ---------------------------------------------------------
    if [ "$ACTION" = "set" ]; then
        NUMBER=$(printf '%s' "$POST_DATA" | jq -r 'if .number == null then "" else .number end')

        if ! _validate_phone "$NUMBER"; then
            cgi_error "invalid_phone" "number is not a valid phone number"
            exit 0
        fi

        qlog_info "Enabling call forwarding to $NUMBER (AT+CCFC=0,3)"
        raw=$(qcmd "AT+CCFC=0,3,\"$NUMBER\"" 2>/dev/null)

        if _is_network_rejected "$raw"; then
            qlog_warn "Call forwarding set rejected by network: $raw"
            cgi_error "cf_network_rejected" "$raw"
            exit 0
        fi

        # Success check follows the codebase convention (imei.sh / settings.sh):
        # fail ONLY on an explicit *ERROR* in the response. atcli_smd11 does not
        # reliably echo a trailing "OK" for every command/firmware, so a positive
        # "*OK*" match (the old behaviour) wrongly rejected valid supplementary-
        # service replies — the reported "couldn't save" bug. A genuine network
        # rejection (+CME ERROR: 257) is already intercepted above.
        case "$raw" in
            *ERROR*)
                qlog_error "Call forwarding set failed: $raw"
                cgi_error "cf_set_failed" "$raw"
                exit 0
                ;;
            *)
                uci set quecmanager.call_forwarding=call_forwarding 2>/dev/null
                uci set quecmanager.call_forwarding.last_number="$NUMBER"
                uci commit quecmanager 2>/dev/null
                qlog_info "Call forwarding enabled to $NUMBER"
                jq -n --arg number "$NUMBER" \
                    '{success:true, active:true, number:$number}'
                exit 0
                ;;
        esac
    fi

    # --- action: disable -----------------------------------------------------
    if [ "$ACTION" = "disable" ]; then
        qlog_info "Disabling call forwarding (AT+CCFC=0,0)"
        raw=$(qcmd 'AT+CCFC=0,0' 2>/dev/null)

        if _is_network_rejected "$raw"; then
            qlog_warn "Call forwarding disable rejected by network: $raw"
            cgi_error "cf_network_rejected" "$raw"
            exit 0
        fi

        # Negative success check (see the set action above for the rationale).
        case "$raw" in
            *ERROR*)
                qlog_error "Call forwarding disable failed: $raw"
                cgi_error "cf_set_failed" "$raw"
                exit 0
                ;;
            *)
                qlog_info "Call forwarding disabled"
                jq -n '{success:true, active:false}'
                exit 0
                ;;
        esac
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be set or disable"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed

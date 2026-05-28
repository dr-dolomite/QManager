#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms.sh — CGI Endpoint: SMS Center (GET + POST)
# =============================================================================
# GET:  Returns all received SMS messages and storage status via native CMGL pipeline.
# POST: Sends, deletes individual, or deletes all SMS messages.
#
# External tool (bundled; hard-wired to /dev/smd11):
#   sms_tool -d /dev/smd11 recv -j             -> JSON: {"msg":[...]}
#   sms_tool -d /dev/smd11 send <phone> <msg>  -> Send an SMS
#   sms_tool -d /dev/smd11 delete <index>      -> Delete one message
#   sms_tool -d /dev/smd11 delete all          -> Delete all messages
#   sms_tool -d /dev/smd11 status              -> Storage status (plain text)
#
# POST body: { "action": "send"|"delete"|"delete_all", ... }
#   action=send:       { "action":"send", "phone":"...", "message":"..." }
#   action=delete:     { "action":"delete", "index": <number> }
#   action=delete_all: { "action":"delete_all" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
# Install location: /www/cgi-bin/quecmanager/cellular/sms.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_sms"
cgi_headers
cgi_handle_options

# --- Shared AT lock ----------------------------------------------------------
# Shared with qcmd/atcli_smd11 so sms_tool calls serialize against every other
# process touching /dev/smd11. Without this, an inbox fetch can collide with a
# concurrent atcli_smd11 call from the poller/watchcat and either block on the
# char device or return interleaved data.
_SMS_LOCK_FILE="/var/lock/qmanager.lock"
_SMS_LOCK_WAIT=10

# BusyBox-compatible flock with timeout (polling loop).
# Usage: _sms_flock_wait <fd> <timeout_seconds>
_sms_flock_wait() {
    _fd="$1"
    _wait="$2"
    _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null
}

# --- sms_tool wrapper --------------------------------------------------------
# Always talks to /dev/smd11. Wrapped in the shared /var/lock/qmanager.lock so
# every call serializes against qcmd/atcli_smd11.
#
# sms_tool writes harmless tcgetattr/tcsetattr diagnostics to stderr because
# /dev/smd11 is a char device, not a real TTY. We MUST NOT merge stderr into
# stdout with 2>&1, because when the JSON payload is larger than the stdout
# block buffer (~4 KB), partial flushes interleave the cleanup error line
# INTO the middle of the JSON stream. Line-based filtering then sees the
# JSON bytes glued onto `...Inappropriate ioctl for device` and drops the
# whole chunk (see sms_alerts.sh for the same fix).
#
# Instead: capture stderr to a temp file and stdout into a variable. On
# success return pure stdout (JSON is intact). On failure return stderr
# with the known noise lines stripped so the UI sees a meaningful message.
_sms_run() {
    [ -e "$_SMS_LOCK_FILE" ] || : > "$_SMS_LOCK_FILE" 2>/dev/null
    _sms_err="/tmp/qmanager_sms_err.$$"

    (
        _sms_flock_wait 9 "$_SMS_LOCK_WAIT" || exit 2
        _sms_out=$(sms_tool -d /dev/smd11 "$@" 2>"$_sms_err")
        _sms_rc=$?

        if [ "$_sms_rc" -eq 0 ]; then
            printf '%s' "$_sms_out"
        else
            _sms_err_clean=$(grep -v -e '^tcgetattr(' -e '^tcsetattr(' -e 'Inappropriate ioctl for device$' < "$_sms_err" 2>/dev/null)
            if [ -n "$_sms_err_clean" ]; then
                printf '%s' "$_sms_err_clean"
            else
                printf '%s' "$_sms_out"
            fi
        fi

        rm -f "$_sms_err"
        exit "$_sms_rc"
    ) 9<"$_SMS_LOCK_FILE"
}

# --- Native CMGL → JSON pipeline ---------------------------------------------
# Replaces sms_tool recv -j with: qcmd CMGF=0 + qcmd CMGL=4, parse +CMGL
# headers, pipe (idx|stat|hex) lines into sms_pdu.awk op=decode_list.
#
# qcmd already serializes via /var/lock/qmanager.lock, so this function does
# NOT add its own flock — that would risk a self-deadlock against qcmd.
#
# Echoes the decoder's JSON envelope ({"msg":[...]}) on stdout. Echoes an
# empty envelope on failure rather than aborting the CGI request.
_sms_native_recv() {
    local raw pipe_in
    # Ensure PDU mode. CMGF=0 is idempotent; cheap to issue every call.
    qcmd "AT+CMGF=0" >/dev/null 2>&1 || {
        qlog_warn "CMGF=0 failed; native recv aborted, returning empty inbox"
        echo '{"msg":[]}'
        return 0
    }

    # List all stored messages. Output mixes header lines and PDU hex lines.
    raw=$(qcmd "AT+CMGL=4" 2>/dev/null)
    if [ -z "$raw" ]; then
        qlog_warn "CMGL=4 returned empty; native recv returning empty inbox"
        echo '{"msg":[]}'
        return 0
    fi

    # Build the pipe-delimited input for decode_list.
    # State machine: read a +CMGL header (capture idx, stat); next non-empty
    # non-OK line is the PDU hex; emit "idx|stat|hex".
    pipe_in=$(printf '%s\n' "$raw" | awk '
        { sub(/\r$/, "") }
        /^\+CMGL:/ {
            # +CMGL: <idx>,<stat>,<alpha>,<len>
            sub(/^\+CMGL: */, "")
            n = split($0, f, ",")
            if (n >= 2) { cur_idx = f[1]; cur_stat = f[2]; have_hdr = 1 }
            next
        }
        /^OK$/   { next }
        /^ERROR/ { next }
        NF == 0  { next }
        have_hdr {
            # First non-blank line after header is the PDU hex.
            printf "%s|%s|%s\n", cur_idx, cur_stat, $0
            have_hdr = 0
        }
    ')

    if [ -z "$pipe_in" ]; then
        echo '{"msg":[]}'
        return 0
    fi

    printf '%s\n' "$pipe_in" | awk -f /usr/lib/qmanager/sms_pdu.awk -v op=decode_list
}

# =============================================================================
# GET — Fetch inbox messages + storage status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS inbox and status"

    # 1. Get messages via native CMGL pipeline (JSON output: {"msg":[...]})
    raw_json=$(_sms_native_recv)
    if [ -n "$raw_json" ]; then
        raw_msgs=$(printf '%s' "$raw_json" | jq '.msg // []' 2>/dev/null)
        [ -z "$raw_msgs" ] && raw_msgs="[]"
    else
        raw_msgs="[]"
    fi

    # Validate JSON — if extraction failed, fallback to empty
    printf '%s' "$raw_msgs" | jq empty 2>/dev/null || raw_msgs="[]"

    # 2. Merge multi-part messages (same sender+reference) into single entries
    #    - Single messages (no "reference" field) pass through as-is
    #    - Multi-part messages are grouped by sender+reference, sorted by part,
    #      content concatenated, all storage indexes collected for bulk delete
    messages=$(printf '%s' "$raw_msgs" | jq '
        [.[] | select(has("reference") | not) |
            {indexes: [.index], sender, content, timestamp, status}
        ] as $singles |
        ([.[] | select(has("reference"))] |
            group_by(.sender + "|" + (.reference | tostring)) |
            [.[] | sort_by(.part) | {
                indexes: [.[].index],
                sender:  .[0].sender,
                content: ([.[].content] | join("")),
                timestamp: ([.[].timestamp] | min),
                status: (if any(.[]; .status == "unread") then "unread" else "read" end)
            }]
        ) as $merged |
        ($singles + $merged) | sort_by(.timestamp) | reverse
    ' 2>/dev/null)
    [ -z "$messages" ] && messages="[]"
    printf '%s' "$messages" | jq empty 2>/dev/null || messages="[]"

    # 2. Get storage status via sms_tool status (plain text, needs parsing)
    status_raw=$(_sms_run status)
    # Parse "used" and "total" from output — expected pattern: N/M somewhere in output
    storage_used=$(printf '%s' "$status_raw" | grep -o '[0-9]*/[0-9]*' | head -1 | cut -d'/' -f1)
    storage_total=$(printf '%s' "$status_raw" | grep -o '[0-9]*/[0-9]*' | head -1 | cut -d'/' -f2)
    [ -z "$storage_used" ] && storage_used=0
    [ -z "$storage_total" ] && storage_total=0

    # 3. Build JSON response
    jq -n \
        --argjson messages "$messages" \
        --argjson used "$storage_used" \
        --argjson total "$storage_total" \
        '{
            success: true,
            messages: $messages,
            storage: {
                used: $used,
                total: $total
            }
        }'
    exit 0
fi

# =============================================================================
# POST — Send / Delete / Delete All
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: send --------------------------------------------------------
    if [ "$ACTION" = "send" ]; then
        RAW_PHONE=$(printf '%s' "$POST_DATA" | jq -r '.phone // empty')
        MESSAGE=$(printf '%s' "$POST_DATA" | jq -r '.message // empty')

        if [ -z "$RAW_PHONE" ]; then
            cgi_error "missing_phone" "phone number is required"
            exit 0
        fi
        if [ -z "$MESSAGE" ]; then
            cgi_error "missing_message" "message text is required"
            exit 0
        fi

        # Only normalization: strip a leading + if present. The user is
        # responsible for providing the full international number — we do not
        # rewrite local-format numbers.
        PHONE=$(printf '%s' "$RAW_PHONE" | sed 's/^+//')

        qlog_info "Sending SMS to $PHONE (raw: $RAW_PHONE)"
        result=$(_sms_run send "$PHONE" "$MESSAGE")
        rc=$?

        if [ $rc -ne 0 ]; then
            qlog_error "sms_tool send failed (rc=$rc): $result"
            jq -n --arg detail "$result" \
                '{"success":false,"error":"send_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "SMS sent successfully to $PHONE"
        cgi_success
        exit 0
    fi

    # --- action: delete ------------------------------------------------------
    # Accepts "indexes": [n, ...] — deletes all storage slots for a (possibly
    # merged multi-part) message.
    if [ "$ACTION" = "delete" ]; then
        INDEXES_JSON=$(printf '%s' "$POST_DATA" | jq -c '.indexes // empty' 2>/dev/null)

        if [ -z "$INDEXES_JSON" ] || [ "$INDEXES_JSON" = "null" ]; then
            cgi_error "missing_indexes" "indexes array is required"
            exit 0
        fi

        qlog_info "Deleting SMS indexes: $INDEXES_JSON"
        fail_count=0
        idx_tmp="/tmp/qmanager_sms_idx.tmp"
        printf '%s' "$INDEXES_JSON" | jq -r '.[]' > "$idx_tmp"
        while read -r idx; do
            result=$(_sms_run delete "$idx")
            rc=$?
            if [ $rc -ne 0 ]; then
                qlog_warn "Failed to delete index $idx: $result"
                fail_count=$((fail_count + 1))
            fi
        done < "$idx_tmp"
        rm -f "$idx_tmp"

        if [ "$fail_count" -gt 0 ]; then
            qlog_warn "SMS delete completed with $fail_count failure(s)"
            cgi_error "partial_failure" "$fail_count message(s) failed to delete"
            exit 0
        fi

        qlog_info "SMS delete complete"
        cgi_success
        exit 0
    fi

    # --- action: delete_all --------------------------------------------------
    if [ "$ACTION" = "delete_all" ]; then
        qlog_info "Deleting all SMS messages"
        result=$(_sms_run delete all)
        rc=$?

        if [ $rc -ne 0 ]; then
            qlog_error "sms_tool delete all failed (rc=$rc): $result"
            jq -n --arg detail "$result" \
                '{"success":false,"error":"delete_all_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "All SMS messages deleted"
        cgi_success
        exit 0
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be send, delete, or delete_all"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed

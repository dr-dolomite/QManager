#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# logs.sh — CGI Endpoint: System Log Viewer & Management (GET + POST)
# =============================================================================
# GET:  Parses /tmp/qmanager.log (+ rotated files), applies filters, returns
#       structured JSON with entries, stats, and available component list.
#
# Query parameters (GET):
#   lines            — Max entries to return (default: 100)
#   level            — Minimum log level: DEBUG|INFO|WARN|ERROR
#   component        — Filter by component name (exact match)
#   search           — Case-insensitive text search across entire line
#   include_rotated  — 1 to include rotated log files (default: 0)
#
# POST actions:
#   {"action":"clear"}  — Truncate current log, remove rotated files
#   {"action":"status"} — Return log file statistics only
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/logs.sh
# Install location: /www/cgi-bin/quecmanager/system/logs.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_logs"
cgi_headers
cgi_handle_options

# --- Constants ---------------------------------------------------------------
LOG_FILE="/tmp/qmanager.log"
MAX_ROTATED=2

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

# _qd_decode STRING — percent/plus-decode into _QD_VAL. Control bytes
# (%00-%1F, %7F) are dropped; a malformed %XX is kept literally. The only fork
# is the printf subshell per decoded byte.
_qd_decode() {
    local s="$1"
    local out=""
    local hex
    while case "$s" in *+*) true ;; *) false ;; esac; do
        s="${s%%+*} ${s#*+}"
    done
    while case "$s" in *%*) true ;; *) false ;; esac; do
        out="$out${s%%\%*}"
        s="${s#*%}"
        hex="${s%"${s#??}"}"
        case "$hex" in
            [0-9A-Fa-f][0-9A-Fa-f]) ;;
            *) out="$out%"; continue ;;
        esac
        s="${s#??}"
        case "$hex" in
            0?|1?|7[Ff]) continue ;;
        esac
        out="$out$(printf "\\x$hex")"
    done
    _QD_VAL="$out$s"
}

# try_logd — answer a GET from qmanager_logd. Returns 0 once the response body
# is printed; 1 (nothing printed) means "use the legacy file path": no
# capability, an invalid parameter, logd unreachable (qlog exit 3) or any other
# non-zero qlog exit. Values are validated with case patterns and passed as
# argv elements, never through eval.
try_logd() {
    local rest
    local pair
    local k
    local v
    local p_limit="100"
    local p_level=""
    local p_comp=""
    local p_search=""
    local p_boot=""
    local p_after=""
    local p_before=""
    local out
    local rc

    _qd_cap "logq=1" || return 1

    rest="${QUERY_STRING}&"
    while [ -n "$rest" ]; do
        pair="${rest%%&*}"
        rest="${rest#*&}"
        [ -n "$pair" ] || continue
        k="${pair%%=*}"
        v=""
        [ "$k" = "$pair" ] || v="${pair#*=}"
        case "$k" in
            lines|limit)
                case "$v" in
                    '') ;;
                    *[!0-9]*|???????????*) return 1 ;;
                    *)
                        v="${v#"${v%%[!0]*}"}"
                        [ -n "$v" ] || v=0
                        [ "$v" -lt 1 ] && v=100
                        [ "$v" -gt 500 ] && v=500
                        p_limit="$v"
                        ;;
                esac
                ;;
            level|min_level)
                case "$v" in
                    ''|DEBUG|INFO|WARN|ERROR) p_level="$v" ;;
                    *) return 1 ;;
                esac
                ;;
            component)
                case "$v" in
                    ''|all) p_comp="" ;;
                    *[!a-z0-9_-]*|?????????????????????????????????????????????????*) return 1 ;;
                    *) p_comp="$v" ;;
                esac
                ;;
            search)
                _qd_decode "$v"
                p_search="$_QD_VAL"
                if [ "${#p_search}" -gt 256 ]; then
                    p_search=$(printf '%.256s' "$p_search")
                fi
                ;;
            boot)
                case "$v" in
                    ''|this|prev) p_boot="$v" ;;
                    *[!0-9]*|???????????*) return 1 ;;
                    *) p_boot="$v" ;;
                esac
                ;;
            after)
                case "$v" in
                    '') ;;
                    *[!0-9]*|???????????????????*) return 1 ;;
                    *) p_after="$v" ;;
                esac
                ;;
            before)
                case "$v" in
                    '') ;;
                    *[!0-9]*|???????????????????*) return 1 ;;
                    *) p_before="$v" ;;
                esac
                ;;
        esac
    done

    set -- logq "limit=$p_limit"
    [ -n "$p_level" ] && set -- "$@" "min_level=$p_level"
    [ -n "$p_comp" ] && set -- "$@" "component=$p_comp"
    [ -n "$p_search" ] && set -- "$@" "search=$p_search"
    [ -n "$p_boot" ] && set -- "$@" "boot=$p_boot"
    [ -n "$p_after" ] && set -- "$@" "after=$p_after"
    [ -n "$p_before" ] && set -- "$@" "before=$p_before"

    out=$(/usr/bin/qlog "$@" 2>/dev/null)
    rc=$?
    [ "$rc" -eq 0 ] && [ -n "$out" ] || return 1
    printf '%s\n' "$out"
    return 0
}

# --- Helpers -----------------------------------------------------------------

# Extract a query parameter from QUERY_STRING
get_param() {
    echo "$QUERY_STRING" | tr '&' '\n' | grep "^${1}=" | head -1 | \
        sed "s/^${1}=//" | sed 's/+/ /g; s/%20/ /g; s/%2F/\//g; s/%3A/:/g'
}

# Gather log file paths in order (oldest rotated first, then current)
get_log_sources() {
    local include_rotated="$1"
    if [ "$include_rotated" = "1" ]; then
        i=$MAX_ROTATED
        while [ "$i" -ge 1 ]; do
            [ -f "${LOG_FILE}.${i}" ] && echo "${LOG_FILE}.${i}"
            i=$((i - 1))
        done
    fi
    [ -f "$LOG_FILE" ] && echo "$LOG_FILE"
}

# Collect unique component names from log sources. Only the [component:PID]
# block in field position counts ("[YYYY-MM-DD HH:MM:SS] LEVEL [comp:PID] msg"):
# an unanchored "[...:" match picked up the timestamp and bracketed message text.
get_components() {
    local sources="$1"
    if [ -z "$sources" ]; then
        echo "[]"
        return
    fi
    # shellcheck disable=SC2086
    sed -n 's/^\[[^]]*\] *[A-Z][A-Z]* *\[\([^]:[]*\):[^]]*\].*/\1/p' $sources 2>/dev/null | \
        sort -u | \
        jq -R -s 'split("\n") | map(select(length > 0))'
}

# Get log file statistics
get_stats() {
    local size_kb=0
    local line_count=0
    local rotated=0

    if [ -f "$LOG_FILE" ]; then
        local size_bytes
        size_bytes=$(wc -c < "$LOG_FILE" 2>/dev/null)
        size_kb=$((size_bytes / 1024))
        line_count=$(wc -l < "$LOG_FILE" 2>/dev/null)
    fi

    i=1
    while [ "$i" -le "$MAX_ROTATED" ]; do
        [ -f "${LOG_FILE}.${i}" ] && rotated=$((rotated + 1))
        i=$((i + 1))
    done

    jq -n \
        --argjson size_kb "$size_kb" \
        --argjson lines "$line_count" \
        --argjson rotated "$rotated" \
        '{current_size_kb: $size_kb, current_lines: $lines, rotated_files: $rotated}'
}

# Parse log entries with filtering — single awk pass, outputs NDJSON
parse_logs() {
    local sources="$1"
    local param_lines="$2"
    local param_level="$3"
    local param_component="$4"
    local param_search="$5"

    if [ -z "$sources" ]; then
        echo ""
        return
    fi

    # shellcheck disable=SC2086
    cat $sources | awk -v max_lines="$param_lines" \
        -v filter_level="$param_level" \
        -v filter_component="$param_component" \
        -v filter_search="$param_search" '
    BEGIN {
        lvl["DEBUG"] = 0
        lvl["INFO"]  = 1
        lvl["WARN"]  = 2
        lvl["ERROR"] = 3
        min_level = 0
        if (filter_level != "" && filter_level in lvl) {
            min_level = lvl[filter_level]
        }
        count = 0
        filter_search_lower = tolower(filter_search)
    }
    /^\[/ {
        # Parse: [YYYY-MM-DD HH:MM:SS] LEVEL [component:PID] Message
        ts_end = index($0, "]")
        if (ts_end == 0) next
        timestamp = substr($0, 2, ts_end - 2)

        rest = substr($0, ts_end + 2)

        # Extract level (first word after ] )
        n = split(rest, parts, /[[:space:]]+/)
        if (n < 1) next
        level = parts[1]

        # Level filter
        if (!(level in lvl)) next
        if (lvl[level] < min_level) next

        # Find [component:PID] block
        comp_start = index(rest, "[")
        comp_end_pos = index(rest, "]")
        if (comp_start == 0 || comp_end_pos == 0) next
        comp_pid = substr(rest, comp_start + 1, comp_end_pos - comp_start - 1)

        # Split component:PID
        cp_sep = index(comp_pid, ":")
        if (cp_sep > 0) {
            component = substr(comp_pid, 1, cp_sep - 1)
            pid = substr(comp_pid, cp_sep + 1)
        } else {
            component = comp_pid
            pid = ""
        }

        # Component filter
        if (filter_component != "" && component != filter_component) next

        # Message is everything after the ] closing component block
        message = substr(rest, comp_end_pos + 2)
        # Trim leading whitespace
        sub(/^[[:space:]]+/, "", message)

        # Search filter (case-insensitive)
        if (filter_search != "") {
            test_line = tolower($0)
            if (index(test_line, filter_search_lower) == 0) next
        }

        # Store matching entry
        count++
        timestamps[count] = timestamp
        levels[count] = level
        components[count] = component
        pids[count] = pid
        messages[count] = message
    }
    END {
        # Output last max_lines entries as NDJSON
        start = 1
        if (count > max_lines + 0) start = count - max_lines + 1

        for (i = start; i <= count; i++) {
            # Escape JSON special chars in message
            gsub(/\\/, "\\\\", messages[i])
            gsub(/"/, "\\\"", messages[i])
            gsub(/\t/, "\\t", messages[i])
            # Escape in other fields too (component names are safe, but be thorough)
            gsub(/\\/, "\\\\", timestamps[i])
            gsub(/"/, "\\\"", timestamps[i])

            printf "{\"timestamp\":\"%s\",\"level\":\"%s\",\"component\":\"%s\",\"pid\":\"%s\",\"message\":\"%s\"}\n", \
                timestamps[i], levels[i], components[i], pids[i], messages[i]
        }
    }'
}

# =============================================================================
# GET — Read and filter logs
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    try_logd && exit 0

    PARAM_LINES=$(get_param "lines")
    PARAM_LEVEL=$(get_param "level")
    PARAM_COMPONENT=$(get_param "component")
    PARAM_SEARCH=$(get_param "search")
    PARAM_INCLUDE_ROTATED=$(get_param "include_rotated")

    # Defaults and validation
    PARAM_LINES="${PARAM_LINES:-100}"
    PARAM_INCLUDE_ROTATED="${PARAM_INCLUDE_ROTATED:-0}"
    # Sanitize lines param — must be numeric
    case "$PARAM_LINES" in
        *[!0-9]*) PARAM_LINES=100 ;;
    esac

    qlog_debug "Reading logs: lines=$PARAM_LINES level=$PARAM_LEVEL component=$PARAM_COMPONENT search=$PARAM_SEARCH"

    SOURCES=$(get_log_sources "$PARAM_INCLUDE_ROTATED")

    if [ -z "$SOURCES" ]; then
        # No log files exist yet
        jq -n '{
            success: true,
            entries: [],
            total: 0,
            stats: {current_size_kb: 0, current_lines: 0, rotated_files: 0},
            available_components: []
        }'
        exit 0
    fi

    entries=$(parse_logs "$SOURCES" "$PARAM_LINES" "$PARAM_LEVEL" "$PARAM_COMPONENT" "$PARAM_SEARCH")
    components=$(get_components "$SOURCES")
    stats=$(get_stats)

    if [ -n "$entries" ]; then
        # total is counted by jq: wc -l on the unterminated NDJSON undercounted by one.
        printf '%s' "$entries" | jq -s \
            --argjson stats "$stats" \
            --argjson components "$components" \
            '{
                success: true,
                entries: .,
                total: length,
                stats: $stats,
                available_components: $components
            }'
    else
        jq -n \
            --argjson stats "$stats" \
            --argjson components "$components" \
            '{
                success: true,
                entries: [],
                total: 0,
                stats: $stats,
                available_components: $components
            }'
    fi
    exit 0
fi

# =============================================================================
# POST — Actions (clear, status)
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    action=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    case "$action" in
        clear)
            qlog_info "Clearing all log files"
            [ -f "$LOG_FILE" ] && : > "$LOG_FILE"
            i=1
            while [ "$i" -le "$MAX_ROTATED" ]; do
                rm -f "${LOG_FILE}.${i}"
                i=$((i + 1))
            done
            qlog_info "Log files cleared"
            cgi_success
            ;;
        status)
            stats=$(get_stats)
            printf '%s' "$stats" | jq '{success: true} + .'
            ;;
        *)
            cgi_error "invalid_action" "Action must be: clear or status"
            ;;
    esac
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed

#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# syslog.sh — CGI Endpoint: Device logs (system log ring + kernel ring), GET
# =============================================================================
# The modem's own logs, not QManager's transcript (that is system/logs.sh).
# Read-only: no locks, no writes, no clear action.
#
# Query parameters:
#   source  — system (logread, default) | kernel (dmesg)
#   lines   — 50..500, default 200 (clamped; non-numeric is invalid_param)
#
# Response (entries NEWEST FIRST, contract in types/device-syslog.ts):
#   {"success":true,"source":"system","now":<epoch>,"uptime":<s>,"total":<n>,
#    "entries":[{"t","ts","facility","level","proc","pid","msg"}]}
#   {"success":true,"source":"kernel",...,"entries":[{"up","msg"}]}
#
# Endpoint: GET /cgi-bin/quecmanager/system/syslog.sh
# Install location: /www/cgi-bin/quecmanager/system/syslog.sh
# =============================================================================

qlog_init "cgi_syslog"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_error "method_not_allowed" "Use GET"
    exit 0
fi

# qs_get <key> — sets QS_VAL to the raw value (no URL decoding: every accepted
# value is plain [a-z0-9]).
qs_get() {
    QS_VAL=""
    _qs_ifs=$IFS
    IFS='&'
    set -f
    for _qs_kv in $QUERY_STRING; do
        case "$_qs_kv" in
            "$1="*) QS_VAL=${_qs_kv#*=}; break ;;
        esac
    done
    set +f
    IFS=$_qs_ifs
}

qs_get source
SOURCE="${QS_VAL:-system}"
case "$SOURCE" in
    system|kernel) ;;
    *) cgi_error "invalid_param" "source must be system or kernel"; exit 0 ;;
esac

qs_get lines
LINES="${QS_VAL:-200}"
case "$LINES" in
    ''|*[!0-9]*) cgi_error "invalid_param" "lines must be a number"; exit 0 ;;
esac
# Strip leading zeros so ash never reads the value as octal.
while :; do
    case "$LINES" in
        0?*) LINES=${LINES#0} ;;
        *) break ;;
    esac
done
case "$LINES" in
    ?????*) LINES=500 ;;
esac
if [ "$LINES" -lt 50 ]; then
    LINES=50
elif [ "$LINES" -gt 500 ]; then
    LINES=500
fi

NOW=$(date +%s)
UPTIME=0
{ read -r UPTIME _ ; } < /proc/uptime 2>/dev/null
case "$UPTIME" in
    ''|*[!0-9.]*|.*|*.*.*) UPTIME=0 ;;
esac

# One awk pass over the ring: counts every line, keeps only the last $max in a
# circular buffer, then prints the whole JSON document newest first. Output is
# built with explicit string handling (no sub/gsub replacement strings, whose
# backslash rules differ between awks). `t` comes from mktime(), which reads the
# same local time logread stamps with; -1 becomes null.
emit() {
    awk -v mode="$SOURCE" -v max="$LINES" -v now="$NOW" -v up_s="$UPTIME" '
    function esc(s,   out, n, k, c) {
        out = ""
        n = length(s)
        for (k = 1; k <= n; k++) {
            c = substr(s, k, 1)
            if (c == "\\") out = out "\\\\"
            else if (c == "\"") out = out "\\\""
            else if (c == "\t") out = out " "
            else if (c in bad) continue
            else out = out c
        }
        return out
    }
    function sys_entry(line,   n, f, tm, ts, after, rest, fl, fac, lv, t, k, tag, p, proc, pid, pidtxt, msg, ok) {
        ok = 0
        n = split(line, f, " ")
        if (n >= 6 && (f[2] in mon) && f[3] ~ /^[0-9]+$/ && f[4] ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/ && f[5] ~ /^[0-9][0-9][0-9][0-9]$/ && f[6] ~ /^[a-z0-9]+\.[a-z]+$/) ok = 1
        if (!ok) {
            return "{\"t\":null,\"ts\":\"\",\"facility\":null,\"level\":null,\"proc\":null,\"pid\":null,\"msg\":\"" esc(line) "\"}"
        }
        match(line, /^[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+/)
        ts = substr(line, 1, RLENGTH)
        after = substr(line, RLENGTH + 1)
        sub(/^ +[^ ]+ ?/, "", after)
        rest = after

        split(f[4], tm, ":")
        t = mktime(f[5] " " mon[f[2]] " " (f[3] + 0) " " (tm[1] + 0) " " (tm[2] + 0) " " (tm[3] + 0))
        t = (t > 0) ? sprintf("%d", t) : "null"

        split(f[6], fl, ".")
        fac = "\"" fl[1] "\""
        lv = fl[2]
        if (lv in lvmap) lv = "\"" lvmap[lv] "\""
        else lv = "null"

        proc = "null"
        pid = "null"
        msg = rest
        k = index(rest, ": ")
        if (k == 0 && length(rest) > 1 && substr(rest, length(rest)) == ":") {
            tag = substr(rest, 1, length(rest) - 1)
            msg = ""
        } else if (k > 0) {
            tag = substr(rest, 1, k - 1)
            msg = substr(rest, k + 2)
        } else {
            tag = ""
        }
        if (tag != "" && index(tag, " ") == 0 && length(tag) <= 64) {
            p = index(tag, "[")
            if (p > 0 && substr(tag, length(tag)) == "]") {
                pidtxt = substr(tag, p + 1, length(tag) - p - 1)
                tag = substr(tag, 1, p - 1)
                if (pidtxt ~ /^[0-9]+$/ && length(pidtxt) <= 10) pid = sprintf("%d", pidtxt + 0)
            }
            if (tag != "") proc = "\"" esc(tag) "\""
        } else {
            msg = rest
        }
        return "{\"t\":" t ",\"ts\":\"" esc(ts) "\",\"facility\":" fac ",\"level\":" lv ",\"proc\":" proc ",\"pid\":" pid ",\"msg\":\"" esc(msg) "\"}"
    }
    function kern_entry(line,   upv, rest) {
        upv = "0"
        rest = line
        if (match(line, /^\[ *[0-9.]+\]/)) {
            upv = substr(line, 2, RLENGTH - 2)
            gsub(/ /, "", upv)
            rest = substr(line, RLENGTH + 1)
            if (!(upv ~ /^[0-9]+$/ || upv ~ /^[0-9]+\.[0-9]+$/)) upv = "0"
            if (match(rest, /^\[ *[TC][0-9]+\] ?/)) rest = substr(rest, RLENGTH + 1)
            else if (substr(rest, 1, 1) == " ") rest = substr(rest, 2)
        }
        return "{\"up\":" upv ",\"msg\":\"" esc(rest) "\"}"
    }
    BEGIN {
        for (i = 1; i < 32; i++) bad[sprintf("%c", i)] = 1
        bad[sprintf("%c", 127)] = 1
        split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mn, " ")
        for (i = 1; i <= 12; i++) mon[mn[i]] = i
        lvmap["emerg"] = "emerg"; lvmap["panic"] = "emerg"
        lvmap["alert"] = "alert"; lvmap["crit"] = "crit"
        lvmap["err"] = "err"; lvmap["error"] = "err"
        lvmap["warn"] = "warning"; lvmap["warning"] = "warning"
        lvmap["notice"] = "notice"; lvmap["info"] = "info"; lvmap["debug"] = "debug"
    }
    {
        sub(/\r$/, "")
        buf[NR % max] = $0
    }
    END {
        cnt = (NR < max) ? NR : max
        printf "{\"success\":true,\"source\":\"%s\",\"now\":%s,\"uptime\":%s,\"total\":%d,\"entries\":[", mode, now, up_s, NR
        for (i = 0; i < cnt; i++) {
            line = buf[(NR - i) % max]
            printf "%s%s", (i ? "," : ""), (mode == "kernel") ? kern_entry(line) : sys_entry(line)
        }
        print "]}"
    }'
}

if [ "$SOURCE" = "kernel" ]; then
    dmesg 2>/dev/null | emit
else
    logread 2>/dev/null | emit
fi
exit 0

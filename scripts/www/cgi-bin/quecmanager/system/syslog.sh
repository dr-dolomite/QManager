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
#   {"success":true,"source":"kernel",...,"entries":[{"up","facility","level","msg"}]}
#   (kernel facility/level from dmesg -r, null when a line has no priority
#   prefix; user-space writers such as QCMAP log into the ring as "user")
#
# With kmsg=1 the kernel response also carries boot, this_boot and boots[]
# (LogBoot shape) from logd; a previous boot's response maps the kept kernel
# records into the same entry shape (oldest-first logq answer reversed), with
# `uptime` chosen so now - uptime + up lands on each record's own wall time.
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

qs_get boot
BOOT="${QS_VAL:-this}"
case "$BOOT" in
    this|prev) ;;
    ''|*[!0-9]*) cgi_error "invalid_param" "boot must be this, prev or a number"; exit 0 ;;
    ??????????*) cgi_error "invalid_param" "boot must be this, prev or a number"; exit 0 ;;
esac

QLOG_BIN="${QLOG_BIN:-/usr/bin/qlog}"
LOGD_PROTO="${LOGD_PROTO:-/var/run/qmanager_logd.proto}"

# kmsg_on -> 0 when logd captures kernel records (capability line kmsg=1).
kmsg_on() {
    local _l
    [ -x "$QLOG_BIN" ] && [ -f "$LOGD_PROTO" ] || return 1
    while IFS= read -r _l; do
        [ "$_l" = "kmsg=1" ] && return 0
    done < "$LOGD_PROTO" 2>/dev/null
    return 1
}

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
        # Fast path: most lines hold nothing to escape.
        if (index(s, "\\") == 0 && index(s, "\"") == 0 && s !~ /[[:cntrl:]]/) return s
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
    function kern_entry(line,   upv, rest, lv, fac, fi, pr) {
        upv = "0"
        lv = "null"
        fac = "null"
        # dmesg -r prefixes the raw priority, <facility*8 + level>.
        if (match(line, /^<[0-9]+>/) && RLENGTH <= 6) {
            pr = substr(line, 2, RLENGTH - 2) + 0
            lv = "\"" klv[pr % 8] "\""
            fi = int(pr / 8) ""
            if (fi in kfac) fac = "\"" kfac[fi] "\""
            line = substr(line, RLENGTH + 1)
        }
        rest = line
        if (match(line, /^\[ *[0-9.]+\]/)) {
            upv = substr(line, 2, RLENGTH - 2)
            gsub(/ /, "", upv)
            rest = substr(line, RLENGTH + 1)
            if (!(upv ~ /^[0-9]+$/ || upv ~ /^[0-9]+\.[0-9]+$/)) upv = "0"
            if (match(rest, /^\[ *[TC][0-9]+\] ?/)) rest = substr(rest, RLENGTH + 1)
            else if (substr(rest, 1, 1) == " ") rest = substr(rest, 2)
        }
        return "{\"up\":" upv ",\"facility\":" fac ",\"level\":" lv ",\"msg\":\"" esc(rest) "\"}"
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
        split("emerg alert crit err warning notice info debug", kl, " ")
        for (i = 1; i <= 8; i++) klv[i - 1] = kl[i]
        split("kern user mail daemon auth syslog lpr news uucp cron authpriv ftp", kf, " ")
        for (i = 1; i <= 12; i++) kfac[i - 1] = kf[i]
        for (i = 16; i <= 23; i++) kfac[i] = "local" (i - 16)
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

if [ "$SOURCE" = "kernel" ] && [ "$BOOT" != "this" ] && kmsg_on; then
    # A boot other than the running one (or the running one by number) comes
    # from the kept kernel records, never the live ring.
    ANS=$("$QLOG_BIN" logq source=kernel "boot=$BOOT" "limit=$LINES" 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$ANS" ]; then
        cgi_error "unavailable" "The kept kernel log could not be read"
        exit 0
    fi
    printf '%s
' "$ANS" | jq -c --argjson now "$NOW" --argjson up "$UPTIME" '
        (.entries // []) as $e
        | ([$e[] | select(.t != null) | (.t - .up)] | first) as $base
        | {success: true, source: "kernel", now: $now,
           uptime: (if $base == null then $up else ($now - $base) end),
           total: (.total // ($e | length)),
           boot: .boot, this_boot: .this_boot, boots: (.boots // []),
           entries: ($e | reverse | map({up: .up, facility: .facility, level: .priority,
                                         msg: .message, t: .t, tag: .tag}))}' 2>/dev/null || cgi_error "unavailable" "The kept kernel log could not be read"
    exit 0
fi

if [ "$SOURCE" = "kernel" ]; then
    # -r adds the priority prefix; a dmesg without -r falls back to plain lines.
    OUT=$({ dmesg -r 2>/dev/null || dmesg 2>/dev/null; } | emit)
    # Boot selector for the Logs tab: one cheap logd call when kmsg=1.
    FRAG=""
    if kmsg_on; then
        FRAG=$("$QLOG_BIN" logq source=kernel limit=1 2>/dev/null | jq -r '"\"boot\":\(.boot),\"this_boot\":\(.this_boot),\"boots\":\(.boots | tojson)"' 2>/dev/null)
    fi
    if [ -n "$FRAG" ] && [ -n "$OUT" ]; then
        printf '%s,%s}
' "${OUT%\}}" "$FRAG"
    else
        printf '%s
' "$OUT"
    fi
else
    logread 2>/dev/null | emit
fi
exit 0

#!/bin/sh
# ssrwatch_summary.sh: SSRs per hour by broker version from the watcher log.
# Hours come from hourly heartbeats (a partial hour is not counted), so the
# rate is approximate for short watches. Also lists every SSR and re-apply.

DIR=${SSRW_DIR:-/usrdata/ssr_watch}
LOG=$DIR/ssr.log
[ -f "$LOG" ] || { echo "no log at $LOG"; exit 1; }

cat "$LOG.1" "$LOG" 2>/dev/null | awk '
    function val(k,   i, p) {
        for (i = 1; i <= NF; i++) { p = index($i, "="); if (substr($i, 1, p - 1) == k) return substr($i, p + 1) }
        return ""
    }
    { ev = val("event"); v = val("atd"); if (v == "") v = "?" }
    ev == "start" { print "start: boot " val("boot") " up=" val("up") "s had " val("ssr_boot") " SSRs before the watcher (atd " v ")" }
    ev == "boot"  { boots++; print "boot:  new boot " val("boot") " (previous " val("prev") " ended with " val("prev_ssr") " SSRs)" }
    ev == "hb"    { hours[v]++ }
    ev == "ssr"   { ssr[v]++; print "ssr:   boot " val("boot") " up=" val("up") " #" val("crash") " atd " v " " val("reason") }
    ev == "reapply" { print "       reapply after SSR: sig=" val("sig") }
    END {
        print "--"
        for (v in hours) {
            r = hours[v] ? ssr[v] / hours[v] : 0
            printf "atd %s: %d SSRs in %d h (%.2f/h)\n", v, ssr[v], hours[v], r
        }
        for (v in ssr) if (!(v in hours)) printf "atd %s: %d SSRs, under 1 h observed\n", v, ssr[v]
        printf "reboots seen: %d\n", boots
    }'

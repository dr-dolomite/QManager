#!/bin/sh
# ssrwatch.sh: reboot-proof baseband SSR watcher (dev-only; build.sh never
# packages tools/). Run by procd through /etc/init.d/ssr_watch (respawn, no
# retry limit), BusyBox ash. Install: tools/ssr-watch/ssrwatch_install.sh.
#
# Every EVERY s it reads this boot's crash counter ("handling crash #N" in
# dmesg) and appends one line per new SSR to $DIR/ssr.log, then syncs. The
# counter, boot ID and running total live in $DIR/state (temp + sync + mv), so
# a reboot resumes the count. Lines are key=value, one event each:
#   start   first run: the SSRs this boot had before the watcher existed
#   boot    a new boot ID: the previous boot's last known counts
#   ssr     one baseband crash: crash=<#N this boot> total= atd= reason=
#   reapply REAPPLY s after an SSR: the broker's signal config state then
#   hb      hourly heartbeat (rate denominator): ssr_boot= total= atd= sig=
# Every line carries ts= (wall clock, can step on NITZ), up= and boot=.
# Rates: sh $DIR/bin/ssrwatch_summary.sh
#
# Start over: /etc/init.d/ssr_watch stop; rm -f $DIR/state $DIR/ssr.log*;
# /etc/init.d/ssr_watch start

DIR=${SSRW_DIR:-/usrdata/ssr_watch}
LOG=$DIR/ssr.log
STATE=$DIR/state
EVERY=${SSRW_EVERY:-60}
HB=${SSRW_HB:-3600}
REAPPLY=${SSRW_REAPPLY:-90}
CAP=524288
# Kernel ring reader; tests point it at a fake (BusyBox sh runs its own
# dmesg applet before PATH, so a shim alone is not enough).
DMESG=${SSRW_DMESG:-dmesg}

for _v in "$EVERY" "$HB" "$REAPPLY"; do
    case "$_v" in ''|*[!0-9]*) echo "ssrwatch: bad SSRW_* value" >&2; exit 2 ;; esac
done

up_s() { read -r _u _x < /proc/uptime; echo "${_u%%.*}"; }
boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null; }

# Highest crash number still in the ring (0 when none).
crash_count() {
    _c=$($DMESG 2>/dev/null | grep -o 'handling crash #[0-9]*' | tail -1)
    _c=${_c##*#}
    case "$_c" in ''|*[!0-9]*) _c=0 ;; esac
    echo "$_c"
}

# The newest fault reason, spaces folded so the line stays key=value.
crash_reason() {
    $DMESG 2>/dev/null | grep 'fatal error received:' | tail -1 |
        sed 's/.*fatal error received: *//; s/ *$//; s/[[:space:]][[:space:]]*/_/g; s/"//g' | cut -c1-120
}

atd_ver() {
    _a=$(grep '^version=' /var/run/qmanager_atd.proto 2>/dev/null)
    echo "${_a#version=}"
}

sig_state() {
    _s=$(jq -r '.qmi_sig_config // "none"' /tmp/qmanager_qmi.json 2>/dev/null)
    echo "${_s:-none}"
}

logl() {
    if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$CAP" ]; then
        mv -f "$LOG" "$LOG.1"
    fi
    echo "ts=$(date +%s) up=$(up_s) boot=${CUR_BOOT%%-*} $1" >> "$LOG"
    sync
}

load_state() {
    S_BOOT=""
    S_SEEN=0
    S_TOTAL=0
    [ -f "$STATE" ] || return 1
    while IFS='=' read -r _k _v; do
        case "$_k" in
            boot)  S_BOOT=$_v ;;
            seen)  S_SEEN=$_v ;;
            total) S_TOTAL=$_v ;;
        esac
    done < "$STATE"
    for _v in "$S_SEEN" "$S_TOTAL"; do
        case "$_v" in ''|*[!0-9]*) S_SEEN=0; S_TOTAL=0; return 1 ;; esac
    done
    return 0
}

save_state() {
    printf 'boot=%s\nseen=%s\ntotal=%s\n' "$S_BOOT" "$S_SEEN" "$S_TOTAL" > "$STATE.new" &&
        sync && mv -f "$STATE.new" "$STATE" && sync
}

mkdir -p "$DIR" || exit 1
CUR_BOOT=$(boot_id)
n=$(crash_count)

if ! load_state; then
    # First run: the crashes so far predate the watcher.
    S_BOOT=$CUR_BOOT
    S_SEEN=$n
    S_TOTAL=0
    logl "event=start ssr_boot=$n atd=$(atd_ver) sig=$(sig_state)"
    save_state
elif [ "$S_BOOT" != "$CUR_BOOT" ]; then
    logl "event=boot prev=${S_BOOT%%-*} prev_ssr=$S_SEEN total=$S_TOTAL atd=$(atd_ver)"
    S_BOOT=$CUR_BOOT
    S_SEEN=0
    save_state
fi

next_hb=$(( $(up_s) + HB ))
reapply_at=0

while :; do
    n=$(crash_count)
    # The ring can drop old lines; the counter never goes backwards.
    if [ "$n" -gt "$S_SEEN" ]; then
        why=$(crash_reason)
        i=$((S_SEEN + 1))
        while [ "$i" -le "$n" ]; do
            S_TOTAL=$((S_TOTAL + 1))
            # Only the newest crash's reason is certain to be the last line.
            r=unknown
            [ "$i" -eq "$n" ] && r=${why:-unknown}
            logl "event=ssr crash=$i total=$S_TOTAL atd=$(atd_ver) reason=$r"
            i=$((i + 1))
        done
        S_SEEN=$n
        save_state
        reapply_at=$(( $(up_s) + REAPPLY ))
    fi

    now=$(up_s)
    if [ "$reapply_at" -gt 0 ] && [ "$now" -ge "$reapply_at" ]; then
        logl "event=reapply sig=$(sig_state) atd=$(atd_ver)"
        reapply_at=0
    fi
    if [ "$now" -ge "$next_hb" ]; then
        logl "event=hb ssr_boot=$S_SEEN total=$S_TOTAL atd=$(atd_ver) sig=$(sig_state)"
        next_hb=$((now + HB))
    fi

    sleep "$EVERY" &
    wait $!
done

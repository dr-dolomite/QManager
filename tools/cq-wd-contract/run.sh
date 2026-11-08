#!/bin/sh
# =============================================================================
# run.sh - contract-test runner for the RM551E CGIs (spec 8, contracts 8)
# =============================================================================
# Feeds every fixture in fixtures/<endpoint>/*.json to the repo's own CGI
# (monitoring/connection_quality.sh, monitoring/watchdog.sh) and checks
# expect.shape / expect.equals with jq. After the fixtures it runs a few
# behaviour checks the neutral fixture format cannot express (what a save wrote,
# which flags it raised, which services it touched, that a GET writes nothing).
#
#   sh tools/cq-wd-contract/run.sh [-b BUSYBOX] [-j JQ] [-k] [FILTER]
#
#   -b  BusyBox binary the CGIs run under (default: busybox on PATH). Every
#       applet the CGIs call resolves to it, so the run exercises that version.
#   -j  jq binary (default: jq on PATH)
#   -k  keep the sandbox directory (printed) for inspection
#   FILTER  only fixtures whose name contains this text
#
# Sandbox: nothing outside a fresh temp dir is touched. The production files are
# copied there with their absolute paths (/usr/lib/qmanager/, /tmp/, /etc/qmanager,
# /etc/init.d/, /var/run/qmanager, /etc/config/quecmanager) rewritten to the
# sandbox, so the code under test is byte-for-byte what ships apart from those
# prefixes. `uci` is a stub (uci-stub.sh) first on PATH; the init script is a stub
# that logs its calls. Auth: the sandbox copy of each CGI gets `_SKIP_AUTH=1` on
# line 2 (the switch auth/login.sh itself sets); the shipped CGIs are never
# edited, so this cannot reach production.
#
# Fixture placeholders (setup.files, any string): "__MONO__" -> the sandbox
# uptime (a fresh ping/slots mono), "__NOW__" -> the epoch.
#
# Exit status: 0 when every fixture and check passes, 1 otherwise.
# =============================================================================

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FIXDIR="$HERE/fixtures"

BB="${BB:-}"
JQ="${JQ:-}"
KEEP=0
FILTER=""
while [ $# -gt 0 ]; do
    case "$1" in
        -b) BB="$2"; shift 2 ;;
        -j) JQ="$2"; shift 2 ;;
        -k) KEEP=1; shift ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) FILTER="$1"; shift ;;
    esac
done
[ -n "$BB" ] || BB=$(command -v busybox)
[ -n "$JQ" ] || JQ=$(command -v jq)
if [ -z "$BB" ] || [ -z "$JQ" ]; then
    echo "run.sh: busybox and jq are required (-b / -j)" >&2
    exit 2
fi
BB="$(cd "$(dirname "$BB")" && pwd)/$(basename "$BB")"
JQ="$(cd "$(dirname "$JQ")" && pwd)/$(basename "$JQ")"

SB=$(mktemp -d "${TMPDIR:-/tmp}/cqwd.XXXXXX") || exit 2
cleanup() {
    [ "$KEEP" = "1" ] && { echo "sandbox kept: $SB"; return 0; }
    rm -rf "$SB"
}
trap cleanup EXIT INT TERM

# --- Build the sandbox ---------------------------------------------------------
mkdir -p "$SB/bin" "$SB/usr/lib/qmanager" "$SB/cgi" "$SB/etc/init.d" "$SB/etc/config" "$SB/out" "$SB/in"
for a in $("$BB" --list); do
    case "$a" in '[['|'') continue ;; esac
    ln -s "$BB" "$SB/bin/$a"
done
ln -s "$JQ" "$SB/bin/jq"
: > "$SB/etc/config/quecmanager"

rewrite() {
    sed -e "s|/usr/lib/qmanager/|@SB@/usr/lib/qmanager/|g" \
        -e "s|/tmp/|@SB@/tmp/|g" \
        -e "s|/etc/qmanager|@SB@/etc/qmanager|g" \
        -e "s|/etc/init.d/|@SB@/etc/init.d/|g" \
        -e "s|/var/run/qmanager|@SB@/var/run/qmanager|g" \
        -e "s|/etc/config/quecmanager|@SB@/etc/config/quecmanager|g" \
        -e "s|@SB@|$SB|g"
}

for f in "$ROOT"/scripts/usr/lib/qmanager/*.sh; do
    rewrite < "$f" > "$SB/usr/lib/qmanager/$(basename "$f")"
done
for n in connection_quality watchdog; do
    src="$ROOT/scripts/www/cgi-bin/quecmanager/monitoring/$n.sh"
    { head -n 1 "$src"; echo "_SKIP_AUTH=1"; tail -n +2 "$src"; } | rewrite > "$SB/cgi/$n.sh"
done

{
    echo "#!$SB/bin/sh"
    echo "UCI_DIR=$SB/uci"
    cat "$HERE/uci-stub.sh"
} > "$SB/bin/uci"
chmod +x "$SB/bin/uci"

cat > "$SB/etc/init.d/qmanager_watchcat" <<EOF
#!$SB/bin/sh
echo "\$(basename "\$0") \$1" >> "$SB/svc.log"
[ "\$1" = "running" ] && [ -f "$SB/svc.running" ]
EOF
chmod +x "$SB/etc/init.d/qmanager_watchcat"

# From here every applet is the BusyBox under test.
PATH="$SB/bin"
export PATH

PASS=0
FAIL=0

reset_state() {
    rm -rf "$SB/tmp" "$SB/uci" "$SB/var" "$SB/etc/qmanager" "$SB/svc.log" "$SB/svc.running" "$SB/out"/*
    mkdir -p "$SB/tmp" "$SB/uci" "$SB/var/run/qmanager" "$SB/etc/qmanager"
}

uptime_int() {
    local up
    local rest
    read -r up rest < /proc/uptime
    printf '%s' "${up%%.*}"
}

# subst_file <jq filter> <fixture> <dest> [raw]: write the fixture value when it
# is not null, with the placeholders replaced.
put_file() {
    local up
    local now
    up=$(uptime_int)
    now=$(date +%s)
    if [ "$4" = "raw" ]; then
        jq -r "$1 | select(. != null)" "$2"
    else
        jq -c "$1 | select(. != null)" "$2"
    fi > "$SB/out/put.tmp" 2>/dev/null
    if [ -s "$SB/out/put.tmp" ]; then
        sed -e "s/\"__MONO__\"/$up/g" -e "s/__MONO__/$up/g" \
            -e "s/\"__NOW__\"/$now/g" -e "s/__NOW__/$now/g" "$SB/out/put.tmp" > "$3"
    fi
}

# seed <fixture>: reset the sandbox and load setup into the stub store (through
# the adapter's own routing) and the state files.
seed() {
    reset_state
    jq -r '
        def emit($sec):
            (.[$sec] // {}) | to_entries[] | select(.value != null)
            | if (.value | type) == "array" then
                "cfg_set_list \($sec) \(.key) \(.value | map(tostring | @sh) | join(" "))"
              elif (.value | type) == "boolean" then
                "cfg_set \($sec) \(.key) \(if .value then "1" else "0" end)"
              else "cfg_set \($sec) \(.key) \(.value | tostring | @sh)" end;
        .setup | emit("connection_quality"), emit("watchdog")' "$1" > "$SB/out/seed.sh"
    (
        . "$SB/usr/lib/qmanager/qm_platform_cqwd.sh"
        . "$SB/out/seed.sh"
        cfg_commit
    ) >/dev/null 2>&1
    put_file '.setup.files.status' "$1" "$SB/tmp/qmanager_watchcat.json"
    put_file '.setup.files.failover' "$1" "$SB/tmp/qmanager_sim_failover"
    put_file '.setup.files.ping' "$1" "$SB/tmp/qmanager_ping.json"
    put_file '.setup.files.slots' "$1" "$SB/tmp/qmanager_ping_slots.json"
    put_file '.setup.files.last_outage' "$1" "$SB/tmp/qmanager_last_outage" raw
}

# cgi <name> <METHOD> <query> <bodyfile|-> : run it, leave headers-stripped body
# in $SB/out/body and stderr in $SB/out/err.
cgi() {
    local len
    local bodyin
    bodyin=/dev/null
    len=""
    if [ "$4" != "-" ]; then
        bodyin="$4"
        len=$(wc -c < "$4")
    fi
    if [ -n "$len" ]; then
        env -i PATH="$SB/bin" REQUEST_METHOD="$2" QUERY_STRING="$3" CONTENT_LENGTH="$len" \
            "$SB/bin/sh" "$SB/cgi/$1.sh" < "$bodyin" > "$SB/out/raw" 2> "$SB/out/err"
    else
        env -i PATH="$SB/bin" REQUEST_METHOD="$2" QUERY_STRING="$3" \
            "$SB/bin/sh" "$SB/cgi/$1.sh" < "$bodyin" > "$SB/out/raw" 2> "$SB/out/err"
    fi
    sed '1,/^$/d' "$SB/out/raw" > "$SB/out/body"
}

# post <name> <json>: POST a JSON text
post() {
    printf '%s' "$2" > "$SB/in/body"
    cgi "$1" POST "" "$SB/in/body"
}

DEFS='
def tokok($v; $t):
    ($t | split("|")) as $ts | ($v | type) as $ty
    | any($ts[]; . as $x
        | ($x == "int" and $ty == "number" and ($v == ($v | floor)))
          or ($x == "num" and $ty == "number")
          or ($x == "str" and $ty == "string")
          or ($x == "bool" and $ty == "boolean")
          or ($x == "null" and $ty == "null")
          or ($x == "array" and $ty == "array")
          or ($x == "object" and $ty == "object"));
def present($root; f):
    (try ([path(f)] | .[0]) catch null) as $p
    | if $p == null then false else
        ($root | getpath($p[:-1])) as $par
        | if ($par | type) == "object" then ($par | has($p[-1]))
          elif ($par | type) == "array" then ($p[-1] < ($par | length))
          else false end
      end;
def chk($lbl; f; $tok): . as $root
    | if present($root; f) then
        (($root | f) as $v | if tokok($v; $tok) then empty
            else "shape \($lbl): got \($v | type), want \($tok)" end)
      else "shape \($lbl): missing" end;
def eq($lbl; f; $want): . as $root
    | if present($root; f) then
        (($root | f) as $v | if $v == $want then empty
            else "equals \($lbl): got \($v | tojson), want \($want | tojson)" end)
      else "equals \($lbl): missing" end;
'

# check_fixture <fixture>: prints the failures of the response in $SB/out/body
check_fixture() {
    local stmts
    if ! jq -e . "$SB/out/body" >/dev/null 2>&1; then
        echo "response is not a single JSON document"
        head -c 300 "$SB/out/raw" | sed 's/^/    raw: /'
        head -c 300 "$SB/out/err" | sed 's/^/    err: /'
        return 0
    fi
    stmts=$(jq -r '[
        (.expect.shape // {} | to_entries[] | "chk(\(.key | @json); \(.key); \(.value | @json))"),
        (.expect.equals // {} | to_entries[] | "eq(\(.key | @json); \(.key); \(.value | tojson))")
      ] | join(", ")' "$1")
    [ -n "$stmts" ] || return 0
    jq -r "$DEFS [ $stmts ] | .[]" "$SB/out/body" 2>&1
}

# tmp_snapshot: names and checksums of every file under the sandbox /tmp (flags,
# state files; the qlog file is the only legitimate write), to prove a rejected
# POST left them alone.
tmp_snapshot() {
    local f
    (cd "$SB/tmp" 2>/dev/null && find . -type f ! -name qmanager.log | sort | while read -r f; do
        printf '%s ' "$f"
        md5sum < "$f"
    done)
}

# --- Fixtures ------------------------------------------------------------------
for dir in connection_quality watchdog; do
    for fx in "$FIXDIR/$dir"/*.json; do
        [ -f "$fx" ] || continue
        name="$dir/$(basename "$fx" .json)"
        if [ -n "$FILTER" ]; then
            case "$name" in *"$FILTER"*) ;; *) continue ;; esac
        fi
        repo=$(jq -r '.repo // ""' "$fx")
        if [ -n "$repo" ] && [ "$repo" != "rm551e" ]; then
            continue
        fi
        seed "$fx"
        method=$(jq -r '.method' "$fx")
        query=$(jq -r '.query // ""' "$fx")
        if [ "$(jq -r '.body == null' "$fx")" = "true" ]; then
            bodyarg="-"
        else
            if [ "$(jq -r '.body | type == "object" and has("__raw")' "$fx")" = "true" ]; then
                jq -j '.body.__raw' "$fx" > "$SB/in/body"
            else
                jq -j '.body' "$fx" > "$SB/in/body"
            fi
            bodyarg="$SB/in/body"
        fi
        cp "$SB/uci/db" "$SB/out/db.before" 2>/dev/null || : > "$SB/out/db.before"
        tmp_snapshot > "$SB/out/tmp.before"
        cgi "$dir" "$method" "$query" "$bodyarg"
        errs=$(check_fixture "$fx")
        # A GET never writes: no store change, no staged copy, no reload flag.
        if [ "$method" = "GET" ]; then
            cp "$SB/uci/db" "$SB/out/db.after" 2>/dev/null || : > "$SB/out/db.after"
            cmp -s "$SB/out/db.before" "$SB/out/db.after" || errs="$errs
GET changed the config store"
            [ -f "$SB/uci/stage" ] && errs="$errs
GET left staged config"
            ls "$SB/tmp" 2>/dev/null | grep -q reload && errs="$errs
GET raised a reload flag"
        fi
        # A rejected POST (success false) writes nothing: no store change, nothing
        # staged, no flag or state file touched, no service call.
        if [ "$method" = "POST" ] && [ "$(jq -r '.expect.equals.".success" == false' "$fx")" = "true" ]; then
            cp "$SB/uci/db" "$SB/out/db.after" 2>/dev/null || : > "$SB/out/db.after"
            cmp -s "$SB/out/db.before" "$SB/out/db.after" || errs="$errs
rejected POST changed the config store"
            [ -f "$SB/uci/stage" ] && errs="$errs
rejected POST left staged config"
            tmp_snapshot > "$SB/out/tmp.after"
            cmp -s "$SB/out/tmp.before" "$SB/out/tmp.after" || errs="$errs
rejected POST changed a flag or state file"
            [ -s "$SB/svc.log" ] && errs="$errs
rejected POST called a service"
        fi
        if [ -z "$errs" ]; then
            PASS=$((PASS + 1))
            [ -n "${VERBOSE:-}" ] && echo "PASS $name"
        else
            FAIL=$((FAIL + 1))
            echo "FAIL $name"
            printf '%s\n' "$errs" | sed 's/^/    /'
        fi
    done
done

# --- Behaviour checks (what the fixture format cannot express) ------------------
# ok <label> <condition-command...>
expect() {
    local label
    label="$1"
    shift
    if "$@"; then
        PASS=$((PASS + 1))
        [ -n "${VERBOSE:-}" ] && echo "PASS check: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL check: $label"
    fi
}
store_has() { grep -q "$(printf '%s\t%s\t%s' "$1" "$2" "$3")" "$SB/uci/db"; }
store_lacks() { ! grep -q "$(printf '%s\t%s' "$1" "$2")" "$SB/uci/db"; }
list_is() { [ "$(grep "$(printf '^L\t%s\t' "$1")" "$SB/uci/db" | cut -f3 | tr '\n' ' ')" = "$2" ]; }
flag() { [ -f "$SB/tmp/$1" ]; }
noflag() { [ ! -f "$SB/tmp/$1" ]; }
svc_is() { [ "$(cat "$SB/svc.log" 2>/dev/null | tr '\n' ',')" = "$1" ]; }
no_svc() { [ ! -s "$SB/svc.log" ]; }
resp() { jq -e "$1" "$SB/out/body" >/dev/null 2>&1; }
db_unchanged() { [ -f "$SB/uci/db" ] || : > "$SB/uci/db"; cmp -s "$SB/out/db.before" "$SB/uci/db" && [ ! -f "$SB/uci/stage" ]; }


if [ -z "$FILTER" ] || [ "$FILTER" = "behaviour" ]; then
    # save_probe on an empty store: creates the section, writes new keys only
    reset_state
    post connection_quality '{"action":"save_probe","sensitivity":"quiet","targets":["9.9.9.9","8.8.4.4","2001:4860:4860::8888","example.org"]}'
    expect "save_probe stores sensitivity" store_has S ping_profile.sensitivity quiet
    expect "save_probe stores the targets as a list" list_is ping_profile.targets "9.9.9.9 8.8.4.4 2001:4860:4860::8888 example.org "
    expect "save_probe raises the ping flag only" flag qmanager_ping_reload
    expect "save_probe leaves the other flags" noflag qmanager_quality_reload
    expect "save_probe leaves nothing staged" test ! -f "$SB/uci/stage"
    cgi connection_quality GET "" -
    expect "GET after save_probe reflects it" resp '.settings.sensitivity == "quiet" and .settings.targets[3] == "example.org" and .cadence.interval_sec == 10 and .is_default == true'

    # rejected save_probe: nothing written, no flag
    reset_state
    cp "$SB/uci/db" "$SB/out/db.before" 2>/dev/null || : > "$SB/out/db.before"
    post connection_quality '{"action":"save_probe","sensitivity":"quiet","targets":["1.1.1.1","8.8.8.8;reboot","2606:4700:4700::1111","cloudflare.com"]}'
    expect "rejected save_probe is invalid_field targets[1]" resp '.error == "invalid_field" and .field == "targets[1]"'
    expect "rejected save_probe writes nothing" db_unchanged
    expect "rejected save_probe raises no flag" noflag qmanager_ping_reload

    # save_thresholds: custom kept when a named preset is saved, both flags raised
    reset_state
    post connection_quality '{"action":"save_thresholds","latency":{"preset":"custom","custom_ms":400},"loss":{"preset":"standard"}}'
    expect "save_thresholds stores custom" store_has S quality_thresholds.latency_custom_ms 400
    expect "save_thresholds raises the poller flag" flag qmanager_quality_reload
    expect "save_thresholds raises the watchdog flag" flag qmanager_watchcat_reload
    expect "save_thresholds leaves the ping flag" noflag qmanager_ping_reload
    post connection_quality '{"action":"save_thresholds","latency":{"preset":"tolerant"},"loss":{"preset":"standard"}}'
    expect "named preset keeps the stored custom value" store_has S quality_thresholds.latency_custom_ms 400
    cgi connection_quality GET "" -
    expect "GET reports tolerant with the kept custom" resp '.settings.latency.preset == "tolerant" and .settings.latency.custom_ms == 400 and .is_default == false'

    # live status: fresh cache, slots, last outage
    reset_state
    now=$(date +%s)
    up=$(uptime_int)
    printf '{"timestamp":%s,"mono":%s,"sensitivity":"relaxed","targets":["a","b","c","d"],"interval_sec":5,"fail_secs":20,"recover_secs":10,"last_rtt_ms":12.5,"reachable":true,"streak_success":3,"streak_fail":0,"fail_elapsed_sec":0,"during_recovery":false,"last_family":"ipv4","last_leg":2,"cycle_ms":40}\n' "$now" "$up" > "$SB/tmp/qmanager_ping.json"
    printf '{"mono":%s,"slots":[{"state":"miss","rtt_ms":null},{"state":"ok","rtt_ms":9.5},{"state":"standby","rtt_ms":null},{"state":"standby","rtt_ms":null}]}\n' "$up" > "$SB/tmp/qmanager_ping_slots.json"
    cgi connection_quality GET "" -
    expect "live: fresh cache reports reachable, leg and slots" resp '.live.reachable == true and .live.last_leg == 2 and .live.slots[1].state == "ok" and .live.slots[1].rtt_ms == 9.5 and .live.slots[0].state == "miss"'
    printf '{"mono":1,"slots":[{"state":"ok","rtt_ms":1},{"state":"ok","rtt_ms":1},{"state":"ok","rtt_ms":1},{"state":"ok","rtt_ms":1}]}\n' > "$SB/tmp/qmanager_ping_slots.json"
    cgi connection_quality GET "" -
    expect "live: an old slots file reads as standby" resp '.live.reachable == true and .live.slots[0].state == "standby"'
    printf '{"timestamp":1,"mono":0,"reachable":true,"interval_sec":5,"last_leg":1}\n' > "$SB/tmp/qmanager_ping.json"
    cgi connection_quality GET "" -
    expect "live: a stale cache reads as unknown" resp '.live.reachable == null and .live.last_leg == 0 and .live.slots[2].state == "standby"'
    printf '42 1 true 203.0.113.9 -\n' > "$SB/tmp/qmanager_last_outage"
    cgi connection_quality GET "" -
    expect "last_outage: parsed from the outage file" resp '.last_outage.duration_s == 42 and (.last_outage.ended_ago_s | type == "number") and .last_outage.wan_changed == true'
    printf '42 99999999999 true x -\n' > "$SB/tmp/qmanager_last_outage"
    cgi connection_quality GET "" -
    expect "last_outage: an end stamp ahead of uptime reads as none" resp '.last_outage == null'
    printf 'junk\n' > "$SB/tmp/qmanager_last_outage"
    cgi connection_quality GET "" -
    expect "last_outage: garbage reads as none" resp '.last_outage == null'

    # watchdog save_settings: stored as 1/0 and numbers, reload flag, no service call
    reset_state
    post watchdog '{"action":"save_settings","act_after_sec":45,"quality_enabled":true,"tier1_enabled":false,"quality_after_sec":300}'
    expect "watchdog save stores ints" store_has S watchcat.act_after_sec 45
    expect "watchdog save stores bools as 1/0" store_has S watchcat.quality_enabled 1
    expect "watchdog save stores false as 0" store_has S watchcat.tier1_enabled 0
    expect "watchdog save raises the watchdog flag" flag qmanager_watchcat_reload
    expect "watchdog save without carrier leaves the poller flag" noflag qmanager_poller_reload
    expect "watchdog save without enabled touches no service" no_svc
    cgi watchdog GET "" -
    expect "watchdog GET reflects the save" resp '.settings.act_after_sec == 45 and .settings.quality_enabled == true and .settings.tier1_enabled == false and .settings.quality_after_sec == 300'

    # carrier keys: poller reload flag too
    reset_state
    post watchdog '{"action":"save_settings","carrier_enabled":true,"carrier_after_min":30}'
    expect "carrier save stores the toggle" store_has S watchcat.carrier_enabled 1
    expect "carrier save stores the minutes" store_has S watchcat.carrier_after_min 30
    expect "carrier save raises the poller flag" flag qmanager_poller_reload
    expect "carrier save raises the watchdog flag" flag qmanager_watchcat_reload

    # rejected save: two-pass, nothing staged or written, no flag
    reset_state
    post watchdog '{"action":"save_settings","act_after_sec":45}'
    cp "$SB/uci/db" "$SB/out/db.before"
    rm -f "$SB/tmp/qmanager_watchcat_reload"
    post watchdog '{"action":"save_settings","act_after_sec":60,"step_wait_sec":9}'
    expect "rejected watchdog save reports step_wait_sec" resp '.error == "invalid_field" and .field == "step_wait_sec" and (.detail | type == "string")'
    expect "rejected watchdog save writes nothing" db_unchanged
    expect "rejected watchdog save raises no flag" noflag qmanager_watchcat_reload

    # slot handling
    reset_state
    post watchdog '{"action":"save_settings","tier3_enabled":true,"backup_sim_slot":1}'
    expect "tier3 + slot stored" store_has S watchcat.backup_sim_slot 1
    post watchdog '{"action":"save_settings","tier3_enabled":false,"backup_sim_slot":null}'
    expect "slot null deletes the key" store_lacks S watchcat.backup_sim_slot
    cgi watchdog GET "" -
    expect "GET reports a cleared slot as null" resp '.settings.backup_sim_slot == null and .settings.tier3_enabled == false'

    # enabled: service enable + start / stop + disable
    reset_state
    post watchdog '{"action":"save_settings","enabled":true}'
    sleep 1
    expect "enabled true enables and starts the service" svc_is "qmanager_watchcat enable,qmanager_watchcat running,qmanager_watchcat start,"
    reset_state
    : > "$SB/svc.running"
    post watchdog '{"action":"save_settings","enabled":true}'
    expect "enabled true on a running daemon does not start it" svc_is "qmanager_watchcat enable,qmanager_watchcat running,"
    reset_state
    post watchdog '{"action":"save_settings","enabled":false}'
    expect "enabled false stops and disables the service" svc_is "qmanager_watchcat stop,qmanager_watchcat disable,"

    # flags: revert_sim, retry_failback, dismiss_sim_swap
    reset_state
    post watchdog '{"action":"revert_sim"}'
    expect "revert_sim raises the revert flag" flag qmanager_watchcat_revert_sim
    post watchdog '{"action":"retry_failback"}'
    expect "retry_failback raises the retry flag" flag qmanager_watchcat_retry_failback
    expect "retry_failback answers success" resp '.success == true'
    printf '{"detected":true,"dismissed":false}\n' > "$SB/tmp/qmanager_sim_swap_detected"
    post watchdog '{"action":"dismiss_sim_swap"}'
    expect "dismiss_sim_swap marks the flag dismissed" jq -e ".dismissed == true" "$SB/tmp/qmanager_sim_swap_detected" >/dev/null

    # POST body cap: a CONTENT_LENGTH over 8192 or not a plain number is refused
    # before the body is read; an absent or zero length is still no_body.
    for cgi_name in connection_quality watchdog; do
        printf '{"action":"nope"}' > "$SB/in/body"
        for cl in 8193 9999 00008193 99999999999999999999 abc -1 "12 3" 1e3; do
            reset_state
            env -i PATH="$SB/bin" REQUEST_METHOD=POST QUERY_STRING="" CONTENT_LENGTH="$cl" \
                "$SB/bin/sh" "$SB/cgi/$cgi_name.sh" < "$SB/in/body" > "$SB/out/raw" 2> "$SB/out/err"
            sed '1,/^$/d' "$SB/out/raw" > "$SB/out/body"
            expect "$cgi_name: CONTENT_LENGTH '$cl' is payload_too_large" resp '.success == false and .error == "payload_too_large"'
        done
        for cl in "" 0; do
            reset_state
            env -i PATH="$SB/bin" REQUEST_METHOD=POST QUERY_STRING="" CONTENT_LENGTH="$cl" \
                "$SB/bin/sh" "$SB/cgi/$cgi_name.sh" < "$SB/in/body" > "$SB/out/raw" 2> "$SB/out/err"
            sed '1,/^$/d' "$SB/out/raw" > "$SB/out/body"
            expect "$cgi_name: CONTENT_LENGTH '$cl' is no_body" resp '.success == false and .error == "no_body"'
        done
        reset_state
        env -i PATH="$SB/bin" REQUEST_METHOD=POST QUERY_STRING="" CONTENT_LENGTH=0000017 \
            "$SB/bin/sh" "$SB/cgi/$cgi_name.sh" < "$SB/in/body" > "$SB/out/raw" 2> "$SB/out/err"
        sed '1,/^$/d' "$SB/out/raw" > "$SB/out/body"
        expect "$cgi_name: a zero-padded in-range CONTENT_LENGTH is read" resp '.error == "unknown_action"'
    done

    # GET of a garbage state file degrades to {} instead of failing
    reset_state
    printf 'not json' > "$SB/tmp/qmanager_watchcat.json"
    cgi watchdog GET "" -
    expect "garbage state file reads as {}" resp '.success == true and .status == {}'
fi

echo "cq-wd-contract: $PASS passed, $FAIL failed (busybox: $("$BB" 2>&1 | head -n 1))"
[ "$FAIL" -eq 0 ]

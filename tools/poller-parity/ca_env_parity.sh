#!/bin/sh
# ca_env_parity.sh: dev-only check of the poller's carrier sidecar (ca.env) and
# the gated deep-tier QCAINFO read (ca_env_publish, ca_deep_read,
# resolve_poller_config). Never installed (build.sh excludes tools/). POSIX sh,
# LF only; runs off-device in a scratch dir, never touching /var/run or /tmp
# state of a real poller. qcmd_exec_g is stubbed with a logging fake, so no AT
# command is ever sent.
#
# Usage: ca_env_parity.sh <qmanager_poller> <parse_at.sh> <qmi_merge.sh> <safe_tmp.sh>
#
# Proves:
#   - the toggle reads only a literal 1 from quecmanager.watchcat.carrier_enabled;
#   - the deep read runs only when every gate holds (tier deep, toggle on, serving
#     cell parsed and 5G-SA, mono readable, no scan/SIM-switch/long-running flag,
#     60 s spacing with one cycle of grain), and then sends exactly
#     AT+QCAINFO=1;+QCAINFO;+QCAINFO=0 once;
#   - ca.env layout, order, end marker, AT vs QMI source, NR count empty for QMI,
#     mono of the read, no leftover temp files;
#   - a failed, busy or non-QCAINFO reply writes nothing and leaves the CA fields
#     and the old file alone, and the retry is still spaced;
#   - unchanged values are not rewritten inside 10 s, changed ones are at once;
#   - the toggle off writes nothing and sends nothing;
#   - the call sites in poll_cycle (static greps).
# Exit 0 only when nothing failed.

POLLER="$1"; PARSE="$2"; QMIM="$3"; SAFE="$4"
[ -f "$POLLER" ] && [ -f "$PARSE" ] && [ -f "$QMIM" ] && [ -f "$SAFE" ] || {
    echo "usage: ca_env_parity.sh <qmanager_poller> <parse_at.sh> <qmi_merge.sh> <safe_tmp.sh>" >&2
    exit 2
}

qlog_debug() { :; }
qlog_info() { :; }
qlog_warn() { :; }
qlog_error() { :; }
qlog_state_change() { :; }

T="/tmp/pcx_ca.$$"
mkdir -p "$T/run" || exit 2
trap 'rm -rf "$T"' EXIT INT TERM

. "$PARSE"
. "$QMIM"
. "$SAFE"
# safe_tmp's trusted-file test wants uid 0; the scratch files are not root's.
qm_trusted_file() { [ -f "$1" ]; }

_lift() { # name
    sed -n "/^$1() {/,/^}/p" "$POLLER"
}
for _f in _ca_count ca_env_publish ca_deep_read resolve_poller_config; do
    _lift "$_f" > "$T/f.sh"
    [ -s "$T/f.sh" ] || { echo "cannot lift $_f from $POLLER"; exit 2; }
    . "$T/f.sh"
done

# Tunables come from the poller itself, so a changed constant is tested as shipped.
grep -E '^(CA_GATED_MIN_SEC|CA_ENV_REWRITE_SEC)=[0-9]+' "$POLLER" | sed 's/[[:space:]]*#.*//' > "$T/consts.sh"
. "$T/consts.sh"
[ -n "$CA_GATED_MIN_SEC" ] && [ -n "$CA_ENV_REWRITE_SEC" ] || { echo "cannot read tunables from $POLLER"; exit 2; }

PASS=0
FAIL=0
check() { # name expected actual
    if [ "$2" = "$3" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $1"
        echo "  want: [$2]"
        echo "  got : [$3]"
    fi
}

# --- fakes --------------------------------------------------------------------
AT_LOG="$T/at.log"
QR_REPLY=""
QR_RC=0
qcmd_exec_g() {
    echo "$1" >> "$AT_LOG"
    _QR="$QR_REPLY"
    return "$QR_RC"
}
UCI_CA=""
uci() { # -q get <key>
    case "$3" in
        quecmanager.watchcat.carrier_enabled) printf '%s\n' "$UCI_CA" ;;
    esac
    return 0
}
at_calls() {
    local _n=0
    local _l
    [ -f "$AT_LOG" ] || { echo 0; return; }
    while IFS= read -r _l; do _n=$((_n + 1)); done < "$AT_LOG"
    echo "$_n"
}
env_get() { # var: value of one assignment in ca.env, via a subshell source
    ( . "$CA_ENV" 2>/dev/null; eval "printf '%s' \"\${$1-<unset>}\"" )
}

CA_ENV="$T/run/ca.env"
LONG_FLAG="$T/long"
SIM_SWITCH_FLAG="$T/simsw"
POLL_INTERVAL=2

SA_REPLY='AT+QCAINFO=1;+QCAINFO;+QCAINFO=0
+QCAINFO: "PCC",636666,12,"NR5G BAND 41",1,272,1,3,636666,-90,-10,300
+QCAINFO: "SCC",520110,11,"NR5G BAND 41",1,495,1,3,520110,-92,-11,250

OK'
LTE_REPLY='+QCAINFO: "PCC",150,100,"LTE BAND 1",1,295,-93,-8,-67,26
+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,295,-94,-11,-75,0,0,-,-
+QCAINFO: "SCC",1850,50,"LTE BAND 7",1,295,-94,-11,-75,0,0,-,-

OK'
NSA_REPLY="$LTE_REPLY"'
+QCAINFO: "SCC",528030,8,"NR5G BAND 41",262,-86,-11,1846'

base() { # healthy deep SA state with the gate open
    CA_ENV_ENABLED=1
    ap_tier=deep
    network_type=5G-SA
    _QENG_PARSED=1
    _MONO_TOP=1000
    system_state=normal
    _CA_GATED_MONO=0
    _CA_ENV_MONO=0
    _CA_ENV_SIG=""
    _CA_READ_MONO=0
    ca_source="at"
    rm -f "$AT_LOG" "$LONG_FLAG" "$SIM_SWITCH_FLAG" "$CA_ENV"
    QR_REPLY="$SA_REPLY"
    QR_RC=0
    t2_ca_active=false; t2_ca_count=7; t2_nr_ca_active=false; t2_nr_ca_count=7
    t2_total_bandwidth_mhz=7; t2_bandwidth_details="sentinel"
    t2_carrier_components='[{"sentinel":1}]'
}

# --- 1. the toggle --------------------------------------------------------------
for _v in 1; do
    UCI_CA="$_v"; resolve_poller_config; check "toggle '$_v' on" "1" "$CA_ENV_ENABLED"
done
for _v in "" 0 2 01 yes true on " 1" "1 " "-1" "x1"; do
    UCI_CA="$_v"; resolve_poller_config; check "toggle '$_v' off" "0" "$CA_ENV_ENABLED"
done
# a reload re-arms the publisher (next read writes at once)
_CA_ENV_MONO=555; _CA_ENV_SIG="x"; UCI_CA=1; resolve_poller_config
check "reload resets throttle" "0|" "$_CA_ENV_MONO|$_CA_ENV_SIG"

# --- 2. the gate: open, then each condition closed in turn ----------------------
base
ca_deep_read
check "gate open: one AT call" "1" "$(at_calls)"
check "gate open: exact command" "AT+QCAINFO=1;+QCAINFO;+QCAINFO=0" "$(cat "$AT_LOG")"
check "gate open: ca.env written" "1" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"

closed() { # name: base state with one thing changed by the caller's eval string
    base
    eval "$2"
    ca_deep_read
    check "closed: $1 -> no AT" "0" "$(at_calls)"
    check "closed: $1 -> no ca.env" "0" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"
    check "closed: $1 -> CA fields untouched" "[{\"sentinel\":1}]" "$t2_carrier_components"
}
closed "tier active"        'ap_tier=active'
closed "tier idle"          'ap_tier=idle'
closed "toggle off"         'CA_ENV_ENABLED=0'
closed "network LTE"        'network_type=LTE'
closed "network NSA"        'network_type=5G-NSA'
closed "network empty"      'network_type=""'
closed "serving not parsed" '_QENG_PARSED=0'
closed "mono 0"             '_MONO_TOP=0'
closed "mono empty"         '_MONO_TOP=""'
closed "mono garbage"       '_MONO_TOP=12x'
closed "mono leading zero"  '_MONO_TOP=0900'
closed "long-running flag"  ': > "$LONG_FLAG"'
closed "SIM-switch flag"    ': > "$SIM_SWITCH_FLAG"'
closed "scan in progress"   'system_state=scan_in_progress'
closed "10 s since last"    '_CA_GATED_MONO=990'
closed "57 s since last"    '_CA_GATED_MONO=943'

# --- 3. spacing: 60 s with one cycle (POLL_INTERVAL) of grain -------------------
base
ca_deep_read                                  # 1000
_MONO_TOP=1050; ca_deep_read
check "spacing 50 s: still one call" "1" "$(at_calls)"
_MONO_TOP=1057; ca_deep_read
check "spacing 57 s: still one call" "1" "$(at_calls)"
_MONO_TOP=1058; ca_deep_read
check "spacing 58 s (one cycle grain): second call" "2" "$(at_calls)"
_MONO_TOP=1100; ca_deep_read
check "spacing 42 s after 1058: no call" "2" "$(at_calls)"
_MONO_TOP=1118; ca_deep_read
check "spacing 60 s after 1058: third call" "3" "$(at_calls)"

# --- 4. ca.env content, AT / SA ---------------------------------------------------
base
ca_deep_read
check "SA file content" "ca_mono='1000'
ca_source='at'
ca_rat='sa'
ca_lte_cc='0'
ca_nr_cc='2'
qm_sidecar_end='1'" "$(cat "$CA_ENV")"
check "SA status.json side effect: ca_source" "at" "$ca_source"
check "SA status.json side effect: read mono" "1000" "$_CA_READ_MONO"
check "SA status.json side effect: nr SCC count (PCC excluded there, included in ca.env)" "1" "$t2_nr_ca_count"
check "no temp files left" "ca.env" "$(ls "$T/run")"
check "ca.env mode" "-rw-r--r--" "$(ls -l "$CA_ENV" | cut -c1-10)"
check "var ca_mono" "1000" "$(env_get ca_mono)"
check "var ca_nr_cc" "2" "$(env_get ca_nr_cc)"

# --- 5. failed / busy / non-QCAINFO reads change nothing --------------------------
base
ca_deep_read
cp "$CA_ENV" "$T/ca.keep"
_comp_keep="$t2_carrier_components"
for _rc in 1 2 3; do
    _MONO_TOP=$((1000 + _rc * 100)); QR_RC=$_rc; QR_REPLY="$SA_REPLY"
    : > "$AT_LOG"
    ca_deep_read
    check "rc $_rc: attempted once" "1" "$(at_calls)"
    check "rc $_rc: ca.env untouched" "$(cat "$T/ca.keep")" "$(cat "$CA_ENV")"
    check "rc $_rc: CA fields untouched" "$_comp_keep" "$t2_carrier_components"
    check "rc $_rc: retry spaced from the attempt" "$_MONO_TOP" "$_CA_GATED_MONO"
done
_MONO_TOP=1500; QR_RC=0; QR_REPLY='OK'; : > "$AT_LOG"
ca_deep_read
check "reply without QCAINFO: attempted" "1" "$(at_calls)"
check "reply without QCAINFO: ca.env untouched" "$(cat "$T/ca.keep")" "$(cat "$CA_ENV")"
check "reply without QCAINFO: CA fields untouched" "$_comp_keep" "$t2_carrier_components"
QR_REPLY=""; _MONO_TOP=1600; ca_deep_read
check "empty reply: ca.env untouched" "$(cat "$T/ca.keep")" "$(cat "$CA_ENV")"

# --- 6. publisher: QMI source, LTE/NSA through AT, empty list ------------------------
base
ap_tier=active; network_type=LTE
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"},{"type":"SCC","technology":"LTE","band":"B3"}]'
_CA_READ_MONO=998
ca_env_publish qmi
check "QMI file content" "ca_mono='998'
ca_source='qmi'
ca_rat='lte'
ca_lte_cc='2'
ca_nr_cc=''
qm_sidecar_end='1'" "$(cat "$CA_ENV")"

base
network_type=5G-NSA
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"},{"type":"SCC","technology":"LTE","band":"B3"},{"type":"SCC","technology":"NR","band":"N41"}]'
_CA_READ_MONO=999
ca_env_publish qmi
check "QMI mixed (NSA): NR left empty, LTE counted" "qmi|nsa|2|" "$(env_get ca_source)|$(env_get ca_rat)|$(env_get ca_lte_cc)|$(env_get ca_nr_cc)"

base
ap_tier=active; network_type=5G-NSA; QR_REPLY="$NSA_REPLY"
parse_ca_info "$QR_REPLY"; _CA_READ_MONO=1000; ca_env_publish at
check "AT NSA: LTE 3, NR leg counted" "at|nsa|3|1" "$(env_get ca_source)|$(env_get ca_rat)|$(env_get ca_lte_cc)|$(env_get ca_nr_cc)"

base
ap_tier=active; network_type=LTE
parse_ca_info "$LTE_REPLY"; _CA_READ_MONO=1000; ca_env_publish at
check "AT LTE: 3 LTE, 0 NR" "at|lte|3|0" "$(env_get ca_source)|$(env_get ca_rat)|$(env_get ca_lte_cc)|$(env_get ca_nr_cc)"

base
t2_carrier_components='[]'; ca_env_publish at
check "empty list: nothing written" "0" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"
t2_carrier_components=''; ca_env_publish at
check "unparsed list: nothing written" "0" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"

base
_QENG_PARSED=0
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
ca_env_publish qmi
check "serving cell not parsed: rat unknown" "unknown" "$(env_get ca_rat)"
base
network_type=""
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
ca_env_publish qmi
check "no network type: rat unknown" "unknown" "$(env_get ca_rat)"

base
CA_ENV_ENABLED=0
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
ca_env_publish qmi
check "toggle off: nothing written" "0" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"
base
_MONO_TOP=0
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
ca_env_publish qmi
check "mono unreadable: nothing written" "0" "$([ -f "$CA_ENV" ] && echo 1 || echo 0)"

# --- 7. rewrite throttle ---------------------------------------------------------------
base
network_type=LTE
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"},{"type":"SCC","technology":"LTE","band":"B3"}]'
_CA_READ_MONO=1000; ca_env_publish qmi
_MONO_TOP=1004; _CA_READ_MONO=1004; ca_env_publish qmi
check "same values inside 10 s: not rewritten" "1000" "$(env_get ca_mono)"
_MONO_TOP=1010; _CA_READ_MONO=1010; ca_env_publish qmi
check "same values after 10 s: refreshed" "1010" "$(env_get ca_mono)"
_MONO_TOP=1012; _CA_READ_MONO=1012
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
ca_env_publish qmi
check "changed count: rewritten at once" "1012|1" "$(env_get ca_mono)|$(env_get ca_lte_cc)"
_MONO_TOP=1013; _CA_READ_MONO=1013; network_type=5G-NSA; ca_env_publish qmi
check "changed rat: rewritten at once" "1013|nsa" "$(env_get ca_mono)|$(env_get ca_rat)"
# unwritable target: the attempt is throttled and the signature not recorded
base
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1"}]'
CA_ENV="$T/no_such_dir/ca.env"
ca_env_publish qmi
check "write failure: not recorded as published" "" "$_CA_ENV_SIG"
check "write failure: attempt throttled" "1000" "$_CA_ENV_MONO"
CA_ENV="$T/run/ca.env"

# --- 8. toggle off: deep path is a no-op ---------------------------------------------------
base
CA_ENV_ENABLED=0
ca_deep_read
check "toggle off: no AT, no file" "0|0" "$(at_calls)|$([ -f "$CA_ENV" ] && echo 1 || echo 0)"

# --- 9. call sites (static) ----------------------------------------------------------------
_pc="$T/poll_cycle.sh"
_lift poll_cycle > "$_pc"
check "poll_cycle: AT publish after cache update" "1" "$(grep -c '^                    ca_env_publish at$' "$_pc")"
check "poll_cycle: QMI publish in the qmi_ca_build else" "1" "$(grep -c '^                ca_env_publish qmi$' "$_pc")"
check "poll_cycle: deep call in the non-deep else" "1" "$(grep -c '^            ca_deep_read$' "$_pc")"
check "poll_cycle: no other QCAINFO command" "1" "$(grep -c "AT+QCAINFO=1;+QCAINFO;+QCAINFO=0" "$_pc")"
check "ca_deep_read: the only other QCAINFO command" "1" "$(_lift ca_deep_read | grep -c "AT+QCAINFO=1;+QCAINFO;+QCAINFO=0")"
check "no AT+CFUN=1,1 in the new code" "0" "$( { _lift ca_deep_read; _lift ca_env_publish; } | grep -c 'CFUN=1,1')"

echo "RESULT ca_env: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]

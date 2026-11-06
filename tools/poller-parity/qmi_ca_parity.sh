#!/bin/sh
# qmi_ca_parity.sh: dev-only gate for the QMI carrier list (qmi_ca_build in
# qmi_merge.sh). Never installed (build.sh excludes tools/). POSIX sh, LF only;
# the authority is the device shell, but it also runs under dash.
#
# Usage: qmi_ca_parity.sh <parse_at.sh> <qmi_merge.sh>
#
# Feeds the same carrier set to both paths and compares:
#   - AT:  parse_ca_info on a QCAINFO reply, then qmi_ca_cache_update
#   - QMI: qmi_ca_build on a fake broker 0.7.0 qmi.env + fake QENG globals
# Every t2_* carrier global must be identical, except an LTE SCC's SINR: AT
# reports 0 there on this firmware, QMI publishes null. Then the decision table:
# each gate that must send the poller back to AT+QCAINFO is flipped in turn and
# qmi_ca_build must return 1 without touching the globals.
# Exit 0 only when nothing failed.

[ -f "$1" ] && [ -f "$2" ] || { echo "usage: $0 <parse_at.sh> <qmi_merge.sh>" >&2; exit 2; }

qlog_debug() { :; }
qlog_info() { :; }
qlog_warn() { :; }
qlog_error() { :; }
qlog_state_change() { :; }
qm_trusted_file() { [ -f "$1" ]; }

T=$(mktemp -d 2>/dev/null || echo "/tmp/qmi_ca_parity.$$")
mkdir -p "$T"
trap 'rm -rf "$T"' EXIT INT TERM
QMI_ENV="$T/qmi.env"
QMI_STAMP="$T/qmi.stamp"
QMI_SCAN_FLAG="$T/scan"
QMI_SIMSW_FLAG="$T/simsw"

. "$1"
. "$2"

PASS=0
FAIL=0
check() {
    if [ "$2" = "$3" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $1"
        echo "  want: $2"
        echo "  got : $3"
    fi
}

_UP=100000
_MONO_TOP="$_UP"
system_state=normal

# QCAINFO replies (live shapes, 2026-11-06).
AT_LTE='+QCAINFO: "PCC",150,100,"LTE BAND 1",1,295,-93,-8,-67,26
+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,295,-94,-11,-75,0,0,-,-'
AT_NSA="$AT_LTE
"'+QCAINFO: "SCC",528030,8,"NR5G BAND 41",262,-86,-11,1846'

# mkenv: a valid broker 0.7.0 sidecar for AT_LTE (PCC B1 + SCC B3), then the
# per-case edits via sed on the file.
mkenv() {
    cat > "$QMI_ENV" <<XEOF
qmi_mono='$_UP'
qmi_state='up'
qmi_ssr_count='0'
qmi_registered='1'
qmi_lte_pci='295'
qmi_lte_earfcn='150'
qmi_ca_count='2'
qmi_pcc_pci='295'
qmi_pcc_earfcn='150'
qmi_pcc_band='1'
qmi_pcc_bw_mhz='20'
qmi_scc1_pci='295'
qmi_scc1_earfcn='1350'
qmi_scc1_band='3'
qmi_scc1_bw_mhz='15'
qmi_scc1_active='1'
qmi_scc2_pci=''
qmi_scc2_earfcn=''
qmi_scc2_band=''
qmi_scc2_bw_mhz=''
qmi_scc2_active=''
qmi_scc3_pci=''
qmi_scc3_earfcn=''
qmi_scc3_band=''
qmi_scc3_bw_mhz=''
qmi_scc3_active=''
qmi_scc4_pci=''
qmi_scc4_earfcn=''
qmi_scc4_band=''
qmi_scc4_bw_mhz=''
qmi_scc4_active=''
qmi_pcc_rsrp='-93'
qmi_pcc_rsrq='-8'
qmi_pcc_rssi='-67'
qmi_pcc_sinr='26'
qmi_scc1_rsrp='-94'
qmi_scc1_rsrq='-11'
qmi_scc1_rssi='-75'
qmi_scc2_rsrp=''
qmi_scc2_rsrq=''
qmi_scc2_rssi=''
qmi_scc3_rsrp=''
qmi_scc3_rsrq=''
qmi_scc3_rssi=''
qmi_scc4_rsrp=''
qmi_scc4_rsrq=''
qmi_scc4_rssi=''
qmi_nr_pci=''
qmi_nr_arfcn=''
qmi_nr_endc=''
qm_sidecar_end='1'
XEOF
}

# envset <name> <value>: rewrite one key of the sidecar.
envset() { sed -i "s/^$1=.*/$1='$2'/" "$QMI_ENV"; }
# envdrop <name>: remove a key (a sidecar from an older broker).
envdrop() { sed -i "/^$1=/d" "$QMI_ENV"; }

fresh_load() { _QMI_OK=0; _qmi_calls=0; qmi_load; }

# QENG globals + caches back to "LTE only, nothing cached".
qeng_lte() {
    _QENG_PARSED=1
    network_type="LTE"
    lte_pci=295; lte_earfcn=150
    nr_pci=""; nr_arfcn=""
    system_state=normal
    _MONO_TOP="$_UP"
    qmi_ca_cache_reset
    rm -f "$QMI_SCAN_FLAG" "$QMI_SIMSW_FLAG"
}
qeng_nsa() {
    qeng_lte
    network_type="5G-NSA"
    nr_pci=262; nr_arfcn=528030
}

t2_reset() {
    t2_ca_active=false; t2_ca_count=0; t2_nr_ca_active=false; t2_nr_ca_count=0
    t2_total_bandwidth_mhz=0; t2_bandwidth_details=""; t2_carrier_components="[]"
    ca_source=at; _CA_READ_MONO=0
}
t2_dump() {
    printf '%s|%s|%s|%s|%s|%s' "$t2_ca_active" "$t2_ca_count" "$t2_nr_ca_active" \
        "$t2_nr_ca_count" "$t2_total_bandwidth_mhz" "$t2_bandwidth_details"
}

# AT result for a QCAINFO reply -> AT_T2 (scalars) and AT_CC (the JSON).
at_run() {
    t2_reset
    parse_ca_info "$1"
    qmi_ca_cache_update "$t2_carrier_components"
    AT_T2=$(t2_dump)
    AT_CC="$t2_carrier_components"
}
# AT's LTE SCC SINR is 0 on this firmware; the QMI path publishes null.
scc_sinr_null() {
    printf '%s' "$1" | sed 's/\("type":"SCC","technology":"LTE"[^}]*"sinr":\)[-0-9.]*}/\1null}/g'
}

echo "== LTE-only: PCC B1 + SCC B3"
qeng_lte
at_run "$AT_LTE"
echo "AT  : $AT_T2"
echo "AT  : $AT_CC"
qeng_lte; mkenv; fresh_load; t2_reset
qmi_ca_build; rc=$?
echo "QMI : $(t2_dump) src=$ca_source rc=$rc read_mono=$_CA_READ_MONO"
echo "QMI : $t2_carrier_components"
check "lte: build ok" "0" "$rc"
check "lte: scalars" "$AT_T2" "$(t2_dump)"
check "lte: carrier JSON (AT SCC sinr 0 -> null)" "$(scc_sinr_null "$AT_CC")" "$t2_carrier_components"
check "lte: ca_source" "qmi" "$ca_source"
check "lte: ca_read_mono = sidecar read time" "$_UP" "$_CA_READ_MONO"

echo "== LTE-only, PCC alone"
qeng_lte
at_run '+QCAINFO: "PCC",150,100,"LTE BAND 1",1,295,-93,-8,-67,26'
qeng_lte; mkenv; envset qmi_ca_count 1
for k in pci earfcn band bw_mhz active; do envset "qmi_scc1_$k" ""; done
for k in rsrp rsrq rssi; do envset "qmi_scc1_$k" ""; done
fresh_load; t2_reset; qmi_ca_build; rc=$?
check "pcc only: build ok" "0" "$rc"
check "pcc only: scalars" "$AT_T2" "$(t2_dump)"
check "pcc only: carrier JSON" "$AT_CC" "$t2_carrier_components"

echo "== NSA: LTE PCC + SCC B3 + NR SCC N41 from the AT cache"
qeng_nsa
at_run "$AT_NSA"
echo "AT  : $AT_T2"
echo "AT  : $AT_CC"
AT_NSA_T2="$AT_T2"; AT_NSA_CC="$AT_CC"
# The cache the poller holds after that AT read; QENG still shows the NR leg.
qeng_lte; network_type="5G-NSA"; nr_pci=262; nr_arfcn=528030
t2_reset; parse_ca_info "$AT_NSA"; qmi_ca_cache_update "$t2_carrier_components"
mkenv; fresh_load; t2_reset
_MONO_TOP=$((_UP + 3))
qmi_ca_build; rc=$?
echo "QMI : $(t2_dump) src=$ca_source rc=$rc"
echo "QMI : $t2_carrier_components"
check "nsa: build ok" "0" "$rc"
check "nsa: scalars" "$AT_NSA_T2" "$(t2_dump)"
check "nsa: carrier JSON" "$(scc_sinr_null "$AT_NSA_CC")" "$t2_carrier_components"
check "nsa: ca_source" "mixed" "$ca_source"

echo "== decision table (each must fall back to AT+QCAINFO: rc 1, globals untouched)"
# expect_at <name>: run the build on the current state, rc must be 1 and the
# t2_* globals must be exactly the pre-set markers.
expect_at() {
    t2_reset; t2_total_bandwidth_mhz=777; t2_carrier_components="MARK"; ca_source=at
    qmi_ca_build; rc=$?
    check "$1: falls back to AT" "1|777|MARK|at" "$rc|$t2_total_bandwidth_mhz|$t2_carrier_components|$ca_source"
}
expect_ok() {
    t2_reset
    qmi_ca_build; rc=$?
    check "$1: builds" "0|$2" "$rc|$ca_source"
}
fresh() { qeng_lte; mkenv; }
nsa_cached() {
    qeng_lte; network_type="5G-NSA"; nr_pci=262; nr_arfcn=528030
    t2_reset; parse_ca_info "$AT_NSA"; qmi_ca_cache_update "$t2_carrier_components"; mkenv
}

fresh; fresh_load; expect_ok "baseline LTE" qmi
nsa_cached; fresh_load; expect_ok "baseline NSA" mixed

fresh; fresh_load; _QENG_PARSED=0; expect_at "QENG not parsed this cycle"
fresh; : > "$QMI_SCAN_FLAG"; fresh_load; expect_at "scan flag"
fresh; : > "$QMI_SIMSW_FLAG"; fresh_load; expect_at "SIM-switch flag"
fresh; fresh_load; system_state=scan_in_progress; expect_at "scan_in_progress"
fresh; envset qmi_state down; fresh_load; expect_at "state down"
fresh; envset qmi_state unavailable; fresh_load; expect_at "state unavailable"
fresh; envset qmi_registered 0; fresh_load; expect_at "not registered"
fresh; envset qmi_registered ""; fresh_load; expect_at "registration unknown"
fresh; fresh_load; _MONO_TOP=$((_UP + 6)); expect_at "sidecar age 6 s"
fresh; fresh_load; _MONO_TOP=$((_UP + 5)); expect_ok "sidecar age 5 s" qmi
fresh; fresh_load; _MONO_TOP=$((_UP - 1)); expect_at "sidecar from the future"
fresh; fresh_load; _MONO_TOP=0; expect_at "no uptime"
rm -f "$QMI_ENV"; fresh; rm -f "$QMI_ENV"; fresh_load; expect_at "no sidecar"
fresh; sed -i '$d' "$QMI_ENV"; fresh_load; expect_at "truncated sidecar (no end marker)"

# Broker 0.6.x: the 0.7.0 names are absent, and stale values must not leak.
fresh; fresh_load
for k in qmi_pcc_rsrp qmi_pcc_rsrq qmi_pcc_rssi qmi_pcc_sinr qmi_scc1_rsrp qmi_scc1_rsrq qmi_scc1_rssi \
    qmi_scc2_rsrp qmi_scc2_rsrq qmi_scc2_rssi qmi_scc3_rsrp qmi_scc3_rsrq qmi_scc3_rssi \
    qmi_scc4_rsrp qmi_scc4_rsrq qmi_scc4_rssi qmi_nr_pci qmi_nr_arfcn qmi_nr_endc; do envdrop "$k"; done
fresh_load; expect_at "broker 0.6.x (no 0.7.0 keys, stale values unset)"
check "0.7.0 names unset after a 0.6.x load" "" "${qmi_pcc_rsrp+set}"

fresh; fresh_load; network_type="5G-SA"; expect_at "SA"
fresh; fresh_load; network_type="Unknown"; expect_at "unknown network type"
fresh; fresh_load; lte_pci=""; expect_at "QENG has no LTE PCI"
fresh; fresh_load; lte_earfcn=""; expect_at "QENG has no LTE EARFCN"
fresh; fresh_load; lte_pci=296; expect_at "QMI PCC PCI differs from QENG"
fresh; fresh_load; lte_earfcn=1300; expect_at "QMI PCC EARFCN differs from QENG"
fresh; envset qmi_pcc_pci ""; fresh_load; expect_at "QMI PCC PCI empty"
fresh; envset qmi_pcc_earfcn "x"; fresh_load; expect_at "QMI PCC EARFCN not numeric"
fresh; envset qmi_pcc_rsrp ""; fresh_load; expect_at "PCC RSRP empty"
fresh; envset qmi_pcc_rssi "abc"; fresh_load; expect_at "PCC RSSI not numeric"
fresh; envset qmi_pcc_sinr ""; fresh_load; expect_ok "PCC SINR empty (null)" qmi
fresh; envset qmi_scc1_rsrp ""; fresh_load; expect_ok "SCC signal empty (null)" qmi
fresh; envset qmi_scc1_rsrp "x"; fresh_load; expect_at "SCC signal garbage"
fresh; envset qmi_scc1_bw_mhz ""; fresh_load; expect_at "SCC slot half filled"
fresh; envset qmi_pcc_bw_mhz ""; fresh_load; expect_at "PCC bandwidth empty"
fresh; envset qmi_pcc_band "0"; fresh_load; expect_at "PCC band 0"
fresh; envset qmi_ca_count 3; fresh_load; expect_at "ca_count says an SCC was dropped"
fresh; envset qmi_ca_count ""; fresh_load; expect_at "ca_count empty"

# NR leg handling.
nsa_cached; fresh_load; nr_arfcn=528000; expect_at "NSA: NR ARFCN changed vs cache"
nsa_cached; fresh_load; nr_pci=263; expect_at "NSA: NR PCI changed vs cache"
nsa_cached; fresh_load; _MONO_TOP=$((_UP + 19)); sed -i "s/^qmi_mono=.*/qmi_mono='$((_UP + 19))'/" "$QMI_ENV"; fresh_load; expect_ok "NSA: cache 19 s old" mixed
nsa_cached; fresh_load; _MONO_TOP=$((_UP + 21)); sed -i "s/^qmi_mono=.*/qmi_mono='$((_UP + 21))'/" "$QMI_ENV"; fresh_load; expect_at "NSA: cache 21 s old"
nsa_cached; fresh_load; network_type="LTE"; expect_at "NR leg shown but network_type LTE"
qeng_nsa; mkenv; fresh_load; expect_at "NSA: no cache yet"
nsa_cached; fresh_load; qmi_ca_cache_reset; expect_at "NSA: cache reset after an AT failure"
nsa_cached; fresh_load
nr_arfcn=""; nr_pci=""; network_type="LTE"
expect_ok "NR leg gone: NR rows dropped" qmi
check "NR leg gone: no N41 in the list" "no" "$(case "$t2_carrier_components" in *N41*) echo yes ;; *) echo no ;; esac)"

# The cache itself: NR PCC / NR-CA / unreadable parses pin AT.
fresh; fresh_load
t2_reset; parse_ca_info '+QCAINFO: "PCC",528030,8,"NR5G BAND 41",1,262,-86,-11,-70,1846
+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,295,-94,-11,-75,0,0,-,-'
qmi_ca_cache_update "$t2_carrier_components"
expect_at "last AT parse had an NR PCC"
fresh; fresh_load
t2_reset; parse_ca_info "$AT_LTE
"'+QCAINFO: "SCC",528030,8,"NR5G BAND 41",262,-86,-11,1846
+QCAINFO: "SCC",521310,12,"NR5G BAND 41",263,-90,-12,1000'
qmi_ca_cache_update "$t2_carrier_components"
nr_pci=262; nr_arfcn=528030; network_type="5G-NSA"
expect_at "last AT parse had 2 NR rows (NR-CA)"
fresh; fresh_load; qmi_ca_cache_update ""; expect_at "last AT parse unreadable"
fresh; fresh_load; qmi_ca_cache_update "[]"; expect_ok "last AT parse empty []" qmi

echo "== NR cache details"
qmi_ca_cache_reset; _MONO_TOP=777
qmi_ca_cache_update '[{"type":"PCC","technology":"LTE","band":"B1","earfcn":150,"bandwidth_mhz":20,"pci":295,"rsrp":-93,"rsrq":-8,"rssi":-67,"sinr":26},{"type":"SCC","technology":"NR","band":"N41","earfcn":528030,"bandwidth_mhz":60,"pci":262,"rsrp":-86,"rsrq":-11,"rssi":null,"sinr":23.9}]'
check "cache: row" ',{"type":"SCC","technology":"NR","band":"N41","earfcn":528030,"bandwidth_mhz":60,"pci":262,"rsrp":-86,"rsrq":-11,"rssi":null,"sinr":23.9}' "$_QMC_NR_ROWS"
check "cache: id/mhz/det/mono/n" "528030|262|60| + N41: 60 MHz|777|1|0" "$_QMC_NR_ARFCN|$_QMC_NR_PCI|$_QMC_NR_MHZ|$_QMC_NR_DET|$_QMC_NR_MONO|$_QMC_NR_N|$_QMC_AT_ONLY"

echo
echo "RESULT qmi_ca_parity: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

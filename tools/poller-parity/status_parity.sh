#!/bin/sh
# status_parity.sh: dev-only status.json composer parity gate (ledger B5.29
# Phase C). Never installed (build.sh excludes tools/). Runs ON the device,
# BusyBox ash. POSIX sh, LF only.
#
# The poller composes /tmp/qmanager_status.json with a printf composer
# (_wc_compose_pf) and keeps the original jq composer as write_cache_jq. This
# proves the two emit the same JSON value for the same globals, that hostile
# modem text can never run code or break the document, and that write_cache's
# safety net (jq empty every 30 cycles, 10 minutes on the jq composer after a
# failure) behaves.
#
# Usage (poller file = the one under test, staged on the device):
#   status_parity.sh synthetic <poller> [iterations]  scenarios + seeded random
#   status_parity.sh hostile   <poller>               round-trip and no-eval checks
#   status_parity.sh safety    <poller>               write_cache safety net
#   status_parity.sh all       <poller> [iterations]  the three above
#   status_parity.sh arm                              live: start capturing (deployed poller)
#   status_parity.sh compare [dir]                    live: compare the captured pairs
#   status_parity.sh live [timeout_s]                 arm, wait for 200 pairs, compare
#
# The synthetic modes source the block between "BEGIN WC COMPOSER" and "END WC
# COMPOSER" of the poller (the composers, _wc_prepare, write_cache), with qlog,
# the clock and the on-demand loader shimmed. The live modes use the poller's
# own capture hook: while /var/run/qmanager/wc_parity exists, every write_cache
# also writes <n>.jq.json and <n>.pf.json (same globals) to /var/run/qmanager/wcp
# for n = 0..199, then removes the flag.
#
# Compared with: jq -S 'del(.timestamp,.mono,.last_successful_poll)'.
# Exit 0 only when nothing failed.

PH_FLAG=/var/run/qmanager/wc_parity
PH_LIVE=/var/run/qmanager/wcp
PH_DIFF='del(.timestamp,.mono,.last_successful_poll)'
PH_PASS=0
PH_FAIL=0
PH_SKIP=0
PH_FIRST=""

die() { echo "status_parity: $1" >&2; exit 2; }

# _norm <file> <out>: normalised form for comparison.
_norm() {
    jq -S "$PH_DIFF" "$1" > "$2" 2>/dev/null
}

# _pair <name> <jq.json> <pf.json>: count one comparison, remember the first diff.
_pair() {
    local _n="$1"
    if ! jq empty "$3" >/dev/null 2>&1; then
        PH_FAIL=$((PH_FAIL + 1))
        [ -z "$PH_FIRST" ] && PH_FIRST="$_n: printf output is not valid JSON ($(head -c 200 "$3" 2>/dev/null))"
        return 1
    fi
    if ! jq empty "$2" >/dev/null 2>&1; then
        # The jq composer itself failed (e.g. a non-numeric --argjson): nothing
        # to compare, the printf output was already checked for validity.
        PH_SKIP=$((PH_SKIP + 1))
        return 0
    fi
    _norm "$2" "$PH_TMP/a.norm"
    _norm "$3" "$PH_TMP/b.norm"
    if cmp -s "$PH_TMP/a.norm" "$PH_TMP/b.norm"; then
        PH_PASS=$((PH_PASS + 1))
        return 0
    fi
    PH_FAIL=$((PH_FAIL + 1))
    if [ -z "$PH_FIRST" ]; then
        # BusyBox has no diff; jq -S prints one key per line, so unmatched
        # lines on each side are the difference.
        PH_FIRST="$_n:
jq composer only:
$(grep -vxFf "$PH_TMP/b.norm" "$PH_TMP/a.norm" | head -n 10)
printf composer only:
$(grep -vxFf "$PH_TMP/a.norm" "$PH_TMP/b.norm" | head -n 10)"
    fi
    return 1
}

_report() {
    echo "RESULT $1: PASS=$PH_PASS FAIL=$PH_FAIL SKIP(jq composer failed)=$PH_SKIP"
    if [ -n "$PH_FIRST" ]; then
        echo "FIRST DIFF: $PH_FIRST"
    fi
    [ "$PH_FAIL" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Block loader and shims
# ---------------------------------------------------------------------------
ph_load() {
    PH_TMP="/tmp/pcx_sp.$$"
    mkdir -p "$PH_TMP" || die "cannot make $PH_TMP"
    trap 'rm -rf "$PH_TMP"' EXIT
    [ -f "$1" ] || die "no such poller file: $1"
    sed -n '/^# --- BEGIN WC COMPOSER/,/^# --- END WC COMPOSER/p' "$1" > "$PH_TMP/block.sh"
    [ -s "$PH_TMP/block.sh" ] || die "no WC COMPOSER block in $1"
    PH_LOG="$PH_TMP/qlog"
    : > "$PH_LOG"
    qlog_error() { printf 'ERROR %s\n' "$1" >> "$PH_LOG"; }
    qlog_info() { printf 'INFO %s\n' "$1" >> "$PH_LOG"; }
    mono_now_set() {
        _MONO=""
        { read -r _MONO _ph_idle < /proc/uptime; } 2>/dev/null
        _MONO="${_MONO%%.*}"
        case "$_MONO" in ''|*[!0-9]*) _MONO=0 ;; esac
    }
    load_ondemand_cache_gated() { :; }
    CACHE_FILE="$PH_TMP/status.json"
    CACHE_TMP="$PH_TMP/status.json.tmp"
    _WC_FAILS=0
    errors=""
    _NOW=""
    _MONO_TOP=""
    WC_PARITY_FLAG="$PH_TMP/no_such_flag"
    WC_PARITY_DIR="$PH_TMP/wcp"
    . "$PH_TMP/block.sh"
    WC_PARITY_FLAG="$PH_TMP/no_such_flag"
    WC_PARITY_DIR="$PH_TMP/wcp"
}

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------
sc_base() {
    _WC_TS=1760000000
    _WC_MONO=123456
    _WC_ERRJ='[]'
    system_state=normal
    modem_reachable=true
    t1_cfun=1
    network_type=5G-NSA
    t2_sim_slot=1
    t2_carrier="Globe Telecom"
    service_status=connected
    t2_ca_active=true
    t2_ca_count=2
    t2_nr_ca_active=true
    t2_nr_ca_count=1
    t2_total_bandwidth_mhz=140
    t2_bandwidth_details="B3: 20 MHz + n78: 100 MHz"
    t2_carrier_components=$(jq -n '[
        {"type":"PCC","technology":"LTE","band":"B3","earfcn":1300,"bandwidth_mhz":20,"pci":123,"rsrp":-95},
        {"type":"SCC","technology":"NR","band":"N78","arfcn":632640,"bandwidth_mhz":100,"pci":45,"rsrp":-98.5}
    ]')
    t2_apn="internet"
    t2_wan_ipv4="10.20.30.40"
    t2_wan_ipv6="2001:db8::1"
    t2_primary_dns="8.8.8.8"
    t2_secondary_dns="8.8.4.4"
    t2_primary_dns_v4="8.8.8.8"
    t2_primary_dns_v6="2001:4860:4860::8888"
    t2_secondary_dns_v4="8.8.4.4"
    t2_secondary_dns_v6="2001:4860:4860::8844"
    lte_state=connected
    lte_band="B3"
    lte_earfcn=1300
    lte_bandwidth=20
    lte_pci=123
    lte_cell_id=268435455
    lte_enodeb_id=1048575
    lte_sector_id=255
    lte_tac=12345
    lte_rsrp=-95
    lte_rsrq=-9
    lte_sinr=14.5
    lte_rssi=-65
    lte_ta=7
    nr_state=connected
    nr_band="N78"
    nr_arfcn=632640
    nr_pci=45
    nr_cell_id=68719476735
    nr_enodeb_id=262143
    nr_sector_id=255
    nr_tac=12345
    nr_rsrp=-98
    nr_rsrq=-11
    nr_sinr=10
    nr_scs=30
    nr_ta=12
    sig_lte_rsrp="[-95,-96,-99,-101]"
    sig_lte_rsrq="[-9,-10,-11,-12]"
    sig_lte_sinr="[14,13,9,8]"
    sig_nr_rsrp="[-98,-99,null,null]"
    sig_nr_rsrq="[-11,-12,null,null]"
    sig_nr_sinr="[10,9,null,null]"
    t1_temperature=52
    cpu_usage=7
    memory_used_mb=180
    memory_total_mb=480
    uptime_seconds=86400
    conn_uptime_seconds=4321
    boot_firmware="RM551EGL00AAR01A01M8G"
    boot_build_date="Mar 3 2026"
    boot_manufacturer="Quectel"
    boot_model="RM551E-GL"
    boot_imei="860000000000000"
    boot_imsi="515030000000000"
    boot_iccid="8963030000000000000"
    boot_phone_number="+639170000000"
    boot_lte_category="20"
    t2_mimo="4x4"
    boot_supported_lte_bands="1:3:5:7:8:20:28"
    boot_supported_nsa_nr5g_bands="41:78"
    boot_supported_sa_nr5g_bands="1:3:28:41:78"
    boot_supported_nrdc_nr5g_bands=""
    hw_lte_bands="1:2:3:4:5:7:8"
    hw_nsa_nr5g_bands="41:78"
    hw_sa_nr5g_bands="1:3:28:41:78"
    boot_qmanager_version="v0.1.32"
    boot_ippt_mode="disabled"
    boot_ippt_mac=""
    boot_ippt_nat="1"
    boot_ippt_usbnet="1"
    boot_ippt_dhcpv4dns="disabled"
    ap_tier=active
    conn_internet_available=true
    conn_status=connected
    conn_latency=34.2
    conn_avg_latency=36.1
    conn_min_latency=30.0
    conn_max_latency=48.9
    conn_jitter=3.4
    conn_packet_loss=0
    conn_ping_target="1.1.1.1"
    conn_history="[34.2,33.1,null,35.0,36.4]"
    conn_history_interval=5
    CONN_HISTORY_SIZE=60
    conn_during_recovery=false
    conn_profile=relaxed
    QUALITY_LAT_THRESHOLD=250
    QUALITY_LOSS_THRESHOLD=30
    dns_lookup_ms=12
    dns_resolver="192.168.225.1"
    conn_last_family=ipv4
    wc_enabled=true
    wc_state=monitoring
    wc_current_tier=0
    wc_failure_count=0
    wc_last_recovery_time=null
    wc_last_recovery_tier=null
    wc_total_recoveries=0
    wc_cooldown_remaining=0
    wc_reboots_this_hour=0
    _WC_HB_AGE=7
    _WC_HB_STALE=90
    sim_fo_active=false
    sim_fo_original_slot=null
    sim_fo_current_slot=null
    sim_fo_switched_at=null
    sim_swap_detected=false
    sim_swap_profile_id=""
    sim_swap_profile_name=""
    lte_source=at
    _QMI_READ_MONO=0
    _QMI_STATE=""
    _QMI_SSR=0
}

# Fixture families (the corpus the parser gate uses): each starts from sc_base.
sc_lte() {
    sc_base
    network_type=LTE
    t2_nr_ca_active=false; t2_nr_ca_count=0
    t2_ca_count=1
    t2_total_bandwidth_mhz=20
    t2_bandwidth_details="B3: 20 MHz"
    nr_state=unknown; nr_band=""
    nr_arfcn=""; nr_pci=""; nr_cell_id=""; nr_enodeb_id=""; nr_sector_id=""; nr_tac=""
    nr_rsrp=""; nr_rsrq=""; nr_sinr=""; nr_scs=""; nr_ta=""
    sig_nr_rsrp="[null,null,null,null]"; sig_nr_rsrq="[null,null,null,null]"; sig_nr_sinr="[null,null,null,null]"
}
sc_sa() {
    sc_base
    network_type=5G-SA
    t2_ca_active=false; t2_ca_count=0
    lte_state=unknown; lte_band=""
    lte_earfcn=""; lte_bandwidth=""; lte_pci=""; lte_cell_id=""; lte_enodeb_id=""; lte_sector_id=""
    lte_tac=""; lte_rsrp=""; lte_rsrq=""; lte_sinr=""; lte_rssi=""; lte_ta=""
    sig_lte_rsrp="[null,null,null,null]"; sig_lte_rsrq="[null,null,null,null]"; sig_lte_sinr="[null,null,null,null]"
    t2_carrier_components="[]"
}
sc_noservice() {
    sc_base
    system_state=normal
    modem_reachable=false
    _WC_ERRJ='["modem_timeout"]'
    network_type=""
    service_status=no_service
    t2_ca_active=false; t2_ca_count=0; t2_nr_ca_active=false; t2_nr_ca_count=0
    t2_total_bandwidth_mhz=0; t2_bandwidth_details=""; t2_carrier_components="[]"
    t2_carrier=""
    lte_state=unknown; lte_band=""; nr_state=unknown; nr_band=""
    lte_earfcn=""; lte_bandwidth=""; lte_pci=""; lte_cell_id=""; lte_enodeb_id=""; lte_sector_id=""
    lte_tac=""; lte_rsrp=""; lte_rsrq=""; lte_sinr=""; lte_rssi=""; lte_ta=""
    nr_arfcn=""; nr_pci=""; nr_cell_id=""; nr_enodeb_id=""; nr_sector_id=""; nr_tac=""
    nr_rsrp=""; nr_rsrq=""; nr_sinr=""; nr_scs=""; nr_ta=""
    sig_lte_rsrp="[null,null,null,null]"; sig_lte_rsrq="[null,null,null,null]"; sig_lte_sinr="[null,null,null,null]"
    sig_nr_rsrp="[null,null,null,null]"; sig_nr_rsrq="[null,null,null,null]"; sig_nr_sinr="[null,null,null,null]"
    t1_temperature=""
}
sc_cfun0() {
    sc_noservice
    modem_reachable=true
    _WC_ERRJ='[]'
    t1_cfun=0
    service_status=unknown
    t2_sim_slot=2
}
sc_simabsent() {
    sc_noservice
    _WC_ERRJ='["sim_not_inserted"]'
    t2_sim_status=absent
    t2_sim_slot=""
    boot_iccid=""; boot_imsi=""; boot_phone_number=""
    sim_swap_detected=true
    sim_swap_profile_id="p_123"
    sim_swap_profile_name="Home \"Fiber\" SIM"
}
sc_connunknown() {
    sc_base
    conn_internet_available=null
    conn_status=unknown
    conn_latency=null; conn_avg_latency=null; conn_min_latency=null; conn_max_latency=null
    conn_jitter=null; conn_packet_loss=0
    conn_ping_target=""; conn_history="[]"; conn_profile=""; conn_last_family=""
    dns_lookup_ms=null; dns_resolver=""
}
sc_deepstate() {
    sc_base
    ap_tier=deep
    system_state=scan_in_progress
    wc_enabled=false; wc_state=disabled
    sim_fo_active=true; sim_fo_original_slot=1; sim_fo_current_slot=2; sim_fo_switched_at=1759990000
    wc_last_recovery_time=1759999000; wc_last_recovery_tier=2; wc_total_recoveries=3
    wc_cooldown_remaining=45; wc_reboots_this_hour=1; wc_failure_count=4; wc_current_tier=2
}
sc_qmi() {
    # Deep tier between AT reads: LTE signal gap-filled from qmi.env.
    sc_base
    ap_tier=deep
    lte_source=qmi
    lte_rsrp=-89; lte_rsrq=-10; lte_rssi=-60
    _QMI_READ_MONO=123455
    _QMI_STATE=up
    _QMI_SSR=3
}
sc_qmidown() {
    sc_base
    _QMI_READ_MONO=120000
    _QMI_STATE=down
    _QMI_SSR=4
}
sc_qmiunavail() {
    sc_base
    _QMI_STATE=unavailable
}
sc_empties() {
    # Fields that have a default in both composers, set empty.
    sc_base
    t1_cfun=""; network_type=""; t2_sim_slot=""
    t2_total_bandwidth_mhz=""
    cpu_usage=""; memory_used_mb=""; memory_total_mb=""; uptime_seconds=""; conn_uptime_seconds=""
    ap_tier=""
    conn_packet_loss=""; conn_history=""; conn_history_interval=""
    CONN_HISTORY_SIZE=""; conn_during_recovery=""
    QUALITY_LAT_THRESHOLD=""; QUALITY_LOSS_THRESHOLD=""
    dns_lookup_ms=""
    wc_enabled=""; wc_state=""; wc_current_tier=""; wc_failure_count=""
    wc_last_recovery_time=""; wc_last_recovery_tier=""; wc_total_recoveries=""
    wc_cooldown_remaining=""; wc_reboots_this_hour=""; _WC_HB_AGE=""; _WC_HB_STALE=""
    sim_fo_active=""; sim_fo_original_slot=""; sim_fo_current_slot=""; sim_fo_switched_at=""
    sim_swap_detected=""
    conn_internet_available=""
    conn_latency=""; conn_avg_latency=""; conn_min_latency=""; conn_max_latency=""; conn_jitter=""
    t1_temperature=""
    lte_source=""; _QMI_READ_MONO=""; _QMI_STATE=""; _QMI_SSR=""
}

run_named() {
    local _s
    for _s in sc_base sc_lte sc_sa sc_noservice sc_cfun0 sc_simabsent sc_connunknown sc_deepstate sc_qmi sc_qmidown sc_qmiunavail sc_empties; do
        "$_s"
        write_cache_jq "$PH_TMP/a.json" 2>/dev/null
        _wc_compose_pf "$PH_TMP/b.json"
        _pair "$_s" "$PH_TMP/a.json" "$PH_TMP/b.json"
    done
    # The QMI Phase 2 keys exist in both composers with the scenario values.
    sc_qmi
    write_cache_jq "$PH_TMP/a.json" 2>/dev/null
    _wc_compose_pf "$PH_TMP/b.json"
    for _s in a b; do
        if jq -e '(.lte.source == "qmi") and (.device.qmi_read_mono == 123455) and (.device.qmi_state == "up") and (.device.qmi_ssr_count == 3) and (.lte.rsrp == -89) and (.network | has("ca_source") | not)' "$PH_TMP/$_s.json" >/dev/null 2>&1; then
            PH_PASS=$((PH_PASS + 1))
        else
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="qmi keys missing or wrong in $_s.json"
        fi
    done
}

# ---------------------------------------------------------------------------
# Seeded random scenarios: vary strings and numbers over nasty lists
# ---------------------------------------------------------------------------
PH_SEED=20261019
_rand() {
    PH_SEED=$(( (PH_SEED * 1103515245 + 12345) & 2147483647 ))
    _R=$(( (PH_SEED / 65536) % $1 ))
}

# _pick_str: _PS = one nasty string (index drawn from the seed).
_pick_str() {
    _rand 22
    case "$_R" in
        0)  _PS="" ;;
        1)  _PS="plain text" ;;
        2)  _PS='a"b' ;;
        3)  _PS='a\b' ;;
        4)  _PS='trailing\' ;;
        5)  _PS='\\double' ;;
        6)  _PS='"' ;;
        7)  _PS='\n literal' ;;
        8)  _PS=$(printf 'tab\there') ;;
        9)  _PS=$(printf 'cr\rhere') ;;
        10) _PS='line1
line2' ;;
        11) _PS=$(printf 'ctl\001x') ;;
        12) _PS=$(printf 'ctl\037x') ;;
        13) _PS=$(printf 'del\177x') ;;
        14) _PS=$(printf 'esc\033[0m') ;;
        15) _PS='$(id) `id` ${HOME}' ;;
        16) _PS='China Mobile 中国移动 café' ;;
        17) _PS="it's" ;;
        18) _PS='/ <script> & A' ;;
        19) _PS='  leading and trailing  ' ;;
        20) _PS='{"a":[1,2,3]}' ;;
        21) _PS=$(printf 'mix"\\\t\r\001end') ;;
    esac
}

# _pick_num: _PN = one numeric token. JSON-valid ones must round-trip; the
# jq-invalid ones (leading zero, text) are checked for validity only, so they
# are listed in _pick_bad instead.
_pick_num() {
    _rand 16
    case "$_R" in
        0)  _PN="" ;;
        1)  _PN="0" ;;
        2)  _PN="-1" ;;
        3)  _PN="-95" ;;
        4)  _PN="-110.5" ;;
        5)  _PN="14.5" ;;
        6)  _PN="268435455" ;;
        7)  _PN="68719476735" ;;
        8)  _PN="7.25" ;;
        9)  _PN="null" ;;
        10) _PN="0.5" ;;
        11) _PN="-0.5" ;;
        12) _PN="100" ;;
        13) _PN="3.0" ;;
        14) _PN="1234567" ;;
        15) _PN="52" ;;
    esac
}

PH_STR_VARS="t2_carrier t2_bandwidth_details t2_apn t2_wan_ipv4 t2_wan_ipv6 t2_primary_dns t2_secondary_dns t2_primary_dns_v4 t2_primary_dns_v6 t2_secondary_dns_v4 t2_secondary_dns_v6 lte_band nr_band boot_firmware boot_build_date boot_manufacturer boot_model boot_imei boot_imsi boot_iccid boot_phone_number boot_lte_category t2_mimo boot_supported_lte_bands boot_supported_nsa_nr5g_bands boot_supported_sa_nr5g_bands boot_supported_nrdc_nr5g_bands hw_lte_bands hw_nsa_nr5g_bands hw_sa_nr5g_bands boot_qmanager_version boot_ippt_mode boot_ippt_mac boot_ippt_nat boot_ippt_usbnet boot_ippt_dhcpv4dns conn_ping_target conn_profile conn_last_family dns_resolver sim_swap_profile_id sim_swap_profile_name service_status lte_state nr_state conn_status wc_state lte_source _QMI_STATE"
# Numeric fields that have a default in BOTH composers (empty is allowed).
PH_NUM_VARS="t1_cfun t2_sim_slot t2_total_bandwidth_mhz lte_earfcn lte_bandwidth lte_pci lte_cell_id lte_enodeb_id lte_sector_id lte_tac lte_rsrp lte_rsrq lte_sinr lte_rssi lte_ta nr_arfcn nr_pci nr_cell_id nr_enodeb_id nr_sector_id nr_tac nr_rsrp nr_rsrq nr_sinr nr_scs nr_ta t1_temperature cpu_usage memory_used_mb memory_total_mb uptime_seconds conn_uptime_seconds conn_latency conn_avg_latency conn_min_latency conn_max_latency conn_jitter conn_packet_loss conn_history_interval QUALITY_LAT_THRESHOLD QUALITY_LOSS_THRESHOLD dns_lookup_ms wc_current_tier wc_failure_count wc_last_recovery_time wc_last_recovery_tier wc_total_recoveries wc_cooldown_remaining wc_reboots_this_hour _WC_HB_AGE _WC_HB_STALE sim_fo_original_slot sim_fo_current_slot sim_fo_switched_at _QMI_READ_MONO _QMI_SSR"

run_random() {
    local _i=0
    local _cnt="$1"
    local _v
    local _k
    local _bases="sc_base sc_lte sc_sa sc_noservice sc_connunknown sc_deepstate sc_qmi"
    local _b
    local _nstr
    local _nnum
    set -- $PH_STR_VARS
    _nstr=$#
    set -- $PH_NUM_VARS
    _nnum=$#
    while [ "$_i" -lt "$_cnt" ]; do
        _rand 7
        _k=0
        for _b in $_bases; do
            [ "$_k" -eq "$_R" ] && break
            _k=$((_k + 1))
        done
        "$_b"
        # 6 random string fields and 8 random numeric fields per scenario.
        _k=0
        while [ "$_k" -lt 6 ]; do
            _rand "$_nstr"
            set -- $PH_STR_VARS
            shift "$_R"
            _v="$1"
            _pick_str
            [ -n "$_v" ] && eval "$_v=\$_PS"
            _k=$((_k + 1))
        done
        _k=0
        while [ "$_k" -lt 8 ]; do
            _rand "$_nnum"
            set -- $PH_NUM_VARS
            shift "$_R"
            _v="$1"
            _pick_num
            [ -n "$_v" ] && eval "$_v=\$_PN"
            _k=$((_k + 1))
        done
        _rand 4
        case "$_R" in
            0) conn_history="[]" ;;
            1) conn_history="[1.5,null,2,null,null,3.25]" ;;
            2) conn_history="[12.0,null]" ;;
        esac
        _rand 4
        case "$_R" in
            0) _WC_ERRJ='[]' ;;
            1) _jstr "modem_timeout"; _WC_ERRJ="[$_JV]" ;;
            2) _pick_str; _jstr "$_PS"; _WC_ERRJ="[$_JV]" ;;
        esac
        write_cache_jq "$PH_TMP/a.json" 2>/dev/null
        _wc_compose_pf "$PH_TMP/b.json"
        _pair "random#$_i" "$PH_TMP/a.json" "$PH_TMP/b.json"
        _i=$((_i + 1))
    done
}

# Values the old composer could not handle at all (jq exits 2): the printf
# composer must still emit valid JSON, with the field's default.
run_badnums() {
    local _bad
    local _f
    for _bad in "abc" "0123" "12abc" "1e5" "-" "." "1.2.3" "0x1F" " 5" "5 " "+5" "--5" "5-" ".5" "5." "NaN" "Infinity" "\$(id)"; do
        sc_base
        for _f in lte_rsrp nr_pci t1_temperature conn_latency cpu_usage wc_current_tier t1_cfun _QMI_READ_MONO _QMI_SSR; do
            eval "$_f=\$_bad"
        done
        _wc_compose_pf "$PH_TMP/b.json"
        if jq empty "$PH_TMP/b.json" >/dev/null 2>&1; then
            # Every poisoned numeric field must be a number or null, never text.
            if jq -e '[.lte.rsrp,.nr.pci,.device.temperature,.connectivity.latency_ms,.device.cpu_usage,.watchcat.current_tier,.network.cfun,.device.qmi_read_mono,.device.qmi_ssr_count] | all(. == null or type == "number")' "$PH_TMP/b.json" >/dev/null 2>&1; then
                PH_PASS=$((PH_PASS + 1))
            else
                PH_FAIL=$((PH_FAIL + 1))
                [ -z "$PH_FIRST" ] && PH_FIRST="badnum '$_bad': a poisoned numeric field is not a number or null"
            fi
        else
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="badnum '$_bad': not valid JSON"
        fi
    done
    # Poisoned arrays fall back to their defaults.
    sc_base
    sig_lte_rsrp="[1,abc]"; sig_nr_rsrp="not an array"; conn_history="[1,,2]"; t2_carrier_components="oops"
    t2_ca_active="maybe"; modem_reachable="nope"
    _wc_compose_pf "$PH_TMP/b.json"
    if jq -e '(.signal_per_antenna.lte_rsrp == [null,null,null,null]) and (.signal_per_antenna.nr_rsrp == [null,null,null,null]) and (.connectivity.latency_history == []) and (.network.carrier_components == []) and (.network.ca_active == false) and (.modem_reachable == false)' "$PH_TMP/b.json" >/dev/null 2>&1; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1))
        [ -z "$PH_FIRST" ] && PH_FIRST="poisoned arrays/booleans did not take their defaults: $(head -c 300 "$PH_TMP/b.json")"
    fi
}

# ---------------------------------------------------------------------------
# Hostile text: valid JSON, exact round trip, nothing executed
# ---------------------------------------------------------------------------
run_hostile() {
    local _n=0
    local _s
    local _pwn=/tmp/pp_pwned
    rm -f "$_pwn" "${_pwn}2" "${_pwn}3"
    for _n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
        case "$_n" in
            1)  _s='$(touch /tmp/pp_pwned)' ;;
            2)  _s='`touch /tmp/pp_pwned2`' ;;
            3)  _s='a"b\c' ;;
            4)  _s=$(printf 'tab\there') ;;
            5)  _s=$(printf 'cr\rhere') ;;
            6)  _s=$(printf 'ctl\001byte') ;;
            7)  _s='"; touch /tmp/pp_pwned3; echo "' ;;
            8)  _s='\"},"evil":{"x":"' ;;
            9)  _s=$(printf 'esc\033[31m\037\177') ;;
            10) _s='trailing backslash\' ;;
            11) _s='multi
line' ;;
            12) _s='{{ $x }} ${IFS} $((1+1)) *?[a-z]' ;;
            13) _s='日本語 café 😀' ;;
            14) _s="single'quote" ;;
            15) _s='%s %d \n \t' ;;
            16) _s='' ;;
        esac
        sc_base
        t2_carrier="$_s"
        t2_apn="$_s"
        sim_swap_profile_name="$_s"
        lte_source="$_s"
        _QMI_STATE="$_s"
        errors="$_s"
        _wc_prepare
        _wc_compose_pf "$PH_TMP/b.json"
        if ! jq empty "$PH_TMP/b.json" >/dev/null 2>&1; then
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: invalid JSON: $(head -c 300 "$PH_TMP/b.json")"
            continue
        fi
        printf '%s' "$_s" > "$PH_TMP/exp"
        jq -j '.network.carrier' "$PH_TMP/b.json" > "$PH_TMP/got"
        if ! cmp -s "$PH_TMP/exp" "$PH_TMP/got"; then
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: carrier did not round-trip"
            continue
        fi
        jq -j '.sim_swap.matching_profile_name' "$PH_TMP/b.json" > "$PH_TMP/got"
        cmp -s "$PH_TMP/exp" "$PH_TMP/got" || { PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: profile name did not round-trip"; continue; }
        jq -j '.device.qmi_state' "$PH_TMP/b.json" > "$PH_TMP/got"
        cmp -s "$PH_TMP/exp" "$PH_TMP/got" || { PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: qmi_state did not round-trip"; continue; }
        # lte.source falls back to at when empty.
        printf '%s' "${_s:-at}" > "$PH_TMP/exp_src"
        jq -j '.lte.source' "$PH_TMP/b.json" > "$PH_TMP/got"
        cmp -s "$PH_TMP/exp_src" "$PH_TMP/got" || { PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: lte.source did not round-trip"; continue; }
        jq -j '.errors[0] // ""' "$PH_TMP/b.json" > "$PH_TMP/got"
        if [ -n "$_s" ]; then
            cmp -s "$PH_TMP/exp" "$PH_TMP/got" || { PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: errors[0] did not round-trip"; continue; }
        fi
        # No injected key: the document keeps exactly the top-level keys it had.
        if [ "$(jq -c 'keys' "$PH_TMP/b.json")" != '["connectivity","device","errors","last_successful_poll","lte","modem_reachable","mono","network","nr","signal_per_antenna","sim","sim_failover","sim_swap","system_state","timestamp","watchcat"]' ]; then
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="hostile#$_n: top-level keys changed"
            continue
        fi
        # The jq composer must agree on the same input.
        write_cache_jq "$PH_TMP/a.json" 2>/dev/null
        _pair "hostile#$_n" "$PH_TMP/a.json" "$PH_TMP/b.json" || continue
    done
    errors=""
    for _s in "$_pwn" "${_pwn}2" "${_pwn}3"; do
        if [ -e "$_s" ]; then
            PH_FAIL=$((PH_FAIL + 1))
            [ -z "$PH_FIRST" ] && PH_FIRST="hostile: $_s exists, a modem string was executed"
            rm -f "$_s"
        else
            PH_PASS=$((PH_PASS + 1))
        fi
    done

    # Informational: a byte that is not valid UTF-8 (jq accepts it).
    sc_base
    t2_carrier=$(printf 'bad\377byte')
    _wc_compose_pf "$PH_TMP/b.json"
    if jq empty "$PH_TMP/b.json" >/dev/null 2>&1; then
        echo "info: invalid UTF-8 byte in a string: jq accepts the document"
    else
        echo "info: invalid UTF-8 byte in a string: jq REJECTS the document (the safety net would switch to the jq composer for 10 minutes)"
    fi
}

# ---------------------------------------------------------------------------
# Safety net: write_cache validates every WC_VALIDATE_EVERY cycles
# ---------------------------------------------------------------------------
run_safety() {
    local _real
    local _i
    sc_base
    _NOW=1760000000
    _MONO_TOP=""

    # 1. Healthy composer: the first write is validated and published.
    : > "$PH_LOG"
    rm -f "$CACHE_FILE"
    write_cache
    if [ -s "$CACHE_FILE" ] && jq empty "$CACHE_FILE" >/dev/null 2>&1 && [ "$_WC_JQ_LEFT" -eq 0 ]; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); PH_FIRST="safety: healthy first write not published (JQ_LEFT=$_WC_JQ_LEFT)"
    fi

    # 2. A broken composer: publish the good file, never the broken one, and
    # switch to the jq composer for WC_JQ_PENALTY cycles.
    _real=$(jq -c . "$CACHE_FILE")
    _wc_compose_pf() { printf '{"broken": [1,\n' > "$1"; }
    _WC_CHK=$((WC_VALIDATE_EVERY - 1))
    : > "$PH_LOG"
    write_cache
    if jq empty "$CACHE_FILE" >/dev/null 2>&1 && [ "$_WC_JQ_LEFT" -eq "$WC_JQ_PENALTY" ] \
        && grep -q 'invalid JSON' "$PH_LOG" && [ "$(grep -c ERROR "$PH_LOG")" -eq 1 ]; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="safety: broken composer was not caught (JQ_LEFT=$_WC_JQ_LEFT log=$(cat "$PH_LOG"))"
    fi
    if [ "$(jq -c '.network.carrier' "$CACHE_FILE")" = '"Globe Telecom"' ]; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="safety: published file is not the jq composition"
    fi

    # 3. During the penalty the jq composer is used (the broken one is not called).
    _i=0
    while [ "$_i" -lt $((WC_JQ_PENALTY - 1)) ]; do
        write_cache
        _i=$((_i + 1))
    done
    if jq empty "$CACHE_FILE" >/dev/null 2>&1 && [ "$_WC_JQ_LEFT" -eq 1 ]; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="safety: penalty countdown wrong (JQ_LEFT=$_WC_JQ_LEFT, want 1)"
    fi

    # 4. After the penalty the printf composer comes back and is validated on
    # its first cycle (still broken here -> penalised again, file still good).
    write_cache
    : > "$PH_LOG"
    write_cache
    if jq empty "$CACHE_FILE" >/dev/null 2>&1 && [ "$_WC_JQ_LEFT" -eq "$WC_JQ_PENALTY" ] && grep -q 'invalid JSON' "$PH_LOG"; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="safety: broken composer not re-caught after the penalty (JQ_LEFT=$_WC_JQ_LEFT)"
    fi

    # 5. A composer failure (rc != 0) keeps the previous file and counts fails.
    _wc_compose_pf() { return 1; }
    _WC_JQ_LEFT=0
    _WC_CHK=0
    _WC_FAILS=0
    : > "$PH_LOG"
    _real=$(jq -c . "$CACHE_FILE")
    write_cache
    write_cache
    if [ "$(jq -c . "$CACHE_FILE")" = "$_real" ] && [ "$_WC_FAILS" -eq 2 ] && [ "$(grep -c ERROR "$PH_LOG")" -eq 1 ] && [ ! -e "$CACHE_TMP" ]; then
        PH_PASS=$((PH_PASS + 1))
    else
        PH_FAIL=$((PH_FAIL + 1)); [ -z "$PH_FIRST" ] && PH_FIRST="safety: composer failure handling wrong (FAILS=$_WC_FAILS)"
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Live capture (needs the deployed poller)
# ---------------------------------------------------------------------------
live_arm() {
    [ -d /var/run/qmanager ] || die "/var/run/qmanager missing: is the poller running?"
    rm -rf "$PH_LIVE"
    mkdir -p "$PH_LIVE" || die "cannot make $PH_LIVE"
    : > "$PH_FLAG"
    echo "armed: $PH_FLAG (the deployed poller writes 200 pairs to $PH_LIVE, then removes the flag)"
}

live_compare() {
    local _dir="${1:-$PH_LIVE}"
    local _n=0
    local _miss=0
    PH_TMP="/tmp/pcx_sp.$$"
    mkdir -p "$PH_TMP" || die "cannot make $PH_TMP"
    trap 'rm -rf "$PH_TMP"' EXIT
    [ -d "$_dir" ] || die "no capture dir: $_dir"
    while [ "$_n" -lt 200 ]; do
        if [ -f "$_dir/$_n.jq.json" ] && [ -f "$_dir/$_n.pf.json" ]; then
            _pair "live#$_n" "$_dir/$_n.jq.json" "$_dir/$_n.pf.json"
        else
            _miss=$((_miss + 1))
        fi
        _n=$((_n + 1))
    done
    [ "$_miss" -eq 0 ] || echo "note: $_miss of 200 pairs missing (capture still running or the poller restarted)"
    _report live
}

live_wait() {
    local _t="${1:-600}"
    local _w=0
    live_arm
    while [ -f "$PH_FLAG" ] && [ "$_w" -lt "$_t" ]; do
        sleep 2
        _w=$((_w + 2))
    done
    [ -f "$PH_FLAG" ] && { rm -f "$PH_FLAG"; echo "timeout after ${_t}s: flag removed, comparing what exists"; }
    live_compare
}

# ---------------------------------------------------------------------------
case "$1" in
    synthetic)
        ph_load "$2"
        run_named
        run_random "${3:-300}"
        run_badnums
        _report synthetic
        ;;
    hostile)
        ph_load "$2"
        run_hostile
        _report hostile
        ;;
    safety)
        ph_load "$2"
        run_safety
        _report safety
        ;;
    all)
        ph_load "$2"
        _rc=0
        run_named
        run_random "${3:-300}"
        run_badnums
        _report synthetic || _rc=1
        PH_PASS=0; PH_FAIL=0; PH_SKIP=0; PH_FIRST=""
        run_hostile
        _report hostile || _rc=1
        PH_PASS=0; PH_FAIL=0; PH_SKIP=0; PH_FIRST=""
        run_safety
        _report safety || _rc=1
        exit "$_rc"
        ;;
    arm)     live_arm ;;
    compare) live_compare "$2" ;;
    live)    live_wait "$2" ;;
    *)
        sed -n '2,/^PH_FLAG/p' "$0" | sed '$d' | cut -c3-
        exit 2
        ;;
esac

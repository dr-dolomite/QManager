#!/bin/sh
# history_series_system.sh — System Health series (docs/features/history.md).
#
# Dot-sourced by history.sh inside the poller. The per-tick path reads the
# poller's globals with builtins only: no forks, no AT, no jq. Forks happen on
# rare edges only: one df per hour, one dmesg grep per modem crash, and the
# once-per-boot reboot classification (builtin reads of two small files).

HIST_SERIES="$HIST_SERIES system"
HIST_system_STATES="normal throttled"
HIST_system_FAULT=""
HIST_system_METRICS="cpu mem_pct mem_mb temp_c st_sys_used st_sys_size st_app_used st_app_size st_tmp_used st_tmp_size"
HIST_system_EVENTS="device_reboot modem_crash modem_recovered thermal_throttled thermal_recovered software_updated clock_stepped storage_low broker_restarted oom_kill imei_changed"
HIST_system_EVENTS_KEEP="device_reboot modem_crash modem_recovered thermal_throttled thermal_recovered"
HIST_system_PAIRS="modem_crash:modem_recovered thermal_throttled:thermal_recovered"
# Crash state survives a same-boot poller restart (system.ssr), so its
# recovery still comes: only a new boot closes an open crash (history.md §6).
HIST_system_RESUME="modem_crash"

# Overridable for tools/history-test/.
: "${HIST_SYS_CRASH_LOG:=/etc/qmanager/crash.log}"
: "${HIST_SYS_DF_PATHS:=/real_rootfs /usrdata /tmp}"
: "${HIST_SYS_DF_EVERY:=360}"
: "${HIST_SYS_ALIVE_EVERY:=30}"
: "${HIST_SYS_SSR_LOOKBACK:=60}"

_hsy_n=0        # samples since the poller started
_hsy_pm=""      # mono of the previous sample
_hsy_ssr=""     # SSR count baseline (empty = not taken yet)
_hsy_crash=0    # 1 while a modem crash is open
_hsy_ssr_ld=0   # RAM SSR state read once per poller run
_hsy_rb=0       # reboot classification done for this poller run

# _hsy_v VALUE LO HI -> _HI = integer within LO..HI, else empty (no reading).
_hsy_v() {
    _hist_int "$1"
    [ -n "$_HI" ] || return 0
    if [ "$_HI" -lt "$2" ] || [ "$_HI" -gt "$3" ]; then
        _HI=""
    fi
}

# _hsy_kb VALUE -> _HI = plain KiB count (no leading zero: ash reads it as octal).
_hsy_kb() {
    _HI="$1"
    case "$_HI" in
        ''|*[!0-9]*|0?*|???????????*) _HI="" ;;
    esac
}

# _hsy_storage: one df for the three areas, parsed with builtins. BusyBox df
# wraps a long filesystem name onto its own line; the numbers follow on the
# next line, starting with the size.
_hsy_storage() {
    local _f
    local _a
    local _b
    local _c
    local _d
    local _e
    local _g
    local _r
    local _sz
    local _us
    local _mp
    local _ar
    _f="$HIST_RUN/system.df"
    # shellcheck disable=SC2086
    df -k $HIST_SYS_DF_PATHS > "$_f" 2>/dev/null
    [ -f "$_f" ] || return 0
    while read -r _a _b _c _d _e _g _r; do
        case "$_a" in
            ''|*[!0-9]*)
                [ -n "$_b" ] || continue
                _sz="$_b"; _us="$_c"; _mp="$_g"
                ;;
            *)
                _sz="$_a"; _us="$_b"; _mp="$_e"
                ;;
        esac
        case "$_mp" in
            /real_rootfs) _ar="sys" ;;
            /usrdata) _ar="app" ;;
            /tmp) _ar="tmp" ;;
            *) continue ;;
        esac
        _hsy_kb "$_sz"
        [ -n "$_HI" ] && [ "$_HI" -gt 0 ] || continue
        _sz="$_HI"
        _hsy_kb "$_us"
        [ -n "$_HI" ] || continue
        eval "_HV_st_${_ar}_used=\$_HI; _HV_st_${_ar}_size=\$_sz"
    done < "$_f"
}

# The SSR baseline survives a poller restart in the same boot (RAM file), so
# a crash while the poller was down is still seen and an open one still closes.
_hsy_ssr_save() {
    printf '%s %s %s\n' "$_hist_boot" "$_hsy_ssr" "$_hsy_crash" > "$HIST_RUN/system.ssr" 2>/dev/null
}

_hsy_ssr_load() {
    local _b
    local _c
    local _o
    local _r
    _hsy_ssr_ld=1
    [ -n "$_hist_boot" ] && [ -f "$HIST_RUN/system.ssr" ] || return 0
    { read -r _b _c _o _r < "$HIST_RUN/system.ssr"; } 2>/dev/null
    [ "$_b" = "$_hist_boot" ] || return 0
    case "$_c" in ''|*[!0-9]*|0?*|???????????*) return 0 ;; esac
    _hsy_ssr="$_c"
    [ "$_o" = "1" ] && _hsy_crash=1
}

# _hsy_ssr_check MONO: modem crash onset / recovery from the QMI lane's SSR
# episode counter and lane state (qmi_merge.sh qmi_load, run this cycle).
_hsy_ssr_check() {
    local _m
    local _c
    local _on
    local _ts
    _m="$1"
    [ "${_QMI_OK:-0}" = "1" ] || return 0
    _c="${_QMI_SSR:-}"
    case "$_c" in ''|*[!0-9]*|0?*|???????????*) return 0 ;; esac
    [ "$_hsy_ssr_ld" = "1" ] || _hsy_ssr_load
    if [ -z "$_hsy_ssr" ]; then
        _hsy_ssr="$_c"
        _hsy_ssr_save
        return 0
    fi
    if [ "$_c" -gt "$_hsy_ssr" ]; then
        _hsy_ssr="$_c"
        if [ "$_hsy_crash" != "1" ]; then
            # Onset: the newest kernel fatal-error stamp (seconds since boot,
            # the mono clock) when it falls in this sample's window.
            _on="$_m"
            _ts=$(dmesg 2>/dev/null | grep -F '4080000.remoteproc-mss: fatal error received' | tail -n 1)
            _ts="${_ts#*\[}"
            _ts="${_ts%%\]*}"
            _ts="${_ts#"${_ts%%[! ]*}"}"
            _ts="${_ts%%.*}"
            case "$_ts" in
                ''|*[!0-9]*|0?*|???????????*) ;;
                *)
                    if [ "$_ts" -le "$_m" ] && [ $((_m - _ts)) -le "$HIST_SYS_SSR_LOOKBACK" ]; then
                        if [ -z "$_hsy_pm" ] || [ "$_ts" -ge "$_hsy_pm" ]; then
                            _on="$_ts"
                        fi
                    fi
                    ;;
            esac
            hist_event modem_crash "Modem crashed" error "$_on"
            _hsy_crash=1
        fi
        _hsy_ssr_save
    elif [ "$_c" -lt "$_hsy_ssr" ]; then
        # Broker restart or reboot: a new counter, not a crash.
        _hsy_ssr="$_c"
        if [ "$_hsy_crash" = "1" ]; then
            hist_event modem_recovered "Modem recovered" info "$_m"
            _hsy_crash=0
        fi
        _hsy_ssr_save
    fi
    if [ "$_hsy_crash" = "1" ] && [ "$_QMI_STATE" = "up" ]; then
        hist_event modem_recovered "Modem recovered" info "$_m"
        _hsy_crash=0
        _hsy_ssr_save
    fi
}

# _hsy_alive WALL: last-known-alive stamp for the next boot's offline time.
_hsy_alive() {
    printf '%s %s\n' "$1" "$_hist_boot" > "$HIST_STORE/system/alive" 2>/dev/null
}

# _hsy_reboot: once per boot, on the first trusted sample. Classifies the
# restart that led to this boot from crash.log and the alive stamp.
_hsy_reboot() {
    local _d
    local _mk
    local _ae
    local _ab
    local _r
    local _be
    local _lo
    local _ep
    local _ty
    local _rs
    local _c
    local _best
    local _bc
    local _off
    local _sev
    _hsy_rb=1
    [ -n "$_hist_boot" ] || return 0
    _d="$HIST_STORE/system"
    [ -d "$_d" ] || mkdir -p "$_d" 2>/dev/null
    _be="$_hist_off"
    if [ ! -f "$_d/boot" ]; then
        # First run after install: nothing to compare against.
        printf '%s\n' "$_hist_boot" > "$_d/boot" 2>/dev/null
        _hsy_alive $((_hist_pm + _hist_off))
        return 0
    fi
    _mk=""
    { read -r _mk _r < "$_d/boot"; } 2>/dev/null
    # A poller restart in the same boot: already recorded.
    [ "$_mk" = "$_hist_boot" ] && return 0
    _ae=""
    _ab=""
    _r=""
    [ -f "$_d/alive" ] && { read -r _ae _ab _r < "$_d/alive"; } 2>/dev/null
    case "$_ae" in ''|*[!0-9]*|0?*|???????????*) _ae="" ;; esac
    if [ -n "$_ae" ]; then
        # Torn or foreign stamp = unknown.
        if [ -n "$_r" ] || [ -z "$_mk" ] || [ "$_ab" != "$_mk" ] \
            || [ "$_ae" -lt "$HIST_SANE_EPOCH" ] || [ "$_ae" -ge "$_be" ]; then
            _ae=""
        fi
    fi
    if [ -n "$_ae" ]; then
        _lo=$((_ae - 60))
    else
        _lo=$((_be - 900))
    fi
    _best=""
    _bc=""
    if [ -f "$HIST_SYS_CRASH_LOG" ]; then
        while IFS='|' read -r _ep _ty _rs; do
            case "$_ep" in ''|*[!0-9]*|0?*|???????????*) continue ;; esac
            [ "$_ty" = "reboot" ] || continue
            case "$_rs" in
                user) _c="user" ;;
                scheduled) _c="scheduled" ;;
                update) _c="update" ;;
                tier4_escalation) _c="watchdog" ;;
                *) continue ;;
            esac
            [ "$_ep" -ge "$_lo" ] && [ "$_ep" -le "$_be" ] || continue
            if [ -z "$_best" ] || [ "$_ep" -ge "$_best" ]; then
                _best="$_ep"
                _bc="$_c"
            fi
        done < "$HIST_SYS_CRASH_LOG"
    fi
    if [ -n "$_best" ]; then
        _c="$_bc"
        _off=$((_be - _best))
        _sev="info"
    else
        _c="unexpected"
        _off="-"
        [ -n "$_ae" ] && _off=$((_be - _ae))
        _sev="error"
    fi
    # mono 0 = the moment this boot began (t = offset).
    hist_event device_reboot "cause=$_c off=$_off" "$_sev" 0 "cause=$_c;off=$_off"
    printf '%s\n' "$_hist_boot" > "$_d/boot" 2>/dev/null
    _hsy_alive $((_hist_pm + _hist_off))
}

hist_system_sample() {
    local _m
    local _t
    _HV_cpu=""
    _HV_mem_pct=""
    _HV_mem_mb=""
    _HV_temp_c=""
    _HV_st_sys_used=""
    _HV_st_sys_size=""
    _HV_st_app_used=""
    _HV_st_app_size=""
    _HV_st_tmp_used=""
    _HV_st_tmp_size=""
    _m="$_hist_pm"
    _hsy_n=$((_hsy_n + 1))
    _HS="normal"
    [ "$thermal_throttling" = "1" ] && _HS="throttled"

    _hsy_v "$cpu_usage" 0 100;           _HV_cpu="$_HI"
    _hsy_v "$memory_used_mb" 0 1048576;  _HV_mem_mb="$_HI"
    _hsy_v "$memory_total_mb" 1 1048576
    _t="$_HI"
    if [ -n "$_t" ] && [ -n "$_HV_mem_mb" ]; then
        _hsy_v $((_HV_mem_mb * 100 / _t)) 0 100;  _HV_mem_pct="$_HI"
    fi
    _hsy_v "${t1_temperature_max:-}" -40 150;     _HV_temp_c="$_HI"

    [ $(( (_hsy_n - 1) % HIST_SYS_DF_EVERY )) -eq 0 ] && _hsy_storage

    _hsy_ssr_check "$_m"

    if [ "$_hist_trusted" = "1" ]; then
        [ "$_hsy_rb" = "1" ] || _hsy_reboot
        if [ -n "$_hist_boot" ] && [ $((_hsy_n % HIST_SYS_ALIVE_EVERY)) -eq 0 ]; then
            _hsy_alive $((_m + _hist_off))
        fi
    fi
    _hsy_pm="$_m"
    return 0
}

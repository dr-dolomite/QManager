#!/bin/sh
# dump_globals.sh <parse_at.sh> <parser> <fixture>
#
# Runs ONE parser (with the poller's pre-processing) over ONE fixture in a
# fresh shell process and prints the resulting globals:
#   set | grep -E '^(lte_|nr_|t1_|t2_|sig_|qmi_|_qmo_|network_type=|service_status=|_cid_)' | sort
#
# qmi_ / _qmo_ (QMI gap-fill, qmi_merge.sh) are listed so a parser that ever
# touched them would show; parse_at.sh sets none of them.
#
# parser: serving_cell qrsrp qrsrq qsinr signal ca_info carrier sim_slot
#         sim_status tier2 temperature helpers
#
# Every name the poller initialises is pre-set to the sentinel SENT_<name>
# first, so "parser left the value unchanged" is visible. A sidecar file
# "<fixture>.env" (shell assignments) is sourced after the sentinels, e.g. to
# pin network_type / lte_state / nr_state for parse_ca_info reconciliation.
#
# temperature: parse_temperature reads /sys/class/thermal directly (hard-coded
# in parse_at.sh, so it cannot be redirected without editing the library). It
# therefore only means something LIVE on the device; parity.sh runs old/new
# back-to-back for it.
#
# helpers: fixture lines are "helper arg1 arg2..." (split on TABs if the line
# contains one, else on spaces). Tokens: <empty> = empty argument, <CR> = a
# carriage return. One call per line; output "helper(args)=<out> [rc=N]".
# _compute_cell_parts (global-setting) prints its _cid_* results instead.

PP_LIB=$1
PP_PARSER=$2
PP_FIX=$3

if [ -z "$PP_LIB" ] || [ -z "$PP_PARSER" ] || [ -z "$PP_FIX" ]; then
    echo "usage: dump_globals.sh <parse_at.sh> <parser> <fixture>" >&2
    exit 2
fi
[ -f "$PP_LIB" ] || { echo "no such lib: $PP_LIB" >&2; exit 2; }
[ -f "$PP_FIX" ] || { echo "no such fixture: $PP_FIX" >&2; exit 2; }

PP_HERE=${0%/*}
[ "$PP_HERE" = "$0" ] && PP_HERE=.
. "$PP_HERE/shim.sh"

trap 'rm -f /tmp/ppx_$$_*.tmp "${TMPDIR:-/tmp}/ppx_lib_$$.sh"' EXIT

pp_init_sentinels
[ -f "$PP_FIX.env" ] && . "$PP_FIX.env"
pp_source_lib "$PP_LIB"

# $( ) drops trailing newlines exactly as the poller's capture does; CRs stay.
PP_RAW=$(cat "$PP_FIX")

pp_dump() {
    # PARITY_CC_NORMALIZE=1: compare t2_carrier_components as JSON (jq -cS .)
    # instead of byte-wise, so pretty vs compact output of the same array is
    # equal. An empty value (old jq tonumber failure) stays empty.
    if [ "${PARITY_CC_NORMALIZE:-0}" = "1" ]; then
        set | grep -E '^(lte_|nr_|t1_|t2_|sig_|qmi_|_qmo_|network_type=|service_status=|_cid_)' | grep -v '^t2_carrier_components=' | sort
        printf '%s\n' '--- t2_carrier_components (jq -cS) ---'
        if [ -n "$t2_carrier_components" ]; then
            # Not JSON (e.g. the SENT_ sentinel left untouched): compare raw.
            printf '%s' "$t2_carrier_components" | jq -cS . 2>/dev/null ||
                printf 'RAW:%s\n' "$t2_carrier_components"
        else
            printf '%s\n' '<empty>'
        fi
        return
    fi
    set | grep -E '^(lte_|nr_|t1_|t2_|sig_|qmi_|_qmo_|network_type=|service_status=|_cid_)' | sort
    # The grep above is line-oriented (as in the poller's tap), so the multi-line
    # pretty-printed jq value of t2_carrier_components is cut after its first line.
    # Emit the full value too so fixtures compare the real JSON byte-for-byte.
    printf '%s\n' '--- t2_carrier_components (full) ---'
    printf '%s\n' "$t2_carrier_components"
}

case "$PP_PARSER" in
    serving_cell) pp_call_serving_cell "$PP_RAW" ;;
    qrsrp)        pp_call_qrsrp "$PP_RAW" ;;
    qrsrq)        pp_call_qrsrq "$PP_RAW" ;;
    qsinr)        pp_call_qsinr "$PP_RAW" ;;
    signal)       pp_call_signal "$PP_RAW" ;;
    ca_info)      pp_call_ca_info "$PP_RAW" ;;
    carrier)      pp_call_carrier "$PP_RAW" ;;
    sim_slot)     pp_call_sim_slot "$PP_RAW" ;;
    sim_status)   pp_call_sim_status "$PP_RAW" ;;
    tier2)        pp_call_tier2 "$PP_RAW" ;;
    temperature)  parse_temperature ;;
    helpers)
        PP_CR=$(printf '\r')
        PP_TAB=$(printf '\t')
        set -f
        while IFS= read -r PP_LINE || [ -n "$PP_LINE" ]; do
            PP_LINE=${PP_LINE%"$PP_CR"}
            case "$PP_LINE" in ''|'#'*) continue ;; esac
            case "$PP_LINE" in
                *"$PP_TAB"*) PP_IFS=$PP_TAB ;;
                *)           PP_IFS=' ' ;;
            esac
            OLDIFS=$IFS
            IFS=$PP_IFS
            set -- $PP_LINE
            IFS=$OLDIFS
            PP_FN=$1
            shift
            PP_SHOW=""
            PP_A1=""; PP_A2=""; PP_A3=""; PP_A4=""; PP_N=0
            for PP_ARG in "$@"; do
                [ "$PP_ARG" = "<empty>" ] && PP_ARG=""
                while :; do
                    case "$PP_ARG" in
                        *'<CR>'*) PP_ARG="${PP_ARG%%<CR>*}${PP_CR}${PP_ARG#*<CR>}" ;;
                        *) break ;;
                    esac
                done
                PP_N=$((PP_N + 1))
                case $PP_N in
                    1) PP_A1=$PP_ARG ;; 2) PP_A2=$PP_ARG ;; 3) PP_A3=$PP_ARG ;; 4) PP_A4=$PP_ARG ;;
                esac
                PP_SHOW="${PP_SHOW:+$PP_SHOW,}$PP_ARG"
            done
            case "$PP_FN" in
                _compute_cell_parts)
                    _cid_dec="UNSET" ; _cid_enb="UNSET" ; _cid_sec="UNSET"
                    if [ "$PP_N" -ge 2 ]; then
                        _compute_cell_parts "$PP_A1" "$PP_A2"
                    else
                        _compute_cell_parts "$PP_A1"
                    fi
                    PP_RC=$?
                    printf '%s=dec[%s] enb[%s] sec[%s] [rc=%s]\n' "$PP_FN($PP_SHOW)" "$_cid_dec" "$_cid_enb" "$_cid_sec" "$PP_RC"
                    ;;
                _sig_val|_antenna_to_json_array|_antenna_line_to_json|_hex_to_dec|map_scs_to_khz|_lte_rb_to_mhz|_nr_bw_to_mhz)
                    case $PP_N in
                        0) PP_OUT=$($PP_FN) ;;
                        1) PP_OUT=$($PP_FN "$PP_A1") ;;
                        2) PP_OUT=$($PP_FN "$PP_A1" "$PP_A2") ;;
                        3) PP_OUT=$($PP_FN "$PP_A1" "$PP_A2" "$PP_A3") ;;
                        *) PP_OUT=$($PP_FN "$PP_A1" "$PP_A2" "$PP_A3" "$PP_A4") ;;
                    esac
                    PP_RC=$?
                    printf '%s=[%s] [rc=%s]\n' "$PP_FN($PP_SHOW)" "$PP_OUT" "$PP_RC"
                    ;;
                *)
                    printf '%s=UNSUPPORTED\n' "$PP_FN($PP_SHOW)"
                    ;;
            esac
        done < "$PP_FIX"
        exit 0
        ;;
    *)
        echo "unknown parser: $PP_PARSER" >&2
        exit 2
        ;;
esac

pp_dump

#!/bin/sh
# gen_fixtures.sh [out_dir]   (POSIX sh; runs on the device or under Git Bash)
#
# Regenerates the synthetic fixture corpus byte-for-byte (CRLF framing exactly
# like the AT broker: echo line ends "\r\r\n", data lines end "\r\n"). The
# "live_a" fixtures are verbatim captures from the test modem (read-only AT);
# tier2__live_a has its phone number redacted to zeros.
#
# Framing styles seen from qcmd:
#   single   : ECHO\r\r\n  LINE\r\n ... \r\nOK\r\n          (QENG, QCAINFO)
#   compound : ECHO\r\r\n  LINE\r\n\r\n LINE\r\n\r\n OK\r\n  (a;b;c compounds)
#
# Sidecar "<fixture>.txt.env" files pin pre-parser globals (network_type, ...).

OUT=${1:-${0%/*}/fixtures}
mkdir -p "$OUT" || exit 1
N=0

single() {   # name echo line...
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\r\r\n' "$_e"
        for _l in "$@"; do printf '%s\r\n' "$_l"; done
        printf '\r\nOK\r\n'
    } > "$_f"
    N=$((N + 1))
}
compound() { # name echo line...
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\r\r\n' "$_e"
        for _l in "$@"; do printf '%s\r\n\r\n' "$_l"; done
        printf 'OK\r\n'
    } > "$_f"
    N=$((N + 1))
}
lfonly() {   # name echo line...   (no CRs at all)
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\n' "$_e"
        for _l in "$@"; do printf '%s\n' "$_l"; done
        printf '\nOK\n'
    } > "$_f"
    N=$((N + 1))
}
errreply() { # name echo errtext   (ECHO\r\r\n ERR\r\n)
    printf '%s\r\r\n%s\r\n' "$2" "$3" > "$OUT/$1.txt"
    N=$((N + 1))
}
emptyf() { : > "$OUT/$1.txt"; N=$((N + 1)); }
rawf()   { printf "$2" > "$OUT/$1.txt"; N=$((N + 1)); }   # name printf-format
envf()   { printf '%s\n' "$2" > "$OUT/$1.txt.env"; }       # name assignments

QE='AT+QENG="servingcell"'
QC='AT+QCAINFO'
QS='AT+QRSRP;+QRSRQ;+QSINR'
T2='AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?'

# ----------------------------------------------------------------- live_a --
single serving_cell__live_a "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,233B703,135,9485,28,5,5,BF82,-115,-12,-83,11,5,240,-'
single ca_info__live_a "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255,0,-,-'
compound signal__live_a "$QS" \
 '+QRSRP: -116,-116,-32768,-32768,LTE' \
 '+QRSRQ: -13,-13,-32768,-32768,LTE' \
 '+QSINR: 2,1,-32768,-32768,LTE'
compound tier2__live_a "$T2" \
 '+COPS: 0,0,"TNT",7' '+QUIMSLOT: 1' '+CNUM: ,"000000000000",129' '+CPIN: READY'

# ------------------------------------------------------------ serving_cell --
L='+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-'
single serving_cell__lte_noconn_fdd "$QE" "$L"
single serving_cell__lte_connect_tdd "$QE" \
 '+QENG: "servingcell","CONNECT","LTE","TDD",515,03,2D1AB04,271,40540,41,5,5,A1B2,-95,-9,-65,15,10,150,-'
single serving_cell__lte_limsrv "$QE" \
 '+QENG: "servingcell","LIMSRV","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-'
# exactly 17 fields: lte_sinr is the LAST field, so its trailing CR survives (cut -f17 of a CR-terminated line)
single serving_cell__lte_17fields_cr "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9'
single serving_cell__lte_16fields "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63'
single serving_cell__lte_10fields "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3'
single serving_cell__lte_trailing_comma "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,'
single serving_cell__lte_cellid_lower_hex "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2d1ab04,271,1300,3,5,5,a1b2,-92,-9,-63,9,0,240,-'
single serving_cell__lte_bad_hex "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,XYZ,271,1300,3,5,5,ZZ,-92,-9,-63,9,0,240,-'
single serving_cell__lte_empty_hex "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,,271,1300,3,5,5,,-92,-9,-63,9,0,240,-'
single serving_cell__lte_cellid_zero "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,0,271,1300,3,5,5,0,-92,-9,-63,9,0,240,-'
single serving_cell__lte_cellid_max28 "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,FFFFFFF,271,1300,3,5,5,FFFF,-92,-9,-63,9,0,240,-'
single serving_cell__lte_cellid_overflow "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,FFFFFFFFFFFFFFFFFFFF,271,1300,3,5,5,FFFFFFFFFFFFFFFFFFFF,-92,-9,-63,9,0,240,-'
single serving_cell__lte_0x_prefixed_hex "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,0x2D1AB04,271,1300,3,5,5,0xA1B2,-92,-9,-63,9,0,240,-'
single serving_cell__lte_dash_fields "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,-,-,-,-,-,-,-,-,-,-,-'
single serving_cell__lte_empty_fields "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",,,,,,,,,,,,,,,,'
single serving_cell__lte_spaces_in_fields "$QE" \
 '+QENG: "servingcell", "NOCONN", "LTE", "FDD", 515, 03, 2D1AB04, 271, 1300, 3, 5, 5, A1B2, -92, -9, -63, 9, 0, 240, -'
single serving_cell__lte_hostile "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,2$(id),13;00,`id`,5,5,A1B2,-9'"'"'2,-9",-6\3,9,0,240,-'
single serving_cell__lte_two_servingcell_lines "$QE" \
 "$L" \
 '+QENG: "servingcell","CONNECT","LTE","FDD",515,03,AAAAAAA,100,500,1,5,5,B1B1,-80,-8,-50,20,0,240,-'
single serving_cell__lte_no_servingcell_line "$QE" \
 '+QENG: "LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9'
single serving_cell__lte_search_on_lte_line "$QE" \
 '+QENG: "servingcell","SEARCH","LTE"'
single serving_cell__search "$QE" '+QENG: "servingcell","SEARCH"'
single serving_cell__noconn_bare "$QE" '+QENG: "servingcell","NOCONN"'
single serving_cell__limsrv_bare "$QE" '+QENG: "servingcell","LIMSRV"'
single serving_cell__connect_bare "$QE" '+QENG: "servingcell","CONNECT"'
single serving_cell__unknown_state "$QE" \
 '+QENG: "servingcell","XYZ","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-'
single serving_cell__wcdma "$QE" \
 '+QENG: "servingcell","NOCONN","WCDMA",515,03,2D1A,1234,10700,-90,-8,-70'
lfonly serving_cell__lte_lf_only "$QE" "$L"
rawf serving_cell__bare_cr_only 'AT+QENG="servingcell"\r\r+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-\r\rOK\r'
rawf serving_cell__lte_no_final_eol 'AT+QENG="servingcell"\r\r\n+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-'
emptyf serving_cell__empty
single serving_cell__ok_only "$QE"
errreply serving_cell__error "$QE" 'ERROR'
errreply serving_cell__cme_error "$QE" '+CME ERROR: 10'
single serving_cell__garbage "$QE" 'hello world' 'not a response'

# NSA (EN-DC): servingcell state line + LTE line + NR5G-NSA line
NSA_LTE='+QENG: "LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-'
NSA_NR='+QENG: "NR5G-NSA",515,03,271,-95,12,-11,504990,78,1,1'
single serving_cell__nsa_noconn "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" "$NSA_NR"
single serving_cell__nsa_connect "$QE" '+QENG: "servingcell","CONNECT"' "$NSA_LTE" "$NSA_NR"
single serving_cell__nsa_limsrv "$QE" '+QENG: "servingcell","LIMSRV"' "$NSA_LTE" "$NSA_NR"
# LTE line exactly 15 fields: lte_sinr = last field keeps its CR; NR line is CR-safe (tr -d '\r')
single serving_cell__nsa_lte_15fields_cr "$QE" '+QENG: "servingcell","NOCONN"' \
 '+QENG: "LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9' "$NSA_NR"
single serving_cell__nsa_nr_scs_values "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,271,-95,12,-11,504990,78,1,3'
single serving_cell__nsa_nr_scs_unknown "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,271,-95,12,-11,504990,78,1,9'
single serving_cell__nsa_nr_10fields_no_scs "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,271,-95,12,-11,504990,78,1'
single serving_cell__nsa_nr_dash_fields "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,-,-,-,-,-,-,-,-'
single serving_cell__nsa_nr_snr_negative "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,271,-95,-5,-11,504990,78,1,1'
single serving_cell__nsa_nr_trailing_comma "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,271,-95,12,-11,504990,78,1,1,'
single serving_cell__nsa_no_lte_line "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_NR"
single serving_cell__nsa_no_nr_line_lte_only "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE"
single serving_cell__nsa_lte_bad_hex "$QE" '+QENG: "servingcell","NOCONN"' \
 '+QENG: "LTE","FDD",515,03,QQQ,271,1300,3,5,5,ZZ,-92,-9,-63,9,0,240,-' "$NSA_NR"
single serving_cell__nsa_lte_cellid_lower_hex "$QE" '+QENG: "servingcell","NOCONN"' \
 '+QENG: "LTE","FDD",515,03,2d1ab04,271,1300,3,5,5,a1b2,-92,-9,-63,9,0,240,-' "$NSA_NR"

# LTE <SINR> is raw X, dB = 2X-20 (0..25 only). Live RM551E lines, 2026-10-21:
# no antennas, B1 FDD raw 12 (QCAINFO 4 dB) and B40 TDD raw 8 at CQI 0.
single serving_cell__lte_sinr_live_noant "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,22B5066,295,150,1,5,5,BF82,-119,-9,-90,12,6,240,-'
single serving_cell__lte_sinr_tdd_cqi0 "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","TDD",515,03,22B507D,295,39125,40,5,5,BF82,-127,-16,-90,8,0,-,0'
single serving_cell__lte_sinr_zero "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,0,0,240,-'
single serving_cell__lte_sinr_max25 "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,25,0,240,-'
single serving_cell__lte_sinr_over26 "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,26,0,240,-'
single serving_cell__lte_sinr_leading_zero "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,05,0,240,-'
single serving_cell__lte_sinr_3digits "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,100,0,240,-'
single serving_cell__lte_sinr_sentinel "$QE" \
 '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,-32768,0,240,-'
# EN-DC: LTE raw 11 -> 2 dB while the NR5G-NSA SINR 32 stays verbatim (already dB)
single serving_cell__nsa_lte_sinr_scaled "$QE" '+QENG: "servingcell","NOCONN"' \
 '+QENG: "LTE","FDD",515,03,22B5066,295,150,1,5,5,BF82,-89,-10,-59,11,15,180,-' \
 '+QENG: "NR5G-NSA",515,03,271,-95,32,-11,504990,78,1,1'
single serving_cell__nsa_lte_sinr_dash "$QE" '+QENG: "servingcell","NOCONN"' \
 '+QENG: "LTE","FDD",515,03,22B5066,295,150,1,5,5,BF82,-89,-10,-59,-' "$NSA_NR"
single serving_cell__nsa_hostile "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" \
 '+QENG: "NR5G-NSA",515,03,2$(id),-9;5,12,`id`,50'"'"'4990,78",1,1'
lfonly serving_cell__nsa_lf_only "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" "$NSA_NR"

# SA
SA='+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_noconn "$QE" "$SA"
single serving_cell__sa_connect "$QE" \
 '+QENG: "servingcell","CONNECT","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_limsrv "$QE" \
 '+QENG: "servingcell","LIMSRV","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,0'
# 16 fields: nr_scs is the last field -> "N\r" -> map_scs_to_khz no match -> ""
single serving_cell__sa_16fields_cr "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1'
single serving_cell__sa_15fields "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12'
single serving_cell__sa_cellid_36bit_max "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,FFFFFFFFF,271,FFFF,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_cellid_lower_hex "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,abcdef123,271,1a2b,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_bad_hex "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,XYZ,271,QQ,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_empty_hex "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,,271,,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_cellid_zero "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,0,271,0,504990,78,1,-95,-11,12,1,0'
single serving_cell__sa_scs_0 "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","FDD",515,03,2D1AB04A1,271,1A2B,154570,28,1,-95,-11,12,0,0'
single serving_cell__sa_scs_3 "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,2073334,257,1,-95,-11,12,3,0'
single serving_cell__sa_scs_unknown "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,9,0'
single serving_cell__sa_snr_negative_dash "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-,-,-5,1,0'
single serving_cell__sa_trailing_comma "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,0,'
single serving_cell__sa_hostile "$QE" \
 '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,2$(id),1A2B,5`id`;0,7"8,1,-95,-11,1'"'"'2,1,0'
lfonly serving_cell__sa_lf_only "$QE" "$SA"
single serving_cell__sa_and_nsa_tags "$QE" '+QENG: "servingcell","NOCONN"' "$NSA_LTE" "$NSA_NR" "$SA"

# ------------------------------------------------------------------ ca_info --
single ca_info__lte_pcc_only "$QC" '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2'
single ca_info__lte_pcc_scc "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255,0,-,-' \
 '+QCAINFO: "SCC",1650,50,"LTE BAND 3",1,135,-120,-14,-90,11,0,-,-'
single ca_info__lte_all_rb_values "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1,75,"LTE BAND 1",1,1,-1,-1,-1,1' \
 '+QCAINFO: "SCC",2,50,"LTE BAND 2",1,2,-2,-2,-2,2' \
 '+QCAINFO: "SCC",3,25,"LTE BAND 3",1,3,-3,-3,-3,3' \
 '+QCAINFO: "SCC",4,15,"LTE BAND 4",1,4,-4,-4,-4,4' \
 '+QCAINFO: "SCC",5,6,"LTE BAND 5",1,5,-5,-5,-5,5' \
 '+QCAINFO: "SCC",7,0,"LTE BAND 7",1,7,-7,-7,-7,7' \
 '+QCAINFO: "SCC",8,30,"LTE BAND 8",1,8,-8,-8,-8,8'
single ca_info__lte_short_scc_fields "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1'
single ca_info__lte_dash_empty_fields "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,-,-,-,-,-' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,,,,,'
single ca_info__lte_trailing_comma "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2,'
single ca_info__lte_freq_empty "$QC" \
 '+QCAINFO: "PCC",,100,"LTE BAND 28",1,135,-115,-12,-82,2'
single ca_info__lte_nonnumeric_sinr "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,abc'
single ca_info__lte_pci_double_dash "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,1-2,-115,-12,-82,2'
single ca_info__lte_rsrp_trailing_dash "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115-,-12,-82,2'
single ca_info__lte_freq_hostile "$QC" \
 '+QCAINFO: "PCC",$(id),100,"LTE BAND 28",1,135,-115,-12,-82,2'
single ca_info__lte_big_and_leading_zero_numbers "$QC" \
 '+QCAINFO: "PCC",99999999999999999999,100,"LTE BAND 28",1,007,-0115,-12,-82,2'
single ca_info__lte_float_sinr "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,1.50' \
 '+QCAINFO: "SCC",9486,100,"LTE BAND 28",1,135,-115,-12,-82,2.0'
single ca_info__lte_exp_sinr "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,1e2'
single ca_info__lte_negative_zero_and_plus "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,0,-0,--5,-82,+3'
single ca_info__lte_sinr_dash_only "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,-'
single ca_info__lte_hostile_band_and_type "$QC" \
 '+QCAINFO: "P`id`CC",9485,100,"LTE BAND 3;touch /tmp/pp_pwned;",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3'"'"'$(id)\n",1,135,-123,-16,-97,255,0,-,-'
single ca_info__tab_in_field "$QC" \
 "$(printf '+QCAINFO: "PCC",94\t85,100,"LTE BAND 28",1,135,-115,-12,-82,2')"
single ca_info__nr_pcc_short5 "$QC" '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271'
single ca_info__nr_short_forms "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271' \
 '+QCAINFO: "SCC",637344,3,"NR5G BAND 41",272,-90' \
 '+QCAINFO: "SCC",637345,3,"NR5G BAND 41",273,-90,-10' \
 '+QCAINFO: "SCC",637346,3,"NR5G BAND 41",274,-90,-10,1235'
single ca_info__nr_snr_values_short "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235' \
 '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,-5' \
 '+QCAINFO: "SCC",2,3,"NR5G BAND 41",273,-90,-10,5' \
 '+QCAINFO: "SCC",3,3,"NR5G BAND 41",274,-90,-10,0' \
 '+QCAINFO: "SCC",4,3,"NR5G BAND 41",275,-90,-10,-32768' \
 '+QCAINFO: "SCC",5,3,"NR5G BAND 41",276,-90,-10,-' \
 '+QCAINFO: "SCC",6,3,"NR5G BAND 41",277,-90,-10,' \
 '+QCAINFO: "SCC",7,3,"NR5G BAND 41",278,-90,-10,abc' \
 '+QCAINFO: "SCC",8,3,"NR5G BAND 41",279,-90,-10,1255' \
 '+QCAINFO: "SCC",9,3,"NR5G BAND 41",280,-90,-10,1245' \
 '+QCAINFO: "SCC",10,3,"NR5G BAND 41",281,-90,-10,-1235' \
 '+QCAINFO: "SCC",11,3,"NR5G BAND 41",282,-90,-10,32767' \
 '+QCAINFO: "SCC",12,3,"NR5G BAND 41",283,-90,-10,150'
single ca_info__nr_snr_values_long "$QC" \
 '+QCAINFO: "SCC",1,3,"NR5G BAND 41",2,272,1,3,636666,-90,-10,1235' \
 '+QCAINFO: "SCC",2,3,"NR5G BAND 41",2,273,1,3,636666,-90,-10,-5' \
 '+QCAINFO: "SCC",3,3,"NR5G BAND 41",2,274,1,3,636666,-90,-10,5' \
 '+QCAINFO: "SCC",4,3,"NR5G BAND 41",2,275,1,3,636666,-90,-10,0' \
 '+QCAINFO: "SCC",5,3,"NR5G BAND 41",2,276,1,3,636666,-90,-10,-32768' \
 '+QCAINFO: "SCC",6,3,"NR5G BAND 41",2,277,1,3,636666,-90,-10,-' \
 '+QCAINFO: "SCC",7,3,"NR5G BAND 41",2,278,1,3,636666,-90,-10,' \
 '+QCAINFO: "SCC",8,3,"NR5G BAND 41",2,279,1,3,636666,-90,-10,xyz'
# awk-numeric edge cases: one per fixture (a jq tonumber failure blanks ALL components)
single ca_info__nr_snr_awk_hex "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,0x10'
single ca_info__nr_snr_awk_exp "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,1e4'
single ca_info__nr_snr_awk_plus "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,+250'
single ca_info__nr_snr_awk_nan "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,nan'
single ca_info__nr_snr_awk_inf "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,inf'
single ca_info__nr_snr_awk_dot "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,.5'
single ca_info__nr_snr_awk_huge "$QC" '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,99999999999999999999'
single ca_info__nr_long_scc "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235' \
 '+QCAINFO: "SCC",637344,3,"NR5G BAND 41",2,272,1,3,636666,-90,-10,1235'
single ca_info__nr_long_forms "$QC" \
 '+QCAINFO: "SCC",1,3,"NR5G BAND 41",2,272,1,3,636666' \
 '+QCAINFO: "SCC",2,3,"NR5G BAND 41",2,273,1,3,636666,-90' \
 '+QCAINFO: "SCC",3,3,"NR5G BAND 41",2,274,1,3,636666,-90,-10' \
 '+QCAINFO: "SCC",4,3,"NR5G BAND 41",2,275,1,3,636666,-90,-10,300' \
 '+QCAINFO: "SCC",5,3,"NR5G BAND 41",2,276,1,3,636666,-90,-10,300,extra'
single ca_info__nr_8_vs_9_boundary "$QC" \
 '+QCAINFO: "SCC",1,3,"NR5G BAND 41",272,-90,-10,300' \
 '+QCAINFO: "SCC",2,3,"NR5G BAND 41",2,272,1,3,636666'
single ca_info__nr_trailing_comma "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235,' \
 '+QCAINFO: "SCC",637344,3,"NR5G BAND 41",2,272,1,3,636666,-90,-10,1235,'
single ca_info__nr_bw_enum_all "$QC" \
 '+QCAINFO: "PCC",1,0,"NR5G BAND 78",1' '+QCAINFO: "SCC",2,1,"NR5G BAND 78",2' \
 '+QCAINFO: "SCC",3,2,"NR5G BAND 78",3' '+QCAINFO: "SCC",4,3,"NR5G BAND 78",4' \
 '+QCAINFO: "SCC",5,4,"NR5G BAND 78",5' '+QCAINFO: "SCC",6,5,"NR5G BAND 78",6' \
 '+QCAINFO: "SCC",7,6,"NR5G BAND 78",7' '+QCAINFO: "SCC",8,7,"NR5G BAND 78",8' \
 '+QCAINFO: "SCC",9,8,"NR5G BAND 78",9' '+QCAINFO: "SCC",10,9,"NR5G BAND 78",10' \
 '+QCAINFO: "SCC",11,10,"NR5G BAND 78",11' '+QCAINFO: "SCC",12,11,"NR5G BAND 78",12' \
 '+QCAINFO: "SCC",13,12,"NR5G BAND 78",13' '+QCAINFO: "SCC",14,13,"NR5G BAND 78",14' \
 '+QCAINFO: "SCC",15,14,"NR5G BAND 78",15' '+QCAINFO: "SCC",16,15,"NR5G BAND 78",16' \
 '+QCAINFO: "SCC",17,16,"NR5G BAND 78",17' '+QCAINFO: "SCC",18,17,"NR5G BAND 78",18' \
 '+QCAINFO: "SCC",19,,"NR5G BAND 78",19'
single ca_info__nrdc_band "$QC" \
 '+QCAINFO: "PCC",504990,12,"NRDC BAND 78",271,-95,-11,1235' \
 '+QCAINFO: "SCC",637344,3,"NRDC BAND 41",2,272,1,3,636666,-90,-10,-5'
single ca_info__nsa_lte_pcc_nr_scc_single "$QC" \
 '+QCAINFO: "PCC",1300,100,"LTE BAND 3",1,271,-92,-9,-63,9' \
 '+QCAINFO: "SCC",504990,12,"NR5G BAND 78",2,271,1,3,504990,-95,-11,1235'
envf ca_info__nsa_lte_pcc_nr_scc_single 'network_type="5G-NSA"; lte_state=connected; nr_state=connected'
single ca_info__nsa_lte_pcc_nr_scc_double "$QC" \
 '+QCAINFO: "PCC",1300,100,"LTE BAND 3",1,271,-92,-9,-63,9' \
 '+QCAINFO: "SCC",1650,50,"LTE BAND 3",1,271,-92,-9,-63,9' \
 '+QCAINFO: "SCC",504990,12,"NR5G BAND 78",2,271,1,3,504990,-95,-11,1235' \
 '+QCAINFO: "SCC",637344,3,"NR5G BAND 41",2,272,1,3,636666,-90,-10,300'
envf ca_info__nsa_lte_pcc_nr_scc_double 'network_type="5G-NSA"; lte_state=connected; nr_state=connected'
single ca_info__sa_pcc_two_scc "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235' \
 '+QCAINFO: "SCC",637344,3,"NR5G BAND 41",2,272,1,3,636666,-90,-10,300' \
 '+QCAINFO: "SCC",154570,2,"NR5G BAND 28",2,273,0,2,154570,-100,-12,100'
envf ca_info__sa_pcc_two_scc 'network_type="5G-SA"; lte_state=inactive; nr_state=connected'
# QENG says LTE but QCAINFO already shows an NR PCC: reconcile network_type -> 5G-SA
single ca_info__reconcile_nr_pcc_while_lte "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235'
envf ca_info__reconcile_nr_pcc_while_lte 'network_type="LTE"; lte_state=connected; nr_state=inactive'
single ca_info__reconcile_state_unknown "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235'
envf ca_info__reconcile_state_unknown 'network_type=""; lte_state=unknown; nr_state=unknown'
single ca_info__reconcile_state_other "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235'
envf ca_info__reconcile_state_other 'network_type="LTE"; lte_state=searching; nr_state=connected'
single ca_info__reconcile_skipped_nsa "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235'
envf ca_info__reconcile_skipped_nsa 'network_type="5G-NSA"; lte_state=unknown; nr_state=unknown'
single ca_info__reconcile_default_sentinel "$QC" \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271,-95,-11,1235'
single ca_info__unrecognized_band_skipped "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1,2,"UMTS BAND 1",3,4' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255,0,-,-'
# an SCC line whose band is unrecognised but contains "NR": counted by grep -c 'NR', yields no component
single ca_info__scc_count_vs_component_mismatch "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1,2,"NR XYZ",3,4'
single ca_info__only_unrecognized "$QC" '+QCAINFO: "PCC",1,2,"GSM BAND 1",3'
single ca_info__no_qcainfo_lines "$QC" 'something else' '+QMAP: "x"'
single ca_info__scc_lines_but_pcc_missing "$QC" '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255'
single ca_info__scc_text_without_line_anchor "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 'junk +QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255'
single ca_info__blank_lines_between "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' '' '' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255'
single ca_info__duplicate_pcc "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "PCC",504990,12,"NR5G BAND 78",271'
single ca_info__glued_records "$QC"  '+QCAINFO: "PCC",396970,3,"NR5G BAND 25",999,-11,-11,1929'  '+QCAINFO: "SCC",520110,12,"NR5G BAND 41",1,495,1,14,528000+QCAINFO: "SCC",502110,11,"NR5G BAND 41",1,495,0,-,-,'
single ca_info__no_space_after_prefix "$QC" '+QCAINFO:"PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2'
single ca_info__lte_bandword_nospace "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTEBAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1350,75,"LTEBAND 3",1,135,-123,-16,-97,255'
lfonly ca_info__lte_lf_only "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' \
 '+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,135,-123,-16,-97,255'
emptyf ca_info__empty
single ca_info__ok_only "$QC"
errreply ca_info__error "$QC" 'ERROR'
errreply ca_info__cme_error "$QC" '+CME ERROR: 3'
single ca_info__error_text_after_data "$QC" \
 '+QCAINFO: "PCC",9485,100,"LTE BAND 28",1,135,-115,-12,-82,2' 'ERROR'

# ------------------------------------------------------------------- signal --
compound signal__lte_4rx "$QS" '+QRSRP: -95,-97,-100,-102,LTE' '+QRSRQ: -9,-10,-11,-12,LTE' '+QSINR: 10,12,8,6,LTE'
compound signal__lte_2rx "$QS" '+QRSRP: -95,-97,-32768,-32768,LTE' '+QRSRQ: -9,-10,-32768,-32768,LTE' '+QSINR: 10,12,-32768,-32768,LTE'
compound signal__nr_only "$QS" '+QRSRP: -90,-92,-95,-97,NR5G' '+QRSRQ: -8,-9,-10,-11,NR5G' '+QSINR: 15,17,12,11,NR5G'
compound signal__nsa_both "$QS" \
 '+QRSRP: -95,-97,-32768,-32768,LTE' '+QRSRP: -90,-92,-95,-97,NR5G' \
 '+QRSRQ: -9,-10,-32768,-32768,LTE'  '+QRSRQ: -8,-9,-10,-11,NR5G' \
 '+QSINR: 10,12,-32768,-32768,LTE'   '+QSINR: 15,17,12,11,NR5G'
compound signal__nr_ports3_4_inactive "$QS" '+QRSRP: -90,-92,-32768,-32768,NR5G' '+QRSRQ: -8,-9,-32768,-32768,NR5G' '+QSINR: 15,17,-32768,-32768,NR5G'
compound signal__all_inactive "$QS" '+QRSRP: -32768,-32768,-32768,-32768,LTE' '+QRSRQ: -32768,-32768,-32768,-32768,LTE' '+QSINR: -32768,-32768,-32768,-32768,LTE'
compound signal__missing_qsinr "$QS" '+QRSRP: -95,-97,-100,-102,LTE' '+QRSRQ: -9,-10,-11,-12,LTE'
compound signal__missing_qrsrq "$QS" '+QRSRP: -95,-97,-100,-102,LTE' '+QSINR: 10,12,8,6,LTE'
compound signal__trailing_and_empty_fields "$QS" '+QRSRP: -95,-97,,,LTE' '+QRSRQ: -9,-10,-11,' '+QSINR: ,,,,LTE'
compound signal__three_values_then_rat "$QS" '+QRSRP: -95,-97,-100,LTE' '+QRSRQ: -9,-10,LTE' '+QSINR: 10,LTE'
compound signal__rat_only "$QS" '+QRSRP: LTE' '+QRSRQ: NR5G' '+QSINR: LTE'
compound signal__no_rat_suffix "$QS" '+QRSRP: -95,-97,-100,-102' '+QRSRQ: -9,-10,-11,-12' '+QSINR: 10,12,8,6'
compound signal__no_space_after_colon "$QS" '+QRSRP:-95,-97,-100,-102,LTE' '+QRSRQ:-9,-10,-11,-12,LTE' '+QSINR:10,12,8,6,LTE'
compound signal__extra_spaces "$QS" '+QRSRP:  -95 , -97 ,-100, -102 ,LTE' '+QRSRQ:   -9,-10,-11,-12,LTE' '+QSINR: 10,12,8,6, LTE'
compound signal__nonnumeric_values "$QS" '+QRSRP: abc,-97,x y,"q",LTE' '+QRSRQ: 1.5,-0,+3,-32768.0,LTE' '+QSINR: -32767,-032768,32768,-32768,NR5G'
compound signal__hostile_values "$QS" '+QRSRP: $(id),`id`,;,'"'"'q'"'"',LTE' '+QRSRQ: "-9",\n,\\,%s,NR5G' '+QSINR: -1"2,3,4,5,LTE'
compound signal__duplicate_lines "$QS" \
 '+QRSRP: -95,-97,-100,-102,LTE' '+QRSRP: -1,-2,-3,-4,LTE' '+QRSRP: -80,-81,-82,-83,NR5G' '+QRSRP: -5,-6,-7,-8,NR5G'
compound signal__rat_tags_both_on_one_line "$QS" '+QRSRP: -95,-97,-100,-102,LTE NR5G' '+QRSRQ: -9,-10,-11,-12,NR5G LTE' '+QSINR: 1,2,3,4,LTE'
compound signal__other_rat_tag "$QS" '+QRSRP: -95,-97,-100,-102,WCDMA' '+QRSRQ: -9,-10,-11,-12,GSM' '+QSINR: 1,2,3,4,NR5G-SA'
compound signal__more_than_4_values "$QS" '+QRSRP: -95,-97,-100,-102,-104,-106,LTE' '+QRSRQ: -9,-10,-11,-12,-13,LTE' '+QSINR: 1,2,3,4,5,NR5G'
compound signal__cr_inside_values "$QS" "$(printf '+QRSRP: -95,-97\r,-100,-102,LTE')" '+QRSRQ: -9,-10,-11,-12,LTE' '+QSINR: 1,2,3,4,LTE'
lfonly signal__lf_only "$QS" '+QRSRP: -95,-97,-100,-102,LTE' '+QRSRQ: -9,-10,-11,-12,LTE' '+QSINR: 10,12,8,6,LTE'
emptyf signal__empty
single signal__ok_only "$QS"
errreply signal__error "$QS" 'ERROR'
errreply signal__cme_error "$QS" '+CME ERROR: 3'
rawf signal__no_final_eol 'AT+QRSRP;+QRSRQ;+QSINR\r\r\n+QRSRP: -95,-97,-100,-102,LTE\r\n\r\n+QRSRQ: -9,-10,-11,-12,LTE\r\n\r\n+QSINR: 10,12,8,6,LTE'
rawf signal__bare_cr_separators 'AT+QRSRP;+QRSRQ;+QSINR\r\r+QRSRP: -95,-97,-100,-102,LTE\r+QRSRQ: -9,-10,-11,-12,LTE\r+QSINR: 10,12,8,6,LTE\rOK\r'
compound qrsrp__nsa "AT+QRSRP" '+QRSRP: -95,-97,-32768,-32768,LTE' '+QRSRP: -90,-92,-95,-97,NR5G'
compound qrsrq__lte "AT+QRSRQ" '+QRSRQ: -9,-10,-11,-12,LTE'
compound qsinr__nr "AT+QSINR" '+QSINR: 15,17,12,11,NR5G'
compound qrsrp__wrong_prefix_in_reply "AT+QRSRP" '+QRSRQ: -9,-10,-11,-12,LTE'

# ------------------------------------------------------------------- tier-2 --
compound tier2__ready_globe "$T2" '+COPS: 0,0,"Globe Telecom",7' '+QUIMSLOT: 1' '+CNUM: ,"000000000000",129' '+CPIN: READY'
compound tier2__slot2_smart "$T2" '+COPS: 0,0,"SMART",7' '+QUIMSLOT: 2' '+CNUM: ,"000000000000",129' '+CPIN: READY'
compound tier2__pin_required "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CNUM: ,"",129' '+CPIN: SIM PIN'
compound tier2__puk_required "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: SIM PUK'
compound tier2__pin2 "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: SIM PIN2'
compound tier2__not_ready "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: NOT READY'
compound tier2__not_inserted_text "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: NOT INSERTED'
compound tier2__cpin_error_text "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: ERROR'
compound tier2__cpin_unknown "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: PH-NET PIN'
compound tier2__cpin_lowercase "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: ready'
printf '%s\r\r\n+COPS: 0\r\n\r\n+QUIMSLOT: 1\r\n\r\n+CME ERROR: 10\r\n' "$T2" > "$OUT/tier2__sim_absent_cme10.txt"; N=$((N + 1))
printf '%s\r\r\n+CME ERROR: 10\r\n' "$T2" > "$OUT/tier2__cme10_first.txt"; N=$((N + 1))
errreply tier2__error "$T2" 'ERROR'
emptyf tier2__empty
single tier2__ok_only "$T2"
compound tier2__cops_no_commas "$T2" '+COPS: 0' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_deregistered "$T2" '+COPS: 2' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_one_comma "$T2" '+COPS: 0,0' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_two_commas "$T2" '+COPS: 0,0,"X"' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_empty_name "$T2" '+COPS: 0,0,"",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_comma_in_name "$T2" '+COPS: 0,0,"Foo, Inc",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_numeric_format "$T2" '+COPS: 0,2,"51503",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_spaces_in_name "$T2" '+COPS: 0,0,"Smart  Comm  ",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_no_space_after_colon "$T2" '+COPS:0,0,"NoSpace",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_two_lines "$T2" '+COPS: 0,0,"First",7' '+COPS: 0,0,"Second",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_hostile_name "$T2" '+COPS: 0,0,"A$(id)`id`;'"'"'q'"'"'\n%s",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_utf8 "$T2" '+COPS: 0,0,"Çelcom Ünicode é",7' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__cops_trailing_fields "$T2" '+COPS: 0,0,"Globe",7,extra,more' '+QUIMSLOT: 1' '+CPIN: READY'
compound tier2__quimslot_trailing_space "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: 1 ' '+CPIN: READY'
compound tier2__quimslot_three "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: 3' '+CPIN: READY'
compound tier2__quimslot_two_numbers "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: 1 2' '+CPIN: READY'
compound tier2__quimslot_empty "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT:' '+CPIN: READY'
compound tier2__quimslot_missing "$T2" '+COPS: 0,0,"G",7' '+CPIN: READY'
compound tier2__quimslot_hostile "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: $(id);`x`' '+CPIN: READY'
compound tier2__cpin_two_lines "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: 1' '+CPIN: SIM PIN' '+CPIN: READY'
lfonly tier2__lf_only "$T2" '+COPS: 0,0,"G",7' '+QUIMSLOT: 1' '+CPIN: READY'
emptyf temperature__live
compound carrier__only_cops "AT+COPS?" '+COPS: 0,0,"Smart",7'
compound sim_slot__only "AT+QUIMSLOT?" '+QUIMSLOT: 2'
compound sim_status__ready_only "AT+CPIN?" '+CPIN: READY'
compound sim_status__garbage_with_ready_word "AT+CPIN?" 'NOT READY TO ACCEPT'

# ------------------------------------------------------------------ helpers --
# Format: "helper arg..." (space separated) or TAB separated when an arg has spaces.
# Tokens: <empty> = empty arg, <CR> = carriage return.
TAB=$(printf '\t')
{
    printf '# _sig_val\n'
    for v in -32768 -95 0 -32767 abc -0 "<empty>" 1.5 -032768 32768 "-32768<CR>"; do printf '_sig_val %s\n' "$v"; done
    printf '# _antenna_to_json_array\n'
    printf '_antenna_to_json_array -95 -97 -32768 -32768\n'
    printf '_antenna_to_json_array -95 -97 -100 -102\n'
    printf '_antenna_to_json_array <empty> <empty> <empty> <empty>\n'
    printf '_antenna_to_json_array -95 -97\n'
    printf '_antenna_to_json_array\n'
    printf '_antenna_to_json_array a b c d e f\n'
    printf '_antenna_to_json_array 1.5 -0 +3 -32768.0\n'
    printf '# _antenna_line_to_json (tab separated: line, prefix)\n'
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,-32768,-32768,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,-32768,-32768,LTE<CR>%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s<empty>%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRQ: -9,-10,-11,-12,LTE%sQRSRQ\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRQ: -9,-10,-11,-12,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QSINR: 10,12,8,6,NR5G%sQSINR\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP:-95,-97,-100,-102,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP:   -95 , -97 , -100 , -102 ,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s-95,-97,-100,-102,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,,,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,-100,-102,-1,-2,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%sgarbage with +QRSRP: inside%sQRSRP\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,-100,-102,LTE%s<empty>\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: -95,-97,-100,-102,LTE\n' "$TAB"
    printf '_antenna_line_to_json%s+X.Y: -95,-97,-100,-102,LTE%sX.Y\n' "$TAB" "$TAB"
    printf '_antenna_line_to_json%s+QRSRP: "-95",$(id),-100,-102,LTE%sQRSRP\n' "$TAB" "$TAB"
    printf '# _hex_to_dec\n'
    for v in 2D1AB04 2d1ab04 0 00 FF ff "<empty>" XYZ -1 0x10 FFFFFFFFF FFFFFFFFFFFFFFFF 7FFFFFFFFFFFFFFF 8000000000000000 FFFFFFFFFFFFFFFFF 1G G 12345 +5 "FF<CR>" 0X1F 010; do
        printf '_hex_to_dec %s\n' "$v"
    done
    printf '# _compute_cell_parts (hex [nr])\n'
    for v in 2D1AB04 2d1ab04 0 FF 100 FFFFFFF 233B703 XYZ "<empty>" -1 FFFFFFFFF 3FFF 4000 FFFFFFFFFFFFFFFFF 7FFFFFFFFFFFFFFF 8000000000000000 "FF<CR>"; do
        printf '_compute_cell_parts %s\n' "$v"
        printf '_compute_cell_parts %s nr\n' "$v"
    done
    printf '_compute_cell_parts 2D1AB04 NR\n_compute_cell_parts 2D1AB04 xyz\n_compute_cell_parts 2D1AB04 <empty>\n_compute_cell_parts\n'
    printf '# map_scs_to_khz\n'
    for v in 0 1 2 3 4 5 9 -1 "<empty>" abc 01 00 "0<CR>"; do printf 'map_scs_to_khz %s\n' "$v"; done
    printf 'map_scs_to_khz\n'
    printf '# _lte_rb_to_mhz\n'
    for v in 6 15 25 50 75 100 0 1 3 5 10 20 200 "<empty>" abc 100.0 0100 "100<CR>" -1; do printf '_lte_rb_to_mhz %s\n' "$v"; done
    printf '_lte_rb_to_mhz\n'
    printf '# _nr_bw_to_mhz\n'
    for v in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 99 -1 "<empty>" abc 01 "12<CR>" 1.0; do printf '_nr_bw_to_mhz %s\n' "$v"; done
    printf '_nr_bw_to_mhz\n'
} > "$OUT/helpers__all.txt"
N=$((N + 1))

echo "wrote $N fixtures to $OUT"

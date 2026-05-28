# sms_pdu.awk — PDU codec for QManager SMS native backend
# Operations (selected via -v op=...):
#   decode_one   — read hex PDU lines from stdin/file, emit one JSON object
#   decode_list  — read N hex PDU lines, emit {"msg":[...]} array
#   encode_ucs2  — read recipient + UTF-8 body, emit TPDU hex
#   encode_gsm7  — read recipient + ASCII body, emit TPDU hex

BEGIN {
    if (op == "") { print "ERROR: -v op=... required" > "/dev/stderr"; exit 2 }
}

# --- Hex helpers ------------------------------------------------------------
function hex2dec(h,    n, i, c, v) {
    n = 0
    for (i = 1; i <= length(h); i++) {
        c = toupper(substr(h, i, 1))
        v = index("0123456789ABCDEF", c) - 1
        if (v < 0) return -1
        n = n * 16 + v
    }
    return n
}

function swap_pair(h) {
    return substr(h, 2, 1) substr(h, 1, 1)
}

# Decode a semi-octet-swapped digit string of N digits (N may be odd; pad F dropped)
function decode_digits(h, ndigits,    i, out, pair) {
    out = ""
    for (i = 1; i <= length(h); i += 2) {
        pair = swap_pair(substr(h, i, 2))
        out = out pair
    }
    # If odd digit count, strip trailing F
    if (ndigits > 0 && length(out) > ndigits) out = substr(out, 1, ndigits)
    return out
}

# Decode the TZ semi-octet (octet 7 of SCTS).
# Per 3GPP TS 23.040 §9.2.3.11: bit 3 of the byte is the sign (0=+, 1=-);
# remaining bits form a semi-octet-swapped BCD quarter-hour count.
# Returns "±HH:MM".
function decode_tz(h,    raw, sign, masked, swapped, qhours, hh, mm, sgn) {
    raw     = hex2dec(h)
    sign    = and_int(raw, 8)             # bit 3 of byte
    masked  = and_int(raw, 247)           # clear bit 3 → 0xF7
    swapped = swap_pair(sprintf("%02X", masked))
    qhours  = swapped + 0                 # BCD digits → decimal
    hh      = int(qhours / 4)
    mm      = (qhours % 4) * 15
    sgn     = (sign == 0) ? "+" : "-"
    return sgn sprintf("%02d:%02d", hh, mm)
}

# Decode SCTS (7 octets, semi-octet swapped: YY MM DD HH mm ss TZ).
# Returns ISO 8601: "20YY-MM-DDTHH:MM:SS±HH:MM".
function decode_scts(h,    y, mo, d, hh, mm, ss, tz) {
    y  = swap_pair(substr(h, 1,  2))
    mo = swap_pair(substr(h, 3,  2))
    d  = swap_pair(substr(h, 5,  2))
    hh = swap_pair(substr(h, 7,  2))
    mm = swap_pair(substr(h, 9,  2))
    ss = swap_pair(substr(h, 11, 2))
    tz = decode_tz(substr(h, 13, 2))
    return "20" y "-" mo "-" d "T" hh ":" mm ":" ss tz
}

# Pop N hex chars from the front of state's "pdu" string
function pop(n,    out) {
    out = substr(pdu, 1, n)
    pdu = substr(pdu, n + 1)
    return out
}

# --- Bitwise helpers --------------------------------------------------------
# Device verification: BusyBox awk on the Quectel target supports and/or/lshift/rshift
# (verified 2026-05-28: `echo "" | awk 'BEGIN{print and(0xF0,0x0F),or(1,2),lshift(1,4),rshift(16,2)}'`
# printed `0 3 16 4` as expected). Using arithmetic-only wrappers for portability —
# they work identically on BusyBox awk AND GAWK without build-flag dependency.
function and_int(a, b,    r, bit) {
    r = 0; bit = 1
    while (a > 0 && b > 0) {
        if (a % 2 == 1 && b % 2 == 1) r = r + bit
        a = int(a / 2); b = int(b / 2); bit = bit * 2
    }
    return r
}
function or_int(a, b,    r, bit) {
    r = 0; bit = 1
    while (a > 0 || b > 0) {
        if (a % 2 == 1 || b % 2 == 1) r = r + bit
        a = int(a / 2); b = int(b / 2); bit = bit * 2
    }
    return r
}
function lshift_int(v, n) { while (n-- > 0) v = v * 2; return v }
function rshift_int(v, n) { while (n-- > 0) v = int(v / 2); return v }

# --- GSM-7 default alphabet and extension table -----------------------------
# gsm7_default[1..128] maps septet value 0..127 to UTF-8 character sequence.
# Index is (septet_value + 1) so split()-style 1-based indexing is preserved.
# gsm7_ext[septet_value] maps extension table codes to characters.
function gsm7_init() {
    # Default alphabet populated by direct assignment to avoid the split()
    # comma-separator collision at septet 44 (the comma character itself).
    # Reference: 3GPP TS 23.038, Table 6.2.1
    # Indices 1..128 correspond to septet values 0..127.
    gsm7_default[1]   = "@"
    gsm7_default[2]   = "£"
    gsm7_default[3]   = "$"
    gsm7_default[4]   = "¥"
    gsm7_default[5]   = "è"
    gsm7_default[6]   = "é"
    gsm7_default[7]   = "ù"
    gsm7_default[8]   = "ì"
    gsm7_default[9]   = "ò"
    gsm7_default[10]  = "Ç"
    gsm7_default[11]  = "\n"
    gsm7_default[12]  = "Ø"
    gsm7_default[13]  = "ø"
    gsm7_default[14]  = "\r"
    gsm7_default[15]  = "Å"
    gsm7_default[16]  = "å"
    gsm7_default[17]  = "Δ"
    gsm7_default[18]  = "_"
    gsm7_default[19]  = "Φ"
    gsm7_default[20]  = "Γ"
    gsm7_default[21]  = "Λ"
    gsm7_default[22]  = "Ω"
    gsm7_default[23]  = "Π"
    gsm7_default[24]  = "Ψ"
    gsm7_default[25]  = "Σ"
    gsm7_default[26]  = "Θ"
    gsm7_default[27]  = "Ξ"
    gsm7_default[28]  = "\033"     # ESC — extension table escape character
    gsm7_default[29]  = "Æ"
    gsm7_default[30]  = "æ"
    gsm7_default[31]  = "ß"
    gsm7_default[32]  = "É"
    gsm7_default[33]  = " "
    gsm7_default[34]  = "!"
    gsm7_default[35]  = "\""
    gsm7_default[36]  = "#"
    gsm7_default[37]  = "¤"
    gsm7_default[38]  = "%"
    gsm7_default[39]  = "&"
    gsm7_default[40]  = "'"
    gsm7_default[41]  = "("
    gsm7_default[42]  = ")"
    gsm7_default[43]  = "*"
    gsm7_default[44]  = "+"
    gsm7_default[45]  = ","
    gsm7_default[46]  = "-"
    gsm7_default[47]  = "."
    gsm7_default[48]  = "/"
    gsm7_default[49]  = "0"
    gsm7_default[50]  = "1"
    gsm7_default[51]  = "2"
    gsm7_default[52]  = "3"
    gsm7_default[53]  = "4"
    gsm7_default[54]  = "5"
    gsm7_default[55]  = "6"
    gsm7_default[56]  = "7"
    gsm7_default[57]  = "8"
    gsm7_default[58]  = "9"
    gsm7_default[59]  = ":"
    gsm7_default[60]  = ";"
    gsm7_default[61]  = "<"
    gsm7_default[62]  = "="
    gsm7_default[63]  = ">"
    gsm7_default[64]  = "?"
    gsm7_default[65]  = "¡"
    gsm7_default[66]  = "A"
    gsm7_default[67]  = "B"
    gsm7_default[68]  = "C"
    gsm7_default[69]  = "D"
    gsm7_default[70]  = "E"
    gsm7_default[71]  = "F"
    gsm7_default[72]  = "G"
    gsm7_default[73]  = "H"
    gsm7_default[74]  = "I"
    gsm7_default[75]  = "J"
    gsm7_default[76]  = "K"
    gsm7_default[77]  = "L"
    gsm7_default[78]  = "M"
    gsm7_default[79]  = "N"
    gsm7_default[80]  = "O"
    gsm7_default[81]  = "P"
    gsm7_default[82]  = "Q"
    gsm7_default[83]  = "R"
    gsm7_default[84]  = "S"
    gsm7_default[85]  = "T"
    gsm7_default[86]  = "U"
    gsm7_default[87]  = "V"
    gsm7_default[88]  = "W"
    gsm7_default[89]  = "X"
    gsm7_default[90]  = "Y"
    gsm7_default[91]  = "Z"
    gsm7_default[92]  = "Ä"
    gsm7_default[93]  = "Ö"
    gsm7_default[94]  = "Ñ"
    gsm7_default[95]  = "Ü"
    gsm7_default[96]  = "§"
    gsm7_default[97]  = "¿"
    gsm7_default[98]  = "a"
    gsm7_default[99]  = "b"
    gsm7_default[100] = "c"
    gsm7_default[101] = "d"
    gsm7_default[102] = "e"
    gsm7_default[103] = "f"
    gsm7_default[104] = "g"
    gsm7_default[105] = "h"
    gsm7_default[106] = "i"
    gsm7_default[107] = "j"
    gsm7_default[108] = "k"
    gsm7_default[109] = "l"
    gsm7_default[110] = "m"
    gsm7_default[111] = "n"
    gsm7_default[112] = "o"
    gsm7_default[113] = "p"
    gsm7_default[114] = "q"
    gsm7_default[115] = "r"
    gsm7_default[116] = "s"
    gsm7_default[117] = "t"
    gsm7_default[118] = "u"
    gsm7_default[119] = "v"
    gsm7_default[120] = "w"
    gsm7_default[121] = "x"
    gsm7_default[122] = "y"
    gsm7_default[123] = "z"
    gsm7_default[124] = "ä"
    gsm7_default[125] = "ö"
    gsm7_default[126] = "ñ"
    gsm7_default[127] = "ü"
    gsm7_default[128] = "à"

    # Extension table — preceded by ESC (septet value 27)
    delete gsm7_ext
    gsm7_ext[10]  = "\f"
    gsm7_ext[20]  = "^"
    gsm7_ext[40]  = "{"
    gsm7_ext[41]  = "}"
    gsm7_ext[47]  = "\\"
    gsm7_ext[60]  = "["
    gsm7_ext[61]  = "~"
    gsm7_ext[62]  = "]"
    gsm7_ext[64]  = "|"
    gsm7_ext[101] = "€"
}

# Unpack n_septets GSM-7 septets from packed hex string; return UTF-8 string.
# udhl_bytes: byte count of the UDH data (excluding the UDHL byte itself).
#   When non-zero, the first ceil((udhl_bytes+1)*8/7) septets are UDH alignment
#   padding and are skipped.  The caller passes the full ud_hex (including the
#   UDH octets) so the bit-stream offset is naturally correct.
function gsm7_unpack(hex, n_septets, udhl_bytes,
                     i, nbytes, byte_idx, bit_pos, b,
                     mask, shift_in, septet, prev,
                     out, ext_pending, skip_septets,
                     bytes) {
    if (gsm7_default[1] == "") gsm7_init()

    # Convert hex to integer array bytes[0..nbytes-1]
    nbytes = int(length(hex) / 2)
    for (i = 0; i < nbytes; i++)
        bytes[i] = hex2dec(substr(hex, i * 2 + 1, 2))

    # Septets to skip when UDH is present (alignment padding)
    skip_septets = 0
    if (udhl_bytes > 0)
        skip_septets = int(((udhl_bytes + 1) * 8 + 6) / 7)   # ceil

    out = ""
    prev = 0
    bit_pos = 0
    byte_idx = 0
    ext_pending = 0

    for (i = 0; i < n_septets; i++) {
        # Extract one 7-bit septet from the byte stream.
        # bit_pos tracks how many bits of the current byte have already been
        # consumed.  When bit_pos < 7 we take (7 - bit_pos) bits from the
        # current byte plus bit_pos leftover bits from the previous byte.
        # When bit_pos == 7 the entire septet is already in prev.
        if (bit_pos < 7) {
            b = bytes[byte_idx]
            # mask for the (7 - bit_pos) low bits of b
            mask = lshift_int(1, 7 - bit_pos) - 1
            shift_in = and_int(b, mask) * lshift_int(1, bit_pos)
            septet = and_int(or_int(prev, shift_in), 127)
            prev = rshift_int(b, 7 - bit_pos)
            bit_pos++
            byte_idx++
        } else {
            septet = and_int(prev, 127)
            prev = 0
            bit_pos = 0
        }

        # Skip UDH alignment septets
        if (i < skip_septets) continue

        # Map septet → character
        if (septet == 27) {
            ext_pending = 1
        } else if (ext_pending) {
            out = out ((septet in gsm7_ext) ? gsm7_ext[septet] : "?")
            ext_pending = 0
        } else {
            out = out gsm7_default[septet + 1]
        }
    }

    # bytes[] is a local array — cleaned up automatically on return

    return out
}

# Decode alphanumeric originating address (TON 0xD0) from GSM-7 packed septets.
# h: raw hex of the address bytes (ndigits semi-octets → ceil(ndigits/2) bytes)
# ndigits: the OA length field value (semi-octet count, NOT byte count)
function decode_gsm7_address(h, ndigits,    abytes, n_septets) {
    abytes    = int((ndigits + 1) / 2)
    n_septets = int(abytes * 8 / 7)
    return gsm7_unpack(h, n_septets, 0)
}

# --- Operation: decode_one --------------------------------------------------
# Reads one line of hex from input, emits one JSON object (no trailing newline).
function do_decode_one(    smsc_len, tpdu_first, oa_len, ton, oa_digits,
                          dcs, scts, udl, ud_hex,
                          sender, ts, content, oa_bytes, udhi, mti,
                          dcs_alphabet, udhi_present, udhl_bytes, udh_hex) {
    # SMSC address — length octet + length bytes of address content
    smsc_len = hex2dec(pop(2))
    if (smsc_len > 0) pop(smsc_len * 2)   # skip SMSC bytes; we don't need them

    tpdu_first = hex2dec(pop(2))
    # bit 6 (0x40) of tpdu_first = TP-UDHI (User Data Header Indicator)
    udhi = (tpdu_first % 128) >= 64 ? 1 : 0

    # SMS-DELIVER has no TP-MR; SMS-SUBMIT does. For inbox (deliver), skip MR.
    # MTI = bits 1..0 of tpdu_first: 0 = SMS-DELIVER (what inbox returns)
    mti = tpdu_first % 4

    oa_len = hex2dec(pop(2))   # number of useful semi-octets in address
    ton    = hex2dec(pop(2))   # type-of-address; 0xD0 = alphanumeric, 0x91 = E.164
    # OA semi-octet count → byte count of address field
    oa_bytes = int((oa_len + 1) / 2)
    oa_digits = pop(oa_bytes * 2)

    if (ton == 208) {  # 0xD0 alphanumeric
        sender = decode_gsm7_address(oa_digits, oa_len)
    } else {
        sender = decode_digits(oa_digits, oa_len)
    }

    hex2dec(pop(2))   # PID — read and discard
    dcs  = hex2dec(pop(2))
    scts = pop(14)
    ts   = decode_scts(scts)
    udl  = hex2dec(pop(2))
    ud_hex = pdu   # remainder

    # DCS alphabet: bits 3..2
    dcs_alphabet = rshift_int(and_int(dcs, 12), 2)

    # UDH parsing (header bytes do NOT need to be stripped — gsm7_unpack
    # reads them as part of the bitstream and skips the corresponding septets)
    udhi_present = udhi
    udhl_bytes   = 0
    udh_hex      = ""
    if (udhi_present) {
        udhl_bytes = hex2dec(substr(ud_hex, 1, 2))
        udh_hex    = substr(ud_hex, 3, udhl_bytes * 2)
    }

    if (dcs_alphabet == 0) {
        content = gsm7_unpack(ud_hex, udl, udhl_bytes)
    } else if (dcs_alphabet == 2) {
        content = ud_hex   # UCS2 — Task 4
    } else {
        content = ud_hex   # 8-bit binary or reserved
    }

    # Emit JSON. Field order matches sms_tool recv -j plus the new status field.
    printf "{\"index\":%d,\"sender\":%s,\"timestamp\":%s,\"status\":%s",
        idx_in, json_str(sender), json_str(ts),
        json_str((stat_in == 0) ? "unread" : "read")
    # reference/part/total filled by Task 3 when UDHI=1
    printf ",\"content\":%s}", json_str(content)
}

function json_str(s,    out, i, c) {
    out = "\""
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if      (c == "\"") out = out "\\\""
        else if (c == "\\") out = out "\\\\"
        else if (c == "\n") out = out "\\n"
        else if (c == "\r") out = out "\\r"
        else if (c == "\t") out = out "\\t"
        else                 out = out c
    }
    return out "\""
}

# --- Driver: read hex from input -------------------------------------------
{
    pdu = toupper($0)
    gsub(/[^0-9A-F]/, "", pdu)
    if (op == "decode_one") {
        idx_in  = (idx == "")  ? 0 : idx + 0
        stat_in = (stat == "") ? 1 : stat + 0
        do_decode_one()
        print ""
    }
}

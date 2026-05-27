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

# Decode 7-bit packed septets — placeholder, full impl in Task 3
function decode_gsm7_address(h, ndigits,    bytes, i, septets) {
    # Address-field GSM-7 decode for alphanumeric sender (TON 0xD0)
    # Returns ASCII string. Full GSM-7 unpack lives in Task 3.
    return "[ALPHA_TODO]"
}

# Decode SCTS (7 octets, semi-octet swapped: YY MM DD HH mm ss TZ)
function decode_scts(h,    y, mo, d, hh, mm, ss) {
    y  = swap_pair(substr(h, 1,  2))
    mo = swap_pair(substr(h, 3,  2))
    d  = swap_pair(substr(h, 5,  2))
    hh = swap_pair(substr(h, 7,  2))
    mm = swap_pair(substr(h, 9,  2))
    ss = swap_pair(substr(h, 11, 2))
    # Match sms_tool format: "MM/DD/YY HH:MM:SS"
    return mo "/" d "/" y " " hh ":" mm ":" ss
}

# Pop N hex chars from the front of state's "pdu" string
function pop(n,    out) {
    out = substr(pdu, 1, n)
    pdu = substr(pdu, n + 1)
    return out
}

# --- Operation: decode_one --------------------------------------------------
# Reads one line of hex from input, emits one JSON object (no trailing newline).
function do_decode_one(    smsc_len, tpdu_first, mr, oa_len, ton, oa_digits,
                          pid, dcs, scts, udl, ud_hex,
                          sender, ts, content, oa_bytes, udhi, mti) {
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

    pid = hex2dec(pop(2))
    dcs = hex2dec(pop(2))
    scts = pop(14)
    ts = decode_scts(scts)
    udl = hex2dec(pop(2))
    ud_hex = pdu   # remainder

    # Body decode lives in Tasks 3/4/5 — for now stub
    content = ud_hex

    # Emit JSON. Field order matches sms_tool recv -j.
    printf "{\"index\":%d,\"sender\":%s,\"timestamp\":%s",
        idx_in, json_str(sender), json_str(ts)
    # reference/part/total filled by Task 5 when UDHI=1
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
        idx_in = (idx == "") ? 0 : idx + 0
        do_decode_one()
        print ""
    }
}

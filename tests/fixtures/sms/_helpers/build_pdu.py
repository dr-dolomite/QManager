#!/usr/bin/env python3
"""build_pdu.py — Generate SMS-DELIVER PDU hex for test fixtures.

Used to author tests/fixtures/sms/decode/*.pdu files. Not shipped to the
device, not invoked by the test harness — purely a build-time author tool.

Encodes:
  - GSM-7 default alphabet + extension table (per 3GPP TS 23.038)
  - UCS-2 BE (UTF-16 BE) with surrogate pairs
  - SMS-DELIVER TPDU framing
  - Optional UDH with IEI=0x00 (concat 8-bit ref)

Usage:
  python tests/fixtures/sms/_helpers/build_pdu.py gsm7  --sender +1234567890 --scts 2026-05-11T10:00:00+00:00 --text "Hello"
  python tests/fixtures/sms/_helpers/build_pdu.py gsm7  --sender +1234567890 --scts 2026-05-11T10:00:00+00:00 --text "Part one" --concat 42,2,1
  python tests/fixtures/sms/_helpers/build_pdu.py ucs2  --sender +1234567890 --scts 2026-05-11T10:00:00+00:00 --text "Hi 你好"

Prints the PDU hex on stdout (uppercase, no whitespace).
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys

GSM7_DEFAULT = (
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ"
    " !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§"
    "¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
assert len(GSM7_DEFAULT) == 128

GSM7_EXT = {
    "\f": 0x0A,
    "^":  0x14,
    "{":  0x28,
    "}":  0x29,
    "\\": 0x2F,
    "[":  0x3C,
    "~":  0x3D,
    "]":  0x3E,
    "|":  0x40,
    "€":  0x65,
}


def gsm7_to_septets(text: str) -> list[int]:
    out: list[int] = []
    for ch in text:
        if ch in GSM7_DEFAULT:
            out.append(GSM7_DEFAULT.index(ch))
        elif ch in GSM7_EXT:
            out.append(0x1B)
            out.append(GSM7_EXT[ch])
        else:
            raise ValueError(f"char {ch!r} not in GSM-7")
    return out


def pack_septets(septets: list[int], pad_bits: int = 0) -> bytes:
    bit_stream: list[int] = []
    if pad_bits:
        bit_stream.extend([0] * pad_bits)
    for s in septets:
        for i in range(7):
            bit_stream.append((s >> i) & 1)
    while len(bit_stream) % 8 != 0:
        bit_stream.append(0)
    out = bytearray()
    for i in range(0, len(bit_stream), 8):
        b = 0
        for j in range(8):
            b |= bit_stream[i + j] << j
        out.append(b)
    return bytes(out)


def encode_oa(number: str) -> bytes:
    n = number.lstrip("+")
    digits = n
    oa_len = len(digits)
    if oa_len % 2:
        digits += "F"
    swapped = "".join(digits[i + 1] + digits[i] for i in range(0, len(digits), 2))
    return bytes([oa_len, 0x91]) + bytes.fromhex(swapped)


def encode_scts(iso: str) -> bytes:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$", iso)
    if not m:
        raise ValueError(f"bad ISO timestamp: {iso}")
    yyyy, MM, DD, hh, mm, ss, sgn, tz_h, tz_m = m.groups()
    yy = yyyy[2:]

    def swap(d: str) -> int:
        return int(d[1] + d[0], 16)

    qhours = int(tz_h) * 4 + int(tz_m) // 15
    tz_bcd = f"{qhours:02d}"
    tz_byte = int(tz_bcd[1] + tz_bcd[0], 16)
    if sgn == "-":
        tz_byte |= 0x08
    return bytes([swap(yy), swap(MM), swap(DD), swap(hh), swap(mm), swap(ss), tz_byte])


def build_gsm7(sender: str, scts: str, text: str, concat: tuple[int, int, int] | None = None) -> str:
    smsc = bytes([0x00])
    tpdu_first = 0x04 | (0x40 if concat else 0x00)  # MMS bit + UDHI if concat

    oa = encode_oa(sender)
    pid = bytes([0x00])
    dcs = bytes([0x00])
    scts_b = encode_scts(scts)

    septets = gsm7_to_septets(text)

    if concat:
        ref, total, part = concat
        # UDH IE for concat-8: IEI=0x00, IEDL=0x03, IED = ref, total, part (5 bytes).
        # UDHL = length of UDH excluding the UDHL byte itself = 5.
        udh_ie = bytes([0x00, 0x03, ref, total, part])
        udhl_byte = bytes([len(udh_ie)])
        # Total UDH (including UDHL byte) = 1 + len(udh_ie) bytes.
        udh_total_bytes = 1 + len(udh_ie)
        pad_bits = (7 - (udh_total_bytes * 8) % 7) % 7
        skip_septets = (udh_total_bytes * 8 + pad_bits) // 7
        packed_body = pack_septets(septets, pad_bits=pad_bits)
        udl = skip_septets + len(septets)
        ud = udhl_byte + udh_ie + packed_body
    else:
        packed_body = pack_septets(septets, pad_bits=0)
        udl = len(septets)
        ud = packed_body

    udl_b = bytes([udl])
    pdu = smsc + bytes([tpdu_first]) + oa + pid + dcs + scts_b + udl_b + ud
    return pdu.hex().upper()


def build_ucs2(sender: str, scts: str, text: str) -> str:
    smsc = bytes([0x00])
    tpdu_first = 0x04  # MMS bit, no UDHI

    oa = encode_oa(sender)
    pid = bytes([0x00])
    dcs = bytes([0x08])  # UCS-2
    scts_b = encode_scts(scts)

    body = text.encode("utf-16-be")
    udl = len(body)
    ud = bytes([udl]) + body

    pdu = smsc + bytes([tpdu_first]) + oa + pid + dcs + scts_b + ud
    return pdu.hex().upper()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["gsm7", "ucs2"])
    ap.add_argument("--sender", required=True)
    ap.add_argument("--scts", required=True, help="ISO 8601, e.g. 2026-05-11T10:00:00+00:00")
    ap.add_argument("--text", required=True)
    ap.add_argument("--concat", help="ref,total,part — e.g. 42,2,1")
    args = ap.parse_args()

    if args.mode == "gsm7":
        concat = None
        if args.concat:
            ref, total, part = (int(x) for x in args.concat.split(","))
            concat = (ref, total, part)
        print(build_gsm7(args.sender, args.scts, args.text, concat))
    else:
        if args.concat:
            print("ucs2 concat not implemented in this helper (UDH packing path)", file=sys.stderr)
            return 2
        print(build_ucs2(args.sender, args.scts, args.text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

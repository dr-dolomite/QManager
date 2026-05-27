# sms_pdu.awk — PDU codec for QManager SMS native backend
# Operations (selected via -v op=...):
#   decode_one   — read hex PDU lines from stdin/file, emit one JSON object
#   decode_list  — read N hex PDU lines, emit {"msg":[...]} array
#   encode_ucs2  — read recipient + UTF-8 body, emit TPDU hex
#   encode_gsm7  — read recipient + ASCII body, emit TPDU hex

BEGIN {
    if (op == "") { print "ERROR: -v op=... required" > "/dev/stderr"; exit 2 }
}

# Operations stubbed out — filled in by Tasks 2-6

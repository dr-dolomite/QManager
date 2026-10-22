#!/bin/sh
# AT parity suite (read-only). Usage: sh parity.sh <outdir>
# Each case writes <n>.out (stdout), <n>.err (stderr), <n>.rc and a summary line.
OUT="$1"
[ -n "$OUT" ] || exit 2
mkdir -p "$OUT"
: > "$OUT/summary.txt"

now_us() {
    { read -r _a; read -r _b; read -r _c; } < /proc/timer_list
    _c="${_c#now at }"
    _c="${_c% nsecs}"
    echo $((_c / 1000))
}

n=0
run() {
    # run <class> <args...>
    cls="$1"
    shift
    n=$((n + 1))
    id=$(printf '%02d' "$n")
    t0=$(now_us)
    if [ -n "$QE" ]; then
        env "$QE" qcmd "$@" > "$OUT/$id.out" 2> "$OUT/$id.err"
    else
        qcmd "$@" > "$OUT/$id.out" 2> "$OUT/$id.err"
    fi
    rc=$?
    t1=$(now_us)
    echo "$rc" > "$OUT/$id.rc"
    echo "$id $cls rc=$rc ms=$(( (t1 - t0) / 1000 )) env=[$QE] args=[$*]" >> "$OUT/summary.txt"
}

# static (byte-identical expected)
for c in 'AT' 'ATI' 'AT+CGMI' 'AT+CGMM' 'AT+CGMR' 'AT+QGMR' 'AT+CFUN?' 'AT+CPIN?' \
         'AT+CMEE?' 'AT+FOOBAR' 'AT+CPBR=9999' 'ati' 'AT+QCFG="usbnet"' 'AT+CGDCONT?'; do
    run static "$c"
    run static -j "$c"
done
# live (shape only)
for c in 'AT+CSQ' 'AT+QENG="servingcell"' 'AT+QCAINFO' 'AT+COPS?' 'AT+QTEMP' 'AT+CCLK?'; do
    run live "$c"
    run live -j "$c"
done
# error classes / client argument handling
run arg
run arg -j
run arg --bogus
run arg -j --bogus
run arg 'AT+CSQ
AT'
run arg -t 5 ATI
run arg -t 2500 ATI
run arg -t abc ATI
QE=QCMD_WAIT_MS=abc; run arg ATI
QE=QCMD_WAIT_MS=2500; run arg -j ATI
QE=
echo done >> "$OUT/summary.txt"

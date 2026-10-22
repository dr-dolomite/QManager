# atd-parity: on-device AT parity suite for `qcmd`

`parity.sh` runs 50 `qcmd` calls against the live modem and writes each result to a directory, so two builds (or the daemon and the in-process fallback) can be compared byte for byte. It is the check that the `qmanager_atd` client output contract is unchanged (see [`at-broker.md`](../../docs/features/at-broker.md#the-output-contract-is-frozen)).

## What it covers

- **14 static commands, raw and `-j`** (28 cases). Output should be byte-identical between builds: `AT`, `ATI`, `AT+CGMI`, `AT+CGMM`, `AT+CGMR`, `AT+QGMR`, `AT+CFUN?`, `AT+CPIN?`, `AT+CMEE?`, `AT+FOOBAR` (error path), `AT+CPBR=9999`, `ati` (lower case), `AT+QCFG="usbnet"`, `AT+CGDCONT?`.
- **6 live commands, raw and `-j`** (12 cases): `AT+CSQ`, `AT+QENG="servingcell"`, `AT+QCAINFO`, `AT+COPS?`, `AT+QTEMP`, `AT+CCLK?`. Only the shape should match.
- **10 argument and error cases**: no args, `-j` alone, unknown flag (`--bogus`, with and without `-j`), a multi-line argument, `-t` with 5, 2500, and `abc`, and `QCMD_WAIT_MS` set to `abc` and to `2500`.

Only read-only AT commands are sent. The script writes nothing on the device except the output directory given as its argument.

## Running it on the device

Copy the script to the modem (for example to `/tmp/atd-parity/`), then run it with an output directory per run:

```sh
sh /tmp/atd-parity/parity.sh /tmp/atd-parity/run-a
# ...change the build or stop the daemon, then:
sh /tmp/atd-parity/parity.sh /tmp/atd-parity/run-b
```

Each run leaves `NN.out`, `NN.err` and `NN.rc` for every case plus `summary.txt`. The `ms=` fields in `summary.txt` are timings and differ on every run, so compare the other fields.

## Diffing two runs

```sh
cd /tmp/atd-parity
for f in run-a/*.out run-a/*.err run-a/*.rc; do
    b="run-b/${f#run-a/}"
    cmp -s "$f" "$b" || echo "differs: $f"
done
```

## Expected differences

Eight live reads differ between any two runs, because the values they report change: cases 31–34 (`AT+QENG="servingcell"` and `AT+QCAINFO`, raw and `-j`) and cases 37–40 (`AT+QTEMP` and `AT+CCLK?`, raw and `-j`). Compare those by shape, not bytes; `QTEMP` sensor values can move between reads. The other 42 cases should be byte-identical. A non-zero `rc` on a live case can mean the modem lock was busy because another caller held it. Rerun that case before treating it as a regression.

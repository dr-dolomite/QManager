# qmi-parity: offline QMI vs AT telemetry comparison
Usage: `python -I compare.py <input.ndjson>` reads one `{"i","at","qmi"}` object per line, prints a report, and writes `<input>.summary.json`.
Only active-tier samples are compared: serving/signal within 3 s of the QMI clock, CA within 3 s of `at.ca_mono`.
Numeric diffs are `at - qmi`, with tolerance ±2 dB for RSRP/RSRQ and ±3 dB for RSSI/SINR.
Stdlib only; input is parsed as data and never executed.

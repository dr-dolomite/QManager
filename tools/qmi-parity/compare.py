#!/usr/bin/env python3
"""Compare QMI telemetry against AT-derived poller samples (NDJSON).

Usage: python -I compare.py <input.ndjson>
Prints a text report and writes <input.ndjson>.summary.json. Stdlib only.
Diffs are at - qmi. Missing keys become skips or n=0, never crashes.
"""
import json
import math
import sys
from collections import Counter

FRESH_S = 3.0
TOL = {  # numeric field -> absolute tolerance
    "lte.rsrp~sig": 2, "lte.rsrp~cell_row": 2, "lte.rsrq~sig": 2, "lte.rsrq~cell_row": 2,
    "lte.rssi~sig": 3, "lte.rssi~cell_row": 3, "lte.sinr~sig": 3,
    "nr.rsrp~sig": 2, "nr.rsrq~sig": 2, "nr.sinr~sig": 3,
}
IDENTITY = ["lte.pci", "lte.earfcn", "lte.tac", "lte.cell_id",
            "lte.band", "lte.bandwidth", "registration", "plmn"]
SERIES = ["qmi sig.lte.rsrp", "qmi cell-row rsrp", "at lte.rsrp"]


def dct(x):
    return x if isinstance(x, dict) else {}


def lst(x):
    return x if isinstance(x, list) else []


def raw15_scells(cad):
    """Decode CA TLV 0x15 from raw hex: n u8, then per SCell pci u16,
    earfcn u16, bw u32, band u16, state u32, idx u8 (15 bytes)."""
    h = dct(cad.get("raw")).get("15")
    if not isinstance(h, str):
        return []
    b = bytes.fromhex(h)
    out = []
    for k in range(b[0] if b else 0):
        e = b[1 + 15 * k:16 + 15 * k]
        if len(e) < 15:
            break
        out.append({"pci": int.from_bytes(e[0:2], "little"), "earfcn": int.from_bytes(e[2:4], "little"),
                    "state": int.from_bytes(e[10:14], "little")})
    return out


def dig(obj, *path):
    for key in path:
        obj = dct(obj).get(key)
    return obj


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def same(a, b):
    return str(a).strip().upper() == str(b).strip().upper()


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def r3(x):
    return None if x is None else round(x, 3)


def pct(part, whole):
    return round(100.0 * part / whole, 1) if whole else None


def pctl(vals, p):
    s = sorted(vals)
    return s[max(0, math.ceil(p / 100.0 * len(s)) - 1)]


def lat_stats(vals):
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "p50": pctl(vals, 50), "p95": pctl(vals, 95), "max": max(vals)}


def run_lengths(seq):
    """Lengths of maximal runs of equal consecutive values; None breaks a run."""
    runs, cur, prev = [], 0, None
    for v in seq:
        if v is not None and cur and v == prev:
            cur += 1
            continue
        if cur:
            runs.append(cur)
        cur, prev = (1, v) if v is not None else (0, None)
    if cur:
        runs.append(cur)
    return runs


def load(path):
    rows, bad = [], 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                obj = None
            if isinstance(obj, dict):
                rows.append(obj)
            else:
                bad += 1
    return rows, bad


def analyse(rows, bad, path):
    skipped, ca_skipped, errors = Counter(), Counter(), Counter()
    ident = {f: [0, 0] for f in IDENTITY}  # [matches, compared]
    diffs = {f: [] for f in TOL}
    ca_ok = [0, 0]  # [exact LTE set matches, compared]
    ca_used = ca_nr_scc = used = 0
    series = {k: [] for k in SERIES}
    lat, totals = {}, []

    for row in rows:
        at, qmi = row.get("at"), row.get("qmi")
        if isinstance(qmi, dict):  # latency does not depend on freshness
            rtts = []
            for name, val in qmi.items():
                if not isinstance(val, dict) or "rtt_ms" not in val:
                    continue
                if num(val.get("rtt_ms")):
                    lat.setdefault(name, []).append(val["rtt_ms"])
                    rtts.append(val["rtt_ms"])
                if val.get("result", "ok") != "ok":
                    errors[name] += 1
            total = qmi.get("total_ms")
            if not num(total) and rtts:
                total = sum(rtts)
            if num(total):
                totals.append(total)
        if not isinstance(at, dict):
            skipped["at_null"] += 1
            continue
        if not isinstance(qmi, dict):
            skipped["qmi_null"] += 1
            continue
        if at.get("tier") != "active":
            skipped["tier_" + str(at.get("tier"))] += 1
            continue
        if not num(qmi.get("mono_ms")) or not num(at.get("mono")):
            skipped["no_mono"] += 1
            continue
        q_sec = qmi["mono_ms"] / 1000.0
        if abs(q_sec - at["mono"]) > FRESH_S:
            skipped["stale_serving"] += 1
            continue
        used += 1

        lte, nr = dct(at.get("lte")), dct(at.get("nr"))
        srv = dct(dig(qmi, "serving", "data"))
        sig_lte, sig_nr = dct(dig(qmi, "sig", "data", "lte")), dct(dig(qmi, "sig", "data", "nr"))
        rf = dct(dig(qmi, "rf", "data"))
        intra = dct(dig(qmi, "cell", "data", "lte_intra"))
        row_c = next((c for c in lst(intra.get("cells")) if isinstance(c, dict)
                      and c.get("pci") is not None and c.get("pci") == intra.get("pci")), {})
        q_band = next((b.get("band") for b in lst(rf.get("bands"))
                       if isinstance(b, dict) and same(b.get("rat"), "lte")), None)
        q_bw = next((b.get("bw_enum") for b in lst(rf.get("bandwidth"))
                     if isinstance(b, dict) and same(b.get("rat"), "lte")), None)
        a_plmn = dct(at.get("plmn"))
        a_mcc, a_mnc = a_plmn.get("mcc", at.get("mcc")), a_plmn.get("mnc", at.get("mnc"))
        q_mcc, q_mnc = srv.get("mcc"), srv.get("mnc")

        pairs = {
            "lte.pci": (lte.get("pci"), intra.get("pci")),
            "lte.earfcn": (lte.get("earfcn"), intra.get("earfcn")),
            "lte.tac": (lte.get("tac"), intra.get("tac")),
            "lte.cell_id": (lte.get("cell_id"), intra.get("cell_id")),
            "lte.band": (lte.get("band"), q_band),
            "lte.bandwidth": (lte.get("bandwidth"), q_bw),
            "plmn": (None if a_mcc is None or a_mnc is None else f"{a_mcc}/{a_mnc}",
                     None if q_mcc is None or q_mnc is None else f"{q_mcc}/{q_mnc}"),
        }
        for f, (a, b) in pairs.items():
            if a is not None and b is not None:
                ident[f][1] += 1
                ident[f][0] += same(a, b)
        at_type, reg = at.get("type"), srv.get("reg")
        if isinstance(at_type, str) and reg is not None:
            t = at_type.upper()
            ident["registration"][1] += 1
            ident["registration"][0] += ("LTE" in t or "5G" in t) == same(reg, "registered")

        nums = {
            "lte.rsrp~sig": (lte.get("rsrp"), sig_lte.get("rsrp")),
            "lte.rsrp~cell_row": (lte.get("rsrp"), row_c.get("rsrp")),
            "lte.rsrq~sig": (lte.get("rsrq"), sig_lte.get("rsrq")),
            "lte.rsrq~cell_row": (lte.get("rsrq"), row_c.get("rsrq")),
            "lte.rssi~sig": (lte.get("rssi"), sig_lte.get("rssi")),
            "lte.rssi~cell_row": (lte.get("rssi"), row_c.get("rssi")),
            "lte.sinr~sig": (lte.get("sinr"), sig_lte.get("sinr")),
            "nr.rsrp~sig": (nr.get("rsrp"), sig_nr.get("rsrp")),
            "nr.rsrq~sig": (nr.get("rsrq"), sig_nr.get("rsrq")),
            "nr.sinr~sig": (nr.get("sinr"), sig_nr.get("sinr")),
        }
        for f, (a, b) in nums.items():
            if num(a) and num(b):
                diffs[f].append(a - b)

        for key, val in (("qmi sig.lte.rsrp", sig_lte.get("rsrp")),
                         ("qmi cell-row rsrp", row_c.get("rsrp")),
                         ("at lte.rsrp", lte.get("rsrp"))):
            series[key].append(val if num(val) else None)

        # CA: at.ca_mono and qmi share the same clock; qmi CA has no own timestamp.
        ca_mono = at.get("ca_mono")
        cad = dig(qmi, "ca", "data")
        if not num(ca_mono) or abs(q_sec - ca_mono) > FRESH_S:
            ca_skipped["stale_or_missing_ca_mono"] += 1
        elif not isinstance(at.get("ca"), list):
            ca_skipped["at_ca_missing"] += 1
        elif not isinstance(cad, dict):
            ca_skipped["qmi_ca_missing"] += 1
        else:
            ca_used += 1
            at_set, nr_scc = set(), 0
            for c in at["ca"]:
                if not isinstance(c, dict):
                    continue
                tech = str(c.get("technology", "")).upper()
                if tech == "NR":
                    nr_scc += str(c.get("type", "")).upper() == "SCC"
                elif tech == "LTE" and c.get("earfcn") is not None and c.get("pci") is not None:
                    at_set.add((str(c["earfcn"]), str(c["pci"])))
            # Configured SCells (state 1 deactivated, 2 activated), as QCAINFO lists them.
            scells = [s for s in lst(cad.get("scells")) or raw15_scells(cad)
                      if isinstance(s, dict) and (s.get("state") or 0) >= 1]
            q_set = {(str(c["earfcn"]), str(c["pci"])) for c in [dct(cad.get("pcell"))] + scells
                     if c.get("earfcn") is not None and c.get("pci") is not None}
            ca_ok[1] += 1
            ca_ok[0] += at_set == q_set
            ca_nr_scc += nr_scc > 0

    numeric = {}
    for f, ds in diffs.items():
        n = len(ds)
        numeric[f] = {"n": n, "tol": TOL[f],
                      "within_pct": pct(sum(abs(d) <= TOL[f] for d in ds), n),
                      "mean_abs_diff": r3(mean([abs(d) for d in ds])),
                      "mean_signed_bias": r3(mean(ds))}
    fresh = {}
    for key, seq in series.items():
        runs = run_lengths(seq)
        fresh[key] = {"runs": len(runs), "mean_run": r3(mean(runs)),
                      "max_run": max(runs) if runs else None}
    latency = {k: lat_stats(v) for k, v in sorted(lat.items())}
    latency["qmi_total"] = lat_stats(totals)
    return {
        "input": path, "lines": len(rows) + bad, "bad_json": bad, "used": used,
        "skipped": dict(skipped),
        "identity": {f: {"n": n, "match_pct": pct(m, n)} for f, (m, n) in ident.items()},
        "numeric": numeric,
        "ca": {"used": ca_used, "skipped": dict(ca_skipped), "compared": ca_ok[1],
               "lte_set_exact_pct": pct(ca_ok[0], ca_ok[1]), "samples_with_nr_scc": ca_nr_scc},
        "freshness": fresh,
        "latency_ms": latency,
        "command_errors": dict(errors),
    }


def fmt(x, pc=False):
    if x is None:
        return "-"
    return f"{x:.1f}%" if pc else f"{x:.2f}"


def counts(c):
    return ", ".join(f"{k}={v}" for k, v in sorted(c.items())) or "none"


def render(s):
    out = [f"QMI vs AT parity: {s['input']}",
           f"lines={s['lines']} bad_json={s['bad_json']} used={s['used']} "
           f"(active + serving fresh <= {FRESH_S:g}s)",
           f"skipped: {counts(s['skipped'])}", "", "Identity (exact match)"]
    for f, v in s["identity"].items():
        out.append(f"  {f:<13} n={v['n']:<4} match={fmt(v['match_pct'], True)}")
    out += ["", "Numeric (diff = at - qmi)"]
    for f, v in s["numeric"].items():
        out.append(f"  {f:<18} n={v['n']:<4} tol=+/-{v['tol']} within={fmt(v['within_pct'], True):<7} "
                   f"mad={fmt(v['mean_abs_diff'])} bias={fmt(v['mean_signed_bias'])}")
    c = s["ca"]
    out += ["", f"CA (at.ca LTE set vs qmi pcell + scells state=2): used={c['used']} "
                f"compared={c['compared']} exact={fmt(c['lte_set_exact_pct'], True)} "
                f"samples_with_NR_SCC={c['samples_with_nr_scc']}",
            f"  CA skipped: {counts(c['skipped'])}", "",
            "Freshness (runs of identical consecutive values)"]
    for k, v in s["freshness"].items():
        out.append(f"  {k:<18} runs={v['runs']} mean_run={fmt(v['mean_run'])} max_run={v['max_run']}")
    out += ["", "Latency ms (p50 / p95 / max)"]
    for k, v in s["latency_ms"].items():
        if v["n"]:
            out.append(f"  {k:<14} n={v['n']:<4} {v['p50']} / {v['p95']} / {v['max']}")
    out.append(f"command errors: {counts(s['command_errors'])}")
    return "\n".join(out)


def main(argv):
    if len(argv) != 2:
        print("usage: python -I compare.py <input.ndjson>", file=sys.stderr)
        return 2
    path = argv[1]
    rows, bad = load(path)
    summary = analyse(rows, bad, path)
    print(render(summary))
    with open(path + ".summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

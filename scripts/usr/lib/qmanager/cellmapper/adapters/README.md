# CellMapper Adapter Contract

Adapters live in `/usr/lib/qmanager/cellmapper/adapters/`. Each `.sh` file is
sourced by the adapter dispatcher (`cellmapper_adapter.sh`) during detection.
The dispatcher calls `cm_adapter_detect` on each adapter in glob order and
uses the **first** one that returns 0.

---

## Required Functions

Every adapter **must** implement all six functions below. Omitting any of them
will cause `cellmapper_adapter.sh` to skip the adapter (with a log warning) or
produce runtime errors during collection.

---

### `cm_adapter_detect`

**Purpose:** Probe the hardware and return 0 if this adapter is appropriate
for the detected device, 1 otherwise.

**Signature:** `cm_adapter_detect` *(no arguments)*

**Contract:**
- Must return 0 only when the adapter can reliably collect data from the
  detected modem model.
- Should be fast — called on every boot/session start.
- Must not have side effects that break other adapters if it returns 1.
- Typically runs one cheap AT command (e.g. `AT+CGMM`) and matches the model
  string.

**Example:**
```sh
cm_adapter_detect() {
    local model
    model=$(qcmd "AT+CGMM" 2>/dev/null)
    case "$model" in
        *RM551E*) return 0 ;;
    esac
    return 1
}
```

---

### `cm_adapter_id`

**Purpose:** Return the adapter's machine-readable identifier string.

**Signature:** `cm_adapter_id` *(no arguments)*

**Contract:**
- Must print a single, stable, lowercase identifier to stdout (no newline
  required; `printf` preferred).
- Used as a cache key — must not change between invocations for the same
  device.
- Recommended format: `<vendor>_<model_series>` (e.g. `quectel_rm551`).

**Example:**
```sh
cm_adapter_id() { printf 'quectel_rm551'; }
```

---

### `cm_adapter_name`

**Purpose:** Return the adapter's human-readable display name.

**Signature:** `cm_adapter_name` *(no arguments)*

**Contract:**
- Must print a short, descriptive name to stdout.
- Used in log messages and status API responses.

**Example:**
```sh
cm_adapter_name() { printf 'Quectel RM551E-GL'; }
```

---

### `cm_adapter_collect_serving`

**Purpose:** Collect the current serving cell measurement(s) and return them
as a JSON array.

**Signature:** `cm_adapter_collect_serving` *(no arguments)*

**Contract:**
- Must print a valid JSON array (`[...]`) to stdout.
- Array may contain one or more measurement objects (e.g. LTE PCC + NR NSA
  secondary).
- Each object must conform to the CellMapper measurement schema (see below).
- Must return 0 on success, 1 if data cannot be collected.
- On failure, must still print `[]` and return 1 (never leave stdout empty).
- Must NOT include GPS coordinates — the collector applies them separately.

---

### `cm_adapter_collect_neighbors`

**Purpose:** Collect neighbour cell measurements and return them as a JSON
array.

**Signature:** `cm_adapter_collect_neighbors` *(no arguments)*

**Contract:**
- Must print a valid JSON array to stdout.
- Each object must have `"isNeighbour": true` and `"connected": false`.
- Fields that are reported as `-` (unavailable) by the modem must be omitted
  from the JSON object.
- Must return 0 on success, 1 if data cannot be collected.
- On failure, print `[]` and return 1.

---

### `cm_adapter_collect_ca`

**Purpose:** Collect carrier aggregation secondary component (SCC) measurements
and return them as a JSON array.

**Signature:** `cm_adapter_collect_ca` *(no arguments)*

**Contract:**
- Must print a valid JSON array to stdout.
- Reads data from `/tmp/qmanager_status.json` (populated by the main QManager
  daemon) using `jq`.
- Each SCC component becomes one measurement object with
  `"connected": true, "isNeighbour": false`.
- If CA data is unavailable or the status file is absent, print `[]` and
  return 0 (not an error — CA is optional).

---

## Measurement Object Schema

Both serving and neighbour measurements must follow this schema. Fields marked
**required** must always be present; optional fields should be omitted rather
than sent as `null` or empty string.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `radio` | integer | yes | Radio type: 0=LTE, 1=NR5G |
| `MCC` | integer | yes | Mobile Country Code |
| `MNC` | integer | yes | Mobile Network Code |
| `LAC` | integer | yes | Tracking/Location Area Code (decimal) |
| `CID` | integer | yes | Cell ID (decimal) |
| `signal` | integer | yes | Primary signal level (RSRP for LTE/NR) |
| `type` | string | yes | `"LTE"` or `"NR"` |
| `subType` | string | yes | `"LTE"`, `"NSA"`, `"SA"` |
| `connected` | boolean | yes | True for serving/CA cells |
| `isNeighbour` | boolean | yes | True for neighbour cells |
| `version` | string | yes | CellMapper app version string (`"5.6.5"`) |
| `currentAppVersion` | string | yes | Same as `version` |
| `phone` | string | yes | `"Quectel\|<model>\|OpenWRT\|QManager"` |
| `lat` | number | yes | Latitude (0.0 if unknown; collector fills in) |
| `lon` | number | yes | Longitude (0.0 if unknown; collector fills in) |
| `ARFCN` | string | LTE | Downlink EARFCN |
| `LTE_RSRP` | string | LTE | RSRP in dBm |
| `LTE_RSRQ` | string | LTE | RSRQ in dB |
| `LTE_SS` | string | LTE | RSSI in dBm |
| `LTE_SNR` | string | LTE | SINR in dB |
| `LTE_PCI` | string | LTE | Physical Cell ID |
| `LTE_DL_BW` | string | LTE | Downlink bandwidth in MHz |
| `LTE_BAND` | string | LTE | Band number |
| `LTE_TAC` | string | LTE | TAC (decimal string) |
| `NR_SS_RSRP` | string | NR | SS-RSRP in dBm |
| `NR_SS_SINR` | string | NR | SS-SINR in dB |
| `NR_SS_RSRQ` | string | NR | SS-RSRQ in dB |
| `NR_PCI` | string | NR | NR Physical Cell ID |
| `NR_ARFCN` | string | NR | NR ARFCN |
| `NR_BAND` | string | NR | NR band number |
| `NR_ENDC_CONNECTED` | string | NSA | `"true"` when EN-DC connected |
| `provider` | string | no | Carrier name from `AT+COPS?` |
| `timestamp` | string | no | Collection time `"YYYY-MM-DD HH:MM:SS"` |

---

## Adding a New Adapter

1. Create `adapters/<vendor>_<model>.sh`.
2. Implement all six required functions.
3. Make the file executable: `chmod +x adapters/<vendor>_<model>.sh`.
4. Test detection in isolation: `. adapters/<vendor>_<model>.sh && cm_adapter_detect && echo OK`.
5. The dispatcher picks adapters in filename order — prefix with a number
   (e.g. `10_rm551.sh`) if ordering matters.

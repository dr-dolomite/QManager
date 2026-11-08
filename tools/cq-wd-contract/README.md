# cq-wd-contract

Contract-test fixtures for the Connection Quality and Watchdog CGIs
(`monitoring/connection_quality.sh`, `monitoring/watchdog.sh`), frozen in
`docs/plans/2026-11-07-cq-watchdog-contracts.md` (section 5, section 8). The fixtures are data;
each repo has its own runner (QManager: `run.sh`, with `uci-stub.sh`; usage in its header).

Fixtures are repo-neutral. This directory must stay byte-identical in QManager and
QManager-RM520N. Each repo's runner feeds every fixture to its own CGI with the platform store
seeded from `setup`, then checks `expect`.

## Layout

    fixtures/connection_quality/*.json   -> monitoring/connection_quality.sh
    fixtures/watchdog/*.json             -> monitoring/watchdog.sh

## Fixture format

    {"name": str, "method": "GET"|"POST"|"PUT", "query": str, "body": object|null,
     "setup": {"connection_quality": {...}, "watchdog": {...},
               "files": {"status": object|null, "failover": object|null}},
     "expect": {"shape": {"<jq path>": "<type tokens>"}, "equals": {"<jq path>": <json value>}}}

- `body`: sent as the JSON request body. `{"__raw": "<text>"}` means send `<text>` verbatim as the
  body (for `invalid_json`). `null` means no body. `PUT` appears only in `method_not_allowed` cases.
- `setup.connection_quality` / `setup.watchdog`: LOGICAL keys and JSON-typed values (spec 3.1, 3.2:
  `sensitivity`, `targets` (array), `latency_preset`, `latency_custom_ms`, `loss_preset`,
  `loss_custom_pct`; watchdog `act_after_sec`, `tier3_enabled`, `backup_sim_slot`, ...). The runner
  maps them onto the platform store (UCI strings or JSON). An absent key is absent in the store; an
  empty object is an empty store.
- `setup.files.status`: content for the watchdog state file (`/tmp/qmanager_watchcat.json`);
  `null` = no file. `setup.files.failover`: the SIM failover record; `null` = no record.
  Optional keys, absent = no file (added with Amendments 1 and 3): `ping` (the probe cache,
  `qmanager_ping.json`), `slots` (the per-slot file, `qmanager_ping_slots.json`) and
  `last_outage` (a STRING, the one-line outage file `"<secs> <end_mono> <changed|-> <wan4|-> <wan6|->"`).
  In any file value, the strings `"__MONO__"` (or the bare text `__MONO__` inside a string) and
  `"__NOW__"` are replaced by the runner with the sandbox uptime in seconds and the epoch, so a
  fixture can describe a FRESH cache (`mono: "__MONO__"`) without knowing the clock; a stale one
  uses `"mono": 0` with `"timestamp": 1` (wall-clock fallback, always old).
- `expect.shape`: jq path to type tokens `int num str bool null array object` joined with `|`.
  Paths are checked against the response body with jq only (no regex).
- `expect.equals`: jq path to the exact JSON value (`jq -e 'path == $v'`).
- Optional top-level `"repo": "rm551e"`: the only allowed extra key; the fixture applies to that
  repo only (the RM520N runner skips it). Currently `watchdog/dismiss_sim_swap_ok.json`.
- Harness note: `enabled` saves call `svc_*`; the runner must stub the service functions.

## Decisions pinned by these fixtures (where the contract text is silent)

- Unknown key in a watchdog `save_settings` (including the retired `fail_threshold`,
  `check_interval`): `invalid_field` with `field` = that key. Nothing is ignored.
- Validation is two-pass and ordered; fixtures never combine two invalid fields in one request
  except where the first failing field is unambiguous (`step_wait_sec` after valid keys).
- A JSON string, number or fractional value where an `int` or `bool` is required is
  `invalid_field`.
- `save_thresholds` named presets ignore `custom_*` entirely, even when out of range.
- Every `invalid_field` response carries a string `detail`.
- A `shape` or `equals` path must exist in the response: a missing key fails even when `null` is an
  allowed type (a GET emits every contract key, `null` included).
- `retry_failback` answers success whether or not a failover is active (Amendment 1 B).
- `carrier_enabled` / `carrier_after_min` (5-240) follow the same typing rules as every other key.
- `last_outage` is `null` when the outage file is absent, malformed, or its end stamp is ahead of the
  uptime (garbage reads as none); `live` degrades to `reachable: null`, `last_leg: 0` and four
  `standby` slots when the probe cache is stale, missing, or the slots file is older than the cache window.

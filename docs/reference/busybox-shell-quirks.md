# BusyBox Shell & jq Quirks

This document catalogs shell and jq behaviors that differ from a standard Linux environment and have caused bugs or near-misses in QManager's CGI/daemon backend. Read this before writing backend shell scripts.

## Shell Quirks

### `$(( ))` Fails on Octal-Leading-Zero Time Strings

BusyBox `/bin/sh` arithmetic expansion treats strings like `"08"` and `"09"` as octal literals. `$(( 08 ))` is a syntax error or silently returns 0 depending on BusyBox version.

**Rule:** Never parse `HH:MM` time fields with `$(( hh * 60 + mm ))` in shell. Do all minute arithmetic inside `jq` using `tonumber` (e.g. `"08" | tonumber` is clean). This is why `scenario_block_for_now` and `_scenario_generate_cron_lines` do all time math in jq.

### `pgrep -x` Is Unreliable on BusyBox

BusyBox `pgrep` does not always support `-x` (exact match). Use `kill -0 <pid>` against a known PID file to check liveness instead of searching by process name.

### `ls -h` Does Not Exist on BusyBox

`ls` on OpenWRT BusyBox has no `-h` (human-readable sizes) flag. Use `du -sh` for sizes, or emit raw byte counts and format in the frontend.

### CGI Newline Rule: CRLF Headers Required, LF Body

CGI headers written to stdout must use `\r\n` line endings. The response body uses `\n`. If a `Content-Type: application/json` header is emitted without `\r\n`, the entire CGI output (body included) is silently discarded by the HTTP server — you get zero output, not an error.

## jq Quirks

### Apostrophes Inside Single-Quoted jq Filter Strings Close the Shell Quote

In shell, a single-quoted string ends at the first `'` character — there is no escaping inside `'...'`. Using a contraction (`block's`, `don't`) or any apostrophe inside a `jq '...'` filter argument closes the shell quote and corrupts the argument.

**Rule:** Never use contractions or apostrophes inside jq filter strings passed as `'...'` arguments. This is a POSIX rule, not specific to BusyBox, but easy to miss in long multi-line jq pipelines.

Example — breaks:

```sh
jq -r '.blocks[] | "the block'\''s scenario"' file.json   # awkward but works
jq -r '.blocks[] | "the block's scenario"' file.json      # closes quote at the second '
```

Safe alternatives: use `"` for the string literal inside jq (jq allows both), or restructure to avoid the apostrophe.

### Device jq (1.6) Treats jq Keywords as Reserved in `as $var` Bindings

The jq 1.6 build on RM520N-class OpenWRT targets treats jq language keywords as reserved names in `as $<name>` patterns. Using `as $def`, `as $end`, `as $try`, `as $catch`, `as $reduce`, `as $foreach`, `as $label`, or `as $break` in a filter produces a parse error (`unexpected def`, etc.).

**Rule:** Avoid binding those names. Use `$dflt` instead of `$def`, `$result` instead of `$end`, `$current` instead of any keyword, and so on. `scenario_mgr.sh` uses `$dflt` for exactly this reason.

Affected reserved names (jq 1.6): `def`, `end`, `try`, `catch`, `reduce`, `foreach`, `label`, `break`, `as`, `if`, `then`, `else`, `elif`, `error`, `import`, `include`, `module`.

### `jq // empty` Silently Drops `false`

The alternate operator `//` in jq treats `false` and `null` as "empty" and substitutes the right-hand side. `false // "default"` evaluates to `"default"`. Use `if . == null then "default" else . end` when the value can legitimately be boolean false.

This is why CGI scripts that extract boolean fields use `if . == null then empty else tostring end` rather than the shorter `// empty` pattern.

### `jq -r` on a `null` Prints the Literal String `"null"`

`jq -r '.missing_key'` on a key that does not exist prints the four-character string `null`, not an empty string. Subsequent shell `[ -z "$var" ]` checks pass incorrectly. Use `// empty` (for non-boolean fields) or `if . == null then empty else . end` to produce a truly empty output.

### Null Bytes in Shell Source Are Invalid; SCP Masks the Defect

A NUL byte (`\x00`) embedded in a shell script — for example as a sentinel prefix in a `jq` filter string — corrupts the script at parse time and can break text tooling on the device. The production deploy path (`cp -r` + `tr -d '\r'` in `install.sh`) preserves null bytes verbatim.

SCP-based transfers silently convert null bytes to newlines (`\n`). This means a script that contains a null byte may pass SCP-based on-device tests and then fail in production because the production installer uses `cp`.

**Safe pattern:** use a leading space as a sentinel in `jq` case-pattern guards. A shell `case` glob catches it identically, and a leading space is valid in shell source:

```sh
# CORRECT — leading-space sentinel; valid source, caught cleanly by case glob
val=$(jq -r 'if type != "object" then " not_object" else .field end' file.json)
case "$val" in
    " not_object") cgi_error "bad_field" "..."; exit 0 ;;
esac
```

Using a literal NUL (`\x00`) as a sentinel instead is dangerous: `cp -r` (the production install path) preserves null bytes verbatim, corrupting the script, while SCP silently converts them to newlines — so SCP-based on-device tests pass and production breaks.

This is the pattern used in `network/lan_config.sh`'s `ipaddr` parser (`" not_object"`, `" missing"`, `" not_string"` sentinels).

### `uci delete` + `uci commit` Does NOT Remove the Config File

Running `uci -q delete <section>` and then `uci -q commit <package>` removes the section from UCI's in-memory map and flushes the change, but it does **not** delete `/etc/config/<package>` from disk. On the next `uci get <package>.*`, UCI re-reads the file and the section reappears — it silently resurrects.

**Rule:** After any `uci delete` on a section you intend to fully remove, also run `rm -f /etc/config/<package>` to remove the backing file. The Tailscale uninstall path (both `tailscale.sh` and `uninstall.sh`) demonstrates this pattern: `uci -q delete tailscale && uci -q commit tailscale` is always followed by `rm -f /etc/config/tailscale`.

This is an OpenWRT/UCI behavior, not specific to BusyBox shell. It affects any CGI or script that removes a package-owned UCI section and then checks whether the section is gone.

## Known Debt — Cron Writers Without Crond Reload

The existing scheduler subsystems — `tower/schedule.sh` (`qmanager_tower_schedule`), scheduled-reboot, and low-power (`system/settings.sh`) — write the crontab via `crontab -` without issuing `( /etc/init.d/cron reload & )`. This means they share the "dormant crond" gap: on a device that has never had a crontab, the schedule writes correctly but crond never fires because procd has not spawned it yet.

`scenario_install_cron` (`scenario_mgr.sh`) now handles this for the scenario scheduler. The other schedulers have not been updated and remain affected. A future pass should unify cron install across all scheduler subsystems with the reload idiom.

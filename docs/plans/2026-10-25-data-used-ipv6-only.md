# Data Used: count an IPv6-only data call through WDS

Status: approved 2026-10-25, built (broker 0.6.1), host tests green; on-device validation pending. Large change (QMI broker path). Closes the "Known gap" in `docs/features/qmi-lane.md` (WDS packet statistics).

## Problem

`data_call::default_mux` only reads the IPv4 default route in `/proc/net/route`. A v6-only call (APN IP type IPv6) has no such route, so `mux = None`, nothing is bound, `qmi_wds_ok` is empty and Data Used falls back to the netdev counter (which undercounts on this platform because of IPA offload).

## Evidence (RM551E, 2026-10-25, read-only; the unit has an IPv4 call only)

- `/proc/net/ipv6_route` columns: `dest(32 hex) plen(2) src(32) splen(2) next_hop(32) metric(8) refcnt(8) use(8) flags(8) iface`. Today it holds only `fe80::/64` on `eth0`/`br-lan`, `lo` and the `ffff::/ff00::` rows, plus the kernel's reject default on `lo` (`metric ffffffff`, flags `00200200`). No `rmnet_data0` row at all: `rmnet_data0` has `disable_ipv6=1` and `accept_ra=0` while the call is v4-only.
- `netmgrd` strings: it sends its own router solicitations and disables kernel `accept_ra` (`failed to disable ipv6 accept_ra`), and logs `GatewayIPv6 addr` / `Gateway IPV6 Prefix len` from the QMI route lookup. I could not find the command it uses to install the v6 default route (not an `ip -6` shell-out), so **whether a v6-only call shows a default route on `rmnet_data<N>` is the one thing only a real v6 call can prove** (checklist below).
- The mux id belongs to the PDN, not the IP family: a dual-stack call has one `rmnet_data<N>` carrying both families, so N + 1 is the same rule for a v6-only call. The endpoint check (`rmnet_ipa0`) is unchanged.

## Design

Discovery only; the registry, codec, allow-list, env contract and consumer do not change.

1. `data_call.rs`: add `default_mux6(ipv6_route)`: first column a default route (`dest` all zero, `plen` `00`), flags has `RTF_UP` (`0x1`) and not `RTF_REJECT` (`0x200`), iface `rmnet_data<N>`, lowest metric (hex) wins, mux N + 1; same overflow guards as v4. No `unwrap`/indexing; short or odd lines skipped.
2. Optional fallback in the same function, **your call whether to keep it**: if no v6 default route exists, take a global-scope route (not `fe80::/10`, `ff00::/8`, `::1`) on `rmnet_data<N>` when exactly one such iface exists (covers a platform that installs only the address/prefix route). Ambiguous (two ifaces) = no mux. Default: keep it, because `accept_ra=0` makes "no default route in a working v6 call" plausible. Risk: a lone IMS PDN with a global prefix would be counted when there is no internet call; that is small traffic and fails closed in the sense that it never touches the call.
3. `Call` gains `v4: bool` / `v6: bool` (which default route(s) back the mux). `mux = v4 mux if present else v6 mux`. If the v4 default exists and the v6 default is on a **different** `rmnet_data`, the v6 client reads out-of-call (adds 0), same as today; per-family muxes (the cheap first step to multi-PDN later) stay out of scope.
4. `qmi_snapshot.rs::read_wds`: read a family when its route is present this cycle **or** it read ok last cycle (`wds_prev_ok`). So a v6-only call binds and reads the IPv6 client alone (no v4 bind, no `wds4` warn noise), and a family whose route flaps while the call lives keeps being read, so the sum never shrinks. Fail-closed rules unchanged: a family that was ok and now fails with anything but `0x000F` makes `ok` 0 for that cycle; bind failures retry at most every 30 s; nothing is read without a fresh bundle; `qmi_wds_mux` reports the bound mux.
5. Unchanged on purpose: `BROKER_CONFIG` / `BROKER_READ` membership and their allow-list tests, no `0x0086`, 128 KiB stacks, state-change-only logging (one new info line when only v6 is bound is the existing `qmi wds6 bound to mux N` line).

Crate version: bump 0.6.0 -> 0.6.1 so `qmanager_atd` reports a distinguishable build on the device (the `qmi_wds_*` contract is unchanged). Say no if the lifecycle session is pinning 0.6.0.

## Tests (host, `cargo test --release` and `--features poll`)

- `data_call`: v6 default on `rmnet_data0` = mux 1; `rmnet_data5` = 6; lowest metric wins; reject/`lo`/`br-lan`/non-default/down/short/overflow rows give none; v4 wins over v6; fallback single-iface and ambiguous cases (if kept).
- `qmi_snapshot` (fake QRTR): v6-only route file -> only the V6 client binds and reads, V4 client sends nothing, `ok=1`, bytes = v6 bytes, `qmi_wds_mux` set; v6-only -> dual-stack (v4 route appears) binds V4 and the sum grows; v4 route vanishing while v4 was ok keeps reading it (no shrink); mux change on a v6-only call rebinds; SSR replay rebinds the v6 client; no `rmnet_ipa0` still binds nothing.
- Unchanged and still passing: client refusal of the WDS binds / `0x0024`, one-shot registry has no internal clients.
- Cross-compile check for `aarch64-unknown-linux-musl` if the toolchain is present; report artifact path + md5. Nothing is deployed.

## Docs

Only the WDS lines of `docs/features/qmi-lane.md` (mux id rule, Known gap) and the matching note in `docs/features/data-used.md`; the parser doc comment in `data_call.rs`.

## Risks

- The v6 default route might not exist on `rmnet_data<N>` in a v6-only call (mitigated by the fallback). If neither shows, behaviour is exactly today's (netdev fallback), never worse.
- `/proc/net/ipv6_route` read every 2 s: a few KB, same cost class as the v4 read.
- A v6 route on an `rmnet_data` that is not the internet PDN (IMS) when there is no v4 call: counted as if it were the call. Only reachable through the fallback.

## Rollback

Revert the commits (discovery-only). Previous 0.6.0 binary keeps working with the same sidecar; the consumer's `cur < prev` rule absorbs any counter restart.

## On-device validation checklist (needs a v6-only call and your OK to change the APN IP type; nothing run yet)

1. Before: `cat /proc/net/ipv6_route | grep rmnet_data` and `ip -6 route` while on the v6-only profile. **Confirm an `rmnet_data<N>` default row exists** (flags `...03`, not `...0200`); if only a global prefix row exists, the fallback is required.
2. Deploy the built binary (with your OK, after the lifecycle session is done); `logread | grep qmi` shows `qmi wds6 bound to mux N` and no `wds4` bind line.
3. `cat /var/run/qmanager/qmi.env | grep qmi_wds`: `ok='1'`, `mux` = N + 1 of the netdev, rx/tx growing.
4. Parity: 100 MB download from the modem (and one LAN client download) moves rx by about that amount; compare with `QCMAP_CLI` v6 statistics (family 10) over a few minutes.
5. `/cgi-bin/quecmanager/network/data_used.sh` reports `source:"wds"`; no regression of the dashboard row.
6. Dual-stack switch (APN type IPv4v6): v4 client binds, sum continues without a drop; back to IPv4-only: unchanged from today.
7. SSR (only with your OK): after the recovery the v6 client rebinds and `ok` returns to 1.

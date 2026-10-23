# PCIe ASPM policy setting (Ethernet page)

## Findings (live modem, read-only)

- `cat /sys/module/pcie_aspm/parameters/policy` → `default [performance] powersave powersupersave`. The bracket marks the active value, so this modem **is already on performance**.
- QManager didn't set it. A third-party package, `/etc/init.d/sdxpinn-patch` (S14), writes `performance` at boot. Its comment says the platform defaults to `powersupersave`, which causes TX watchdog timeouts on the RTL8125 (`10ec:8125`, `0000:01:00.0`) and adds PCIe latency. Stock modems without that patch boot on `powersupersave`.
- `quecmanager.eth_link` exists with `speed_limit='auto'`. `qmanager_eth_link` (START=99) runs after S14, so a QManager setting wins.

## Design

**UCI:** `quecmanager.eth_link.aspm_policy` ∈ `default|performance|powersave|powersupersave`.

**Seeding (`install.sh` `seed_uci_defaults`):** set `performance` only when the option is absent. That covers fresh installs and also upgrades from builds that predate this setting. A user's later choice is never overwritten.

**Boot (`init.d/qmanager_eth_link` `start()`):** apply `aspm_policy` to sysfs **first**, before the speed-limit early return. Skip if the file is missing, the option is unset, or the value is already active. Log via `logger`.

**CGI (`network/ethernet.sh`):**
- **GET** adds:
  - `aspm_policy`: the live value in brackets from sysfs
  - `aspm_configured`: UCI
  - `aspm_supported`: whether the sysfs file exists
- **POST** accepts `speed_limit` and/or `aspm_policy` (at least one; each validated by `case`).
- An ASPM write is synchronous `echo > policy` plus a read-back verify. It does not bounce the link, so the response has no disconnect window.
- When the POST also carries `speed_limit`, the existing async ethtool apply runs as it does today.
- The read-back failing returns error `aspm_apply_failed`.

**UI (`speed-limit-card.tsx`, renamed to `EthernetPortCard` / `ethernet-port-card.tsx`):**
- Title "Ethernet Port", description "Set the port's link speed and how the modem powers its ethernet controller."
- Second row "PCIe power saving" with a Select: Performance (recommended), Kernel default, Power saving, Max power saving. The consequence line names the trade-off. The row is hidden when `aspm_supported` is false.
- One `CardFoot` Apply commits both drafts in one POST. An ASPM-only change skips the disconnect wait and the confirm-poll, then confirms against the GET read-back.
- Toasts and all copy go through `t()` in all 5 catalogs (en, zh-CN, zh-TW, it, id).

**Docs:** `API-REFERENCE.md` ethernet section, `BACKEND.md` init row, and a `RELEASE_NOTE.md` bullet.

## Build (orchestrated)

1. **backend-writer** (Sonnet): `ethernet.sh`, `qmanager_eth_link`, `install.sh` seed.
2. **Main session** (in parallel, via Impeccable craft): the card, `types.ts`, `ethernet-status.tsx`, the 5 locale files.
3. **validator**: CRLF, BusyBox, and envelope audit, then a deploy of the 2 scripts with a live check.
4. **docs-writer** (Haiku/Sonnet): the doc updates.

Work happens in a worktree off `development-home`.

## Risks / lifecycle

- **Live write needs your OK.** On-device validation will flip the policy `performance → default → performance` once. It shouldn't drop eth0, because ASPM policy changes don't retrain the link, but that is the step most likely to cause a hiccup on the RTL8125.
- **Uninstall:** nothing to revert. The policy is runtime-only and resets on the reboot at the end of uninstall. The UCI section goes away with the `quecmanager` config, as it does today.
- **Update path:** same `seed_uci_defaults` call, so it stays in lockstep.
- **Rollback:** revert the commits. Removing the option makes the boot script a no-op.

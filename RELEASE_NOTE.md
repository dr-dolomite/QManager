# 🚀 QManager BETA v0.1.24

## ✅ Improvements

- **Tower Locking carrier picker now shows EARFCN/ARFCN values.** Each option in the LTE and NR-SA Simple Mode dropdowns now displays a PCC/SCC tag, the band, the channel number in parentheses, and RSRP in dBm — making it easier to identify the right carrier at a glance.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.23

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

If QManager saves you time, consider [sponsoring on GitHub](https://github.com/sponsors/dr-dolomite) or sending GCash via Remitly to **Russel Yasol** (+639544817486).

**License:** MIT + Commons Clause — **Happy connecting!**

---

# 🚀 QManager BETA v0.1.23

A reliability and polish release.

## ⚠️ Heads Up Before Updating

**Tailscale users:** This update swaps Tailscale to a smaller, firmware-upgrade-friendly package (`tailscale-tiny`). Your node stays authorized — no re-login needed. Expect a ~5–15 second tunnel drop during the swap. **If you're managing this device remotely over Tailscale, update from a local connection instead.**

## ✨ New Features

- **Force Tailscale Fixes toggle.** New opt-in switch in System Settings re-applies QManager's own firewall zone and mwan3 routing fixes for `tailscale0` on top of any firmware. Recommended for R02 firmware users where outbound reply packets get marked for WAN egress and never traverse the tunnel. Off by default; survives reboots once enabled.

## ✅ Improvements

- **Fixed Video Optimizer / Traffic Masquerade going silent after firewall changes.** Any firewall reload — VPN install, port forward save, mwan3 refresh — would silently wipe the DPI rules, leaving the feature appearing active but doing nothing. Rules now survive all firewall reloads and reboots. *(Deployed as a permanent fw4 nftables fragment.)*
- **Fixed Custom SIM Profile activation failing with "start_failed".** Manual activation from the UI consistently failed while boot auto-activation worked fine. The backend's two concurrency locks were sharing one file, causing the apply worker to treat its own launcher as a conflict and abort. Locks are now separate.
- **Fixed Cancel / Close buttons showing English in translated UIs.** Buttons in Custom Profiles, Connection Scenarios, SMS, and AT Terminal dialogs now respect the active language instead of falling back to `cancel` / `close`.
- **Tailscale migrated to `tailscale-tiny`.** Smaller install, survives firmware upgrades without reinstall.

## 🌐 Translations

- Italian (it) and Indonesian (id) language packs updated to v2026.05.03.

### Changes in v0.1.23 (for contributors)

**Added** — `system-settings.json` → `system.*`:

| Key | English source string |
|---|---|
| `force_tailscale_fixes_label` | `Force Tailscale Fixes` |
| `force_tailscale_fixes_info_aria` | `Force Tailscale Fixes info` |
| `force_tailscale_fixes_tooltip` | `Applies QManager's own Tailscale firewall and routing fixes on top of your firmware. Recommended for R02 firmware.` |
| `force_tailscale_fixes_toast_enabled` | `Force Tailscale Fixes enabled — applying firewall zone and mwan3 exception` |
| `force_tailscale_fixes_toast_disabled` | `Force Tailscale Fixes disabled — removing firewall zone` |
| `force_tailscale_fixes_toast_failed` | `Failed to update Force Tailscale Fixes` |

**Modified:** none.
**Removed:** none.

Want to contribute? No coding needed — see [`docs/i18n/CONTRIBUTING.md`](https://github.com/dr-dolomite/QManager/blob/development-home/docs/i18n/CONTRIBUTING.md).

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.22

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

If QManager saves you time, consider [sponsoring on GitHub](https://github.com/sponsors/dr-dolomite) or sending GCash via Remitly to **Russel Yasol** (+639544817486).

**License:** MIT + Commons Clause — **Happy connecting!**

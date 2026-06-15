# 🚀 QManager BETA v0.1.28

This release patches a stability regression on RM551E-class modems: periodic ~15-second connection drops that occurred on a clock-regular cadence when the dashboard was left unattended. No new features; no configuration changes needed.

## ✨ New Features

None in this release.

## ✅ Improvements

- **Resolved periodic ~15-second connection drops on RM551E-class modems.** QManager's background polling was querying the modem's data-plane subsystem on every scheduled check — even while the dashboard was closed. On v4-only carriers, the modem firmware runs a continuous IPv6 setup retry loop that puts that subsystem under sustained stress; probing it in the background on top of that amplified the load and triggered a predictable baseband restart roughly every 1 hour 40 minutes, knocking connectivity for ~15 seconds each time. The fix restricts data-plane interrogation to when the dashboard is actively open. When unattended, the poller is signal-only — the same proven-safe pattern used by QManager's predecessor. Connection detail fields (WAN IP, APN, DNS, cell distance, active MIMO) retain their last-known values while you are away and refresh the moment you open the dashboard.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.27

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

# 🚀 QManager BETA v0.1.27

This release cuts background modem load when the dashboard is idle and deepens the Debug Report so random disconnections and hard lock-ups can be diagnosed from a single capture. It also brings a round of refinements: a simpler APN form, a calmer and steadier System Logs page, more accurate IP Passthrough reporting, and a tidier System Settings layout.

## ✨ New Features

- **Adaptive Polling — QManager now eases off the modem when you're away.** When no browser is viewing the dashboard, QManager automatically slows down how often it checks the modem — stepping from a 2-second rate down to every 15 s (idle) and then every 60 s (deep idle). The moment you open the dashboard, full-speed updates resume within about 2 seconds. Automated actions like scenario activation and SIM profile switching still take effect immediately in the background. This cuts unattended background traffic to the modem by roughly 97%. Configurable under **System Settings → Adaptive Polling**.

## ✅ Improvements

- **APN settings simplified.** The APN page is now a single, clear form — one APN, one PDP type, one context ID — instead of five labelled profile slots. Your saved APN is automatically re-applied after reboots and SIM changes. If a Custom SIM Profile is active, it still takes priority and the APN form goes read-only as before.

- **Device Information now shows your active APN.** The Device Information card on the dashboard now lists the APN your modem is connected with, right below the build date. The rarely-useful "LTE Category" entry has been removed to make room for it.

- **SSH Password now lives inside System Settings.** Changing the modem's SSH/root password no longer has its own page. It's now an expandable section at the bottom of the System Settings card, just below Save Settings — same form, one less place to hunt through.

- **IP Passthrough settings now report correctly for non-default configurations.** NAT mode, USB protocol, and DNS offloading were always shown as their defaults (WithNAT, ECM, DNS off) regardless of what the modem actually had configured. This only affected users who had set WithoutNAT, a non-ECM USB protocol, or enabled DNS offloading. The settings page now reads the modem's true state correctly in all cases.

- **System Logs filtering is calmer and steadier.** Changing a level, picking a component, or searching no longer blanks the whole panel — the toolbar stays in place and only the table reloads, so searches no longer lose focus mid-word. Log level tags now use QManager's quiet outline style instead of solid blocks, a failed load shows a clear Retry instead of looking empty, and you can now copy the visible log lines, clear all filters in one click, or click a component name to filter by it.

- **The Debug Report now captures crash evidence.** Hitting Capture in the Diagnostics card now also records your modem's hardware-watchdog status, any baseband (cellular modem) crash dumps the device has saved, and kernel crash markers (panics, hangs, subsystem restarts). If your modem drops the connection at random or locks up hard enough to need a power cycle, the report now contains the evidence needed to pin down whether it is a recoverable modem restart or a deeper firmware-level hang — without needing SSH access. Modem crash dumps are listed by name and date only, never copied in full, so the report stays small and safe to share on a GitHub issue.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.26

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

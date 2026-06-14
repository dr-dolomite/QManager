# 🚀 QManager BETA v0.1.27-draft

This release deepens the Debug Report so random disconnections and hard lock-ups can be diagnosed from a single capture.

## ✅ Improvements

- **APN settings simplified.** The APN page is now a single, clear form — one APN, one PDP type, one context ID — instead of five labelled profile slots. Your saved APN is automatically re-applied after reboots and SIM changes. If a Custom SIM Profile is active, it still takes priority and the APN form goes read-only as before.

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

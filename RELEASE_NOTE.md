# 🚀 QManager BETA v0.1.35

v0.1.35 adds one new setting: PCIe power saving for the ethernet port, which now defaults to Performance. Modems that shipped with aggressive power saving on the ethernet controller can see dropouts and extra latency on the LAN port, and QManager now keeps that controller fully awake unless you choose otherwise.

## ✨ New Features

- **PCIe power saving for the ethernet port.** The Ethernet Status page's speed card is now **Ethernet Port** and gains a **PCIe power saving** setting: Performance (recommended), Kernel default, Power saving or Max power saving. Changing it never drops the link, and your choice is reapplied on every boot.
- **Performance by default.** New installs and upgrades set PCIe power saving to Performance, since the platform's own default can cause ethernet dropouts and added latency. If you have already picked a setting, it is kept.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.34

**System Settings → Software Update.** No migration steps needed. The new Performance default takes effect after the next reboot, or right away if you apply it from the Ethernet Port card.

## 💙 Thank You

Special thanks to Outright0181 for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

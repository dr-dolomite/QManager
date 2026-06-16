# 🚀 QManager BETA v0.1.29

## ✨ New Features

None in this release.

## ✅ Improvements

- **Reduced background radio queries on RM551E devices.** QManager no longer queries MIMO layers, timing advance, APN details, and WAN IP on a recurring background timer. These are now read only while you are viewing the page that displays them, and stop as soon as you navigate away. This matches the lighter-touch behaviour of the predecessor app and removes a class of background radio commands suspected of contributing to the random baseband restarts seen on some RM551E modems.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.28

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

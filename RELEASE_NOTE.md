# 🚀 QManager BETA v0.1.32 (Draft)

v0.1.32 is in progress. This release is shaping up as a polish and correctness pass. Notes below are provisional and will be rewritten before release.

## ✅ Improvements

- **5G bands are now labeled correctly in the Cell Scanner.** NR5G cells show an `N` prefix (`N41`, `N71`) instead of the LTE-style `B` prefix. LTE cells still use `B`.
- **5G channel bandwidth is now shown in MHz, not raw resource blocks.** The Cell Scanner's BW column converts each NR carrier's resource-block count to its true channel bandwidth using the subcarrier spacing — e.g. an n41 carrier now reads 90 MHz instead of 245 MHz. If the modem doesn't report a spacing for a cell, the raw block count is shown labeled "PRB" rather than a misleading MHz figure.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.31

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

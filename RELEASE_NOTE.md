# 🚀 QManager BETA v0.1.34

v0.1.34 is a hotfix for v0.1.33 with one fix: modems on RM551E R01A04 firmware no longer keep dropping their connection. There are no new features, and nothing else changes from v0.1.33.

## ✅ Improvements

- **Fixed repeated disconnects on RM551E R01A04 firmware.** QManager left the modem's extended carrier-aggregation reporting switched on all the time, which made R01A04 drop the connection again and again. It is now switched on only for the moment each reading is taken, so 5G carrier details still show in full. Thanks to No_way for testing the patch first.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.33

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Special thanks to Outright0181 for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

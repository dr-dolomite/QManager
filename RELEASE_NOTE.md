# 🚀 QManager BETA v0.1.36-draft

v0.1.36 is a polish release focused on how much work the web interface asks of the modem. Background tabs now stay quiet, every page request starts faster, and open tabs share one detailed radio reading, so the modem spends less time answering the browser and more time idle.

## ✅ Improvements

- **Lighter on the modem while the web page is open.** Background tabs no longer refresh the dashboard, so the modem drops to its slower idle checks when nobody is watching, and each tab catches up the moment you return to it. Every page request now starts faster (status and sign-in checks take about a third of the time they did), several open tabs share one detailed radio reading instead of each asking the modem separately, and routine log lines no longer crowd the system log.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.35

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Special thanks to radiomean for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

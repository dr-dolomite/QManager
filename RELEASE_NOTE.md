# 🚀 QManager BETA v0.1.36-draft

v0.1.36 adds heat-throttling detection, cuts how much work the web interface asks of the modem, and makes the internet check faster and more honest. Background tabs now stay quiet, every page request starts faster, and open tabs share one detailed radio reading. The connection check now falls back to a second provider and reports an outage within the time its sensitivity setting promises.

## ✨ New Features

- **Thermal throttling detection.** When the modem slows part of its radio, processor or Ethernet port because it is running hot, the dashboard now shows a "Throttling" chip naming what is affected (for example 5G or LTE). The temperature meter also shows how far the modem is from its throttling point ("Throttles at 110 °C", then "8 °C below throttling" as it gets close), and the Activity feed logs when throttling starts and when it clears. You can turn on an optional SMS or email alert on the Alerts page (off by default): it is sent once per throttling episode, after your usual "Wait before alerting" time. System Health Check has a new Thermal throttling item that warns while the modem is throttling.

## ✅ Improvements

- **Faster, more honest outage detection.** When the main probe target stops answering, QManager now checks a second provider (Google or Cloudflare, whichever you are not already using) and IPv6 at the same time, so one unreachable server no longer reads as "internet down". A real outage is reported within the time the selected sensitivity promises (about 7 seconds on Sensitive, about 35 seconds on Quiet) instead of up to twice that, and latency history is no longer reset when the answering server changes.
- **Lighter on the modem while the web page is open.** Background tabs no longer refresh the dashboard, so the modem drops to its slower idle checks when nobody is watching, and each tab catches up the moment you return to it. Every page request now starts faster (status and sign-in checks take about a third of the time they did), several open tabs share one detailed radio reading instead of each asking the modem separately, and routine log lines no longer crowd the system log.
- **Carrier aggregation details come from the modem's fast data channel whenever it is available.** The modem gets far fewer carrier status commands, and secondary carriers no longer show a misleading 0 dB SINR.
- **New browser-tab icon.** The tab icon now matches the QManager logo used across the interface, in place of the old one.
- **Cleaner Network Priority page.** The technology the modem is currently using now shows the same green check as IMEI Settings in place of its rank number, replacing the separate "Serving now" badge.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.35

**System Settings → Software Update.** No migration steps needed.

### Install from the SDXPINN software feed

QManager is also the `sdxpinn-qmanager` package in iamromulan's SDXPINN feed. In LuCI, open **System → Software**, click **Update lists**, then install `sdxpinn-qmanager`, or run:

```sh
opkg update && opkg install sdxpinn-qmanager
```

This works on a fresh modem and over an existing QManager install, and your settings are kept. Reboot when QManager asks you to. Language packs you downloaded need to be installed again afterwards. From then on, update QManager from the same Software page (or `opkg upgrade sdxpinn-qmanager`); the in-app Software Update page will say the install is managed by the package manager. The package can appear in the feed a little later than this release.

## 💙 Thank You

Special thanks to radiomean for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

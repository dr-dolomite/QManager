# 🚀 QManager BETA v0.1.36-draft

v0.1.36 adds a History section that shows how your connection and your modem have behaved over the last month, adds heat-throttling detection, cuts how much work the web interface asks of the modem, and makes the internet check faster and more honest. Background tabs now stay quiet, every page request starts faster, and open tabs share one detailed radio reading. The connection check now falls back to other targets and reports an outage within the time its sensitivity setting promises, and the Connection Watchdog is rebuilt so its settings are in seconds, it explains what it is doing, and it can recover from a stuck single carrier.

## ✨ New Features

- **Cellular History.** A new History section in the sidebar opens a Cellular History page that shows how your connection has behaved over the last 5 minutes, hour, day, week, 15 days or month. Pick a range on the compact switch at the top: the 5-minute view (the default) draws 10-second steps and refreshes every 10 seconds, and the short views start over after a restart. A connection timeline shows when you were on 5G, on LTE or without service, including the short gaps when the modem's radio crashes and restarts itself, so a short drop stays visible even in the 30-day view. Charts show signal strength and quality (RSRP, SINR, RSRQ and RSSI) with the range and average for each period, and summary tiles show how long you have been connected, your last outage, availability and time on 5G. A radio events log lists signal losses with how long each one lasted, plus band, carrier and cell changes, and you can filter it by type. History is collected quietly in the background without asking the modem for anything extra, and is kept for 31 days. The page says "Collecting" until there is enough data to draw.
- **Connection History.** A new page under History shows how your internet connection has behaved over the last 5 minutes, hour, day, week, 15 days or month, and keeps 31 days of it. See at a glance when you were online, when you dropped, and when the link was slow or losing packets, with charts for latency, packet loss, jitter and DNS lookup time, your own limits drawn on them, and a list of outages, slow spells, Watchdog recoveries and SIM failovers with how long each lasted. It replaces the Latency Monitor: old links still land here, and the website speed list moved onto this page with an optional live mode (in Manage) for second-by-second readings and a detail view for each site.
- **System Health history.** A new System Health page under History shows how the modem itself held up over the last 5 minutes, hour, day, week, 15 days or month. A stability timeline shows when the device restarted, when the modem crashed and recovered on its own, and when heat slowed it down. Each restart says why: unexpected, a scheduled restart, a software update, a restart from QManager, or the connection watchdog, and shows how long the device was offline. Charts show processor use, memory use and the hottest temperature inside the modem (with the point where it starts throttling), and a storage card shows how full the system, app data and temporary areas are. A System events list names every restart, crash and throttling episode. Like Cellular History, it collects in the background without asking the modem for anything extra, keeps 31 days, and says "Collecting" until there is enough data. After a restart, all History pages are back within about five minutes.
- **Thermal throttling detection.** When the modem slows part of its radio, processor or Ethernet port because it is running hot, the dashboard now shows a "Throttling" chip naming what is affected (for example 5G or LTE). The temperature meter also shows how far the modem is from its throttling point ("Throttles at 110 °C", then "8 °C below throttling" as it gets close), and the Activity feed logs when throttling starts and when it clears. You can turn on an optional SMS or email alert on the Alerts page (off by default): it is sent once per throttling episode, after your usual "Wait before alerting" time. System Health Check has a new Thermal throttling item that warns while the modem is throttling.
- **Recover from a stuck single carrier.** A new optional Watchdog trigger (off by default, on the Watchdog page) watches for the modem sitting on one carrier when it should be aggregating. If that lasts longer than you choose (15 minutes by default), the Watchdog re-registers on the network and, if needed, restarts the radio to bring the extra carriers back. It never reboots or switches SIM for this, and the connection drops briefly when it acts, so your WAN IP may change.
- **A Watchdog that explains itself.** The Watchdog page now says why it is acting (no internet, poor quality or one carrier), counts down to its next step, shows what it last fixed and how long that took, and tells you when it is resting after trying everything or paused because the radio is off. "Start recovery after" is set in seconds, so it means the same thing at every sensitivity.
- **Reactions and pinned messages in SMS.** Hold or right-click a message (or use the + beside it on a computer) to react with a heart, star, memo or pushpin. A reacted message gets a ring in its emoji's colour so it stands out in the thread. Pinning a message with the pushpin also lifts it above the conversation, tap it to jump back to the message, expand to see every pinned message, or unpin it. Reactions and pins are saved in this browser.
- **One Logs page.** Logs now has a single page, the last one under History, showing what QManager and the modem wrote to their logs, newest first, on separate QManager and System tabs (System can switch to the kernel log). It shows 10 lines per page by default, with a rows-per-page choice and buttons to jump to the first, previous, next or last page, and you can still refresh, copy or clear QManager's log from the top of the page. On the QManager tab, three tiles show how many errors and warnings were logged, when the latest one happened and what logged it, and how big the log file is. The System tab has three matching tiles: errors and warnings, the latest problem, and how much time the system log covers (it warns when one process is filling it), or, on the kernel log, how long the modem has been up.
- **Last outage at a glance.** The dashboard and the Connection Quality page show how long the last outage lasted, how long ago it ended, and whether your WAN IP changed.

## ✅ Improvements

- **Faster, more honest outage detection.** The connection check now has four targets you can edit, and when the first stops answering QManager tries the others at the same time, so one unreachable server no longer reads as "internet down". A real outage is reported within the time the selected sensitivity promises (about 8 seconds on Sensitive, about 40 seconds on Quiet) instead of up to twice that, and latency history is no longer reset when the answering server changes.
- **One home for every connection setting.** Sensitivity, the four targets and the slow-connection limits now live only on the Connection Quality page, and the Watchdog follows them. The Watchdog no longer has its own check-speed setting or its own latency and loss limits, so changing one place changes everything that depends on it.
- **The Watchdog no longer switches itself off.** Reaching the hourly reboot limit used to turn the Watchdog off. Now it just stops rebooting until the hour passes and keeps using its gentler steps. If the limit was also hit in the previous hour and the connection never came back, it waits for the connection (or a day) before rebooting again, so a modem with no coverage does not reboot itself in a loop.
- **A stalled internet check is noticed and restarted.** If the check stops reporting for five minutes, the Watchdog flags it and starts it again. System Health Check now pings the first target you chose.
- **Backups include Connection Quality.** Config Backup can save and restore Sensitivity, targets and limits, and older backups still restore (their Watchdog settings are converted).
- **Upgrading and going back.** Your Watchdog and Connection Quality settings are converted automatically on update, including your old "start after N failed checks" setting, which becomes the same wait in seconds. Reinstalling the previous release restores your earlier values, except the old check-speed override, which is gone. A backup that includes Connection Quality cannot be restored on older releases. Prometheus watchdog metrics keep their names.
- **Lighter on the modem while the web page is open.** Background tabs no longer refresh the dashboard, so the modem drops to its slower idle checks when nobody is watching, and each tab catches up the moment you return to it. Every page request now starts faster (status and sign-in checks take about a third of the time they did), several open tabs share one detailed radio reading instead of each asking the modem separately, and routine log lines no longer crowd the system log.
- **Carrier aggregation details come from the modem's fast data channel whenever it is available.** The modem gets far fewer carrier status commands, and secondary carriers no longer show a misleading 0 dB SINR.
- **The password you choose at setup now also signs you in over SSH.** Setup used to leave SSH on the modem's factory password, so a fresh install could not be reached over SSH with the password you just created. If SSH cannot be set, setup still finishes and tells you to change it in Device Access.
- **New browser-tab icon.** The tab icon now matches the QManager logo used across the interface, in place of the old one.
- **Cleaner Network Priority page.** The technology the modem is currently using now shows the same green check as IMEI Settings in place of its rank number, replacing the separate "Serving now" badge.
- **Language packs now include the History pages.** A downloadable language pack must carry translations for the new History pages, so they are never left in English. Packs published before this release are updated to include them; reinstall yours from the Languages page after updating.
- **Refreshed SMS message bubbles.** Messages in the SMS conversation now use a shared bubble component, so sent, received and failed messages keep their familiar colours while sharing one consistent shape.

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

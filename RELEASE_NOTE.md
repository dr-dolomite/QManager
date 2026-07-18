# 🚀 QManager BETA v0.1.31

v0.1.31 delivers a redesigned Connection Watchdog page, a unified SMS + email Alerts page with optional reboot notifications, and a critical SIM-profile reliability fix.

## ✨ New Features

- **Redesigned Connection Watchdog page.** A live-status hero shows current state, failed checks, recoveries, reboots this hour, quality breaches, and which recovery steps are armed. Detection, Quality, and Recovery settings share one tabbed card with a sticky save bar. A new Recovery Activity log lists recent recovery and SIM-failover actions.
- **Unified Alerts page.** SMS and email alerts now live on a single Monitoring page with a live readiness view, a shared activity log, and per-event control over which channel notifies you (SMS, email, or both). Existing settings carry over unchanged. SMS covers the instant a disconnect happens; email follows up once the connection is back.
- **Opt-in reboot alerts.** A new reboot alert (off by default) tells you when your modem restarted and why — watchdog recovery, planned reboot, or unexpected. A Recent Reboots list shows all recent restarts regardless of whether the alert is on.

## ✅ Improvements

- **SIM switch now waits for slot verification before applying a profile.** Fixes cases where the modem reported a successful switch but stayed on the old SIM, causing the wrong profile (or none) to activate.
- **Email alerts no longer fire premature "recovered" notices** during active recovery attempts.
- **Rapid back-to-back SIM switches now always settle on the correct profile.**
- **Profiles saved via "Load from SIM" now match consistently** — ICCID reads are uniform everywhere, preventing match failures.
- **Screen readers announce watchdog state changes** in real time.
- **Invalid fields now auto-focus on save** — the UI jumps to the problem tab and field.
- **Cooldown and SIM-settle countdowns only appear when active**, including the full ~90 s settle window after a SIM swap.
- **The Alerts page is fully localized** in Italian, Indonesian, and Chinese (Simplified and Traditional).
- **Fixed the public Overview page redirecting to the login screen** almost immediately after loading. Logging out now returns you to the Overview splash instead of the bare login form.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.30

**System Settings → Software Update.** No migration steps needed. Your existing Watchdog settings carry over as-is.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

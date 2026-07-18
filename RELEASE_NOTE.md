# 🚀 QManager BETA v0.1.31

v0.1.31 pairs a ground-up redesign of the Connection Watchdog page with an important Custom SIM Profiles reliability fix, and unifies SMS and email downtime alerts into a single Alerts page. The watchdog moves to a single-column, status-first anatomy — a live status hero, one tabbed settings panel with a sticky save bar, and a new recovery history log — while SIM switching now verifies the slot change actually happened before applying a profile, fixing cases where the wrong profile (or none) was applied after switching SIMs. Alerts brings the old separate SMS and Email alert pages together in one place with a live readiness view, a shared activity log, and per-event control over which channel notifies you.

## ✨ New Features

- **Connection Watchdog has a new status-first layout.** The page now opens with a Live Status card showing exactly what the watchdog is doing right now — its current state, failed checks, total recoveries, reboots this hour, and (new) a live count of connection-quality breaches, plus a read-only view of which recovery steps are armed. Below it, Detection, Quality, and Recovery settings live together in one tabbed card with a single sticky save bar, so you always know whether your changes are saved. A new Recovery Activity card lists the watchdog's recent recovery and SIM-failover actions in one place.
- **SMS and email alerts now live on one Alerts page.** The former separate SMS Alerts and Email Alerts pages are combined into a single page under Monitoring, with a live readiness view showing whether each channel is ready to send, a shared activity log for both, and one place to choose — per event — whether a disconnect or a recovery notifies you by SMS, email, or both. Email can't reach you the instant a disconnect happens (it needs the internet connection that just went down), so SMS covers that moment instead; email still notifies you once the connection is back. Your existing SMS and email alert settings carry over unchanged — nothing to reconfigure.

## ✅ Improvements

- **SIM switching now verifies the slot change actually took effect before applying a profile.** Under certain timing conditions, the modem could report a slot switch as successful while silently staying on the old SIM. QManager now double-checks the switch really happened before matching and applying a Custom SIM Profile, fixing cases where the wrong profile — or no profile — was applied after switching SIMs.
- **Email alerts no longer fire a "recovered" notice during an automatic recovery attempt.** Email alerts now wait out the same brief window SMS alerts already did before declaring the connection recovered, so you no longer get a "recovered" email moments before another outage starts.
- **Rapid, back-to-back SIM switches now settle on the correct profile.** Switching SIMs twice in quick succession could previously leave the wrong profile active. The correct profile for whichever SIM is actually inserted now always wins.
- **Profiles saved via "Load from SIM" now match reliably.** Some SIMs have an ICCID that QManager was reading slightly differently depending on where in the app it was read, which could prevent a saved profile from ever matching that SIM. ICCID reads are now consistent everywhere.
- **Screen readers now announce watchdog state changes** as they happen, so you don't have to be looking at the screen to know the watchdog just started detecting an issue or recovering.
- **Saving a settings mistake now takes you straight to the problem.** If a field is invalid, Save jumps to the tab that needs attention and puts your cursor in the exact field to fix.
- **Cooldown and SIM-settle countdowns are now honest.** The status card only shows a cooldown timer when one is actually counting down, including the full ~90 second settle window after a SIM swap.

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

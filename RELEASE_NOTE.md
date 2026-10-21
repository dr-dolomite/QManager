# 🚀 QManager BETA v0.1.33

v0.1.33 is a follow-up to v0.1.32, built from your feedback, with a round of fixes to the connection watchdog. The dashboard now shows your last outage, how long ago it ended and whether your WAN IP changed when you reconnected, and the watchdog's reboot count, SIM switching, airplane-mode handling and settings backup are all more reliable. It adds one feature; the rest is fixes and polish, including easier-to-read signal colours and a corrected 4G SINR reading.

## ✨ New Features

- **See your last outage on the dashboard.** The Connection Quality card has a new **Last outage** row showing how long your most recent drop lasted and how long ago it ended, for example "40s (2m ago)". Every drop counts, however short, even with alerts turned off. Tap the hint next to it to see the WAN IP you reconnected with and whether it changed. The row resets when the modem restarts. Thanks to [@giorez](https://github.com/giorez) for proposing it ([#27](https://github.com/dr-dolomite/QManager/issues/27)).

## ✅ Improvements

- **Connection Quality no longer shows red right after a restart.** While the modem was still connecting after a reboot, its first internet checks failed and were counted as packet loss, so the card showed red, and could report the connection as degraded, for up to 10 minutes even though the internet was working. Those first checks are now left out, and a bar only turns red when a check in that minute actually failed.
- **The watchdog's reboot count resets after an hour.** The Watchdog page's reboots figure could stay at 1 for days after a single watchdog restart, and that restart vanished from Recent Activity. The count is now a true rolling hour, and restarts the watchdog caused stay listed in Recent Activity after the modem comes back. Thanks to Outright0181 for reporting it.
- **The Watchdog page tells you when the watchdog stops responding.** If the watchdog is turned on but has gone quiet, the page now shows "Not reporting" and the sidebar activity indicator hides, instead of leaving the last status on screen as if nothing were wrong.
- **Saving watchdog settings no longer restarts it.** A recovery already in progress is not interrupted, and the new settings take effect within a minute. Restoring a backup does the same.
- **The watchdog checks that each SIM switch really happened.** If the modem does not move to the other SIM, the watchdog skips that step instead of pretending it worked, and a SIM failover now survives a reboot, so the modem keeps reporting that it is on the backup SIM.
- **The watchdog leaves the radio alone when you turn it off.** Switching the radio off (airplane mode) no longer counts as an outage, and turning it back on gives the connection time to return before any recovery starts. Its radio step never leaves the radio off. After it has tried every recovery step without success, it now pauses for 15 minutes before starting again instead of repeating the whole ladder straight away.
- **Quality-based recovery judges only recent results.** It no longer escalates to a reboot because of an outage that has already ended.
- **Recovery holds off during the modem's own quick baseband restarts on slower check profiles too.** The watchdog used to miss them on the Quiet profile and interrupt a restart that would have fixed itself.
- **Config backups now include every watchdog setting.** Quality recovery, baseband restart hold and automatic switch-back to the primary SIM were left out before, and are now saved and restored.
- **Signal colours are easier to tell apart.** Signal readings such as RSRP, RSRQ and SINR, and their bars, now use plain green for good, yellow for fair and red for poor. The old olive and brown shades were hard to tell apart. The signal-bar icon beside each reading still shows excellent and good separately.
- **The 4G SINR reading is now correct.** The modem reports LTE SINR on its own internal scale, not in dB, and the dashboard and login page were showing that raw number. On a weak signal it read up to 10 dB too high, for example 12 dB when the real value was about 4 dB. It now matches the per-antenna readings on the Antenna Statistics page. The 5G SINR was already correct. Thanks to [@RafayGhafoor](https://github.com/RafayGhafoor) for finding it ([#33](https://github.com/dr-dolomite/QManager/pull/33)).

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.32

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Special thanks to Outright0181 for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

# 🚀 QManager BETA v0.1.30-draft

v0.1.30 reworks how QManager decides whether your internet is up. The background connectivity probe moves from an HTTP request to a simple ICMP ping — the lighter approach the predecessor app used — and gains a configurable IPv6 DNS target so IPv6-only cellular connections are no longer falsely reported offline. This is a focused reliability release: one new capability and one engine change, both aimed at eliminating false "offline" readings.

## ✨ New Features

- **Custom DNS now supports IPv6 resolvers and one-tap provider presets.** You can now set IPv6 DNS servers alongside your IPv4 ones — useful for IPv6-only or dual-stack connections where an IPv4-only resolver would be skipped. A built-in preset picker (Cloudflare, Google, Quad9, AdGuard, ControlD) fills all four addresses at once; choosing "Custom" lets you enter your own. Settings are under Local Network → Custom DNS.

- **IPv6-only connections no longer trigger false outages.** The connectivity probe now pings IPv4 first and falls back to IPv6 automatically. If your cellular bearer hands you an IPv6-only address, the modem stays correctly marked as online instead of declaring itself offline — and the Connection Quality page shows a "Currently reachable via IPv6" note when the fallback is carrying your connection. You can set your preferred IPv4 and IPv6 probe targets (defaults: Cloudflare `1.1.1.1` and `2606:4700:4700::1111`) under System Settings → Connection Quality → Probe Targets.

## ✅ Improvements

- **Connectivity check switched from HTTP to a lightweight ICMP ping.** The background probe that drives the "Internet" badge, dashboard latency chart, and Connection Watchdog now uses a simple ICMP ping of a DNS server instead of an HTTP request. ICMP is faster, produces less noise, and matches what the predecessor app did — removing the most significant behavioral difference between the two while we track down the random-disconnect behavior seen on some setups.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.29

**System Settings → Software Update.** No migration steps needed. Your sensitivity profile is preserved; the old HTTP probe targets are replaced with the new IPv4/IPv6 DNS defaults automatically.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

# 🚀 QManager BETA v0.1.29

v0.1.29 is focused on Connection Watchdog reliability and RM551E stability. The headline addition is automatic SIM failback, and the bulk of this release is fixes and polish — quieter background polling, a rewritten quality-detection pipeline, and a sweep of Watchdog edge cases that surfaced during live testing. This patch also fixes a regression that caused the installer and Software Update to stop partway through on some devices, leaving services not started; installs and updates now complete reliably.

## ✨ New Features

- **Automatic failback to your primary SIM once it is healthy again.** An opt-in setting under the Watchdog's recovery configuration lets the Watchdog periodically test whether the primary SIM has recovered. If the primary passes the health check, the Watchdog transparently switches back — no manual intervention needed. The check interval (default 30 minutes, minimum 5 minutes) is configurable. Because testing the inactive SIM requires a brief real connection swap, this feature is off by default.

## ✅ Improvements

- **Fixed a regression that could cause the installer and Software Update to stop partway through ("Seeding UCI defaults") without finishing, leaving services not started on some devices.** Installs and Software Updates now complete all steps and exit cleanly.

- **Snappier response from every screen that reads the modem.** Settings pages, the AT terminal, and on-demand radio reads were often taking a full extra second or two to respond whenever the background poller happened to be mid-query. The shared AT-command gateway now retries for the modem in 100-millisecond steps instead of 1-second steps, so commands that previously waited out a whole second now return almost immediately — while the safety timeouts that protect against a stuck modem are unchanged.

- **Reduced background radio queries on RM551E devices.** QManager no longer queries MIMO layers, timing advance, APN details, and WAN IP on a recurring background timer. These are now read only while you are viewing the page that displays them, and stop as soon as you navigate away. This matches the lighter-touch behaviour of the predecessor app and removes a class of background radio commands suspected of contributing to the random baseband restarts seen on some RM551E modems.

- **Even quieter background polling when the dashboard is left idle.** When no one has the QManager dashboard open for a while, the background poller now also pauses its carrier-aggregation, radio-state, and per-antenna signal reads — keeping only the single serving-cell query that signal-based tower failover depends on. Everything resumes instantly the moment you reopen the dashboard, with no change to what you see while the app is open. This further trims the idle background radio activity linked to the RM551E baseband restarts.

- **Overview card now respects your temperature unit preference.** The pre-login Overview page was always showing temperatures in °C even when Fahrenheit was selected in System Settings. It now reads your preference and converts correctly.

- **IPv6 addresses no longer overflow the Cellular Information card on mobile.** A full IPv6 WAN or DNS address was running off the right edge of the card on narrow screens. The value now wraps neatly onto its own line beneath its label on small screens, and stays inline on wider layouts — so the full address is always readable.

- **Connection Watchdog no longer amplifies RM551E self-healing outages.** When the cellular modem briefly restarts its own radio firmware — a known RM551E behaviour that self-heals within seconds — the Connection Watchdog now waits it out instead of forcing a re-registration on top. Interrupting a modem mid-self-heal was turning a 30–60 second blip into a multi-minute thrash loop; the watchdog now holds off and only escalates if the connection has not returned after the grace window. On by default; the grace window is tunable under the Watchdog's Recovery settings.

- **Connection Watchdog and Connection Quality settings no longer overlap confusingly.** Connection Sensitivity now does one thing: it sets how often the connection is checked. How many failed checks count as an outage, and every recovery step, are owned by the Connection Watchdog alone — so the two pages can no longer disagree or double-count a single drop. The Watchdog now has its own probe-interval picker (with a Custom 1–60 second option that overrides the sensitivity preset), and a live "declares the connection down after about N seconds" preview so the detection time is no longer a guessing game.

- **One shared definition of "poor connection quality."** The latency and packet-loss limits you set on the Connection Quality page are now the single source of truth: they drive both the quality events shown in Network Events and the Watchdog's quality-based recovery, with each side keeping its own separate "how long must it stay bad" delay. Both now judge against a smoothed rolling average instead of a single noisy sample, and you can dial in exact custom thresholds. The Watchdog's quality tab links straight to where these limits live, instead of duplicating the inputs.

- **Clearer Watchdog activity in Network Events.** Recovery attempts now log more legibly — when a recovery starts, which step ran, whether it worked, and when the Watchdog escalates or gives up — so you can see what the Watchdog actually did during an outage.

- **Tidier Watchdog status readouts on mobile.** The status tiles now use a compact "Step N" for the current and last recovery step, so the "Last Recovery" value no longer gets clipped on narrow screens. The Watchdog's probe-interval picker also shows each option's timing in parentheses — for example "Sensitive (1s)".

- **Dashboard no longer briefly shows connectivity as unknown after a tower hiccup.** After a fast baseband restart, the modem's NTP clock can jump forward by ~90 seconds the moment the data path comes back. That jump was making QManager's staleness check falsely age out its own fresh data and report connectivity as unknown — right when the connection had just recovered. Connectivity state now stays correct through clock steps.

- **The Internet badge and latency chart no longer contradict each other after a brief drop.** The "Internet" badge stayed green (using a smoothed debounced value) while the latency chart showed a packet-loss spike (from the raw probe history) — two signals about the same drop, pointing in opposite directions. After a brief connectivity gap, the badge now shows an amber "Unstable" state that matches the chart and clears on its own once the connection is stable again.

- **The latency reading is now labelled "Internet RTT."** The dashboard latency number is a full end-to-end round-trip to Cloudflare/Google connectivity endpoints — it includes your ISP, routing, and the remote server, not just the cellular link. The label now says "Internet RTT" (and the card title "Internet Latency and Speed Test") so it is clear what is being measured.

- **Connection Watchdog waits for the SIM to fully settle after a SIM swap before checking the connection.** A physical SIM swap on the RM551E needs about 90 seconds to reach stable connectivity. The Watchdog now enforces this floor automatically — regardless of your cooldown setting — so a swap that is genuinely working does not get false-declared a failure and push the Watchdog toward rebooting. The same settle period applies when you use the "Revert to original SIM" button.

- **Requesting a SIM revert during an active swap no longer silently disappears.** If you tapped "Revert SIM" while the Watchdog was still in the middle of confirming a SIM swap, the request was previously dropped without any visible indication. The Watchdog now queues the request and processes it as soon as the swap finishes.

- **Reverting a SIM failover no longer causes a spurious "New SIM detected" alert after the next reboot.** When reverting to the original SIM on a slow-responding modem, the Watchdog now records the reverted SIM as known even if it takes extra time to identify. Without this, the first reboot after a slow revert would incorrectly report a new SIM being inserted.

- **The Watchdog's status now correctly shows when it is running on the backup SIM.** A type-mismatch bug in the status file writer meant the "on backup SIM" indicator was always reported as false, even during an active SIM failover. The recovery logic itself was unaffected — only the displayed status was wrong. This is now fixed.

- **Quality-based SIM failovers now track correctly and can be reverted.** When the Watchdog switched to the backup SIM because of poor connection quality (high latency or packet loss), the failover state was not finalized — leaving no record of which slot was the original, and making the "Revert to original SIM" button ineffective. Quality-triggered switches now finalize identically to connectivity-triggered ones.

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

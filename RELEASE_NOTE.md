# 🚀 QManager BETA v0.1.25

This release adds LAN address configuration to the Local Network page and polishes the login screen.

## ✨ New Features

- **SMS Forwarding: incoming texts are automatically relayed to any phone number you choose.** Enable it in SMS Center → Forwarding, enter a destination number, and every new message that arrives in your modem's inbox is sent on as "From &lt;sender&gt;: &lt;message&gt;". Enabling never blasts your existing inbox — only messages received after you turn it on are forwarded. A built-in test button lets you confirm the path works before you rely on it. If a message can't be delivered after three attempts, a persistent alert tells you exactly which message failed and why; you can clear the alert once you've acknowledged it. The feature stays on regardless of individual delivery failures.

- **The connection watchdog can now recover from degraded-but-reachable links.** When enabled, you can set a latency ceiling (ms) and a packet-loss ceiling (%) — if either is exceeded for a configurable number of consecutive checks, the watchdog runs through the same recovery steps it uses for a full outage. The feature is off by default; turn it on in Monitoring → Connection Watchdog under Connection Quality Monitoring.

- **Band Locking now shows your modem's full band capability.** The band checkboxes reflect every band the RM551E hardware can use, not just what the current SIM announces. Bands your network or SIM actively uses are highlighted in the usual accent color; bands the modem supports but your carrier doesn't use are marked in yellow — so you know exactly what you're choosing between before you lock. The band list also refreshes automatically after a SIM swap, keeping the display accurate without a reboot.
- **Set your LAN gateway address and subnet from the Local Network page.** You can now change the modem's LAN IP address and subnet prefix (/16–/30) directly in QManager — no SSH required. A confirmation dialog reminds you that the LAN briefly drops on apply, and a persistent banner shows the new address to browse to (reconnect your LAN/Ethernet cable after a few seconds so your device picks up the new IP).
- **One-tap Bypass Hotspot in the Traffic Engine.** A new switch under each engine mode pins TTL and hop-limit to 64 so tethered devices aren't flagged as a hotspot — no need to open the TTL/HL page. If TTL/HL is already set elsewhere (the TTL page or a SIM profile), the switch shows on and stays locked so it never fights your existing setup.

## ✅ Improvements

- **SMS Forwarding now has a Delivery & Health panel.** The forwarding page's right-hand card shows the live relay state at a glance (active, issue, off, or unconfigured), a preview bubble of exactly what your recipient will receive, a test-send button that verifies the saved path end-to-end, and a delivery-failure history with a clear action. On wider screens the two forwarding cards now line up to the same height, and the page settles into place as it loads instead of the layout shifting when data arrives. Call Forwarding has been removed — it was not reliably supported on most carriers and data-only plans.

- **The watchdog's first recovery step now re-registers the modem on the network** instead of bouncing the software WAN interface. This gives the modem a real chance to recover a stalled network attach and is a more effective first action before escalating to a radio toggle or reboot.

- **The Connection Watchdog page has been redesigned for clarity.** Now that quality monitoring is part of the watchdog, the settings are reorganized into clean grouped cards: reachability and connection-quality detection share one tabbed card with a single save, the recovery actions read as a clear numbered escalation ladder, and the live status always shows cooldown and last-recovery at a glance (showing "—" until there's something to report). Each recovery step now describes in plain language what it does, with the exact modem command shown alongside for advanced users. A green pulse marks Connection Quality when it's armed.

- **Band Locking now shows every band you've actually locked, including ones outside your carrier's plan.** Previously, bands locked outside the network policy silently vanished from the readback. The display now reflects what's configured on the modem verbatim.
- **Reset (Unlock all) now restores the modem's full hardware band support,** not just the carrier-policy subset. Every band the modem is physically capable of using is included in the reset.
- **NR-DC bands can now be locked and reset, just like LTE, NSA, and SA.** The NR-DC card in Band Locking is no longer view-only — you can select specific NR-DC bands, save the lock, and reset to the full supported set. Failover also resets NR-DC bands automatically on connectivity loss.
- **Band Locking loads without the layout jumping around.** The loading placeholders now mirror the real card — the same band-checkbox grid, badge, and buttons — so the page settles into place smoothly instead of growing a few rows when your band list arrives.

- **The login screen's "Can't sign in?" help is clearer and better aligned.** The recovery link now sits with comfortable spacing below the password field, and tapping it expands the recovery steps directly beneath the link — right where you asked — instead of above the field. The device-name line and its loading placeholder now share the same baseline, so the screen settles into place without a flicker, and all of its motion runs on one unified timing.
- **The login device-name line now reads "Sign in as <your device name>" in every supported language.**
- **Wake-on-LAN removed.** The WoL toggle has been removed. Upgrading devices will have the stale WoL configuration cleaned up automatically.
- **Changing your LAN gateway or subnet now reconnects upstream routers automatically.** Previously, a cable-sense router plugged into the modem's LAN port (such as a GL.iNet device in WAN mode) would keep its stale IP lease after a subnet change and require you to physically unplug and replug the cable. The LAN apply now performs a brief link-state bounce on the LAN port so the upstream router drops its old lease and discovers the new gateway on its own — no manual cable intervention needed for DHCP clients. Static-IP devices still need to be manually reconfigured for the new subnet.

- **Indonesian and Italian translations are caught up with the rest of the app.** Recently added screens — including the public overview page, Tower Locking's simple-mode controls, and the Tailscale connectivity-fixes toggle — now appear in Indonesian and Italian instead of falling back to English. **Translation contributors:** these strings were filled in to restore full key parity, so please double-check the wording for the `overview.*` (in `common.json`), `cell_locking.tower_locking.*` (in `cellular.json`), and `force_tailscale_fixes_*` (in `system-settings.json`) keys in the `id` and `it` locales and refine anything that reads awkwardly.
- **Traditional Chinese (繁體中文) is now available as a downloadable language pack.** Contributed by @po1son7 and completed to full parity with the rest of the app. Install it from System Settings → Languages. Simplified Chinese also gets a small terminology fix (the "log out" wording now matches mainland convention).

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.24

**System Settings → Software Update.** No migration steps needed. All settings preserved.

## 💙 Thank You

Special thanks to **[@po1son7](https://github.com/po1son7)** for contributing the **Traditional Chinese (繁體中文)** translation — and a Simplified Chinese terminology fix along the way. Community translations like this are what bring QManager to more people in their own language. 🙏

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

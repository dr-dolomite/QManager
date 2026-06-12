# 🚀 QManager BETA v0.1.26

This release makes Connection Quality latency readings honest — what you see now matches what ping and speed tests report — and eliminates false packet-loss readings on weak signal.

## ✅ Improvements

- **Latency readings now reflect true network round-trip time.** Connection Quality previously measured the full HTTP transaction time of each probe, which ran roughly 3× higher than your real network latency — many users saw ~300 ms while their speed test showed 16–20 ms. The probe now measures the network round trip itself, so the dashboard value is directly comparable to ping and Ookla results (typically 35–65 ms on cellular). Quality thresholds and watchdog ceilings keep their existing values, which now give you comfortable headroom against the honest numbers.
- **No more phantom packet loss on weak signal.** The default probe targets have been switched to lightweight connectivity-check endpoints. The previous full-page HTTPS targets could time out entirely on a weak link and register as packet loss even though the connection was working. If you never customized your probe targets, the upgrade switches them automatically; custom targets are left untouched.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.25

**System Settings → Software Update.** No migration steps needed. All settings preserved — default probe targets are updated automatically, custom targets are kept as-is.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**

---

# 🚀 QManager BETA v0.1.30

v0.1.30 delivers a lighter ICMP-based connectivity probe — matching the predecessor app — and a major Custom DNS expansion. The probe gains an automatic IPv6 fallback so IPv6-only cellular connections are no longer falsely reported offline. Custom DNS adds IPv6 resolver support, one-tap provider presets (Cloudflare, Google, Quad9, AdGuard, ControlD), and two fixes that close leaks where carrier DNS was still reaching clients. A false "high packet loss" reboot-loop after a modem restart is also squashed.

## ✨ New Features

- **Custom DNS now supports IPv6 resolvers and one-tap provider presets.** You can now set IPv6 DNS servers alongside your IPv4 ones — useful for IPv6-only or dual-stack connections where an IPv4-only resolver would be skipped. A built-in preset picker (Cloudflare, Google, Quad9, AdGuard, ControlD) fills all four addresses at once; choosing "Custom" lets you enter your own. Settings are under Local Network → Custom DNS.

- **IPv6-only connections no longer trigger false outages.** The connectivity probe now pings IPv4 first and falls back to IPv6 automatically. If your cellular bearer hands you an IPv6-only address, the modem stays correctly marked as online instead of declaring itself offline — and the Connection Quality page shows a "Currently reachable via IPv6" note when the fallback is carrying your connection. You can set your preferred IPv4 and IPv6 probe targets (defaults: Cloudflare `1.1.1.1` and `2606:4700:4700::1111`) under System Settings → Connection Quality → Probe Targets.

## ✅ Improvements

- **Fixed Custom DNS not applying IPv4 servers when IP Passthrough (MPDN) is active.** Custom DNS was writing IPv4 resolver addresses to the wrong UCI section (`dhcp.lan_bind4`) when an MPDN rule was enabled, but dnsmasq only serves the `dhcp.lan` section — so clients never received the custom DNS via DHCP and fell back to your carrier's resolvers. The DNS configuration now consistently targets `dhcp.lan` regardless of IP Passthrough state, matching the IPv6 path that already did this correctly.

- **Fixed dnsmasq continuing to use carrier DNS as its upstream even after custom DNS was enabled.** Custom DNS was only advertised to clients via DHCP option 6, but when a client used the router itself as its DNS resolver (common on Windows and many devices), dnsmasq still forwarded queries to the carrier's resolvers. Dnsmasq now uses your chosen custom DNS provider as its own upstream as well, so every DNS path — direct or via the router — resolves through your selected provider. DNS leak tests now show your chosen provider.

- **Connectivity check switched from HTTP to a lightweight ICMP ping.** The background probe that drives the "Internet" badge, dashboard latency chart, and Connection Watchdog now uses a simple ICMP ping of a DNS server instead of an HTTP request. ICMP is faster, produces less noise, and matches what the predecessor app did — removing the most significant behavioral difference between the two while we track down the random-disconnect behavior seen on some setups.

- **Fixed a rare false "high packet loss" reboot right after the modem restarts.** In the first minute or so after a reboot, a handful of transient probe failures in a small window could report 50% packet loss when the real loss was 0%. That false reading was enough to trip the Connection Watchdog quality trigger and, in the worst case, cause a reboot loop. The poller now waits until it has collected enough probe samples before reporting a loss figure, so a freshly-started modem can't trigger a false alarm.

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

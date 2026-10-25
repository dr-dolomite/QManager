# 🚀 QManager BETA v0.1.35

v0.1.35 adds real-time signal readings on Antenna Alignment and the dashboard, plus one new setting: PCIe power saving for the ethernet port, which now defaults to Performance. Modems that shipped with aggressive power saving on the ethernet controller can see dropouts and extra latency on the LAN port, and QManager now keeps that controller fully awake unless you choose otherwise. The dashboard also gets its Data Used total back, now counted from the modem itself.

## ✨ New Features

- **Real-time signal on Antenna Alignment and the dashboard.** Antenna Alignment now leads with a live signal reading that updates every second, with a 30-second trace and your best position so far, so you can see the effect of each turn as you aim. The dashboard's LTE signal values also refresh every second while you watch them, and both pages quietly fall back to the usual two-second updates if live readings are not available. Live readings only run while the page is open and visible.
- **PCIe power saving for the ethernet port.** The Ethernet Status page's speed card is now **Ethernet Port** and gains a **PCIe power saving** setting: Performance (recommended), Kernel default, Power saving or Max power saving. Changing it never drops the link, and your choice is reapplied on every boot.
- **Performance by default.** New installs and upgrades set PCIe power saving to Performance, since the platform's own default can cause ethernet dropouts and added latency. If you have already picked a setting, it is kept.

## ✅ Improvements

- **Data Used is back on the dashboard.** The Device & Speed card shows total download and upload again, and it now counts everything the modem moves, including traffic from devices on your LAN, using the modem's own counter. Older figures could read low because they missed that traffic. If QManager ever has to fall back to a less complete counter, a small hint beside the total says the figure may be low.
- **Data Used no longer has a reset button.** The total simply counts from when QManager was installed.
- **Live LTE SINR on the dashboard.** The LTE signal quality (SINR) on the dashboard now updates every second along with the other LTE values while you watch it.
- **Steadier modem status during scans and SIM switches.** The dashboard keeps showing current LTE signal readings while a network scan or a SIM switch is running, instead of pausing until it finishes.
- **Antenna Alignment fits on one screen.** Receive Chains now sits under Positions beside the live reading, so on a desktop the whole page is visible without scrolling. Record moved up next to the Directional / Omni switch, and each empty position says "Not recorded" right beside its label.
- **Easier-to-read scan results.** The results summary on Neighbourcell Scan and Full Scan now puts each group's name and cell count on the left and its best signal on the right, with every dBm figure lined up on one edge, so you can compare readings at a glance.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.34

**System Settings → Software Update.** No migration steps needed. The new Performance default takes effect after the next reboot, or right away if you apply it from the Ethernet Port card.

## 💙 Thank You

Special thanks to Outright0181 for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

# QManager

<div align="center">
  <h3>A modern, custom GUI for Quectel modem management</h3>
  <p>Visualize, configure, and optimize your cellular modem's performance with an intuitive web interface</p>
</div>

---

> **Note:** QManager is the successor to [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup), rebuilt from the ground up with a modern tech stack and improved user experience for managing Quectel modems like the RM520N-GL and similar devices.

---

## ✨ Features

- **Live Signal Monitoring:** Real-time visualization of RSRP, RSRQ, SINR with historical charts for 4G/5G
- **Network Status Dashboard:** Comprehensive view of connection state, IP addresses, and carrier info
- **Band Locking:** Easily configure and lock specific frequency bands for optimal performance
- **APN Management:** Create, edit, and switch between APN profiles
- **Device Diagnostics:** Monitor modem health, temperature, and detailed device information
- **SIM & IMEI Utilities:** Manage SIM settings and view IMEI/IMSI details
- **Responsive Design:** Optimized for both desktop and mobile devices
- **Dark/Light Mode:** Beautiful UI with theme support

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+
- Compatible Quectel modem (RM520N-GL, RM500Q, etc.) with AT command support

### Development Setup

```bash
# Clone the repository
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager

# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build
```

Open [http://localhost:3000](http://localhost:3000) in your browser to explore the QManager console.

---

## 💻 Technologies

- **Framework:** Next.js 15 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui
- **Charts:** Recharts
- **Package Manager:** Bun

---

## 🤝 Support the Project

<div align="center">
  <h3>Support QManager's Development</h3>
  <p>Your contribution helps maintain the project and fund continued development, testing on new cellular networks, and hardware costs.</p>
  <br/>
  <a href="https://ko-fi.com/drdolomite" target="_blank">
    <img height="64" style="border:0;height:64px;" src="https://storage.ko-fi.com/cdn/kofi1.png?v=3" alt="Buy Me a Coffee at ko-fi.com" />
  </a>
  <br/><br/>
  <a href="https://paypal.me/iamrusss" target="_blank">
    <img height="40" src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal" />
  </a>
</div>

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the LICENSE file for details.

---

<div align="center">
  <p>Built with 💙 by <a href="https://github.com/dr-dolomite">DrDolomite</a></p>
</div>

# QManager

<div align="center">
  <img src="public/qmanager-logo.svg" alt="QManager Logo" width="120" />
  <h3>Antarmuka GUI modern untuk manajemen modem Quectel</h3>
  <p>Visualisasikan, konfigurasikan, dan optimalkan performa modem seluler Anda dengan antarmuka web yang intuitif</p>

  ![Version](https://img.shields.io/badge/versi-v0.1.35-blue?style=flat-square)
  ![License](https://img.shields.io/badge/lisensi-MIT%20%2B%20Commons%20Clause-green?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-OpenWRT-orange?style=flat-square)
  ![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square)
  ![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
</div>

---

> **Catatan:** QManager adalah penerus dari [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup), dibangun ulang dari awal menggunakan tumpukan teknologi modern dengan pengalaman pengguna yang lebih baik untuk mengelola modem Quectel RM551E-GL. RM520N-GL memiliki repositori sendiri, [QManager-RM520N](https://github.com/dr-dolomite/QManager-RM520N).

---

## Fitur

### Pemantauan Sinyal & Jaringan
- **Dashboard Sinyal Langsung** — RSRP, RSRQ, SINR secara real-time dengan nilai per-antena (4x4 MIMO) dan grafik historis 30 menit
- **Event Jaringan** — Deteksi otomatis perubahan band, handoff sel, perubahan carrier aggregation, dan event konektivitas
- **Pemantauan Latensi** — Ping real-time dengan riwayat 24 jam, jitter, packet loss, dan tampilan agregat (per jam/12j/harian)
- **Statistik Trafik** — Total penggunaan data kumulatif

### Konfigurasi Seluler
- **Band Locking** — Pilih dan kunci band LTE/NR tertentu untuk performa optimal
- **Tower Locking** — Kunci ke menara sel tertentu berdasarkan PCI, dengan failover otomatis dan perubahan terjadwal
- **Frequency Locking** — Kunci ke saluran EARFCN/ARFCN yang tepat
- **Manajemen APN** — Buat, edit, dan hapus profil APN dengan preset MNO (T-Mobile, AT&T, Verizon, dll.)
- **Profil SIM Kustom** — Simpan konfigurasi lengkap (APN + TTL/HL + IMEI opsional) dan terapkan dengan satu klik
- **Skenario Koneksi** — Simpan dan pulihkan snapshot konfigurasi jaringan lengkap
- **Prioritas Jaringan** — Konfigurasi jenis jaringan yang diutamakan dan mode pemilihan jaringan
- **Pemindai Sel** — Pemindaian sel aktif dan tetangga dengan perbandingan sinyal
- **Kalkulator Frekuensi** — Alat konversi EARFCN/ARFCN ke frekuensi
- **Pusat SMS** — Kirim dan terima pesan SMS langsung dari antarmuka
- **Pengaturan IMEI** — Baca, cadangkan, dan ubah IMEI perangkat
- **IMEI Toolkit** — Generate dan validasi nilai IMEI dengan preset TAC, pemeriksaan Luhn, serta alat salin/cari cepat
- **Manajemen FPLMN** — Lihat dan kelola daftar Forbidden PLMN
- **Konfigurasi MBN** — Pilih dan aktifkan file konfigurasi broadband modem

### Pengaturan Jaringan
- **Kecepatan Link Ethernet** — Kontrol dan pantau kecepatan link, duplex, dan auto-negotiation
- **Pengaturan TTL/HL** — Konfigurasi IPv4 TTL dan IPv6 Hop Limit berbasis iptables
- **Konfigurasi MTU** — Penerapan MTU dinamis untuk antarmuka rmnet
- **IP Passthrough** — Penetapan IP langsung ke perangkat downstream
- **DNS Kustom** — Override server DNS
- **Video Optimizer** — Optimasi streaming video berbasis DPI menggunakan nfqws (TCP SNI split + QUIC desync dengan CDN hostlist yang dapat dikonfigurasi)
- **Traffic Masquerade** — SNI spoofing via TLS ClientHello palsu untuk melewati pembatasan trafik operator (tidak dapat digunakan bersamaan dengan Video Optimizer)

### Keandalan & Pemantauan

- **Connection Watchdog** — Auto-recovery bertingkat (daftar ulang → toggle radio → SIM failover → reboot) yang dipicu oleh gangguan koneksi, dan opsional oleh kualitas koneksi buruk atau carrier tunggal yang macet; reboot dibatasi anggaran dan tidak pernah mematikan watchdog
- **Notifikasi Email** — Pemberitahuan gangguan via Gmail SMTP (msmtp), dikirim saat pemulihan dengan detail durasi
- **Notifikasi SMS** — Pemberitahuan gangguan via SMS, dikirim selama pemadaman aktif setelah ambang batas terlampaui
- **WAN Interface Guard** — Menonaktifkan otomatis profil WAN bayangan untuk mencegah loop retry netifd yang memboroskan CPU
- **Tailscale VPN** — Instalasi, autentikasi, dan pemantauan status dengan satu klik
- **Pembaruan Perangkat Lunak** — Pemeriksaan pembaruan OTA dalam aplikasi, unduhan, verifikasi, dan instalasi
- **Log Sistem** — Penampil log terpusat dengan fitur pencarian

### Antarmuka
- **Mode Gelap/Terang** — Dukungan tema penuh dengan sistem warna perseptual OKLCH
- **Desain Responsif** — Bekerja di monitor desktop dan tablet di lapangan
- **Autentikasi Berbasis Cookie** — Manajemen sesi aman dengan pembatasan laju
- **AT Terminal** — Antarmuka perintah AT langsung untuk pengguna tingkat lanjut
- **Wizard Pengaturan Awal** — Panduan orientasi untuk konfigurasi pertama kali

---

## Instalasi Cepat

Masuk ke perangkat OpenWRT Anda via SSH dan jalankan:

```sh
set -e
REPO="dr-dolomite/QManager"
API="https://api.github.com/repos/${REPO}/releases?per_page=20"

JSON=$(uclient-fetch -qO- "$API" 2>/dev/null || wget -qO- "$API" 2>/dev/null || curl -fsSL "$API")
TAG=$(printf '%s' "$JSON" \
  | tr -d '\n' \
  | sed 's/},{/}\
{/g' \
  | sed -n '/"prerelease":[[:space:]]*true/{s/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p;q}')

[ -n "$TAG" ] || { echo "Gagal mendapatkan tag pre-release terbaru"; exit 1; }

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cd /tmp
wget -O qmanager.tar.gz "$BASE/qmanager.tar.gz"
wget -O sha256sum.txt "$BASE/sha256sum.txt"
sha256sum -c sha256sum.txt
tar xzf qmanager.tar.gz
sh /tmp/qmanager_install/install.sh
```

One-liner praktis (alur terverifikasi yang sama):

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

One-liner ini tetap mengunduh tarball pre-release terbaru, memverifikasi `sha256sum.txt`, lalu menjalankan `install.sh`.

Untuk menentukan rilis tertentu alih-alih pre-release terbaru, atur `TAG` secara manual (misalnya `TAG="v0.1.35"`) dan lewati blok pencarian API.

### Memperbarui

Mulai v0.1.7+, buka **Monitoring → Software Update** dan gunakan alur pembaruan bawaan — unduh, verifikasi, dan instal tanpa SSH.

### Menghapus Instalasi

```sh
set -e
REPO="dr-dolomite/QManager"
API="https://api.github.com/repos/${REPO}/releases?per_page=20"

JSON=$(uclient-fetch -qO- "$API" 2>/dev/null || wget -qO- "$API" 2>/dev/null || curl -fsSL "$API")
TAG=$(printf '%s' "$JSON" \
  | tr -d '\n' \
  | sed 's/},{/}\
{/g' \
  | sed -n '/"prerelease":[[:space:]]*true/{s/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p;q}')

[ -n "$TAG" ] || { echo "Gagal mendapatkan tag pre-release terbaru"; exit 1; }

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cd /tmp
wget -O qmanager.tar.gz "$BASE/qmanager.tar.gz"
tar xzf qmanager.tar.gz
sh /tmp/qmanager_install/uninstall.sh
```

One-liner uninstall:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh --uninstall
```

Gunakan `QMANAGER_TAG="v0.1.35" sh /tmp/qmanager-installer.sh` untuk menentukan versi tertentu dengan one-liner.

---

## Prasyarat

- Quectel RM551E-GL (pengguna RM520N-GL: lihat [QManager-RM520N](https://github.com/dr-dolomite/QManager-RM520N))
- Perangkat OpenWRT dengan modem terhubung
- **Paket wajib:** `jq`, `curl`, `coreutils-timeout`, `ethtool` (installer memasang yang belum ada; `sms-tool` tidak lagi dipakai dan dihapus installer sebagai paket konflik)
- **Paket opsional:** `msmtp` (notifikasi email), `ookla-speedtest` (pengujian kecepatan)

> Paket opsional dapat diinstal dari dalam aplikasi — tidak perlu `opkg` manual.

---

## Tumpukan Teknologi

| Lapisan | Teknologi |
|---------|----------|
| **Frontend** | Next.js 16, React 19, TypeScript 5 |
| **Styling** | Tailwind CSS v4, warna OKLCH, Euclid Circular B + Manrope |
| **Komponen** | shadcn/ui (42+ komponen), Recharts, React Hook Form + Zod |
| **Backend** | Script shell POSIX (OpenWRT/BusyBox), endpoint CGI |
| **Perintah AT** | Klien `qcmd` untuk broker AT Rust `qmanager_atd`, yang memiliki `/dev/smd11`; data baca-saja juga lewat QMI (QRTR) |
| **Package Manager** | Bun |

---

## Arsitektur

```
Browser ─── authFetch() ─── Script CGI ─── qcmd ─── Modem (perintah AT)
                │                  │
                │          Library Shell (40)
                │
        membaca /tmp/qmanager_status.json
                │
         qmanager_poller
       (polling bertingkat: 2d/10d/30d)
```

Frontend adalah aplikasi Next.js yang diekspor secara statis dan dilayani dari perangkat. Backend adalah script shell POSIX yang berjalan di OpenWRT — endpoint CGI untuk permintaan API dan daemon yang berjalan lama untuk pengumpulan data.

**Alur Data Utama:**

- **Daemon poller** menanyai modem via perintah AT setiap 2–30 detik (3 tingkat) dan menulis file cache JSON
- **Endpoint CGI** (101 script) membaca cache untuk permintaan GET, mengeksekusi perintah AT untuk permintaan POST
- **React hooks** (75 hook kustom) melakukan polling lapisan CGI dan menyediakan status loading/error/kedaluwarsa

Lihat [dokumentasi lengkap](docs/README.md) untuk detail arsitektur, referensi API, dan panduan pengembangan.

---

## Pengembangan

### Prasyarat

- [Bun](https://bun.sh/) (direkomendasikan) atau Node.js 18+

### Memulai

```bash
# Clone repositori
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager

# Instal dependensi
bun install

# Jalankan server pengembangan (untuk proxy panggilan API ke modem di 192.168.224.1, aktifkan blok rewrites() di next.config.ts)
bun run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser Anda.

### Build Produksi

```bash
# Ekspor statis ke out/
bun run build

# Paket lengkap (frontend + tarball backend + checksum)
bun run package
```

Script `package` membangun frontend, menggabungkannya dengan script backend ke dalam tarball, dan menghasilkan checksum SHA-256 — siap didistribusikan via GitHub Releases.

---

## Struktur Proyek

```
QManager/
├── app/                        # Halaman Next.js App Router (52 route)
│   ├── dashboard/              # Beranda — pemantauan sinyal langsung
│   ├── cellular/               # Info seluler, SMS, profil, locking band/tower/frekuensi,
│   │                           #   pemindai sel, APN, IMEI, FPLMN, prioritas jaringan
│   ├── local-network/          # Ethernet, IP passthrough, DNS, TTL, MTU,
│   │                           #   video optimizer, traffic masquerade
│   ├── monitoring/             # Event jaringan, latensi, notifikasi email, watchdog,
│   │                           #   notifikasi SMS, Tailscale, log, pembaruan perangkat lunak
│   ├── system-settings/        # Konfigurasi sistem, AT terminal
│   └── (login, setup, reboot, about-device, support)
├── components/                 # Komponen React (~370 file)
│   ├── ui/                     # Primitif shadcn/ui (42+ komponen)
│   ├── cellular/               # UI manajemen seluler
│   ├── dashboard/              # Kartu dashboard beranda
│   ├── local-network/          # UI pengaturan jaringan
│   ├── monitoring/             # UI pemantauan & notifikasi
│   └── system-settings/        # UI konfigurasi sistem
├── hooks/                      # React hooks kustom (75 file)
├── types/                      # Interface TypeScript (38 file)
├── lib/                        # Utilitas (auth-fetch, earfcn, csv)
├── constants/                  # Data statis (preset MNO, label event)
├── scripts/                    # Script shell backend
│   ├── etc/init.d/             # Layanan init.d (14)
│   ├── usr/bin/                # Daemon & utilitas (27)
│   ├── usr/lib/qmanager/       # Library bersama (40)
│   ├── www/cgi-bin/            # Endpoint CGI (101 script)
│   ├── install.sh              # Script instalasi perangkat
│   └── uninstall.sh            # Script penghapusan bersih
└── docs/                       # Dokumentasi
```

---

## Dokumentasi

| Dokumen | Deskripsi |
|---------|-----------|
| [Indeks Dokumentasi](docs/README.md) | Ikhtisar dan tautan ke semua dokumentasi |
| [Arsitektur](docs/ARCHITECTURE.md) | Arsitektur sistem, alur data, tingkat polling |
| [Panduan Frontend](docs/FRONTEND.md) | Komponen, hooks, halaman, routing |
| [Panduan Backend](docs/BACKEND.md) | Script shell, daemon, endpoint CGI |
| [Referensi API](docs/API-REFERENCE.md) | Referensi lengkap endpoint CGI |
| [Sistem Desain](docs/DESIGN-SYSTEM.md) | Warna, tipografi, konvensi UI |
| [Panduan Deployment](docs/DEPLOYMENT.md) | Membangun dan mendeploy ke OpenWRT |
| [Menerjemahkan QManager](docs/i18n/CONTRIBUTING.md) | Tambah paket bahasa baru atau perbaiki terjemahan yang ada |

---

## Layanan Backend

QManager menjalankan 14 layanan init.d di perangkat:

| Layanan | Fungsi |
|---------|--------|
| `qmanager` | Daemon poller utama — polling AT bertingkat, cache JSON, deteksi event |
| `qmanager_watchcat` | Watchdog koneksi — mesin status auto-recovery bertingkat |
| `qmanager_dpi` | Layanan DPI — nfqws dalam mode video optimizer atau traffic masquerade |
| `qmanager_tower_failover` | Failover tower — memulihkan kunci setelah kehilangan sel |
| `qmanager_eth_link` | Kecepatan link Ethernet — menerapkan pengaturan kecepatan/duplex yang tersimpan |
| `qmanager_ttl` | TTL/HL — menerapkan aturan iptables saat boot |
| `qmanager_mtu` | MTU — menerapkan pengaturan MTU antarmuka |
| `qmanager_imei_check` | Integritas IMEI — memverifikasi cadangan IMEI saat boot |
| `qmanager_atd` | Broker AT — memiliki `/dev/smd11` dan menyerialkan perintah AT untuk `qcmd`, `qsms` dan `qmi` |
| `qmanager_netbird_zone` | NetBird — self-heal zona firewall untuk `wt0` saat boot |
| `qmanager_sites` | Pemantau situs — mengukur handshake TCP ke situs yang dikonfigurasi |
| `qmanager_sms_forward` | Daemon penerusan SMS — hanya berjalan saat penerusan diaktifkan |
| `qmanager_sms_storage` | Penyimpanan SMS — menerapkan penyimpanan pilihan (`AT+CPMS`) saat boot |
| `qmanager_tailscale_net` | Tailscale — menegaskan ulang aturan keterjangkauan saat boot |

---

## Dukung Proyek Ini

<div align="center">
  <h3>Dukung Pengembangan QManager</h3>
  <p>Kontribusi Anda membantu memelihara proyek dan mendanai pengembangan berkelanjutan, pengujian pada jaringan seluler baru, dan biaya perangkat keras.</p>
  <br/>
  <a href="https://wise.com/pay/business/blackcatdev?currency=USD" target="_blank">
    <img height="40" src="https://img.shields.io/badge/Donate-Wise-9FE870?style=for-the-badge&logo=wise&logoColor=white" alt="Donate via Wise" />
  </a>
  &nbsp;
  <a href="https://paypal.me/iamrusss" target="_blank">
    <img height="40" src="https://img.shields.io/badge/Donate-PayPal-003087?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal" />
  </a>
  <br/><br/>
  <p>Anda juga bisa <a href="https://github.com/sponsors/dr-dolomite" target="_blank">menjadi sponsor di GitHub</a>.</p>
</div>

---

## Lisensi

Proyek ini dilisensikan di bawah [Lisensi MIT dengan Commons Clause](LICENSE).

**Anda bebas untuk:** menggunakan, memodifikasi, melakukan fork, dan berbagi QManager untuk keperluan pribadi dan non-komersial.

**Anda tidak boleh:** menjual QManager, menggabungkannya ke dalam produk komersial, atau menawarkannya sebagai layanan berbayar — termasuk versi yang telah di-fork.

### Lisensi Komersial

Jika Anda ingin menggunakan QManager dalam produk komersial, perangkat OEM, atau penawaran reseller, lisensi komersial tersedia. Hubungi [DrDolomite](https://github.com/dr-dolomite) secara langsung untuk mendiskusikan ketentuan.

---

<div align="center">
  <p>Dibangun dengan sepenuh hati oleh <a href="https://github.com/dr-dolomite">DrDolomite</a></p>
</div>

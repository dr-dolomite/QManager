# QManager

<div align="center">
  <img src="public/qmanager-logo.svg" alt="Logo QManager" width="120" />
  <h3>Interfaccia moderna per la gestione dei modem Quectel</h3>
  <p>Visualizza, configura e ottimizza le prestazioni del modem cellulare con una web UI intuitiva.</p>
</div>

[English README](./README.en.md)

---

> **Nota:** QManager e' il successore di [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup), riscritto con stack moderno e UX migliorata.

## Funzionalita'

### Monitoraggio segnale e rete
- Dashboard segnale live (RSRP, RSRQ, SINR con valori per antenna)
- Eventi di rete (cambi banda/cella, aggregazione portanti, connettivita')
- Monitor latenza (ping, jitter, packet loss, storico)
- Statistiche traffico (consumo dati cumulativo)

### Configurazione rete mobile
- Blocco bande LTE/NR
- Blocco torre (PCI) con failover
- Blocco frequenze (EARFCN/ARFCN)
- Gestione APN e preset operatore
- Profili SIM personalizzati
- Scenari di connessione salvabili
- Priorita' rete
- Scanner celle e calcolatore frequenze
- Centro SMS
- Impostazioni IMEI + toolkit
- Gestione FPLMN e configurazione MBN

### Rete locale
- Stato e velocita' link Ethernet
- TTL/HL, MTU, IP passthrough, DNS personalizzato
- Video Optimizer e Traffic Masquerade

### Affidabilita' e servizi
- Watchdog connessione multi-step
- Avvisi Email/SMS
- WAN guard
- Integrazione Tailscale
- Aggiornamenti OTA in-app
- Viewer log di sistema

## Installazione rapida

Esegui su OpenWRT:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

Per disinstallare:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh --uninstall
```

## Sviluppo

```bash
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager
bun install
bun run dev
```

## Traduzioni

Guida i18n: [docs/i18n/CONTRIBUTING.md](docs/i18n/CONTRIBUTING.md)

## Documentazione

Indice documentazione: [docs/README.md](docs/README.md)

## Supporto

- GitHub: https://github.com/dr-dolomite
- Discord community: https://discord.gg/wNuzkg8s

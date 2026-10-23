# External Security Review Findings (SDXLEMUR / RM520N & RM551E)

**Report Date:** 2026-10-23  
**Reported By:** Chris (@Flachzange)  
**Reference Target:** `QManager-RM520N` (commit `7a7007c177f237fbf4a9ca89f19f80a6acaee4db`) & Quectel SDXLEMUR runtime  
**Cross-Device Applicability:** Quectel RM520N & Quectel RM551E (QManager codebase)  
**Status:** Documented / Under Evaluation (Patches will be applied to RM551E first, then ported to RM520N)

---

## Executive Summary

An external security review was conducted on the public `QManager-RM520N` repository and on a live Quectel modem runtime installation (`SDXLEMUR`). The review identified several potential security issues requiring attention, particularly given that QManager operates on internet-connected cellular hardware with access to root-level system functions.

> [!NOTE]
> **Assessment Scope:** This review is based on static source-code analysis and runtime configuration observations; it is not a completed penetration test. No evidence was found of intentional backdoors or malicious data exfiltration. Confirmed observations are distinguished from potential vulnerabilities that still require verified exploitability testing.
> 
> While originally reported against RM520N, these patterns may also be present across the RM551E codebase. The development strategy is to audit and apply verified remediation in the RM551E branch first, followed by backporting to RM520N.

### Findings Matrix

| # | Severity | Finding | Primary Affected Files / Components | Status |
|---|---|---|---|---|
| **1** | **Critical** | Potential unauthenticated root shell via `/console` | `scripts/usrdata/qmanager/lighttpd.conf`<br>`scripts/etc/systemd/system/qmanager-console.service` | Source-code finding; exploitability not yet verified |
| **2** | **High** | SSH potentially exposed over public IPv6 due to missing firewall rules | `scripts/usr/bin/qmanager_firewall`<br>Active `ip6tables` policies, Dropbear listener | Runtime configuration confirmed; external reachability untested |
| **3** | **High** | CGI authentication fails open when auth library fails to load | `scripts/usr/lib/qmanager/cgi_base.sh` | Confirmed code pattern |
| **4** | **High** | Known default SSH root password during install & weak MD5-crypt hashing | `scripts/install_rm520n.sh`<br>`scripts/usr/bin/qmanager_set_ssh_password`<br>`scripts/www/cgi-bin/quecmanager/auth/login.sh` | Confirmed implementation behavior |
| **5** | **High** | Missing / insufficient authorization checks for privileged Discord bot commands | `discord-bot/main.go`<br>`discord-bot/handlers.go` | Source-code finding; exploitability not yet verified |
| **6** | **High / Medium** | Software updates can proceed without successful checksum verification | `scripts/usr/bin/qmanager_update` | Confirmed code behavior |
| **7** | **High / Medium** | Excessive privileges granted to web-facing components & permissive paths | `scripts/etc/sudoers.d/qmanager`<br>`scripts/usr/bin/qmanager_setup` | Confirmed configuration and code patterns |
| **8** | **Medium / High** | Installation downloads executable components over unverified HTTP | `scripts/install_rm520n.sh` (Entware bootstrap) | Confirmed installation behavior |
| **9** | **Informational** | External IP-check requests with disabled TLS certificate validation | `scripts/www/cgi-bin/quecmanager/device/about.sh` | Confirmed code behavior |

---

## Detailed Findings

### 1. Potential Unauthenticated Root Shell via `/console`
- **Severity:** Critical
- **Relevant Files:**
  - `scripts/usrdata/qmanager/lighttpd.conf`
  - `scripts/etc/systemd/system/qmanager-console.service`
- **Description & Runtime Observations:**
  - The Lighttpd web server configuration reverse-proxies `/console` to a local `ttyd` daemon instance on port 8080.
  - The `ttyd` service runs as `root` and spawns an interactive shell.
  - No server-side authentication was identified protecting this reverse-proxy endpoint (authentication enforced solely on the frontend is bypassable).
  - Runtime observations show `ttyd` listening on `127.0.0.1:8080`, with Lighttpd listening on IPv4 ports 80 and 443.
- **Risk:** If `/console` is accessible without a valid server-authenticated session, an attacker capable of reaching the web server can obtain an interactive root shell on the modem.
- **Recommendation:** Enforce strict authentication and authorization at the web server/reverse proxy layer, completely independent of the frontend. Consider disabling the web console by default or requiring re-authentication.
- **Status:** Potential vulnerability identified from code; exploitability without frontend credentials pending testing.

---

### 2. SSH Potentially Exposed over Public IPv6
- **Severity:** High
- **Relevant Files & System Config:**
  - `scripts/usr/bin/qmanager_firewall`
  - Modem interface `rmnet_data1` (globally routable IPv6)
  - Dropbear SSH configuration
- **Description & Runtime Observations:**
  - The modem receives a globally routable IPv6 address on cellular WAN (`rmnet_data1`).
  - Active firewall policy shows `ip6tables -P INPUT ACCEPT` with no IPv6 `INPUT` filtering rules established.
  - Dropbear listens on all interfaces for both IPv4 and IPv6: `0.0.0.0:22` and `:::22`.
  - The QManager firewall manages IPv4 via `iptables` rules, but lacks equivalent IPv6 filtering, leaving IPv6 SSH unfiltered.
  - *(Note: Lighttpd currently binds only to IPv4 `0.0.0.0:80` and `0.0.0.0:443`, so the web interface was not observed to be exposed over IPv6).*
- **Risk:** Dropbear SSH may be directly reachable from the public internet over IPv6, subject only to upstream carrier-side ingress filtering.
- **Recommendation:** Implement comprehensive IPv6 firewall filtering rules (`ip6tables` / `nftables`). Explicitly block public WAN access to management services (SSH, web) by default across all cellular interfaces, and ensure rules persist across interface resets and reboots.
- **Status:** Confirmed global IPv6 address assignment, open IPv6 `INPUT` policy, and IPv6 SSH listener. Ingress reachability over carrier networks remains untested.

---

### 3. CGI Authentication Can Fail Open
- **Severity:** High
- **Relevant Files:**
  - `scripts/usr/lib/qmanager/cgi_base.sh`
- **Description:**
  - In `cgi_base.sh`, if loading the authentication library (`cgi_auth.sh`) fails, the script provides a fallback `require_auth()` function that effectively performs a no-op (returns success).
- **Risk:** If the authentication script is missing, deleted, corrupted, or fails to parse, protected CGI endpoints will execute without validating user sessions, granting unauthenticated access to privileged endpoints.
- **Recommendation:** Adopt a "fail closed" security posture. If authentication dependencies cannot be loaded, the handler must terminate immediately with an HTTP 500 / 401 error and log the failure.
- **Status:** Confirmed code pattern.

---

### 4. Known Default SSH Root Password During Install & Outdated Hashing
- **Severity:** High
- **Relevant Files:**
  - `scripts/install_rm520n.sh`
  - `scripts/usr/bin/qmanager_set_ssh_password`
  - `scripts/www/cgi-bin/quecmanager/auth/login.sh`
- **Description:**
  - During setup, the installer configures a known default SSH root password (`qmanager`) before onboarding prompts the user to change it.
  - The password helper utility uses MD5-crypt (`openssl passwd -1`), an obsolete and computationally weak password hashing algorithm.
  - Password synchronization between the web onboarding process and system SSH is best-effort rather than strictly enforced.
- **Risk:** Interrupted or incomplete onboarding leaves the known default root password active. When combined with potential IPv6 SSH exposure (Finding #2), this poses a severe remote compromise risk.
- **Recommendation:** Never initialize SSH with a hardcoded static password. Generate random temporary credentials, require credential setup before starting remote access services, migrate to modern hashing (e.g., SHA-512 crypt or Argon2/bcrypt where supported), and prioritize SSH key authentication.
- **Status:** Confirmed implementation behavior.

---

### 5. Discord Bot Privileged Command Authorization
- **Severity:** High (when bot integration is enabled)
- **Relevant Files:**
  - `discord-bot/main.go`
  - `discord-bot/handlers.go`
- **Description:**
  - The Discord bot registers slash commands capable of triggering privileged operations, including modem reboots, radio configuration modifications, and system commands.
  - Analysis indicated a lack of consistent authorization checks verifying the invoking user's Discord snowflake ID against the configured bot owner ID before executing privileged actions.
- **Risk:** If the bot is invited to a multi-user server or invoked via shared interactions, unauthorized users may trigger destructive or disruptive modem actions.
- **Recommendation:** Enforce strict, centralized authorization middleware verifying user ID and server context before executing any command or component interaction.
- **Status:** Potential authorization weakness identified from source code; full interaction permissions flow to be audited.

---

### 6. Insufficient Update Integrity Verification
- **Severity:** High / Medium
- **Relevant Files:**
  - `scripts/usr/bin/qmanager_update`
- **Description:**
  - Manual and UI-driven update routines can continue even when SHA-256 checksum verification fails or checksum files are missing.
  - Checksum files are fetched from the same distribution channel alongside release artifacts without cryptographic signature verification (e.g., Minisign or GPG).
- **Risk:** A compromised update source, malicious mirror, or man-in-the-middle vector could lead to arbitrary root code execution via malicious update tarballs.
- **Recommendation:** Mandate cryptographic signature verification (e.g., `signify` / `minisign` with pinned public keys) and require checksum validation to succeed before extracting or executing update scripts. Fail closed if verification fails.
- **Status:** Confirmed update verification behavior.

---

### 7. Excessive Privileges for Web-Facing Components
- **Severity:** High / Medium
- **Relevant Files:**
  - `scripts/etc/sudoers.d/qmanager`
  - `scripts/usr/bin/qmanager_setup`
- **Description:**
  - The web server user (`www-data`) is granted passwordless sudo access to several powerful utilities (e.g., firewall reconfiguration, package updates, system reboots).
  - The setup script configures permissive filesystem permissions, including a world-writable (`mode 777`) cron-related directory.
- **Risk:** Any web-layer vulnerability (command injection, path traversal) can be directly amplified into full system takeover with root privileges.
- **Recommendation:** Restrict sudo rules to strict, argument-checked helper binaries. Eliminate world-writable permissions (`chmod 777`) across the filesystem and ensure directory ownership belongs strictly to the daemon user or root.
- **Status:** Confirmed configuration and code patterns.

---

### 8. Unverified Software Downloads During Installation
- **Severity:** Medium / High
- **Relevant Files:**
  - `scripts/install_rm520n.sh`
- **Description:**
  - The Entware bootstrap process in the installation script fetches installation archives and packages over unencrypted HTTP from `bin.entware.net`.
  - Downloaded packages are unpacked without independent signature or pinned hash verification in the bootstrap path.
- **Risk:** An attacker on the local network or transit path could intercept HTTP traffic and inject trojaned packages into the modem filesystem during initial setup.
- **Recommendation:** Enforce HTTPS for all external dependency downloads, verify SSL certificates, and validate package signatures or SHA-256 digests against known safe hashes.
- **Status:** Confirmed installation behavior.

---

### 9. External IP-Check Requests with Disabled TLS Verification
- **Severity:** Informational
- **Relevant Files:**
  - `scripts/www/cgi-bin/quecmanager/device/about.sh`
- **Description:**
  - The device "About" page gathers external IP details by querying public lookup services (`api.ipify.org` and `api6.ipify.org`).
  - Queries are executed using `curl -k`, explicitly bypassing TLS certificate validation.
- **Risk:** Disabling certificate verification exposes external requests to interception or spoofing. Operators may also be unaware that the modem makes automatic external WAN queries.
- **Recommendation:** Ensure standard CA certificates are installed so `curl` can perform full TLS verification without `-k`. Document all external outbound queries in product documentation.
- **Status:** Confirmed code behavior.

---

## Suggested Remediation Priorities

### P0 — Immediate Review & Triage
1. **Verify `/console` Exposure & Authentication:** Ensure `ttyd` proxy is protected by strict web server authentication or bound strictly to authenticated local management sessions.
2. **Eliminate Static SSH Default Password:** Prevent modem from ever leaving a known default SSH credential active.
3. **Firewall IPv6 on Cellular Interfaces:** Apply equivalent restrictive ingress firewall rules to IPv6 as are applied to IPv4, blocking inbound management ports from WAN.

### P1 — High Priority
1. **Fail-Closed CGI Authentication:** Ensure `cgi_base.sh` rejects all requests if authentication libraries fail to load.
2. **Audit Discord Bot Authorization:** Restrict all commands to validated owner user IDs.
3. **Enforce Update Integrity:** Require signed tarballs or fail closed when checksums are unavailable.
4. **Comprehensive Firewall Policy:** Synchronize IPv4 and IPv6 filtering across all dynamic interface changes.

### P2 — System Hardening
1. **Minimize Web Server Privileges:** Harden `sudoers` rules and remove permissive file/directory permissions (`chmod 777`).
2. **Modernize Password Hashing:** Transition from legacy MD5-crypt to modern secure password hashes.
3. **Harden External Network Fetching:** Require HTTPS and verified TLS certificates for all package downloads and IP check queries.

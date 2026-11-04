# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Hobbyist power users and field technicians managing Quectel modems on OpenWRT** (this repository targets the RM551E-GL; the RM520N has its own fork, `QManager-RM520N`). Technically literate without being developers: comfortable with APN, PCI, RSRP, EARFCN and band numbers, but not expected to read shell scripts or hand-write AT commands. The hobbyist is tuning a home cellular setup for speed and coverage; the field tech is deploying and maintaining modems on site.

Two session shapes share one UI:

- **The quick check.** A mid-day glance at signal, watchdog state, data usage, recent events. Seconds, not minutes. Often on a phone or tablet beside the modem.
- **The focused configuration.** Activating a SIM profile, locking a tower or band, tuning APN contexts, aligning an antenna, restoring a backup, tuning the Traffic Engine for a carrier. Minutes of deliberate work, usually at a desk, occasionally roadside on a tablet.

## Product Purpose

QManager is the web GUI for Quectel cellular modems that run OpenWRT. It deploys onto the modem's own OpenWRT system and is fully standalone: no host router, no external toolkit. It replaces engineer-flavoured defaults (classic LuCI, raw AT consoles, vendor utilities) with an interface that respects the user's intelligence without requiring modem-engineering background.

Success looks like:

- A first-time user reaches signal-and-network clarity within thirty seconds of loading the dashboard.
- A returning user activates a saved SIM profile, locks a tower, restores a backup or reconfigures an APN in one focused session, with no terminal fallback.
- A power user can still see every underlying value (EARFCN, PCI, CFUN state, raw AT responses, NFQUEUE rules) without being confronted with all of it by default.
- The modem is never bricked, stranded, or silently reconfigured by the UI it serves.

## Positioning

**QManager runs on the modem it manages.** The app lives on the modem's internal OpenWRT system; there is no host, no companion cloud, and no second device in the path. Every competitor in this space is either a router-resident panel managing a modem over a wire, a desktop utility speaking AT over USB, or a vendor cloud. None of them can claim what follows from residency:

- The UI is reachable exactly as long as the connection it configures is up. A wrong click can sever the user's own session (a LAN gateway change does exactly that), so risk is a first-class design material rather than a warning string.
- Anything that reboots the modem kills any in-flight HTTP request, which is why reboots are deferred through a dialog plus a persistent banner rather than fired mid-request, and why no CGI ever issues `AT+CFUN=1,1` or `reboot` inside a response path.
- There is no privileged out-of-band channel to fall back on. The product must never leave the device in a state only a serial console can recover.

## Operating Context

- **Delivery.** Next.js static export served by uhttpd, a CGI shell backend running under BusyBox `/bin/sh`, and procd init.d services, installed onto the modem and configured through UCI (`quecmanager.*`) and files under `/etc/qmanager/`.
- **Access.** Over the LAN from a phone, tablet or laptop; frequently the only interface to a device with no screen and no buttons.
- **Network reality.** Sessions happen on the very link being configured, sometimes a poor one. Flaky signal, mid-operation drops, a four-second link loss during an APN attach cycle and a baseband restart that takes the radio away are normal operating conditions, not edge cases.
- **The device clock is not trustworthy.** There is no battery-backed real-time clock, so the wall clock can start at 1970 and later step when the network time arrives (and can step again after a baseband restart). Anything time-based must tolerate that; the connection watchdog measures staleness on a monotonic counter for this reason.
- **No internet guarantee.** The modem may have no upstream connectivity while the UI is in use.

## Capabilities and Constraints

**Capabilities.** Signal and radio information, carrier aggregation, band, tower and frequency locking (with failover), cell scanning, antenna alignment and statistics, custom SIM profiles and connection scenarios, APN management, IMEI and network-priority settings, blocked-network (FPLMN) management, known-SIM registry, SMS inbox, sending and forwarding, centralised alerts over SMS and email (including reboot alerts), connection quality, the connection watchdog with SIM failover, adaptive polling, LAN gateway and subnet, custom DNS, TTL and MTU, IP Passthrough, the Traffic Engine (Video Optimizer and Masquerade), Tailscale and Netbird VPN, config backup and restore, language packs, diagnostics, an AT terminal, speed test, and OTA self-update.

**Constraints that bind design.**

- **BusyBox-era userland.** POSIX `ash`, no bashisms, a `jq` built without regex support, and a CGI contract where a stray carriage return means no output at all.
- **AT is the only write transport, and it is serialised.** Every AT call goes through `qcmd` (the `qmanager_atd` broker) under one lock; a read-only QMI lane over QRTR serves identity, signal and packet counters without the lock (`docs/features/qmi-lane.md`). Every value is still polled, and a long-held AT lock stalls every AT caller. The adaptive poller trades freshness for load by tier (active, idle, deep).
- **Scheduled work runs from cron on a device with a 1970 boot window.** Every scheduled operation must survive an untrusted clock and a crond that has to be told to reload.
- **Static export.** No server runtime, no server components, no API routes. The backend is CGI shell scripts.
- **Self-hosted assets only.** Fonts and icon fonts are vendored and subset at build time. An affordance that depends on a CDN is not an affordance.
- **Five shipped locales**: English, Simplified Chinese, Traditional Chinese, Italian, Indonesian. Every user-visible string is translated, so layouts must survive strings substantially longer than English.

**Terminology.** The product uses the user's real vocabulary (dBm, MHz, EARFCN, PCI, NR5G, LTE, SA/NSA, MIMO) rather than translating it into consumer euphemism.

## Brand Commitments

- **Name and voice.** QManager. Direct, specific, never apologetic. "Lock to cell 412" beats "Are you sure you want to proceed?". Real units, real values, real consequences in plain language. Say it once, and short: the UI talks the way a good label does, not the way a manual does. A sentence that exists only to teach belongs behind an info tip or in the docs, not on the surface. Calm by default; risk surfaces visibly.
- **Emotional goals, in order.** First **trust**: that the modem will still be up tomorrow morning and nothing happened behind the user's back. Then **competence, fast**: a new user should feel capable within a few clicks, not after reading docs.
- **The mark is binding.** The "Tonal Q": a ring plus a 45-degree tail anchored at dead centre, two tones of one blue, no gradient and no shadow. The tail starts at the centre because the signal originates at the device. New brand and UI surfaces derive from the mark rather than beside it. The canonical file is `public/qmanager-mark.svg` on the RM520N fork; the target ships `public/qmanager-logo.svg` today and adopts the mark file with the shell and pre-auth ports (ledger U3).
- **Blue is the single overall hue**, and it is the mark's blue. It is simultaneously the brand, the action accent, and the identity of the 5G NR leg.
- **Radio identity colours are fixed**: blue for 5G NR, violet for 4G LTE. They say which radio, never whether anything is healthy.
- **The operational state colours are fixed**: green, amber, red.
- **Binding visual references, confirmed 2026-08-16 on the RM520N fork and adopted here 2026-10-15**: **WiFiman (Ubiquiti)** and **Firewalla**, for their colour usage and data graphics specifically. Bolder chroma than a pastel tonal system. **Structural reference**: Apple's professional UI (macOS System Settings, the Pro-app inspectors) for the grouped-card, consistent-shape page. `DESIGN.md` owns how both are executed.
- **Confirmed direction decisions.** Colour lives primarily on **data-ink** (chart strokes, coloured numerals, quality bars, small discs) over neutral surfaces, rather than on large tonal container fills. Identity and metadata tags are **outline-and-tint**; the operational states remain **filled chips with an icon**. Measured signal quality gets a **continuous red-to-green quality ramp** as its own scale, distinct from the discrete states. Light and dark are both first-class and each is authored.
- **Target-only surfaces are preserved, not erased.** Netbird, Config Backup and Restore, Adaptive Polling, the Traffic Engine (Video Optimizer and Masquerade), Connection Scenarios, Custom SIM Profiles and the deferred-reboot banner exist only in QManager. Their function and safety contracts are ground truth; they are re-authored in this canon one at a time (port ledger U4.11), and until then new work on them follows `DESIGN.md`.
- **Anti-position.** QManager is not a consumer router app. Oversimplification, marketing-flavoured copy, cartoon icons, and wizards that block direct access are all rejected. Density is the point; the design organises it rather than hiding it.

## Anti-references

What QManager should not look or feel like. These sit beside the binding references above (WiFiman, Firewalla) and the Anti-position; they add the failure modes a design review checks a page against.

- **Classic LuCI and engineer-default UI.** Bare tables, browser-default form widgets, dense data with no hierarchy and no progressive disclosure. The look QManager exists to replace.
- **Terminal-style modem utilities and raw AT consoles.** Monospace-everything, command-shaped, assumes you already know which AT command to send. QManager respects expertise without requiring it. The AT terminal exists as a tool, never as the product's voice.
- **Generic SaaS dashboard slop.** The hero-metric template (big number, small label, gradient accent), gradient text, glassmorphism heroes. If the page could be reskinned for a CRM without changing anything, it has failed.
- **Hero-reliant, bespoke-per-screen composition.** A page built around one giant focal widget or an asymmetric mosaic unique to that screen, instead of the grouped-card layout every other feature page uses. It looks impressive alone and breaks the consistency that keeps a user oriented everywhere. A hero is a rare, deliberate exception for a genuine glance surface, never the default.
- **The over-explained UI.** Helper text under every field, three-line card descriptions, empty states that lecture, dialogs that narrate the backend. A sentence that restates a label or teaches a convention buries the one that matters.
- **The debug build.** Copy that leaks file paths, script names, "saved to the modem" provenance lines or AT-command names onto a surface that is not a diagnostic one. It tells the user how the product is built when they came to learn what it is doing.
- **Full-bleed feature layouts that use the page as the canvas.** A feature that claims the whole viewport and scatters loose fragments across it, instead of wrapping its settings in a self-contained card (or a tidy grid of them) that the page arranges. The settings belong inside the card; the page only arranges cards.

## Evidence on Hand

- **A live RM551E** is reachable over SSH (PowerShell Posh-SSH, credentials in the gitignored `.env` as `SSH_HOST`, `SSH_USERNAME`, `SSH_PASSWORD`) for verifying platform claims directly. The device is the source of truth; documentation drifts.
- **The shipped product itself**: a large, coherent, working interface across roughly forty routes. Any claim about how QManager behaves is checkable against the code and the device.
- **The RM520N fork** (`QManager-RM520N`, fetched into this repository; read its files with `git show a05c4e92:<path>`), from which this canon and its reference implementations (`/dashboard`, the `/cellular/` index) come, and `docs/rm520n-port-ledger.md`, which tracks the port.
- **Measured colour data.** Contrast and colour-vision-deficiency separation for the token system were computed on the fork rather than estimated, and more than one shipped value is a correctness fix rather than a taste change (`docs/reference/color-system.md`).
- **What does not exist and must not be invented**: customers, testimonials, benchmarks, install counts, pricing, or any commercial claim. QManager is distributed through GitHub releases and an in-product OTA updater.

## Product Principles

1. **Data clarity first.** Metrics are scannable at a glance, with real units and sensible precision. Colour is part of the clarity budget, not an addition to it: colour that encodes nothing is spending contrast for nothing.
2. **Progressive disclosure.** Essentials surface immediately; advanced controls stay one click away. A field tech does not need to read the AT sequence behind a band lock to trust that the lock applied.
3. **Interfaces that never lie.** Every action shows loading, success, or error, and the result of a finished action always arrives the same way: one success or error toast, never a chip that fades before the user looks back (`DESIGN.md` > Confirmation Toasts; implementation in `docs/reference/toast-confirmation.md`). Multi-step pipelines show per-step state. A status surface reports what is actually running, not the half-edited form. A control that cannot currently work explains why instead of sitting there dead. An ambient animation loops only where something is genuinely live.
4. **Consistent in shape, not just in parts.** Every feature page is a page header followed by a uniform grid of self-contained cards. A user who learns one page has learned them all. A bespoke layout invented for one screen is a consistency failure even when it looks good alone. The unit of composition is the **card that wraps a settings group**, not the page: a card owns its whole content, including the footer an edit is committed from, and the page only arranges cards. A full-bleed layout that treats the viewport as its canvas has skipped the card (`DESIGN.md` > The Card-Wrapped Surface Rule, The Card-Foot Apply Rule).
5. **Resilient by default.** Every data surface ships loading, empty, and error states. Never a blank panel. A flaky-signal session must never leave the UI indeterminate.
6. **Make the dangerous obvious, the safe effortless.** The routine ninety percent should feel instant. Anything that can disrupt the connection (reboot, profile activation, APN save, band or tower lock, IMEI write, LAN gateway change, factory restore) wears its risk visibly and feels deliberate: the destructive variant, an explicit dialog, and, for anything that needs a reboot, a deferred reboot with a persistent banner rather than a reboot mid-request. Warning copy states the consequence, not the mechanism: "Your connection will drop briefly", not an account of why the network rebinds.
7. **Convention over explanation.** Lean on patterns users already know from every settings app: a switch toggles, `SaveButton` commits, red means destructive, a disabled control shows a short reason, a trailing `…` means a dialog follows, units sit in the field suffix, and trash, pencil and copy mean what they always mean. If a control needs a paragraph to be understood, fix the control first (a clearer label, a sensible default, better grouping) before adding words. Copy explains only what a convention cannot: a domain term, a non-obvious side effect, or a consequence. The first two go behind an info tip; the consequence stays visible (Principle 6). Walls of helper text, three-line card descriptions and dialogs that narrate the backend bury the one sentence that matters. Budgets, the info-tip rules and the ban on debug-build copy live in `DESIGN.md` ("Copy & Help").
8. **Built to be scanned, not read.** Nobody reads a screen top to bottom. They arrive with one question ("is 5G up?", "where's the APN field?") and hunt for its answer, and every surface is judged by how fast that hunt ends. Four tools do the work, in this order. **Edges:** every element aligns to at least two edges, so the eye travels down a column instead of zig-zagging. **Differentiation:** related rows are grouped under a label and varied with a glyph or tag, so a long list becomes a few short ones. **Recognition over reading:** a universal glyph, a bar or a chip replaces a sentence only when it registers without a tooltip. **Relative emphasis:** the default state is quiet, so whatever differs from it stands out without being turned up. When something is hard to find, the fix is almost never more words, more whitespace or a louder colour. Awkward whitespace is a symptom, not a shortage of padding: look for a missing edge, an undifferentiated run, or a neighbour competing for the same attention. Mechanics live in `DESIGN.md` ("The Scanning Rules").

## Accessibility & Inclusion

- **WCAG 2.1 AA baseline.** All text and meaningful icons clear 4.5:1 in both themes; large text and UI boundaries clear 3:1.
- **Contrast is measured, not eyeballed.** Every role pairing is checked before merge, against the value the build actually ships rather than the value written in source. The CSS pipeline gamut-maps out-of-sRGB colours, so the declared value is not always the delivered one.
- **Colour is never the sole carrier of meaning.** Status indicators always pair their tone with a distinct icon, and no two states in one slot share a glyph. Directional readouts pair hue with an arrow. The signal quality ramp pairs its colour with both a bar and a quality glyph, because a red-to-green ramp is the worst case for deuteranopia: bar length carries magnitude within the scale, and the glyph ladder carries which stop the reading is on.
- **Colour-vision-deficiency separation is a measured floor, not a guideline.** Deuteranopia and protanopia are simulated for any new pairing. Where a pair cannot clear the floor, the meaning moves to a non-chromatic carrier rather than the pair being shipped and hoped for.
- **Reduced motion respected.** `prefers-reduced-motion: reduce` removes movement and keeps opacity. The UI must remain fully usable, and feel intentional, with motion off.
- **Keyboard-first.** Every primary action is reachable without a mouse, focus rings are visible in both themes, and there are no keyboard traps in modals or the AT terminal.
- **Touch-usable in the field.** Dense data surfaces may pack information tightly, but the controls that act on them never shrink below a comfortable tap target.
- **Retired 2026-08-16 on the RM520N fork, by user decision, and not carried over.** The earlier "outdoor-readable / direct sunlight" extension (which the target's previous PRODUCT.md had) and the light-mode ink rule that served it are no longer requirements. WCAG AA remains the floor; validation against a bright ambient assumption does not.

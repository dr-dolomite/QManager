# Product

## Register

product

## Users

**Hobbyist power users and field technicians managing Quectel modems on OpenWRT.** Technically literate without being developers: comfortable with concepts like APN, PCI, RSRP, and bands, but not expected to read shell scripts or write AT commands by hand.

Two session shapes share the same UI:

- **The quick check.** Mid-day glance at signal, watchdog state, recent events. Seconds, not minutes. Often on a phone or tablet beside the modem.
- **The focused configuration.** Activating a custom SIM profile, locking to a tower, tuning DPI for a specific carrier, restoring a backup. Minutes of deliberate work, usually at a desk on a laptop, occasionally roadside on a tablet in direct sun.

QManager runs **on the modem it manages**. A wrong click can sever the user's own connection. That single fact shapes every confirmation, every deferred reboot, every persistent banner in the product.

## Product Purpose

QManager is the modern web GUI for Quectel cellular modems running OpenWRT (RM520N-GL, RM551E-GL, RM500Q, and similar). It replaces the engineer-flavored defaults (classic LuCI, raw AT consoles, vendor utilities) with an interface that respects the user's intelligence without requiring modem-engineering background.

Success looks like:

- A first-time user reaches signal-and-network clarity within thirty seconds of loading the dashboard.
- A returning user activates a saved SIM profile, locks a tower, or restores a backup in one focused session, with no terminal fallback required.
- A power user can still see every underlying value (EARFCN, PCI, CFUN state, NFQUEUE rules) when they want to, without having to be confronted with all of it by default.
- The modem never gets bricked, stranded, or silently reconfigured by the UI it serves.

## Brand Personality

**Modern, Approachable, Smart.** A premium engineering tool that talks to you like a peer, not a novice and not a sysadmin.

- **Voice.** Direct, specific, never apologetic. "Lock to cell 412" beats "Are you sure you want to proceed?". Real units, real values, real consequences in plain language.
- **Tone.** Calm by default. Risk surfaces visibly (destructive variant, warning copy, explicit dialog) but the routine 90% feels quiet and confident.
- **Feel.** Silky and buttery in motion: every transition, panel slide, badge state change, and chart update should feel Apple-class smooth, not snappy-corporate, not springy-playful, not Material-pop. Restraint with refinement.
- **Visual signature.** Signal Indigo is the single action accent — the one true brand color, used on every button, focus ring, and active affordance. There is no second brand color and no identity palette. The `secondary` token is a quiet functional control surface (a lighter shade of the primary), not a brand statement. The interface stays one-accent. Tokens and rules live in `DESIGN.md`.
- **Emotional goals.** Two we want users to feel often, in this order:
  1. **Trust** that the modem will still be up tomorrow morning and that nothing the UI does behind the scenes will surprise them.
  2. **Competence**, fast. The interface should make a new user feel like they already know what they're doing within a few clicks, not after reading docs.

### Reference touchstones

**Primary reference (heavy, load-bearing):**

- **Apple's professional UI/UX** (macOS System Settings, the Pro-app inspectors in Logic / Final Cut / Xcode, iOS Settings, Apple's developer and admin consoles). The dominant aesthetic and structural reference. Four facets are adopted deliberately, not just borrowed in spirit:
  1. **The grouped-card, consistent-shape page.** Every settings surface in macOS is the same shape: a clear page header, then self-contained grouped cards on a calm, even grid. You always know where you are because every page is built the same way. This is QManager's structural default: each feature page is a page header plus a uniform card layout, never a bespoke per-screen composition.
  2. **Restraint as the resting state.** Surfaces are quiet until reached for. Hierarchy comes from spacing, weight, and grouping, not from a loud focal element competing for attention. Nothing shouts; the important thing is simply the clearest.
  3. **Instrument-class motion.** Every transition, toggle, and value change settles with the silky, exponential ease-out you feel in Control Center and macOS window management. Never bouncy, never springy, never Material-pop. (See Brand Personality > Feel.)
  4. **Professional density without engineer-ugliness.** Apple's pro apps prove dense, expert tooling can stay legible and refined. QManager is a dense modem GUI; the density is earned with hierarchy and grouping, the way a pro-app inspector is, not dumped on the page.

**Supporting references (one facet each):**

- **Ubiquiti UniFi** (Network Controller, UniFi OS, Protect): **data density only.** UniFi contributes exactly one thing, and it is load-bearing: its dense pill-and-tag data tables and inline status tags. QManager's outline-badge pattern (`bg-{role}/15 + text-{role} + border-{role}/30`) and its data tables are the UniFi heritage; UniFi raises that density from "a rule" to "a signature aesthetic." What QManager explicitly does **not** take from UniFi is its varied-size hero-mosaic dashboard composition. That approach was tried (the Traffic Engine redesign) and rejected as inconsistent with the grouped-card layout above. UniFi is a density reference, not a layout reference.
- **Linear** — voice and microcopy. Restraint, precision, expert-tool register in every confirmation, error, and label.
- **Vercel dashboard** — light-and-dark parity, OKLCH-era color restraint, modern polish without corporate stiffness.
- **Grafana** — when data viz earns dense readouts. Specifically informs the signal panel, latency monitor, bandwidth chart, antenna alignment meter.
- **Raycast** — power-user UX without intimidation. Informs the AT terminal, command-palette interactions, instant feedback patterns.
- **QManager-RG520 sibling build (Watchdog + Alerts pages)** — the in-family proof of the **status-first feature page**: a single column of page header, read-only Live Status hero, one tabbed settings card with a sticky save bar, and an optional activity log. Two different features shipped the identical shape on purpose, so learning one page taught the other. Contributes the layout anatomy and its honesty contracts (hero reflects saved state, incapable controls explain themselves, tests only run against saved config); colors and theming are explicitly not imported. Full anatomy lives in DESIGN.md ("Status-First Feature Page").

**Atmospheric hints:**

- **Nokia FastMile 5G Gateway 7 web interface** — borrowed for the **big circular signal-quality meter** as a signal-quality readout, the friendly-but-technical balance, and the soft Bell-Labs-flavored card treatment on signal pages. Applied selectively, not system-wide; the hint lands on signal/antenna surfaces (where the meter is genuinely the best affordance) and recedes elsewhere. It is an optional component, not a layout the rest of the app is built around.
- **Askey CPE Management Utility (iF Design Award winner)** — the proof a CPE interface can be design-award-worthy. Contributes editorial whitespace, a confident typographic hierarchy inside grouped cards, and the premium-consumer feel that softens density without diluting it. The aspirational standard: when in doubt, raise the craft.

## Anti-references

What QManager explicitly should not look or feel like:

- **Classic LuCI and OpenWRT defaults.** Bare tables, browser-default form widgets, dense data with no hierarchy, no progressive disclosure. The "engineer UI" QManager exists to replace.
- **Terminal and putty-style modem utilities (QNavigator, QCOM, raw AT consoles, Quectel's own QNavigator-class tools).** Monospace-everything, command-shaped, assumes you already know which AT command to send. QManager respects expertise without requiring it.
- **Consumer router and "smart home" apps (Netgear Nighthawk, TP-Link Tether, AT&T Smart Home Manager, Linksys Smart Wi-Fi).** Oversimplified, marketing-flavored, hides what power users need behind cartoon icons and gradient hero metrics. Wizards that block direct access.
- **Generic AI/SaaS dashboard slop.** Hero-metric template (big number, small label, gradient accent), gradient text headlines, glassmorphism heroes. If the page could be reskinned for a CRM or a project tracker without changing anything, it has failed.
- **Hero-reliant, bespoke-per-screen composition.** A page built around one giant focal widget (a full-width hero readout, a 5xl/6xl number, an asymmetric "mosaic" unique to that one screen) instead of the grouped-card layout every other feature page uses. It looks impressive in isolation and breaks the consistency that lets a user feel oriented everywhere. Consistency of shape across feature pages beats a memorable hero on any single one. A hero is a rare, deliberate exception for a genuine glance surface, never the default.
- **Full-bleed feature layouts that use the page as the canvas.** A single feature that claims the whole viewport and scatters cards as loose visual fragments or spacers, instead of wrapping its settings inside one self-contained card (or a tidy grid of them) that the page lays out. The settings belong **inside** the card; the page only arranges the cards. If the cards inside a feature carry no clear settings-group boundary, the composition is inverted and should be pulled back into a card-wrapped surface.

## Design Principles

1. **Data clarity first.** Metrics are scannable at a glance. Real units, sensible precision, no decoration that hurts legibility. The signal dashboard is the test case: someone glancing for half a second should know whether things are healthy.
2. **Progressive disclosure.** Essentials surface immediately, advanced controls stay one click away. A field tech does not need to see NFQUEUE rule syntax to understand that Video Optimizer is on.
3. **Confidence through feedback, and interfaces that never lie.** Every action shows loading, success, or error. Async pipelines (profile apply, config restore, language install) show per-step state. The user is never left wondering "did that work?". The same principle extends to state honesty: a status surface reports what is actually running (saved settings, live daemon state), never the half-edited form; a control that cannot currently work explains why instead of sitting there dead; an in-between state (enabled but still starting) gets its own honest rendering. Trust is the first emotional goal, and it is built by never letting the UI claim something the device is not doing.
4. **Consistent in shape, not just in parts.** shadcn/ui components and design tokens are used uniformly, no one-off styles: a status badge looks the same on the cellular page as on the watchdog page. The same discipline governs **page structure**. Every feature page is the same shape, a page header (title plus muted description) followed by a uniform grid of self-contained cards, the way every macOS System Settings pane is the same shape. A user who learns one page has learned them all. A bespoke, hero-driven layout invented for a single screen is a consistency failure even when it looks good on its own. The unit of composition is the **card that wraps a settings group**, not the page: a feature surface is authored as a self-contained card (or a small grid of them) that the page arranges, never a full-bleed layout that claims the whole viewport as its canvas and treats cards as loose decorative parts. The Traffic Engine's grouped settings-in-a-card is the reference; the earlier full-page Custom Profiles compositions are the anti-pattern this rule exists to prevent. For features backed by a live daemon, the sanctioned arrangement of those same self-contained cards is the **status-first column** (Live Status hero, then the settings card, then an optional activity log; see the RG520 touchstone above and DESIGN.md): still cards in a consistent shape, just stacked in the order the user's questions arrive (is it working, how do I tune it, what has it done).
5. **Responsive and resilient.** Graceful loading, empty, and error states everywhere. Never a blank panel. Field-tech sessions on flaky signal cannot be allowed to leave the UI in an indeterminate state.
6. **Make the dangerous obvious, the safe effortless.** QManager runs on the modem it manages. Routine reads and saves feel quiet. Anything that can disrupt the connection (reboot, profile activation, MPDN release, band lock, IMEI write, factory restore) wears its risk visibly: destructive variant, warning copy, explicit dialog, deferred reboot with a persistent banner. The routine 90% should feel instant. The risky 10% should feel deliberate.

## Accessibility & Inclusion

- **WCAG 2.1 AA baseline**, with one project-specific extension below.
- **Outdoor-readable contrast.** Field technicians use this in direct sunlight on tablets and phones. All text and meaningful icons hit 4.5:1 minimum in both light and dark themes, including dense Grafana-style cards where small labels are most at risk. Validate with both themes against bright ambient assumption, not just dark-room AA.
- **Reduced motion respected.** `prefers-reduced-motion: reduce` disables the silky transitions called out in Brand Personality. The UI must remain perfectly usable (and feel intentional) when motion is off, not just functional.
- **Color is never the sole carrier of meaning.** Status badges always pair semantic color with an icon (`CheckCircle2Icon`, `TriangleAlertIcon`, `XCircleIcon`, `MinusCircleIcon`). The live-traffic **throughput-direction pair** — Telemetry Blue for download, Stream Violet for upload (see DESIGN.md) — is a deliberate brand convention, and direction is *also* encoded by the arrow glyph (down vs. up), so the readout survives color-blindness even though the two hues are intentionally distinct. Charts and signal-quality indicators must remain readable in deuteranopia and protanopia simulation; the current chart palette (5 blues + 1 orange) is acceptable today but any addition must be re-verified.
- **Keyboard-first.** Every primary action reachable without a mouse, focus rings visible against both themes, no keyboard traps in modals or the AT terminal.
- **Internationalization is a first-class concern.** EN and zh-CN are bundled; additional language packs are user-installable. Strings live in i18n catalogs, never inline. RTL support flagged per pack.

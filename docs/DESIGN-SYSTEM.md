# QManager Design System

> ⚠️ WARNING: **Superseded on 2026-10-15.** QManager adopted the RM520N design canon wholesale (port ledger U0.1 to U0.3). `DESIGN.md` and `PRODUCT.md` at the repo root are now the only design source of truth. This file is kept as a historical record of the earlier target design (Signal Indigo, outline status badges, hybrid elevation, the uniform card grid). The code no longer matches every value below. Where they differ, `app/globals.css`, `app/layout.tsx` and `components/ui/` are ground truth. The token values, fonts (Rethink Sans, JetBrains Mono), component inventory, and sidebar were re-synced to the code on 2026-11-06; the rest is unverified against the code. Do not build new UI from it.

This document defines the visual language, component library, theming system, and UI conventions used throughout QManager.

---

## Design Philosophy

QManager targets **hobbyist power users** and **field technicians** managing cellular modems. The interface must balance information density (signal metrics, carrier data) with clarity and approachability.

### Principles

1. **Data clarity first** — Signal metrics, latency, and network status are the core experience. Use color, spacing, and hierarchy for scannable numbers.
2. **Progressive disclosure** — Essential info upfront, advanced controls accessible but not overwhelming.
3. **Confidence through feedback** — Every action has clear visual feedback: loading states, success toasts, error messages.
4. **Consistent and systematic** — shadcn/ui components and design tokens used uniformly.
5. **Responsive and resilient** — Works on desktop monitors and tablets. Handles loading, empty, and error states.

### Aesthetic Direction

- **Visual tone:** Clean and modern with purposeful density where data matters
- **References:** Apple System Preferences (clarity), Vercel/Linear (typography, whitespace), Grafana (data density), UniFi (network UX)
- **Anti-references:** Avoid raw terminal aesthetics, cluttered legacy tools, or overly playful styling

---

## Color System (OKLCH)

QManager uses OKLCH (Oklab Lightness, Chroma, Hue) for perceptually uniform colors. Both light and dark modes are first-class citizens.

### Light Mode

| Token | OKLCH Value | Usage |
|-------|-------------|-------|
| `--background` | `oklch(0.985 0.003 258)` | Page background (near white) |
| `--foreground` | `oklch(0.205 0.011 258)` | Primary text (near black) |
| `--card` | `oklch(1 0 258)` | Card backgrounds |
| `--primary` | `oklch(0.565 0.235 262)` | Primary actions, links (blue) |
| `--primary-foreground` | `oklch(0.985 0.006 262)` | Text on primary bg |
| `--secondary` | `oklch(0.967 0.005 258)` | Quiet control surface (neutral) |
| `--secondary-foreground` | `oklch(0.205 0.011 258)` | Text on secondary surface |
| `--muted` | `oklch(0.967 0.005 258)` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.505 0.012 258)` | Secondary text |
| `--accent` | `oklch(0.938 0.007 258)` | Accent backgrounds |
| `--destructive` | `oklch(0.48 0.192 27)` | Destructive actions (red) |
| `--success` | `oklch(0.54 0.15 149)` | Success indicators (green) |
| `--warning` | `oklch(0.56 0.118 72)` | Warning indicators (amber) |
| `--info` | `oklch(0.565 0.235 262)` | Info indicators (blue) |
| `--border` | `oklch(0.905 0.006 258)` | Borders and dividers |
| `--input` | `oklch(0.868 0.008 258)` | Input borders |
| `--ring` | `oklch(0.565 0.235 262)` | Focus rings |

### Dark Mode

| Token | OKLCH Value | Change from Light |
|-------|-------------|-------------------|
| `--background` | `oklch(0.12 0.008 258)` | Charcoal |
| `--foreground` | `oklch(0.965 0.004 258)` | Near white |
| `--card` | `oklch(0.17 0.009 258)` | Elevated dark |
| `--secondary` | `oklch(0.2 0.01 258)` | Quiet control surface (neutral, dark) |
| `--secondary-foreground` | `oklch(0.965 0.004 258)` | Text on secondary surface (dark) |
| `--muted-foreground` | `oklch(0.762 0.011 258)` | Lighter secondary text |
| `--destructive` | `oklch(0.64 0.2 27)` | Brighter red for contrast |
| `--success` | `oklch(0.74 0.2 149)` | Brighter green |
| `--warning` | `oklch(0.79 0.166 72)` | Brighter amber |
| `--info` | `oklch(0.605 0.2 262)` | Brighter blue |
| `--border` | `oklch(0.288 0.012 258)` | Subtle border |
| `--input` | `oklch(0.33 0.013 258)` | Slightly more visible |

### Semantic Color Usage

| Purpose | Class | Token |
|---------|-------|-------|
| Primary buttons/links | `bg-primary text-primary-foreground` | `--primary` |
| Destructive actions | `bg-destructive text-destructive-foreground` | `--destructive` |
| Success indicators | `bg-success text-success-foreground` | `--success` |
| Warning indicators | `bg-warning text-warning-foreground` | `--warning` |
| Info indicators | `bg-info text-info-foreground` | `--info` |
| Muted/secondary text | `text-muted-foreground` | `--muted-foreground` |
| Card surfaces | `bg-card text-card-foreground` | `--card` |

**Important:** Use semantic tokens (`text-info`, `bg-success`) instead of raw Tailwind colors (`text-blue-500`, `bg-green-500`).

### Chart Colors

Six chart colors are defined for Recharts visualizations:

| Token | OKLCH | Visual |
|-------|-------|--------|
| `--chart-1` | `oklch(0.809 0.097 251.813)` | Light blue |
| `--chart-2` | `oklch(0.623 0.201 259.815)` | Medium blue |
| `--chart-3` | `oklch(0.535 0.22 262)` | Deep blue |
| `--chart-4` | `oklch(0.488 0.243 264.376)` | Primary blue |
| `--chart-5` | `oklch(0.424 0.199 265.638)` | Dark blue |
| `--chart-6` | `oklch(0.51 0.143 45)` | Orange (contrast) |

Light-mode values; dark mode redefines all six in `app/globals.css` (`.dark`). The RM520N-derived `--chart-nr`, `--chart-lte` and `--chart-threshold` tokens also exist.

---

## Typography

### Primary (and only UI font): Rethink Sans

The single interface typeface. Loaded from vendored variable font files (`app/fonts/RethinkSans-Variable.woff2`, `RethinkSans-Italic-Variable.woff2`) via `next/font/local`, not `next/font/google`, so the build makes no Google request. See `DESIGN.md` §3 for the full hierarchy and named rules.

| Weight | Usage |
|--------|-------|
| 400 (Regular) | Body text, inputs, descriptions |
| 500 (Medium) | Labels, table headers, button text, nav items |
| 600 (SemiBold) | Headings, card titles, numeric readouts, emphasis |
| 700 (Bold) | Wordmark / brand surfaces only |

CSS Variable: `--font-rethink-sans` (mapped to `--font-sans`)
Tailwind: `font-sans` (mapped via `@theme inline`)

**Weight discipline:** 400 body · 500 labels · 600 headings/emphasis · 700 brand only.

### Monospace (scoped): JetBrains Mono

The one sanctioned non-Manrope face, used **only** in the AT terminal, raw-AT-response / log viewers, and inline `<code>` for AT command strings. Never a general UI font (The Machine-Voice Rule in `DESIGN.md`). Chosen for a disambiguated (slashed) zero and fixed advance width so device output stays column-aligned.

CSS Variable: `--font-jetbrains-mono` (mapped to `--font-mono`; vendored `app/fonts/JetBrainsMono-Variable.woff2`)
Tailwind: `font-mono`

> Note: the app previously shipped Euclid Circular B (commercial) as `--font-euclid` and pointed `--font-mono` at an undefined `--font-geist-mono`. Both are superseded. Rethink Sans is the canonical UI font, and JetBrains Mono the canonical scoped mono.

---

## Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `0.65rem` | Base border radius |
| `--radius-sm` | `calc(0.65rem - 4px)` | Small elements, badges |
| `--radius-md` | `calc(0.65rem - 2px)` | Inputs, buttons |
| `--radius-lg` | `0.65rem` | Cards, dialogs |
| `--radius-xl` | `calc(0.65rem + 4px)` | Large containers |
| `--radius-inline` | `0.5rem` | Small inline affordances, code, skeletons |
| `--radius-field` | `0.625rem` | Inputs, selects, small popovers |
| `--radius-tile` | `0.75rem` | Inner tiles, carrier tiles, alignment slots |
| `--radius-card` | `1rem` | Standard cards, dialogs |
| `--radius-hero` | `1.25rem` | Hero surfaces, aggregation strip |
| `--radius-pill` | `9999px` | Chips, buttons, nav items, metric rows, meters |

The `--radius-sm` to `--radius-xl` chain is the legacy set. `app/globals.css` also defines the purpose-named set above.

The radius is softly rounded — not pill-shaped, not sharp-cornered.

---

## Component Library

### shadcn/ui Configuration

```json
{
  "style": "new-york",
  "rsc": true,
  "tailwind": {
    "baseColor": "zinc",
    "cssVariables": true
  },
  "iconLibrary": "lucide"
}
```

### Available Components (61 files in `components/ui/`)

Not present in the tree (despite earlier docs): `scroll-area`, `resizable`, `navigation-menu`, `carousel`, `form`.

**Layout:** `card`, `card-foot`, `separator`, `aspect-ratio`, `sidebar`, `sheet`, `skeleton`

**Navigation:** `breadcrumb`, `menubar`, `tabs`

**Forms:** `button`, `input`, `textarea`, `label`, `select`, `checkbox`, `switch`, `toggle`, `toggle-group`, `slider`, `input-otp`, `input-group`, `field`, `segmented-field`, `save-button`

**Data Display:** `table`, `badge`, `avatar`, `progress`, `chart` (Recharts wrapper), `tag`, `metric-bar`, `code-block`

**Feedback:** `alert`, `alert-dialog`, `banner`, `tonal-banner`, `dialog`, `popover`, `tooltip`, `hover-card`, `sonner` (toasts), `spinner`

**Menus:** `dropdown-menu`, `context-menu`, `command` (cmdk search)

**Content:** `accordion`, `collapsible`, `drawer` (vaul), `empty`, `kbd`, `meta-panel`

**Icons and brand:** `material-symbol` (+ `material-symbol-names.ts`), `brand-mark`, `hint-icon`

**Interaction and value helpers:** `reveal-button`, `reveal-label-button`, `expand-button`, `swap-label`, `tick-group`, `ticking-value`

`components.json` registers the `@magicui` registry.

### MagicUI Registry

Additional components available from MagicUI (`@magicui` registry in `components.json`).

---

## UI Patterns

### Card Layout

The standard settings card:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Feature Name</CardTitle>
    <CardDescription>What this does in plain language</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Form fields or data display */}
  </CardContent>
  <CardFooter className="flex justify-end gap-2">
    <Button variant="outline" onClick={reset}>Reset</Button>
    <Button onClick={save} disabled={isSaving}>
      {isSaving ? "Saving..." : "Save Changes"}
    </Button>
  </CardFooter>
</Card>
```

### Three-State Pattern

Every data component must handle loading, error, and empty states:

```tsx
// Loading
<Card>
  <CardContent className="p-6">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4 mt-2" />
  </CardContent>
</Card>

// Error
<Alert variant="destructive">
  <AlertDescription>{error.message}</AlertDescription>
</Alert>

// Empty
<Empty
  icon={InboxIcon}
  title="No data available"
  description="Data will appear once the modem is connected"
/>
```

### Signal Quality Indicators

Use consistent color mapping for signal quality:

| Quality | Color | RSRP | RSRQ | SINR |
|---------|-------|------|------|------|
| Excellent | `text-success` | >= -80 | >= -5 | >= 20 |
| Good | `text-info` | >= -100 | >= -10 | >= 13 |
| Fair | `text-warning` | >= -110 | >= -15 | >= 0 |
| Poor | `text-destructive` | < -110 | < -15 | < 0 |

### Toast Notifications

Use `sonner` for all user feedback:

```tsx
import { toast } from "sonner";

// Success
toast.success("Settings saved successfully");

// Error
toast.error("Failed to save settings", {
  description: error.message
});
```

### Reboot Dialog

For operations requiring a device reboot:

```tsx
<Dialog open={showRebootDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Reboot Required</DialogTitle>
      <DialogDescription>
        Changes have been saved. A reboot is required to apply them.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={dismiss}>Later</Button>
      <Button variant="destructive" onClick={reboot}>Reboot Now</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Badge Variants

Use badges for status indicators:

```tsx
// Connected state
<Badge variant="default" className="bg-success">Connected</Badge>

// Warning state
<Badge variant="default" className="bg-warning">Degraded</Badge>

// Error state
<Badge variant="destructive">Error</Badge>

// Inactive/unknown
<Badge variant="secondary">Unknown</Badge>
```

---

## Sidebar Design

The sidebar uses the `inset` variant with `collapsible="icon"` (`components/app-sidebar.tsx`). Groups render through `NavSection` and `NavMenu`. The authoritative tree is `NAV_GROUPS` in `app-sidebar.tsx`, and [`FRONTEND.md`](FRONTEND.md#sidebar-navigation) summarises it:

| Section | Items |
|---------|-------|
| Main | Home (Dashboard) |
| Cellular | Cellular Info, SMS, Custom Profiles, Band Locking, Cell Scanner, Settings |
| Local Network | Ethernet Status, Traffic Engine, Settings (TTL & MTU, Custom DNS) |
| Monitoring | Connection Quality, Alerts, Watchdog, Tailscale, NetBird |
| System | System Settings (Logs, Languages, Configuration Backup, Adaptive Polling, and others) |
| Footer | About Device, Support, Donate |
| User menu | Change Password, Theme, Animations, Reboot Device, Logout |

---

## Responsive Design

### Container Queries

The main content area uses container queries for responsive layouts:

```tsx
<main className="@container/main">
  <div className="grid gap-4 @lg/main:grid-cols-2 @xl/main:grid-cols-3">
    {/* Cards resize based on container, not viewport */}
  </div>
</main>
```

### Breakpoints

Standard Tailwind breakpoints apply:

| Prefix | Width | Usage |
|--------|-------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / small desktop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop |

### Mobile Considerations

- Sidebar collapses to sheet on mobile
- Cards stack vertically
- Tables become horizontally scrollable
- Touch-friendly button sizes (min 44px)

---

## Dark Mode

### Implementation

Dark mode uses `next-themes` with class-based toggling:

```tsx
// app/layout.tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
  {children}
</ThemeProvider>
```

### CSS

The `.dark` selector is defined as a custom Tailwind variant:

```css
@custom-variant dark (&:is(.dark *));
```

All colors automatically switch between light and dark palettes via CSS variables.

### Guidelines

- Never use hardcoded colors (e.g., `#ffffff`, `rgb(0,0,0)`)
- Always use semantic tokens (`text-foreground`, `bg-card`)
- Test both modes when adding new colors
- Dark mode should have slightly brighter semantic colors for contrast

---

## Animations

### Libraries

- **tw-animate-css** — Tailwind animation utilities (fade, slide, scale)
- **Motion** (`motion` package, the successor to Framer Motion; `framer-motion` is not installed) — Complex component animations

### Custom Animations

```css
/* Pulsating ring for status indicators (app/globals.css) */
.animate-pulse-ring {
  animation: pulse-ring var(--duration-ambient) var(--ease-ambient) infinite alternate;
}
```

All animations respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-pulse-ring { animation: none; }
}
```

---

## Icons

### Lucide React

Primary icon library for in-page icons. Sidebar glyphs and the pre-auth pages (`/`, `/login`) use Material Symbols through `components/ui/material-symbol.tsx` instead. Consistent stroke width and sizing:

```tsx
import { RadioTowerIcon, SettingsIcon } from "lucide-react";

<RadioTowerIcon className="size-4" />     // 16px (inline text)
<SettingsIcon className="size-5" />       // 20px (buttons)
<RadioTowerIcon className="size-8" />     // 32px (empty states)
```

### Tabler Icons

Secondary icon library (`@tabler/icons-react`) for specialized icons not in Lucide.

### Icon-Only Buttons

Always include `aria-label` for accessibility:

```tsx
<Button variant="ghost" size="icon" aria-label="Refresh data">
  <RefreshCwIcon className="size-4" />
</Button>
```

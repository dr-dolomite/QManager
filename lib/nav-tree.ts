import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Nav tree: the shape of the sidebar, and the two questions asked of it
// =============================================================================
// The sidebar data lives in components/app-sidebar.tsx. This module owns its
// types and the pure logic both the sidebar and the header breadcrumb need:
// which rows a parent expands to, which row a route belongs to, and what the
// crumb trail for a route is. Labels never live here; `t_key` resolves through
// the "sidebar" namespace (`items.*`, `groups.*`).
// =============================================================================

/**
 * A live condition worth surfacing on the nav row itself, so a user who is not
 * on the Monitoring page still learns the watchdog is intervening.
 *
 * The tone must describe what the device is doing, not how alarming it sounds:
 * `recovery` is the modem being acted on (destructive), `cooldown` is the
 * modem being watched to see whether the action held (warning). Anything that
 * cannot be read off live state does not belong here at all.
 */
export interface NavStatus {
  tone: "destructive" | "warning";
  /** Short machine-voice tag rendered in the pill, e.g. "acting". */
  label: string;
  /** Sentence a screen reader and tooltip get instead of the terse tag. */
  description: string;
}

export interface NavSubItem {
  t_key: string;
  url: string;
  /**
   * Active only on an exact route match. Set on the derived first sub-row,
   * whose URL is the parent's and is therefore a prefix of every sibling.
   */
  exact?: boolean;
}

export interface NavItem {
  t_key: string;
  url: string;
  icon: MaterialSymbolName;
  items?: NavSubItem[];
  /** Renders a button instead of a link (the donate dialog). */
  onClick?: () => void;
  status?: NavStatus;
}

export interface NavGroup {
  /** i18n key under "groups". Omitted for the unlabelled footer group. */
  groupKey?: string;
  items: NavItem[];
  /** "sm" is the quieter footer group (About / Support / Donate). */
  size?: "default" | "sm";
}

/**
 * A parent row with sub-items is a pure expander (the sidebar-07 pattern): it
 * links nowhere, and the page it used to open becomes its first sub-row. The
 * URL is the parent's own, unchanged, so bookmarks keep working; only the label
 * is new, and it lives here rather than on the parent object so the nav arrays
 * themselves never change. A parent missing from this map reuses its own label.
 */
export const FIRST_SUB_T_KEY: Readonly<Record<string, string>> = {
  cellular_information: "cellular_overview",
  sms_center: "sms_inbox",
  band_locking: "band_locking_bands",
  cell_scanner: "cell_scanner_full_scan",
  settings: "cellular_settings_general",
  local_network_settings: "ip_passthrough",
  extensions: "tailscale",
  system_settings: "system_settings_general",
  history: "history_cellular",
};

/** Trailing slashes come and go with the static export; normalise once. */
export function normalizePath(pathname: string) {
  return pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
}

/** The rows a parent expands to: its own page first, then its declared rows. */
export function subRowsOf(item: NavItem): NavSubItem[] {
  if (!item.items) return [];
  return [
    {
      t_key: FIRST_SUB_T_KEY[item.t_key] ?? item.t_key,
      url: item.url,
      exact: true,
    },
    ...item.items,
  ];
}

export function isSubActive(pathname: string, sub: NavSubItem) {
  if (pathname === sub.url) return true;
  return !sub.exact && pathname.startsWith(sub.url + "/");
}

/**
 * A row is active when the route IS it, when a route below it belongs to it
 * (leaf rows only), or when one of its sub-rows is current. The leaf clause is
 * what stops /cellular from claiming /cellular/settings, which is a different
 * nav row entirely.
 */
export function isItemActive(pathname: string, item: NavItem) {
  if (item.onClick) return false;
  const subs = subRowsOf(item);
  if (subs.length) return subs.some((sub) => isSubActive(pathname, sub));
  return pathname === item.url || pathname.startsWith(item.url + "/");
}

export interface NavCrumb {
  /** Translation key inside the "sidebar" namespace. */
  key: string;
  /** Only the current page carries one; groups and parents have no page. */
  href?: string;
}

function matchLength(pathname: string, url: string) {
  if (pathname === url) return url.length;
  return pathname.startsWith(url + "/") ? url.length : -1;
}

/**
 * The breadcrumb for a route, derived from the nav tree rather than from URL
 * segments, so it always names pages the way the sidebar does: group, then
 * parent (for a sub-row), then page. The longest matching URL wins, which lets
 * a route below a page (a redirect stub, a sub-view) resolve to that page. A
 * group with a single row, and the unlabelled footer group, add no crumb of
 * their own. An unmatched route yields an empty trail.
 */
export function resolveNavCrumbs(
  pathname: string,
  groups: readonly NavGroup[],
): NavCrumb[] {
  const path = normalizePath(pathname);
  let best: { length: number; crumbs: NavCrumb[] } | null = null;

  const consider = (url: string, crumbs: NavCrumb[]) => {
    if (url === "#") return;
    const length = matchLength(path, url);
    if (length >= 0 && (!best || length > best.length)) {
      best = { length, crumbs };
    }
  };

  for (const group of groups) {
    const groupCrumb: NavCrumb[] =
      group.groupKey && group.items.length > 1
        ? [{ key: `groups.${group.groupKey}` }]
        : [];

    for (const item of group.items) {
      const subs = subRowsOf(item);
      if (!subs.length) {
        consider(item.url, [
          ...groupCrumb,
          { key: `items.${item.t_key}`, href: item.url },
        ]);
        continue;
      }
      for (const sub of subs) {
        consider(sub.url, [
          ...groupCrumb,
          { key: `items.${item.t_key}` },
          { key: `items.${sub.t_key}`, href: sub.url },
        ]);
      }
    }
  }

  return (best as { crumbs: NavCrumb[] } | null)?.crumbs ?? [];
}

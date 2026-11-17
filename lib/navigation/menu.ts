import type { UserRole } from '@/types/database';

// What the menu (the ☰ button at the top left of the main screens) lists.
//
// The bottom panel holds the four field tools for everyone: Scan, Count, Loads
// and Inventory (for office users, the materials list under that name).
// Everything else is reached from the menu, which also lists those four so
// that one place shows every screen. The screens a step opens (a receipt, a
// load, a crate) keep their own header, without the menu. Exceptions and the Data
// Browser are on the office site only; the menu links to them there.

export interface MenuItem {
  key: string;
  label: string;
  /** A FontAwesome glyph name. */
  icon: string;
  /** A screen in this app, */
  route?: string;
  /** or a page on the office site, opened in the browser. */
  url?: string;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/**
 * The menu for a role. `officePage` gives the address of a page on this
 * build's office site, or null when the build has none: those links are then
 * left out rather than pointing at another environment's site.
 */
export function menuFor(role: UserRole, officePage: (page: string) => string | null): MenuGroup[] {
  const office = role !== 'field_worker';
  const base = office ? '/(office)' : '/(field)';
  const groups: MenuGroup[] = [{
    title: 'Field',
    items: [
      { key: 'scan', label: 'Receiving (Scan)', icon: 'qrcode', route: `${base}/scan` },
      { key: 'inventory', label: 'Inventory', icon: 'cubes', route: `${base}/${office ? 'materials' : 'inventory'}` },
      { key: 'count', label: 'Count', icon: 'clipboard', route: `${base}/count` },
      { key: 'loads', label: 'Loads', icon: 'truck', route: `${base}/loads` },
    ],
  }];
  if (!office) {
    // A crew member's own scans and moves.
    groups.push({ title: 'More', items: [{ key: 'activity', label: 'Activity', icon: 'history', route: `${base}/activity` }] });
    return groups;
  }
  groups.push({
    title: 'Admin',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', route: `${base}/dashboard` },
      { key: 'reports', label: 'Reports', icon: 'bar-chart', route: `${base}/reports` },
      { key: 'activity', label: 'Activity', icon: 'history', route: `${base}/activity` },
      { key: 'locations', label: 'Locations', icon: 'map-marker', route: `${base}/locations` },
      { key: 'qr-codes', label: 'QR Codes', icon: 'tags', route: `${base}/qr-codes` },
    ],
  });
  const site: MenuItem[] = [];
  const inbox = officePage('work-inbox.html');
  if (inbox) site.push({ key: 'work-inbox', label: 'Exceptions (Work Inbox)', icon: 'exclamation-triangle', url: inbox });
  const browser = role === 'admin' ? officePage('admin.html') : null;
  if (browser) site.push({ key: 'data-browser', label: 'Data Browser', icon: 'database', url: browser });
  if (site.length) groups.push({ title: 'On the office site', items: site });
  return groups;
}

/**
 * Whether a menu item is the screen now showing. The router reports the
 * screen's path without its group, so "/(office)/dashboard" shows as
 * "/dashboard".
 */
export function isCurrent(item: MenuItem, pathname: string): boolean {
  return !!item.route && pathname === `/${item.route.split('/').pop()}`;
}

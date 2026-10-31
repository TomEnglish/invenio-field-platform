// Where an item is now (022's item_positions) and what a scanned code is
// (022's lookup_tag), with what each lets the field do. Pure, shared by the
// material page, Inventory, Count, Scan and tests.
import type { LoadIndex } from './crates';

export type Position = 'on_load' | 'missing' | 'in_crate' | 'at_place' | 'gone' | 'unknown';
// One row of item_positions: a received item is its material; one not yet
// received is its count record.
export interface ItemPosition {
  item_kind: 'material' | 'count';
  material_id: string | null;
  inventory_uid: string | null;
  tag: string;
  name: string | null;
  status: string;
  is_high_value: boolean;
  // The receipt's exception decision: crews move it only to a hold area.
  hold: 'on_hold' | 'return_to_vendor' | null;
  crate_code: string | null;
  top_crate_code: string | null;
  load_id: string | null;
  load_number: string | null;
  line_status: 'planned' | 'on_board' | 'missing' | null;
  position: Position;
  place_id: string | null;
  place_name: string | null;
  place_kind: string | null;
  area: string | null;
  location_id: string | null;
  location_note: string | null;
}
export type TagKind = 'crate' | 'unused_label' | 'unknown_label' | 'received' | 'counted' | 'expected' | 'written_off' | 'unknown';
// lookup_tag's answer: for an item, the item_positions columns too.
export type TagLookup = Partial<ItemPosition> & { kind: TagKind; code: string; can_receive: boolean; rejected_before?: boolean; load_line_status?: string | null };

// The site plans whose areas can be used at a place (022): one drawn for it,
// or one not yet tied to a place when it is a yard or site (never a shop or
// vendor). With no place chosen, every plan.
export function plansAt<M extends { place_id?: string | null }>(maps: M[], place: { id: string; kind: string } | null | undefined): M[] {
  if (!place) return maps;
  return maps.filter(map => (map.place_id ? map.place_id === place.id : OWN_PLACE_KINDS.has(place.kind)));
}

const GONE: Record<string, string> = { issued: 'Issued', shipped: 'Shipped', depleted: 'Used up', written_off: 'Written off' };
// Our own yards and sites; anywhere else (an outside shop, a vendor) stock is away.
export const OWN_PLACE_KINDS = new Set(['yard', 'site']);

// "On load L-0003", "In crate HU-ABC123 (inside HU-XYZ789) at Yard · Rack 2",
// "Yard · Rack 2", "Written off"...
export function positionText(p: Pick<ItemPosition, 'position' | 'status' | 'load_number' | 'crate_code' | 'top_crate_code' | 'place_name' | 'area' | 'location_note'>): string {
  const where = [p.place_name, p.area].map(part => part?.trim()).filter(Boolean).join(' · ');
  switch (p.position) {
    case 'on_load': return `On load ${p.load_number ?? 'a new load'}`;
    case 'missing': return `Missing from load ${p.load_number ?? '?'}`;
    case 'in_crate': return `In crate ${p.crate_code}${p.top_crate_code && p.top_crate_code !== p.crate_code ? ` (inside ${p.top_crate_code})` : ''}${where ? ` at ${where}` : ''}`;
    case 'at_place': return where || p.location_note?.trim() || 'Location not recorded';
    case 'gone': return GONE[p.status] ?? 'No longer in stock';
    default: return 'Location not recorded';
  }
}

export const holdText = (hold: ItemPosition['hold']) => (hold === 'on_hold' ? 'on hold' : hold === 'return_to_vendor' ? 'being returned to the vendor' : null);

// What a received material's page offers, and why not, in 022's words. null: allowed.
export interface MaterialActions { transfer: string | null; issue: string | null; ship: string | null; relocate: string | null; holdOnly: boolean }
export function materialActions(p: Pick<ItemPosition, 'position' | 'status' | 'tag' | 'load_number' | 'line_status' | 'crate_code' | 'place_name' | 'place_kind' | 'hold'> | null, office: boolean): MaterialActions {
  const none = (why: string): MaterialActions => ({ transfer: why, issue: why, ship: why, relocate: why, holdOnly: false });
  if (!p) return { transfer: null, issue: null, ship: office ? null : 'Ship Out is for office staff.', relocate: null, holdOnly: false };
  if (p.status === 'written_off') return none(`${p.tag} was written off on a load; an administrator can undo that.`);
  if (p.position === 'gone') return none(`${p.tag} is no longer in stock.`);
  if (p.position === 'on_load' || p.position === 'missing') return none(`${p.tag} is on load ${p.load_number ?? '?'}; it can be moved, issued or shipped when it comes off.`);
  const held = holdText(p.hold);
  const crewHeld = !!held && !office;
  const packed = p.position === 'in_crate' ? `${p.tag} is packed in ${p.crate_code}; take it out of the crate first.` : null;
  const away = p.position === 'at_place' && p.place_kind && !OWN_PLACE_KINDS.has(p.place_kind) ? `${p.tag} is at ${p.place_name}; it comes back to the yard on a load.` : null;
  return {
    transfer: packed ?? away,
    // Issuing from a crate is allowed: all of it takes it out, part opens the crate.
    issue: crewHeld ? `${p.tag} is ${held}; the office releases it before it can be issued.` : null,
    ship: !office ? 'Ship Out is for office staff, for stock leaving the project for good.'
      : packed ?? (p.line_status === 'planned' ? `${p.tag} is planned on load ${p.load_number ?? '?'}; take it off the load first.` : null),
    relocate: packed,
    // Held stock goes, for crews, only to a hold area.
    holdOnly: crewHeld,
  };
}

// Why a tag can't be counted, from lookup_tag, in 022's words; null when it can.
export function countIssue(found: TagLookup | null): string | null {
  if (!found) return null;
  const tag = found.code;
  if (found.kind === 'crate' || found.kind === 'unused_label' || found.kind === 'unknown_label') return 'HU- codes are crate labels; count the items inside the crate.';
  if (found.kind === 'received') return `Tag ${tag} has already been received, so it doesn't need counting. Scan another tag.`;
  if (found.kind === 'written_off') return `${tag} was written off on a load; an administrator can undo that.`;
  if (found.position === 'on_load' || found.position === 'missing') return `${tag} is on load ${found.load_number ?? '?'}; count it when it comes off.`;
  if (found.position === 'in_crate') return `${tag} is packed in ${found.crate_code}; take it out of the crate before counting it.`;
  return null;
}

// Offline, or before 022: whether the device's copy of crates and loads shows
// the item packed or travelling, which the server refuses to count.
export function copyCountIssue(index: Pick<LoadIndex, 'crateOf' | 'onLoad'>, tag: string): string | null {
  const crate = index.crateOf.get(tag.trim());
  if (crate) return `${tag} is packed in ${crate}; take it out of the crate before counting it.`;
  const line = index.onLoad.get(tag.trim());
  if (line && (line.status === 'on_board' || line.status === 'missing')) return `${tag} is on load ${line.load_number ?? 'a new load'}; count it when it comes off.`;
  return null;
}
// "Where it is" for a note, from lookup_tag: what to say and what it opens.
export function positionNote(found: TagLookup | null): { text: string; route: 'crate' | 'load' | null; params: Record<string, string> } | null {
  if (!found?.position || found.kind === 'crate' || found.kind === 'unused_label' || found.kind === 'unknown_label') return null;
  const text = positionText(found as ItemPosition);
  if (found.position === 'in_crate' && found.crate_code) return { text, route: 'crate', params: { code: found.top_crate_code ?? found.crate_code } };
  if ((found.position === 'on_load' || found.position === 'missing') && found.load_id) return { text, route: 'load', params: { id: found.load_id } };
  return found.position === 'unknown' ? null : { text, route: null, params: {} };
}

// Where Scan sends a code: the material's page, receiving (only when the
// server says it may start), the crate, or a message saying why not.
export type ScanRoute = { to: 'material'; materialId: string } | { to: 'receive' } | { to: 'crate'; code: string } | { to: 'say'; message: string };
export function scanRoute(found: TagLookup): ScanRoute {
  if (found.kind === 'crate' || found.kind === 'unused_label' || found.kind === 'unknown_label') return { to: 'crate', code: found.code };
  if (found.kind === 'received' && found.material_id) return { to: 'material', materialId: found.material_id };
  if (found.can_receive) return { to: 'receive' };
  if (found.kind === 'received') return { to: 'say', message: `${found.code} has been received and is no longer in stock.` };
  if (found.kind === 'written_off') return { to: 'say', message: `${found.code} was written off on a load; an administrator can undo that.` };
  if (found.position === 'on_load' || found.position === 'missing') return { to: 'say', message: `${found.code} is on load ${found.load_number ?? '?'}; receive it when it comes off.` };
  return { to: 'say', message: `${found.code} can't be received now.` };
}

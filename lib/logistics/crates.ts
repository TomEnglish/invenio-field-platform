// Crates (handling units): the device's picture of what is packed where, the
// pack draft's checks and the `pack` / `unpack` operation payloads. Pure so
// they are shared by screens, the queue and tests. Contract: MSR migration 021.

export type UnitKind = 'crate' | 'skid' | 'bundle' | 'basket' | 'container' | 'other';
export type UnitStatus = 'open' | 'sealed' | 'on_load' | 'delivered' | 'unpacked';
export const UNIT_KINDS: { value: UnitKind; label: string }[] = [
  { value: 'crate', label: 'Crate' }, { value: 'skid', label: 'Skid' }, { value: 'bundle', label: 'Bundle' },
  { value: 'basket', label: 'Basket' }, { value: 'container', label: 'Container' }, { value: 'other', label: 'Other' },
];
export const STATUS_LABELS: Record<UnitStatus, string> = { open: 'Open', sealed: 'Sealed', on_load: 'On a load', delivered: 'Delivered', unpacked: 'Unpacked' };
export const kindLabel = (kind: string) => UNIT_KINDS.find(k => k.value === kind)?.label ?? 'Crate';

// One row of handling_unit_overview. The place and area are where its
// outermost crate is.
export interface HandlingUnit {
  id: string;
  code: string;
  kind: UnitKind;
  description: string | null;
  is_high_value: boolean;
  status: UnitStatus;
  parent_id: string | null;
  parent_code: string | null;
  top_code: string | null;
  place_id: string | null;
  place_name: string | null;
  site_map_id: string | null;
  zone_id: string | null;
  location: string | null;
  item_count: number;
  unit_count: number;
}
// One row of handling_unit_items: an item packed in a unit now.
export interface UnitItem {
  unit_code: string;
  tag: string;
  name: string;
  quantity: number | string;
  uom: string;
  material_id: string | null;
  inventory_uid: string | null;
}
export interface Place { id: string; kind: string; name: string; project_id: string | null; city: string | null; state: string | null }
// A received material in the yard, and an inventory record, by tag: what may be packed.
export interface YardMaterial { id: string; tag: string; name: string; quantity: number }
export interface CountedItem { uid: string; tag: string; name: string; quantity: number | string | null; uom: string | null; status: 'expected' | 'counted' | 'received' }

export interface LoadReference {
  units: HandlingUnit[];
  items: UnitItem[];
  places: Place[];
  materials: YardMaterial[];
  counted: CountedItem[];
  savedAt: string | null;
}
export const EMPTY_LOAD: LoadReference = { units: [], items: [], places: [], materials: [], counted: [], savedAt: null };

export interface PackOperationPayload {
  unitCode: string;
  kind?: UnitKind;
  description?: string;
  isHighValue?: boolean;
  placeId?: string;
  siteMapId?: string;
  zoneId?: string;
  add?: string[];
  remove?: string[];
  seal: boolean;
}
export interface UnpackOperationPayload { unitCode: string }
// The queued `pack`: sent unchanged; the labels are only for Sync and the overlay.
export interface PackQueuePayload { pack: PackOperationPayload; zoneName?: string; placeName?: string }

const CODE = /^HU-[A-Z0-9]{4,20}$/;
export const MAX_TAGS = 500;
export const MAX_DEPTH = 5;
// Crate labels are read in any case; the server stores them upper-case.
export const looksLikeCrate = (text: string) => /^hu-/i.test(text.trim());
export const crateCode = (text: string) => text.trim().toUpperCase();
export const isCrateCode = (text: string) => CODE.test(crateCode(text));

// ---------------------------------------------------------------------------
// The device's copy, with saved changes laid over it.
// ---------------------------------------------------------------------------
export interface LoadIndex {
  ref: LoadReference;
  units: Map<string, HandlingUnit>;
  contents: Map<string, UnitItem[]>;
  children: Map<string, HandlingUnit[]>;
  crateOf: Map<string, string>;
  materials: Map<string, YardMaterial>;
  counted: Map<string, CountedItem>;
}
export function indexLoad(ref: LoadReference): LoadIndex {
  const units = new Map(ref.units.map(unit => [unit.code, unit]));
  const contents = new Map<string, UnitItem[]>(), children = new Map<string, HandlingUnit[]>(), crateOf = new Map<string, string>();
  for (const item of ref.items) {
    contents.set(item.unit_code, [...(contents.get(item.unit_code) ?? []), item]);
    crateOf.set(item.tag.trim(), item.unit_code);
  }
  for (const unit of ref.units) if (unit.parent_code) children.set(unit.parent_code, [...(children.get(unit.parent_code) ?? []), unit]);
  return {
    ref, units, contents, children, crateOf,
    materials: new Map(ref.materials.map(material => [material.tag.trim(), material])),
    counted: new Map(ref.counted.map(item => [item.tag.trim(), item])),
  };
}

// The saved actions this overlay understands. Queued counts make a tag
// packable; packs and unpacks change crates as the server will.
export type LoadAction =
  | { type: 'pack'; payload: PackQueuePayload }
  | { type: 'unpack'; payload: UnpackOperationPayload }
  | { type: 'count'; payload: { count: { tag: string; name: string; quantity: string; uom: string } } }
  | { type: string; payload: unknown };

const blankUnit = (code: string): HandlingUnit => ({
  id: '', code, kind: 'crate', description: null, is_high_value: false, status: 'open', parent_id: null, parent_code: null, top_code: code,
  place_id: null, place_name: null, site_map_id: null, zone_id: null, location: null, item_count: 0, unit_count: 0,
});

// Lays saved-but-unsent (or sent since the last download) actions over the
// copy, following migration 021's pack and unpack. Replaying one twice changes
// nothing more, so a change both sent and still listed is safe.
export function applyPending(ref: LoadReference, actions: LoadAction[]): LoadReference {
  const relevant = actions.filter(action => action.type === 'pack' || action.type === 'unpack' || action.type === 'count');
  if (relevant.length === 0) return ref;
  const units = new Map(ref.units.map(unit => [unit.code, { ...unit }]));
  let items = ref.items.slice();
  const counted = new Map(ref.counted.map(item => [item.tag.trim(), item]));
  const materials = new Map(ref.materials.map(material => [material.tag.trim(), material]));
  const top = (unit: HandlingUnit) => {
    let current = unit;
    for (let depth = 0; current.parent_code && depth < 20; depth++) {
      const parent = units.get(current.parent_code);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const placeAt = (unit: HandlingUnit, from: HandlingUnit) => {
    const { place_id, place_name, site_map_id, zone_id, location } = top(from);
    Object.assign(unit, { place_id, place_name, site_map_id, zone_id, location });
  };
  for (const action of relevant) {
    if (action.type === 'count') {
      const count = (action as Extract<LoadAction, { type: 'count' }>).payload.count;
      const tag = count.tag.trim();
      if (counted.get(tag)?.status !== 'received') counted.set(tag, { uid: counted.get(tag)?.uid ?? '', tag, name: count.name, quantity: count.quantity, uom: count.uom, status: 'counted' });
    } else if (action.type === 'pack') {
      const { pack, zoneName, placeName } = (action as Extract<LoadAction, { type: 'pack' }>).payload;
      const code = crateCode(pack.unitCode);
      let unit = units.get(code);
      if (!unit) { unit = blankUnit(code); units.set(code, unit); }
      if (unit.status !== 'open' && unit.status !== 'sealed' && unit.status !== 'unpacked') continue;
      if (pack.kind) unit.kind = pack.kind;
      if (pack.description !== undefined) unit.description = pack.description.trim() || null;
      if (pack.isHighValue !== undefined) unit.is_high_value = pack.isHighValue;
      unit.status = 'open';
      if (pack.placeId) Object.assign(unit, { place_id: pack.placeId, place_name: ref.places.find(place => place.id === pack.placeId)?.name ?? placeName ?? null });
      if (pack.zoneId) Object.assign(unit, { zone_id: pack.zoneId, site_map_id: pack.siteMapId ?? unit.site_map_id, location: zoneName ?? unit.location });
      for (const raw of pack.remove ?? []) {
        if (looksLikeCrate(raw)) {
          const child = units.get(crateCode(raw));
          if (child?.parent_code === code) { placeAt(child, unit); Object.assign(child, { parent_id: null, parent_code: null }); }
        } else items = items.filter(item => !(item.unit_code === code && item.tag.trim() === raw.trim()));
      }
      for (const raw of pack.add ?? []) {
        if (looksLikeCrate(raw)) {
          const child = units.get(crateCode(raw));
          if (child && child !== unit && !child.parent_code && (child.status === 'open' || child.status === 'sealed')) Object.assign(child, { parent_id: unit.id || null, parent_code: code });
        } else {
          const tag = raw.trim();
          if (items.some(item => item.tag.trim() === tag)) continue;
          const material = materials.get(tag), record = counted.get(tag);
          items.push({
            unit_code: code, tag, name: material?.name ?? record?.name ?? tag,
            quantity: material?.quantity ?? record?.quantity ?? 1, uom: material ? 'EA' : record?.uom ?? 'EA',
            material_id: material?.id ?? null, inventory_uid: material ? null : record?.uid || null,
          });
        }
      }
      if (pack.seal) unit.status = 'sealed';
    } else {
      const code = crateCode((action as Extract<LoadAction, { type: 'unpack' }>).payload.unitCode);
      const unit = units.get(code);
      if (!unit || (unit.status !== 'open' && unit.status !== 'sealed')) continue;
      items = items.filter(item => item.unit_code !== code);
      for (const child of units.values()) if (child.parent_code === code) { placeAt(child, unit); Object.assign(child, { parent_id: null, parent_code: null }); }
      placeAt(unit, unit);
      Object.assign(unit, { status: 'unpacked', parent_id: null, parent_code: null });
    }
  }
  // Nested units show where their outermost crate is.
  for (const unit of units.values()) {
    const outer = top(unit);
    unit.top_code = outer.code;
    if (outer !== unit) placeAt(unit, outer);
    unit.item_count = items.filter(item => item.unit_code === unit.code).length;
    unit.unit_count = [...units.values()].filter(child => child.parent_code === unit.code).length;
  }
  return { ...ref, units: [...units.values()], items, counted: [...counted.values()] };
}

// Fresh rows for one scanned tag from the server replace what the copy says
// about it. For a crate they are the crate and the crates around and inside
// it (see lookupCratesOnline). An inventory record the lookup didn't find is
// kept: legacy tags stored with spaces only match on the server.
export function mergeFresh(ref: LoadReference, tag: string, fresh: Pick<LoadReference, 'units' | 'items' | 'materials' | 'counted'>): LoadReference {
  if (looksLikeCrate(tag)) {
    const replaced = new Set([crateCode(tag), ...fresh.units.map(unit => unit.code)]);
    return { ...ref, units: [...ref.units.filter(unit => !replaced.has(unit.code)), ...fresh.units] };
  }
  const wanted = tag.trim(), other = <T extends { tag: string }>(row: T) => row.tag.trim() !== wanted;
  return {
    ...ref,
    items: [...ref.items.filter(other), ...fresh.items], materials: [...ref.materials.filter(other), ...fresh.materials],
    counted: fresh.counted.length ? [...ref.counted.filter(other), ...fresh.counted] : ref.counted,
  };
}

// "Yard · T1 Pipe Racks › Rack 2": the place and area of the outermost crate.
export function unitWhere(unit: Pick<HandlingUnit, 'place_name' | 'location'>): string {
  return [unit.place_name, unit.location].map(part => part?.trim()).filter(Boolean).join(' · ');
}
// The crates around a unit, innermost first.
export function unitAncestors(index: LoadIndex, code: string): HandlingUnit[] {
  const chain: HandlingUnit[] = [];
  let current = index.units.get(code);
  while (current?.parent_code && chain.length < 20) {
    const parent = index.units.get(current.parent_code);
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}
function subtreeHeight(index: LoadIndex, code: string, seen = new Set<string>()): number {
  if (seen.has(code)) return 1;
  seen.add(code);
  return 1 + Math.max(0, ...(index.children.get(code) ?? []).map(child => subtreeHeight(index, child.code, seen)));
}
// "In crate HU-ABC123 at Yard · Bay 2" for an item packed now, or null.
export function packedInText(index: LoadIndex, tag: string): { code: string; text: string } | null {
  const code = index.crateOf.get(tag.trim());
  if (!code) return null;
  const unit = index.units.get(code);
  const where = unit ? unitWhere(unit) : '';
  return { code, text: `In crate ${code}${where ? ` at ${where}` : ''}` };
}

// ---------------------------------------------------------------------------
// The pack draft: one crate, its details, what goes in and out, and where.
// ---------------------------------------------------------------------------
// `unchecked`: not on the device's copy; `problem`: the server has since said no.
export interface PackEntry { tag: string; name: string; crate: boolean; unchecked?: boolean; problem?: string }
export interface PackLocation { placeId: string | null; placeName: string; siteMapId: string | null; zoneId: string | null; zoneName: string }
// What the server is known to have for the crate (the download plus changes
// it accepted since) when packing started; null for a label it hasn't packed.
export interface PackBefore {
  kind: UnitKind; description: string; isHighValue: boolean; status: UnitStatus;
  parentCode: string | null; placeId: string | null; zoneId: string | null; where: string;
}
export interface PackDraft {
  code: string;
  before: PackBefore | null;
  kind: UnitKind;
  description: string;
  isHighValue: boolean;
  add: PackEntry[];
  remove: PackEntry[];
  location: PackLocation;
}
export const NO_PACK_LOCATION: PackLocation = { placeId: null, placeName: '', siteMapId: null, zoneId: null, zoneName: '' };

export function packBefore(unit: HandlingUnit | undefined): PackBefore | null {
  if (!unit) return null;
  return {
    kind: unit.kind, description: unit.description ?? '', isHighValue: unit.is_high_value, status: unit.status,
    parentCode: unit.parent_code, placeId: unit.place_id, zoneId: unit.zone_id, where: unitWhere(unit),
  };
}

// Where a pack session starts. The details shown are the device's latest
// (saved packs still waiting to upload included); `before` is what the
// server has, so details and a place or area from a waiting pack are sent
// again with this one, in case that pack is refused.
export interface PackStart { kind: UnitKind; description: string; isHighValue: boolean; location: PackLocation }
export function packStart(code: string, index: LoadIndex, known: LoadIndex): { before: PackBefore | null; start: PackStart } {
  const unit = index.units.get(code), base = known.units.get(code);
  const before = packBefore(base);
  const own = unit && !unit.parent_code;
  return {
    before,
    start: {
      kind: unit?.kind ?? 'crate', description: unit?.description ?? '', isHighValue: unit?.is_high_value ?? false,
      location: {
        ...NO_PACK_LOCATION,
        ...(own && unit.place_id && unit.place_id !== base?.place_id ? { placeId: unit.place_id, placeName: unit.place_name ?? '' } : {}),
        ...(own && unit.zone_id && unit.zone_id !== base?.zone_id ? { zoneId: unit.zone_id, siteMapId: unit.site_map_id, zoneName: unit.location ?? '' } : {}),
      },
    },
  };
}

// Why a scanned label can't be packed at all, or null.
export function labelIssue(index: LoadIndex, text: string): string | null {
  if (!looksLikeCrate(text)) return 'That is an item tag. Scan the crate’s label (HU-…) first.';
  if (!isCrateCode(text)) return `${crateCode(text)} isn't a crate label. Labels read HU- and 4 to 20 letters or numbers.`;
  const unit = index.units.get(crateCode(text));
  if (unit && unit.status !== 'open' && unit.status !== 'sealed' && unit.status !== 'unpacked') return 'This crate is on a load; unload it before repacking.';
  return null;
}

// What the crate holds once this draft is applied.
export function packedAfter(index: LoadIndex, draft: Pick<PackDraft, 'code' | 'add' | 'remove'>): PackEntry[] {
  const out = new Set(draft.remove.map(entry => entry.tag));
  const current: PackEntry[] = [
    ...(index.contents.get(draft.code) ?? []).map(item => ({ tag: item.tag.trim(), name: item.name, crate: false })),
    ...(index.children.get(draft.code) ?? []).map(unit => ({ tag: unit.code, name: unitName(unit), crate: true })),
  ].filter(entry => !out.has(entry.tag));
  const kept = new Set(current.map(entry => entry.tag));
  return [...current, ...draft.add.filter(entry => !kept.has(entry.tag))];
}
export const unitName = (unit: Pick<HandlingUnit, 'kind' | 'description' | 'item_count' | 'unit_count'>) =>
  [unit.description?.trim() || kindLabel(unit.kind), `${unit.item_count + unit.unit_count} inside`].join(' · ');

export type ScanVerdict =
  | { kind: 'add'; entry: PackEntry; message: string }
  | { kind: 'keep'; tag: string; message: string }
  | { kind: 'already'; message: string }
  | { kind: 'refuse'; message: string; recheck: boolean };

// What a tag scanned into the draft does. The device's copy may be out of
// date: `recheck` marks refusals the server might not agree with, and a tag
// the copy doesn't know is added unchecked (the server checks it on upload).
// With `confirmed`, the copy was just refreshed for this tag, so unknown means
// it doesn't exist.
export function classifyScan(index: LoadIndex, draft: Pick<PackDraft, 'code' | 'add' | 'remove'>, raw: string, confirmed = false): ScanVerdict | null {
  const text = raw.trim();
  if (!text) return null;
  const crate = looksLikeCrate(text);
  const tag = crate ? crateCode(text) : text;
  if (draft.add.some(entry => entry.tag === tag)) return { kind: 'already', message: `${tag} is already on the list.` };
  if (draft.remove.some(entry => entry.tag === tag)) return { kind: 'keep', tag, message: `${tag} stays in ${draft.code}.` };
  if (draft.add.length + draft.remove.length >= MAX_TAGS) return { kind: 'refuse', message: `Pack at most ${MAX_TAGS} tags at a time. Save this crate, then pack it again for the rest.`, recheck: false };
  if (crate) {
    if (tag === draft.code) return { kind: 'refuse', message: 'A crate can’t go inside itself.', recheck: false };
    if (!isCrateCode(tag)) return { kind: 'refuse', message: `${tag} isn't a crate label.`, recheck: false };
    const unit = index.units.get(tag);
    if (unit?.parent_code === draft.code) return { kind: 'already', message: `${tag} is already in ${draft.code}.` };
    if (!unit) {
      return confirmed
        ? { kind: 'refuse', message: `${tag} hasn't been packed yet. Pack it first, then put it in this crate.`, recheck: false }
        : { kind: 'add', entry: { tag, name: 'Crate not on this device yet', crate: true, unchecked: true }, message: `${tag} added. It isn't on this device yet; the server checks it when this uploads.` };
    }
    if (unit.parent_code) return { kind: 'refuse', message: `${tag} is already inside ${unit.parent_code}; take it out first.`, recheck: true };
    if (unit.status !== 'open' && unit.status !== 'sealed') return { kind: 'refuse', message: `${tag} is ${STATUS_LABELS[unit.status].toLowerCase()}; it can’t go inside another crate.`, recheck: true };
    const ancestors = unitAncestors(index, draft.code);
    if (ancestors.some(outer => outer.code === tag)) return { kind: 'refuse', message: 'A crate cannot go inside itself or a crate it contains.', recheck: true };
    if (ancestors.length + 1 + subtreeHeight(index, tag) > MAX_DEPTH) return { kind: 'refuse', message: `Crates can be nested at most ${MAX_DEPTH} levels deep.`, recheck: true };
    return { kind: 'add', entry: { tag, name: unitName(unit), crate: true }, message: `${tag} added.` };
  }
  const holder = index.crateOf.get(tag);
  if (holder === draft.code) return { kind: 'already', message: `${tag} is already in ${draft.code}.` };
  if (holder) return { kind: 'refuse', message: `${tag} is already in crate ${holder}; take it out of that crate first.`, recheck: true };
  const material = index.materials.get(tag);
  if (material) return { kind: 'add', entry: { tag, name: material.name, crate: false }, message: `${tag} added.` };
  const record = index.counted.get(tag);
  if (record?.status === 'counted') return { kind: 'add', entry: { tag, name: record.name, crate: false }, message: `${tag} added.` };
  if (record?.status === 'expected') return { kind: 'refuse', message: `${tag} hasn't been counted or received yet. Count it first.`, recheck: true };
  if (record?.status === 'received') return { kind: 'refuse', message: `${tag} has been issued or shipped; it can't be packed.`, recheck: true };
  return confirmed
    ? { kind: 'refuse', message: `${tag} isn't a received or counted item in this project.`, recheck: false }
    : { kind: 'add', entry: { tag, name: 'Not on this device yet', crate: false, unchecked: true }, message: `${tag} added. It isn't on this device yet; the server checks it when this uploads.` };
}

export function packChanges(draft: Pick<PackDraft, 'add' | 'remove'>): number {
  return draft.add.length + draft.remove.length;
}

// Why the draft can't be saved as asked, with the step that fixes it.
// `areasLive`: the project has areas in use (null when the device doesn't know).
export function packReviewIssue(index: LoadIndex, draft: PackDraft, seal: boolean, areasLive: boolean | null): { step: number; message: string } | null {
  if (!isCrateCode(draft.code)) return { step: 0, message: 'Scan the crate’s label (HU-…) first.' };
  if (draft.description.trim().length > 200) return { step: 1, message: 'Keep the description to 200 characters.' };
  if (packChanges(draft) > MAX_TAGS) return { step: 2, message: `Pack at most ${MAX_TAGS} tags at a time.` };
  const problem = draft.add.find(entry => entry.problem);
  if (problem) return { step: 2, message: `${problem.problem} Remove ${problem.tag} from the list, or sort it out first.` };
  // Something taken out of the crate since (an unpack, another pack) can't come out again.
  const inside = new Set([...(index.contents.get(draft.code) ?? []).map(item => item.tag.trim()), ...(index.children.get(draft.code) ?? []).map(unit => unit.code)]);
  const gone = draft.remove.find(entry => !inside.has(entry.tag));
  if (gone) return { step: 2, message: `${gone.tag} is no longer in ${draft.code}. Tap Keep next to it to drop it from the list.` };
  if (!seal) return null;
  if (packedAfter(index, draft).length === 0) return { step: 2, message: 'An empty crate can’t be sealed. Scan items into it first, or save it open.' };
  const unit = index.units.get(draft.code);
  const nested = unit ? !!unit.parent_code : !!draft.before?.parentCode;
  if (!nested && areasLive && !draft.location.zoneId && !draft.before?.zoneId) return { step: 3, message: 'Choose a location: pick the area where this crate is before sealing it.' };
  return null;
}

// The operation sent for the whole session. Details and the location go only
// when they differ from what the server has, so an unchanged area that has
// since been retired isn't sent again.
export function buildPackPayload(draft: PackDraft, seal: boolean): PackOperationPayload {
  const before = draft.before;
  const description = draft.description.trim();
  const payload: PackOperationPayload = { unitCode: draft.code, seal };
  // A label the device doesn't know may be packed already: its type is left alone unless chosen.
  if (draft.kind !== (before?.kind ?? 'crate')) payload.kind = draft.kind;
  if (before ? description !== before.description.trim() : description) payload.description = description;
  if (before ? draft.isHighValue !== before.isHighValue : draft.isHighValue) payload.isHighValue = draft.isHighValue;
  if (draft.location.placeId && draft.location.placeId !== before?.placeId) payload.placeId = draft.location.placeId;
  if (draft.location.zoneId && draft.location.zoneId !== before?.zoneId) {
    payload.zoneId = draft.location.zoneId;
    if (draft.location.siteMapId) payload.siteMapId = draft.location.siteMapId;
  }
  if (draft.add.length) payload.add = draft.add.map(entry => entry.tag);
  if (draft.remove.length) payload.remove = draft.remove.map(entry => entry.tag);
  return payload;
}

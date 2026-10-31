// Truck loads: the device's picture of loads, stops and manifests, the scan
// checks for loading and unloading, driver check-in rules and the load
// operation payloads. Pure, shared by screens, the queue and tests.
// Contract: MSR migration 022 (docs/LOGISTICS.md, "Loads").
import { applyPending, crateCode, looksLikeCrate, STATUS_LABELS, type HandlingUnit, type LoadAction, type LoadIndex, type LoadReference } from './crates';

export type LoadStatus = 'planning' | 'loading' | 'in_transit' | 'delivered' | 'closed' | 'cancelled';
export type StopKind = 'dropoff' | 'pickup' | 'both';
export type StopStatus = 'pending' | 'arrived' | 'done';
export type LineStatus = 'planned' | 'on_board' | 'delivered' | 'missing' | 'not_loaded' | 'removed';
export type CompanyRole = 'broker' | 'carrier' | 'dispatcher' | 'other';
export const OPEN_LOADS: LoadStatus[] = ['planning', 'loading', 'in_transit'];
export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = { planning: 'Planning', loading: 'Loading', in_transit: 'In transit', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled' };
export const STOP_KINDS: { value: StopKind; label: string }[] = [{ value: 'dropoff', label: 'Drop-off' }, { value: 'pickup', label: 'Pick-up' }, { value: 'both', label: 'Both' }];
export const COMPANY_ROLES: { value: CompanyRole; label: string }[] = [
  { value: 'broker', label: 'Broker' }, { value: 'carrier', label: 'Carrier' }, { value: 'dispatcher', label: 'Dispatcher' }, { value: 'other', label: 'Other' },
];

// One row of load_overview. A load made on this device has no number until it syncs.
export interface Load {
  id: string;
  load_number: string | null;
  status: LoadStatus;
  origin_place_id: string | null;
  origin_name: string | null;
  planned_date: string | null;
  truck_type: string | null;
  truck_number: string | null;
  trailer_number: string | null;
  bol_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  licence_recorded_at: string | null;
  notes: string | null;
  stop_count: number;
  stops_done: number;
  next_stop: string | null;
  planned_count: number;
  on_board_count: number;
  delivered_count: number;
  missing_count: number;
  flagged_count: number;
  departed_at: string | null;
  updated_at: string | null;
  // A licence saved here, waiting to upload. Never the number itself.
  licence_waiting?: boolean;
}
// One row of load_stop_overview (cancelled stops aren't listed).
export interface LoadStop {
  id: string;
  load_id: string;
  seq: number | null;
  place_id: string;
  place_name: string;
  // The place's kind: at an outside shop or a vendor the office confirms the drop.
  place_kind?: string | null;
  kind: StopKind;
  planned_date: string | null;
  status: StopStatus;
  due_count: number;
  delivered_count: number;
  missing_count: number;
}
// One row of load_line_overview: a top-level crate or loose item on a load.
export interface LoadLine {
  id: string;
  load_id: string;
  load_number: string | null;
  load_status: LoadStatus;
  tag: string;
  piece_kind: 'crate' | 'item';
  name: string;
  is_high_value: boolean;
  status: LineStatus;
  flag: 'extra' | 'wrong_stop' | 'found' | null;
  added_in_field: boolean;
  pickup_stop_id: string | null;
  dropoff_stop_id: string;
  dropoff_place: string | null;
  delivered_stop_id: string | null;
  delivered_place: string | null;
  is_current_position: boolean;
  on_at: string | null;
  off_at: string | null;
  // The crate's status before it went on, kept here for undo.
  unit_status_before?: string | null;
}
export interface LoadCompany { load_id: string; position: number; name: string; role: CompanyRole; contact_name: string | null; phone: string | null }

export interface LoadSavePayload {
  loadId: string;
  originPlaceId?: string | null;
  plannedDate?: string | null;
  truckType?: string;
  truckNumber?: string;
  trailerNumber?: string;
  bolNumber?: string;
  notes?: string;
  driverName?: string;
  driverPhone?: string;
  companies?: { name: string; role: CompanyRole; contactName?: string; phone?: string }[];
  stops?: { id: string; placeId: string; kind: StopKind; plannedDate?: string | null }[];
}
export type LoadOnPiece = string | { code: string; dropoffStopId: string };
export interface LoadOnPayload { loadId: string; pieces: LoadOnPiece[]; undo?: string[]; stopId?: string }
export interface LoadDepartPayload { loadId: string }
export interface LoadOffPayload { loadId: string; stopId: string; pieces: string[]; zoneId?: string; siteMapId?: string }
export interface StopCompletePayload { loadId: string; stopId: string }
// Queued load operations: `op` goes to the server unchanged; `label` (the
// load number, or "New load") and `zoneName` are only for Sync and the overlay.
export type LoadOperation = 'load_save' | 'load_on' | 'load_depart' | 'load_off' | 'stop_complete';
export interface LoadQueuePayload<T> { op: T; label: string; zoneName?: string }
// The queued licence: the load and the photo files only. The number, state
// and expiry stay in memory (lib/sync/licenceMemory) until record_driver_licence
// takes them; `recorded` then says only the photos are left.
export interface LicencePayload {
  loadId: string;
  label: string;
  recorded?: boolean;
  photos: { uri: string }[];
}
export interface LicenceDetails { number: string; state?: string; expiry?: string }

export const loadLabel = (load: Pick<Load, 'load_number'> | undefined | null) => load?.load_number ?? 'New load';
export const pieceTag = (raw: string) => (looksLikeCrate(raw) ? crateCode(raw) : raw.trim());
const MAX_COMPANIES = 3, MAX_STOPS = 20;
export const LICENCE_NUMBER = /^[A-Z0-9][A-Z0-9 -]{2,39}$/;
export const normaliseLicenceNumber = (text: string) => text.trim().replace(/\s+/g, ' ').toUpperCase();
// YYYY-MM-DD in local time, as the server's dates are.
export const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function validDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoDate(date) === text;
}

// ---------------------------------------------------------------------------
// The copy, indexed, with saved load changes laid over it.
// ---------------------------------------------------------------------------
export interface LoadsIndex {
  loads: Map<string, Load>;
  stops: Map<string, LoadStop[]>;
  lines: Map<string, LoadLine[]>;
  companies: Map<string, LoadCompany[]>;
  // A piece's line on an open load (planned, on board or missing), by tag.
  openLine: Map<string, LoadLine>;
  // Where a piece is now (on a truck, delivered or missing), by tag.
  position: Map<string, LoadLine>;
}
const group = <T, K>(rows: T[], key: (row: T) => K) => {
  const map = new Map<K, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
};
export function indexLoads(ref: Pick<LoadReference, 'loads' | 'stops' | 'lines' | 'companies'>): LoadsIndex {
  const stops = group(ref.stops ?? [], stop => stop.load_id);
  for (const list of stops.values()) list.sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99));
  const lines = ref.lines ?? [];
  return {
    loads: new Map((ref.loads ?? []).map(load => [load.id, load])),
    stops,
    lines: group(lines, line => line.load_id),
    companies: group(ref.companies ?? [], company => company.load_id),
    openLine: new Map(lines.filter(line => line.status === 'planned' || line.status === 'on_board' || line.status === 'missing').map(line => [line.tag, line])),
    position: new Map(lines.filter(line => line.is_current_position).map(line => [line.tag, line])),
  };
}

export type LoadActionLike = { type: string; payload: any };
const blankLoad = (id: string): Load => ({
  id, load_number: null, status: 'planning', origin_place_id: null, origin_name: null, planned_date: null, truck_type: null, truck_number: null,
  trailer_number: null, bol_number: null, driver_name: null, driver_phone: null, licence_recorded_at: null, notes: null, stop_count: 0, stops_done: 0,
  next_stop: null, planned_count: 0, on_board_count: 0, delivered_count: 0, missing_count: 0, flagged_count: 0, departed_at: null, updated_at: null,
});
const text = (value: string | undefined | null) => (value ?? '').trim() || null;

// Lays saved load operations over the copy as migration 022 applies them, so
// a load made offline can be checked in, loaded and sent on its way before it
// syncs. Replaying an operation twice changes nothing more.
export function applyLoadPending(ref: LoadReference, actions: LoadActionLike[]): LoadReference {
  const relevant = actions.filter(action => ['load_save', 'load_on', 'load_depart', 'load_off', 'stop_complete', 'licence'].includes(action.type));
  if (relevant.length === 0) return ref;
  const loads = new Map((ref.loads ?? []).map(load => [load.id, { ...load }]));
  let stops = (ref.stops ?? []).map(stop => ({ ...stop }));
  let lines = (ref.lines ?? []).map(line => ({ ...line }));
  let companies = (ref.companies ?? []).slice();
  const units = new Map(ref.units.map(unit => [unit.code, { ...unit }]));
  const places = new Map(ref.places.map(place => [place.id, place]));
  const touched = new Set<string>();
  const now = new Date().toISOString();
  const place = (id: string | null | undefined) => (id ? places.get(id)?.name ?? null : null);
  const stopOf = (id: string | null | undefined) => stops.find(stop => stop.id === id);
  const position = (line: LoadLine) => { for (const other of lines) if (other.tag === line.tag) other.is_current_position = other === line; };
  const setUnit = (code: string, patch: Partial<HandlingUnit>) => { const unit = units.get(code); if (unit) Object.assign(unit, patch); };

  for (const action of relevant) {
    const op = action.type === 'licence' ? action.payload : action.payload?.op;
    if (!op?.loadId) continue;
    const load = loads.get(op.loadId) ?? (action.type === 'load_save' ? blankLoad(op.loadId) : undefined);
    if (!load) continue;
    loads.set(load.id, load);
    touched.add(load.id);
    const mine = () => lines.filter(line => line.load_id === load.id);
    if (action.type === 'licence') { if (!load.licence_recorded_at) load.licence_waiting = true; continue; }
    if (action.type === 'load_save') {
      const save = op as LoadSavePayload;
      if (load.status === 'closed' || load.status === 'cancelled') continue;
      if ('originPlaceId' in save) Object.assign(load, { origin_place_id: save.originPlaceId ?? null, origin_name: place(save.originPlaceId) });
      if ('plannedDate' in save) load.planned_date = save.plannedDate ?? null;
      for (const [key, column] of [['truckType', 'truck_type'], ['truckNumber', 'truck_number'], ['trailerNumber', 'trailer_number'], ['bolNumber', 'bol_number'], ['notes', 'notes'], ['driverName', 'driver_name'], ['driverPhone', 'driver_phone']] as const) {
        if (key in save) (load as any)[column] = text(save[key]);
      }
      if (save.companies) {
        companies = [...companies.filter(company => company.load_id !== load.id), ...save.companies.slice(0, MAX_COMPANIES).map((company, i) => ({
          load_id: load.id, position: i + 1, name: company.name.trim(), role: company.role ?? 'carrier', contact_name: text(company.contactName), phone: text(company.phone),
        }))];
      }
      if (save.stops && (load.status === 'planning' || load.status === 'loading')) {
        const kept = save.stops.map((stop, i) => {
          const old = stopOf(stop.id);
          return {
            id: stop.id, load_id: load.id, seq: i + 1, place_id: stop.placeId, place_name: place(stop.placeId) ?? old?.place_name ?? 'Stop',
            place_kind: places.get(stop.placeId)?.kind ?? old?.place_kind ?? null, kind: stop.kind ?? 'dropoff',
            planned_date: stop.plannedDate ?? null, status: 'pending' as StopStatus, due_count: 0, delivered_count: 0, missing_count: 0,
          };
        });
        stops = [...stops.filter(stop => stop.load_id !== load.id), ...kept];
      }
    } else if (action.type === 'load_on') {
      const on = op as LoadOnPayload;
      if (load.status === 'delivered' || load.status === 'closed' || load.status === 'cancelled') continue;
      const at = on.stopId ? stopOf(on.stopId) ?? null : null;
      for (const raw of on.undo ?? []) {
        const line = mine().find(l => l.tag === pieceTag(raw) && l.status === 'on_board' && (l.pickup_stop_id ?? null) === (at?.id ?? null));
        if (!line) continue;
        Object.assign(line, { status: line.added_in_field ? 'removed' : 'planned', on_at: null, is_current_position: false });
        if (line.piece_kind === 'crate') setUnit(line.tag, { status: (line.unit_status_before as any) ?? 'sealed' });
      }
      for (const piece of on.pieces ?? []) {
        const tag = pieceTag(typeof piece === 'string' ? piece : piece.code);
        const dropoff = typeof piece === 'string' ? null : piece.dropoffStopId;
        let line = mine().find(l => l.tag === tag && (l.status === 'planned' || l.status === 'on_board'));
        if (line?.status === 'on_board') continue;
        if (!line) {
          if (!dropoff || lines.some(l => l.tag === tag && (l.status === 'planned' || l.status === 'on_board' || l.status === 'missing'))) continue;
          const crate = looksLikeCrate(tag), unit = units.get(tag);
          line = {
            id: `local-${load.id}-${tag}-${lines.length}`, load_id: load.id, load_number: load.load_number, load_status: load.status, tag, piece_kind: crate ? 'crate' : 'item',
            name: crate ? unit?.description || 'Crate' : (ref.materials.find(m => m.tag === tag)?.name ?? ref.counted.find(c => c.tag === tag)?.name ?? tag),
            is_high_value: !!unit?.is_high_value, status: 'planned', flag: null, added_in_field: true, pickup_stop_id: null, dropoff_stop_id: dropoff,
            dropoff_place: stopOf(dropoff)?.place_name ?? null, delivered_stop_id: null, delivered_place: null, is_current_position: false, on_at: null, off_at: null,
          };
          lines.push(line);
        }
        const unit = units.get(tag);
        Object.assign(line, {
          status: 'on_board', pickup_stop_id: at?.id ?? null, on_at: now, unit_status_before: unit?.status ?? null,
          ...(dropoff ? { dropoff_stop_id: dropoff, dropoff_place: stopOf(dropoff)?.place_name ?? line.dropoff_place } : {}),
        });
        position(line);
        if (line.piece_kind === 'crate') setUnit(tag, { status: 'on_load' });
      }
      if (load.status === 'planning' && mine().some(l => l.status === 'on_board')) load.status = 'loading';
      if (at && at.status === 'pending') at.status = 'arrived';
    } else if (action.type === 'load_depart') {
      if (load.status !== 'planning' && load.status !== 'loading') continue;
      if (!load.driver_name || !mine().some(l => l.status === 'on_board')) continue;
      for (const line of mine()) if (line.status === 'planned' && !line.pickup_stop_id) line.status = 'not_loaded';
      Object.assign(load, { status: 'in_transit', departed_at: now });
    } else if (action.type === 'load_off') {
      const off = op as LoadOffPayload & { zoneName?: string };
      const stop = stopOf(off.stopId);
      const where = places.get(stop?.place_id ?? '');
      // An area only at this project's own yard or site (places on the device are shared or ours).
      if (load.status !== 'in_transit' || !stop || (off.zoneId && !where?.project_id)) continue;
      if (stop.status === 'pending') stop.status = 'arrived';
      for (const raw of off.pieces ?? []) {
        const tag = pieceTag(raw);
        let line = mine().filter(l => l.tag === tag).sort((a, b) => Number(['on_board', 'missing', 'delivered'].includes(b.status)) - Number(['on_board', 'missing', 'delivered'].includes(a.status)))[0];
        if (line?.status === 'delivered') continue;
        if (line && (line.status === 'on_board' || line.status === 'missing')) {
          const flag = line.dropoff_stop_id !== stop.id ? 'wrong_stop' : line.status === 'missing' ? 'found' : null;
          Object.assign(line, { status: 'delivered', flag: flag ?? line.flag });
        } else {
          if (lines.some(l => l.load_id !== load.id && l.tag === tag && (l.status === 'planned' || l.status === 'on_board' || l.status === 'missing'))) continue;
          if (!line) {
            line = {
              id: `local-${load.id}-${tag}-${lines.length}`, load_id: load.id, load_number: load.load_number, load_status: load.status, tag, piece_kind: looksLikeCrate(tag) ? 'crate' : 'item',
              name: units.get(tag)?.description || tag, is_high_value: !!units.get(tag)?.is_high_value, status: 'delivered', flag: 'extra', added_in_field: true,
              pickup_stop_id: null, dropoff_stop_id: stop.id, dropoff_place: stop.place_name, delivered_stop_id: null, delivered_place: null, is_current_position: false, on_at: null, off_at: null,
            };
            lines.push(line);
          }
          Object.assign(line, { status: 'delivered', flag: 'extra' });
        }
        Object.assign(line, { delivered_stop_id: stop.id, delivered_place: stop.place_name, off_at: now });
        position(line);
        if (line.piece_kind === 'crate') {
          setUnit(tag, { status: 'delivered', place_id: stop.place_id, place_name: where?.name ?? stop.place_name, zone_id: off.zoneId ?? null, site_map_id: off.siteMapId ?? null, location: off.zoneId ? off.zoneName ?? null : null });
        }
      }
    } else if (action.type === 'stop_complete') {
      const stop = stopOf((op as StopCompletePayload).stopId);
      if (load.status !== 'in_transit' || !stop || stop.status === 'done') continue;
      for (const line of mine()) {
        if (line.dropoff_stop_id === stop.id && line.status === 'on_board') {
          line.status = 'missing';
          position(line);
          if (line.piece_kind === 'crate') setUnit(line.tag, { status: 'missing' });
        }
        if (line.pickup_stop_id === stop.id && line.status === 'planned') line.status = 'not_loaded';
      }
      stop.status = 'done';
      if (!stops.some(s => s.load_id === load.id && (s.status === 'pending' || s.status === 'arrived'))) load.status = 'delivered';
    }
  }

  // Counts, the next stop and the crates' loads follow the lines.
  for (const id of touched) {
    const load = loads.get(id)!;
    const mine = lines.filter(line => line.load_id === id), own = stops.filter(stop => stop.load_id === id).sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99));
    const count = (status: LineStatus) => mine.filter(line => line.status === status).length;
    Object.assign(load, {
      planned_count: count('planned'), on_board_count: count('on_board'), delivered_count: count('delivered'), missing_count: count('missing'),
      flagged_count: mine.filter(line => line.flag).length, stop_count: own.length, stops_done: own.filter(stop => stop.status === 'done').length,
      next_stop: own.find(stop => stop.status === 'pending' || stop.status === 'arrived')?.place_name ?? null,
    });
    for (const stop of own) {
      stop.due_count = mine.filter(line => line.dropoff_stop_id === stop.id && (line.status === 'planned' || line.status === 'on_board')).length;
      stop.delivered_count = mine.filter(line => line.delivered_stop_id === stop.id && line.status === 'delivered').length;
      stop.missing_count = mine.filter(line => line.dropoff_stop_id === stop.id && line.status === 'missing').length;
    }
    for (const line of mine) Object.assign(line, { load_number: load.load_number, load_status: load.status });
  }
  for (const unit of units.values()) {
    const top = unit.top_code ?? unit.code;
    if (units.has(top)) unit.top_status = units.get(top)!.status;
    const line = lines.find(l => l.tag === top && (l.status === 'on_board' || l.status === 'missing' || l.status === 'planned') && touched.has(l.load_id));
    if (line) Object.assign(unit, { load_id: line.load_id, load_number: line.load_number, load_line_status: line.status });
    else if (unit.load_id && touched.has(unit.load_id)) Object.assign(unit, { load_id: null, load_number: null, load_line_status: null });
  }
  return { ...ref, loads: [...loads.values()], stops, lines, companies, units: [...units.values()] };
}

// Every saved change over the copy, in the order saved: a crate unloaded and
// then repacked offline needs the unload first. Consecutive crate (or load)
// changes are applied together.
const CRATE_ACTIONS = new Set(['pack', 'unpack', 'count']);
export function applyChanges(ref: LoadReference, actions: LoadActionLike[]): LoadReference {
  let result = ref;
  for (let at = 0; at < actions.length;) {
    const crate = CRATE_ACTIONS.has(actions[at].type);
    let end = at;
    while (end < actions.length && CRATE_ACTIONS.has(actions[end].type) === crate) end++;
    const run = actions.slice(at, end);
    result = crate ? applyPending(result, run as LoadAction[]) : applyLoadPending(result, run);
    at = end;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Loading: the planned pieces, ticked as they go on.
// ---------------------------------------------------------------------------
// The pieces to load here: at the origin, planned pieces with no pick-up stop;
// at a pick-up stop after leaving, the pieces planned to be picked up there.
// Pieces added on the truck here count too.
export function loadChecklist(ix: LoadsIndex, loadId: string, stopId: string | null = null) {
  const here = (ix.lines.get(loadId) ?? []).filter(line => (line.pickup_stop_id ?? null) === stopId && (line.status === 'planned' || line.status === 'on_board'));
  return { lines: here, onBoard: here.filter(line => line.status === 'on_board').length, total: here.length };
}
export const checklistText = (list: { onBoard: number; total: number }) => `${list.onBoard} of ${list.total} on board`;

export type LoadScan =
  | { kind: 'planned'; tag: string; message: string }
  | { kind: 'unplanned'; tag: string; name: string; unchecked: boolean; message: string }
  | { kind: 'already'; tag: string; message: string }
  | { kind: 'refuse'; tag: string; message: string };

// What a piece scanned on at `stopId` (null: at the origin) does, judged from
// the device's copy as migration 022 judges it. Wording matches the server's.
export function classifyLoadOn(crates: LoadIndex, ix: LoadsIndex, loadId: string, raw: string, stopId: string | null = null): LoadScan | null {
  const tag = pieceTag(raw);
  if (!tag) return null;
  const lines = ix.lines.get(loadId) ?? [], stops = ix.stops.get(loadId) ?? [];
  const load = ix.loads.get(loadId);
  if (load && !stopId && load.status !== 'planning' && load.status !== 'loading') return { kind: 'refuse', tag, message: `${loadLabel(load)} has left; choose the pick-up stop you're at.` };
  if (load && stopId && load.status !== 'in_transit') return { kind: 'refuse', tag, message: `Until the truck leaves, scan pieces on without choosing a stop.` };
  const own = lines.find(line => line.tag === tag && (line.status === 'planned' || line.status === 'on_board'));
  if (own?.status === 'on_board') return { kind: 'already', tag, message: `${tag} is already on the truck. Tap it in the list to take it off.` };
  const missing = lines.find(line => line.tag === tag && line.status === 'missing');
  if (missing) return { kind: 'refuse', tag, message: `${tag} is missing from ${loadLabel(load)}; the office marks it found first.` };
  if (own) {
    // The server takes it on here (a planned pick-up can move), if its drop-off is still to come.
    const drop = stops.find(stop => stop.id === own.dropoff_stop_id), at = stops.find(stop => stop.id === stopId);
    if (drop?.status === 'done') return { kind: 'refuse', tag, message: `${drop.place_name} is already done; choose a later stop for ${tag}.` };
    if (at && drop && (drop.seq ?? 0) <= (at.seq ?? 0)) return { kind: 'refuse', tag, message: `${tag} has to come off at a stop after this one.` };
    return { kind: 'planned', tag, message: `${tag} on board.` };
  }
  const other = ix.openLine.get(tag);
  if (other && other.load_id !== loadId) return { kind: 'refuse', tag, message: `${tag} is already on load ${other.load_number ?? 'another load'}.` };
  if (looksLikeCrate(tag)) {
    const unit = crates.units.get(tag);
    if (unit?.parent_code) return { kind: 'refuse', tag, message: `${tag} is inside ${unit.top_code ?? unit.parent_code}; a crate travels with the crate it's in.` };
    if (unit && !['open', 'sealed', 'delivered'].includes(unit.status)) return { kind: 'refuse', tag, message: `${tag} is ${(STATUS_LABELS[unit.status] ?? unit.status).toLowerCase()}; it can't go on a load.` };
    return { kind: 'unplanned', tag, name: unit ? unit.description || 'Crate' : 'Crate not on this device yet', unchecked: !unit, message: `${tag} isn't planned on this load. Where does it come off?` };
  }
  const holder = crates.crateOf.get(tag);
  if (holder) return { kind: 'refuse', tag, message: `${tag} is packed in ${holder}; load the crate instead.` };
  const material = crates.materials.get(tag), record = crates.counted.get(tag);
  if (material || record?.status === 'counted') return { kind: 'unplanned', tag, name: material?.name ?? record!.name, unchecked: false, message: `${tag} isn't planned on this load. Where does it come off?` };
  if (record?.status === 'received') return { kind: 'refuse', tag, message: `${tag} has been issued or shipped; it can't go on a load.` };
  if (record?.status === 'expected') return { kind: 'refuse', tag, message: `${tag} isn't a crate label or a received or counted item in this project.` };
  return { kind: 'unplanned', tag, name: 'Not on this device yet', unchecked: true, message: `${tag} isn't on this device or planned on this load. Where does it come off?` };
}
// Stops an unplanned piece can come off at: a drop-off (or both) still to
// come, and after the pick-up stop when loading at one.
export function dropoffChoices(ix: LoadsIndex, loadId: string, stopId: string | null = null): LoadStop[] {
  const stops = ix.stops.get(loadId) ?? [];
  const at = stops.find(stop => stop.id === stopId);
  return stops.filter(stop => stop.kind !== 'pickup' && stop.status !== 'done' && (!at || (stop.seq ?? 0) > (at.seq ?? 0)));
}

// Before leaving: the driver's name and something on board. Planned pieces
// not on board stay behind.
export function departCheck(ix: LoadsIndex, loadId: string): { issue: string | null; behind: LoadLine[] } {
  const load = ix.loads.get(loadId);
  const lines = ix.lines.get(loadId) ?? [];
  const behind = lines.filter(line => line.status === 'planned' && !line.pickup_stop_id);
  if (!load) return { issue: 'This load isn’t on this device.', behind };
  if (load.status !== 'planning' && load.status !== 'loading') return { issue: `${loadLabel(load)} has already left.`, behind };
  if (!load.driver_name) return { issue: `Add the driver's name (Driver check-in) before ${loadLabel(load)} leaves.`, behind };
  // The user's rule: the licence (number and a photo of the front) before the truck leaves.
  if (!load.licence_recorded_at && !load.licence_waiting) return { issue: `Record the driver's licence (number and a photo of the front) in Driver check-in before ${loadLabel(load)} leaves.`, behind };
  if (!lines.some(line => line.status === 'on_board')) return { issue: 'Nothing is on the truck yet.', behind };
  return { issue: null, behind };
}

// ---------------------------------------------------------------------------
// Unloading at a stop.
// ---------------------------------------------------------------------------
export function unloadChecklist(ix: LoadsIndex, loadId: string, stopId: string) {
  const lines = ix.lines.get(loadId) ?? [];
  const due = lines.filter(line => line.dropoff_stop_id === stopId && line.flag !== 'extra' && (line.status === 'on_board' || line.status === 'missing' || (line.status === 'delivered' && line.delivered_stop_id === stopId)));
  const off = lines.filter(line => line.delivered_stop_id === stopId && line.status === 'delivered');
  const extras = off.filter(line => line.dropoff_stop_id !== stopId || line.flag === 'extra');
  return { due, offCount: due.filter(line => line.status === 'delivered').length, total: due.length, extras, waiting: due.filter(line => line.status === 'on_board') };
}
export type UnloadScan =
  | { kind: 'due' | 'found'; tag: string; message: string }
  | { kind: 'wrong_stop'; tag: string; message: string }
  | { kind: 'extra'; tag: string; unchecked: boolean; message: string }
  | { kind: 'already'; tag: string; message: string }
  | { kind: 'refuse'; tag: string; message: string };
export function classifyUnload(crates: LoadIndex, ix: LoadsIndex, loadId: string, stopId: string, raw: string): UnloadScan | null {
  const tag = pieceTag(raw);
  if (!tag) return null;
  const lines = (ix.lines.get(loadId) ?? []).filter(line => line.tag === tag);
  const line = lines.find(l => l.status === 'on_board' || l.status === 'missing') ?? lines.find(l => l.status === 'delivered');
  if (line?.status === 'delivered') return { kind: 'already', tag, message: `${tag} is already off.` };
  if (line) {
    if (line.dropoff_stop_id !== stopId) return { kind: 'wrong_stop', tag, message: `${tag} was due at ${line.dropoff_place ?? 'another stop'}. It comes off here, marked as the wrong stop.` };
    return line.status === 'missing' ? { kind: 'found', tag, message: `${tag} was missing; it's found and off.` } : { kind: 'due', tag, message: `${tag} off.` };
  }
  const other = ix.openLine.get(tag);
  if (other && other.load_id !== loadId) return { kind: 'refuse', tag, message: `${tag} belongs to load ${other.load_number ?? 'another load'}.` };
  if (looksLikeCrate(tag)) {
    const unit = crates.units.get(tag);
    if (unit?.parent_code) return { kind: 'refuse', tag, message: `${tag} is inside ${unit.top_code ?? unit.parent_code}; a crate travels with the crate it's in.` };
    if (unit && !['open', 'sealed', 'delivered'].includes(unit.status)) return { kind: 'refuse', tag, message: `${tag} is ${(STATUS_LABELS[unit.status] ?? unit.status).toLowerCase()}; it can't be unloaded here.` };
    return { kind: 'extra', tag, unchecked: !unit, message: `${tag} wasn't on this truck's list. It comes off as an extra.` };
  }
  const holder = crates.crateOf.get(tag);
  if (holder) return { kind: 'refuse', tag, message: `${tag} is packed in ${holder}; unload the crate instead.` };
  const record = crates.counted.get(tag);
  if (!crates.materials.has(tag) && record?.status === 'expected') return { kind: 'refuse', tag, message: `${tag} isn't a crate label or a received or counted item in this project.` };
  const known = crates.materials.has(tag) || record?.status === 'counted';
  return { kind: 'extra', tag, unchecked: !known, message: `${tag} wasn't on this truck's list. It comes off as an extra.` };
}
// The stops a crew can unload at: still to finish, in order.
export const openStops = (ix: LoadsIndex, loadId: string) => (ix.stops.get(loadId) ?? []).filter(stop => stop.status !== 'done');
// At an outside shop or a vendor the office confirms what arrived, so the
// field doesn't finish those stops.
export const OFFICE_FINISHES = new Set(['outside_shop', 'vendor']);
export const officeFinishes = (stop: Pick<LoadStop, 'place_kind'> | undefined) => OFFICE_FINISHES.has(stop?.place_kind ?? '');

// ---------------------------------------------------------------------------
// Driver check-in.
// ---------------------------------------------------------------------------
export interface CheckInCompany { name: string; role: CompanyRole; contactName: string; phone: string }
export interface CheckInDraft {
  driverName: string;
  driverPhone: string;
  companies: CheckInCompany[];
  licenceNumber: string;
  licenceState: string;
  licenceExpiry: string;
  front: string | null;
  back: string | null;
}
export const CHECK_IN_STEPS = ['Driver', 'Companies', 'Licence', 'Review'];
// Why the check-in can't be saved, with the step that fixes it. A licence is
// needed unless one is on file already; then it is optional.
export function checkInIssue(draft: CheckInDraft, licenceOnFile: boolean): { step: number; message: string } | null {
  if (!draft.driverName.trim()) return { step: 0, message: 'Enter the driver’s name.' };
  if (draft.driverName.trim().length > 120) return { step: 0, message: 'Keep the driver’s name to 120 characters.' };
  if (draft.driverPhone.trim().length > 40) return { step: 0, message: 'Keep the phone number to 40 characters.' };
  if (draft.companies.length > MAX_COMPANIES) return { step: 1, message: `Add up to ${MAX_COMPANIES} companies.` };
  for (const [i, company] of draft.companies.entries()) {
    if (!company.name.trim()) return { step: 1, message: `Company ${i + 1} needs a name.` };
    if (company.name.trim().length > 120 || company.contactName.trim().length > 120) return { step: 1, message: `Keep company ${i + 1}'s names to 120 characters.` };
    if (company.phone.trim().length > 40) return { step: 1, message: `Keep company ${i + 1}'s phone to 40 characters.` };
    if (!COMPANY_ROLES.some(role => role.value === company.role)) return { step: 1, message: `Choose company ${i + 1}'s role.` };
  }
  const entering = !!(draft.licenceNumber.trim() || draft.front || draft.back || draft.licenceState.trim() || draft.licenceExpiry.trim());
  if (!entering && licenceOnFile) return null;
  if (!LICENCE_NUMBER.test(normaliseLicenceNumber(draft.licenceNumber))) return { step: 2, message: 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes.' };
  if (draft.licenceState.trim().length > 40) return { step: 2, message: 'Keep the issuing state to 40 characters.' };
  if (draft.licenceExpiry.trim() && !validDate(draft.licenceExpiry.trim())) return { step: 2, message: 'Enter the expiry as a real date.' };
  if (!draft.front) return { step: 2, message: 'Take a photo of the front of the licence.' };
  return null;
}
// The check-in as up to two queued items: what changed of the driver and
// companies (a load_save; null when nothing did) and, when entered, the
// licence. Only changes go, so details the office added after this device's
// download aren't wiped. `start`: what the check-in began with.
export function checkInPayloads(loadId: string, label: string, draft: CheckInDraft, start?: Pick<CheckInDraft, 'driverName' | 'driverPhone' | 'companies'>): { save: LoadSavePayload | null; licence: { payload: LicencePayload; details: LicenceDetails } | null } {
  const companies = (list: CheckInCompany[]) => list.map(company => ({
    name: company.name.trim(), role: company.role,
    ...(company.contactName.trim() ? { contactName: company.contactName.trim() } : {}), ...(company.phone.trim() ? { phone: company.phone.trim() } : {}),
  }));
  const save: LoadSavePayload = { loadId };
  if (!start || draft.driverName.trim() !== start.driverName.trim()) save.driverName = draft.driverName.trim();
  if (!start || draft.driverPhone.trim() !== start.driverPhone.trim()) save.driverPhone = draft.driverPhone.trim();
  if (!start || JSON.stringify(companies(draft.companies)) !== JSON.stringify(companies(start.companies))) save.companies = companies(draft.companies);
  const changed = Object.keys(save).length > 1 ? save : null;
  if (!draft.licenceNumber.trim() || !draft.front) return { save: changed, licence: null };
  return {
    save: changed,
    licence: {
      payload: { loadId, label, photos: [draft.front, draft.back].filter((uri): uri is string => !!uri).map(uri => ({ uri })) },
      details: {
        number: normaliseLicenceNumber(draft.licenceNumber),
        ...(draft.licenceState.trim() ? { state: draft.licenceState.trim() } : {}), ...(draft.licenceExpiry.trim() ? { expiry: draft.licenceExpiry.trim() } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The load editor.
// ---------------------------------------------------------------------------
export interface LoadEditDraft {
  originPlaceId: string | null;
  plannedDate: string;
  truckType: string;
  truckNumber: string;
  trailerNumber: string;
  bolNumber: string;
  notes: string;
  // A stop's planned date (set by the office) is sent back unchanged.
  stops: { id: string; placeId: string; kind: StopKind; plannedDate?: string | null }[];
}
// `lines`: the load's manifest, so a stop still needed by a piece isn't
// removed or turned the wrong way (the server refuses the whole save).
export function loadEditIssue(draft: LoadEditDraft, departed: boolean, lines: LoadLine[] = [], beforeStops: LoadStop[] = []): string | null {
  if (!draft.originPlaceId) return 'Choose where the load starts.';
  if (draft.plannedDate.trim() && !validDate(draft.plannedDate.trim())) return 'Enter the planned date as a real date.';
  if (!departed && draft.stops.length === 0) return 'Add at least one stop.';
  if (draft.stops.length > MAX_STOPS) return `A load can have at most ${MAX_STOPS} stops.`;
  if (!departed && draft.stops.length && draft.stops.every(stop => stop.kind === 'pickup')) return 'At least one stop needs to be a drop-off.';
  const limits: [keyof LoadEditDraft, number, string][] = [['truckType', 60, 'Truck type'], ['truckNumber', 40, 'Truck number'], ['trailerNumber', 40, 'Trailer number'], ['bolNumber', 60, 'Bill of lading number'], ['notes', 2000, 'Notes']];
  for (const [key, max, label] of limits) if (String(draft[key]).trim().length > max) return `${label} is too long (at most ${max} characters).`;
  if (departed) return null;
  const open = lines.filter(line => line.status === 'planned' || line.status === 'on_board' || line.status === 'missing');
  const position = new Map(draft.stops.map((stop, i) => [stop.id, { ...stop, seq: i + 1 }]));
  for (const old of beforeStops) {
    if (!position.has(old.id) && open.some(line => line.pickup_stop_id === old.id || line.dropoff_stop_id === old.id)) return `The stop at ${old.place_name} still has pieces planned for it; move them to another stop first.`;
  }
  for (const line of open.filter(l => l.status !== 'missing')) {
    const drop = position.get(line.dropoff_stop_id), pick = line.pickup_stop_id ? position.get(line.pickup_stop_id) : null;
    if (drop?.kind === 'pickup' || pick?.kind === 'dropoff' || (pick && drop && pick.seq >= drop.seq)) return 'Every planned piece needs a drop-off stop after its pick-up stop.';
  }
  return null;
}
// Only what changed goes; stops go only before the truck leaves.
export function loadSavePayload(loadId: string, draft: LoadEditDraft, before: Load | undefined, beforeStops: LoadStop[], departed: boolean): LoadSavePayload {
  const payload: LoadSavePayload = { loadId };
  if (!before || draft.originPlaceId !== before.origin_place_id) payload.originPlaceId = draft.originPlaceId;
  if ((draft.plannedDate.trim() || null) !== (before?.planned_date ?? null)) payload.plannedDate = draft.plannedDate.trim() || null;
  const fields: [keyof LoadEditDraft & keyof LoadSavePayload, keyof Load][] = [['truckType', 'truck_type'], ['truckNumber', 'truck_number'], ['trailerNumber', 'trailer_number'], ['bolNumber', 'bol_number'], ['notes', 'notes']];
  for (const [key, column] of fields) {
    const value = String(draft[key]).trim();
    if (value !== ((before?.[column] as string | null) ?? '')) (payload as any)[key] = value;
  }
  const stops = draft.stops.map(stop => ({ id: stop.id, placeId: stop.placeId, kind: stop.kind, ...(stop.plannedDate ? { plannedDate: stop.plannedDate } : {}) }));
  const same = before && stops.length === beforeStops.length && stops.every((stop, i) => stop.id === beforeStops[i].id && stop.placeId === beforeStops[i].place_id && stop.kind === beforeStops[i].kind);
  if (!departed && !same) payload.stops = stops;
  return payload;
}

import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { getCached, setCache } from '@/lib/sync/readCache';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchAll, whereTag, withTimeout } from './inventory';
import { applyOperation, type OperationContext } from './operations';
import { applyChanges, indexLoads, splitRefused, type Load, type LoadCompany, type LoadLine, type LoadOperation, type LoadQueuePayload, type LoadStop, type RefusedPiece } from '@/lib/logistics/loads';
import { queueRefused, type QueueAction } from '@/lib/sync/offlineQueue';
import {
  crateCode, indexLoad, looksLikeCrate, mergeFresh, packedInText,
  type CountedItem, type HandlingUnit, type LoadAction, type LoadReference, type MoveQueuePayload, type PackQueuePayload, type Place,
  type RelocateQueuePayload, type UnitItem, type UnpackOperationPayload, type YardMaterial,
} from '@/lib/logistics/crates';

// Crates and loads for Scan, the Crate and Pack screens and the Loads tab
// (migrations 021 and 022): every crate and what it holds, the places a crate
// can be, the tags that may be packed or loaded (in-yard materials and
// inventory records), and open and recent loads with their stops, manifest
// lines and companies. Cached per user and project in chunks like Count's
// tags, so finding, packing and loading work with no signal.

const KEYS = {
  units: 'load_units', items: 'load_items', places: 'load_places', materials: 'load_materials', counted: 'load_counted',
  trips: 'load_trips', tripStops: 'load_trip_stops', tripLines: 'load_trip_lines', tripCompanies: 'load_trip_companies',
  savedAt: 'load_saved_at',
  // Packs, unpacks and load changes the server accepted since the last download.
  applied: 'load_applied',
};
// Delivered and closed loads stay on the device this long.
const RECENT_DAYS = 30;
const ID_CHUNK = 100;
// One large AsyncStorage value can't be read back on Android (about 2 MB a row).
const CHUNK = 500;
const MAX_APPLIED = 500;
const UNIT_COLUMNS_021 = 'id,code,kind,description,is_high_value,status,parent_id,parent_code,top_code,place_id,place_name,site_map_id,zone_id,location,item_count,unit_count';
const UNIT_COLUMNS = `${UNIT_COLUMNS_021},top_status,load_id,load_number,load_line_status`;
const LOAD_COLUMNS = 'id,load_number,status,origin_place_id,origin_name,origin_kind,planned_date,truck_type,truck_number,trailer_number,bol_number,driver_name,driver_phone,licence_recorded_at,licence_complete,licence_override_at,started_in_field,notes,stop_count,stops_done,next_stop,planned_count,on_board_count,delivered_count,missing_count,written_off_count,flagged_count,departed_at,updated_at';
const STOP_COLUMNS = 'id,load_id,seq,place_id,place_name,place_kind,kind,planned_date,status,due_count,delivered_count,missing_count';
const LINE_COLUMNS = 'id,load_id,load_number,load_status,tag,piece_kind,name,is_high_value,status,flag,added_in_field,pickup_stop_id,dropoff_stop_id,dropoff_place,delivered_stop_id,delivered_place,is_current_position,on_at,off_at';
const COMPANY_COLUMNS = 'load_id,position,name,role,contact_name,phone';
// Before migration 022 (or after a rollback) there are no loads and the crate
// view lacks its load columns: crates still load, and there are no loads.
const missingLoads = (message: string) => /load_overview|load_stop_overview|load_line_overview|load_companies|top_status|load_line_status|load_number|load_id/.test(message)
  && /does not exist|42703|42P01|could not find|schema cache/i.test(message);
let before022 = false;
const unitColumns = () => (before022 ? UNIT_COLUMNS_021 : UNIT_COLUMNS);
const ITEM_COLUMNS = 'unit_code,tag,name,quantity,uom,material_id,inventory_uid';
const PLACE_COLUMNS = 'id,kind,name,project_id,city,state';
const MATERIAL_COLUMNS = 'id,material_type,size,grade,current_quantity,qr_codes(code_value)';
const RECORD_COLUMNS_021 = 'uid,qr_code,inventory_item,quantity,uom,count_status';
const RECORD_COLUMNS = `${RECORD_COLUMNS_021},written_off_at`;
// Before 022 there is no write-off.
const readRecords = (query: (columns: string) => PromiseLike<any[]>) => Promise.resolve(query(RECORD_COLUMNS)).catch((error: Error) => {
  if (!/written_off_at/.test(error?.message ?? '')) throw error;
  return query(RECORD_COLUMNS_021);
});

function contextGuard() {
  const { user, activeProject } = useAuthStore.getState();
  const userId = user?.id, projectId = activeProject?.id;
  return {
    projectId,
    current: () => !!projectId && useAuthStore.getState().user?.id === userId && useAuthStore.getState().activeProject?.id === projectId,
  };
}

const toUnit = (row: any): HandlingUnit => ({ ...row, item_count: Number(row.item_count ?? 0), unit_count: Number(row.unit_count ?? 0) });
const toItem = (row: any): UnitItem => ({ ...row, tag: String(row.tag).trim() });
// The tag is the material's QR value; its name is built as the server's view builds it.
const toMaterial = (row: any): YardMaterial | null => {
  const tag = row.qr_codes?.code_value?.trim();
  return tag ? { id: row.id, tag, name: [row.material_type, row.size, row.grade].filter(Boolean).join(' ') || tag, quantity: Number(row.current_quantity) } : null;
};
const toRecord = (row: any): CountedItem => ({ uid: row.uid, tag: String(row.qr_code).trim(), name: row.inventory_item, quantity: row.quantity, uom: row.uom, status: row.written_off_at ? 'written_off' : row.count_status });

// setCache names its key from the account and project at the moment it is
// called, so the context is checked right before each write.
async function writeRows(key: string, rows: unknown[], current: () => boolean) {
  const write = (name: string, value: unknown) => {
    if (!current()) throw new Error('Project changed while loading. Pull to refresh.');
    return setCache(name, value);
  };
  const previous = (await getCached<number>(`${key}_chunks`)) ?? 0;
  const chunks = Math.ceil(rows.length / CHUNK);
  for (let index = 0; index < Math.max(chunks, previous); index++) {
    await write(`${key}_${index}`, index < chunks ? rows.slice(index * CHUNK, (index + 1) * CHUNK) : []);
  }
  await write(`${key}_chunks`, chunks);
}
async function readRows<T>(key: string): Promise<T[]> {
  const chunks = (await getCached<number>(`${key}_chunks`)) ?? 0;
  const parts = await Promise.all(Array.from({ length: chunks }, (_, index) => getCached<T[]>(`${key}_${index}`)));
  return parts.flatMap(part => part ?? []);
}

type Applied = { at: number; action: LoadAction };
// The accepted-changes list is read and rewritten by downloads and uploads;
// one at a time, so neither loses the other's entry.
let appliedTurn: Promise<unknown> = Promise.resolve();
function withApplied<T>(change: (applied: Applied[]) => Promise<T>): Promise<T> {
  const run = appliedTurn.then(async () => change((await getCached<Applied[]>(KEYS.applied)) ?? []));
  appliedTurn = run.catch(() => {});
  return run;
}
// The saved copy, with the changes the server has accepted since it was saved.
export async function readCachedLoad(): Promise<LoadReference> {
  const [units, items, places, materials, counted, loads, stops, lines, companies, savedAt, applied] = await Promise.all([
    readRows<HandlingUnit>(KEYS.units), readRows<UnitItem>(KEYS.items), readRows<Place>(KEYS.places),
    readRows<YardMaterial>(KEYS.materials), readRows<CountedItem>(KEYS.counted),
    readRows<Load>(KEYS.trips), readRows<LoadStop>(KEYS.tripStops), readRows<LoadLine>(KEYS.tripLines), readRows<LoadCompany>(KEYS.tripCompanies),
    getCached<string>(KEYS.savedAt), getCached<Applied[]>(KEYS.applied),
  ]);
  return applyChanges({ units, items, places, materials, counted, loads, stops, lines, companies, savedAt: savedAt ?? null }, (applied ?? []).map(entry => entry.action));
}

// Open loads and those finished in the last 30 days, with their stops, lines
// and companies (fetched by load, 100 loads at a time).
async function fetchLoads(client: ReturnType<typeof getProjectClient>) {
  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
  const loads = await fetchAll<Load>(client, 'load_overview', LOAD_COLUMNS, query => query.or(`status.in.(planning,loading,in_transit),updated_at.gte.${since}`));
  const ids = loads.map(load => load.id);
  const byLoad = async <T,>(table: string, columns: string) => {
    const rows: T[] = [];
    for (let at = 0; at < ids.length; at += ID_CHUNK) rows.push(...await fetchAll<T>(client, table, columns, query => query.in('load_id', ids.slice(at, at + ID_CHUNK))));
    return rows;
  };
  const [stops, lines, companies] = await Promise.all([
    byLoad<LoadStop>('load_stop_overview', STOP_COLUMNS), byLoad<LoadLine>('load_line_overview', LINE_COLUMNS), byLoad<LoadCompany>('load_companies', COMPANY_COLUMNS),
  ]);
  return { loads, stops, lines: lines.map(line => ({ ...line, tag: String(line.tag).trim() })), companies };
}
const NO_LOADS = { loads: [] as Load[], stops: [] as LoadStop[], lines: [] as LoadLine[], companies: [] as LoadCompany[] };

// Fetches every crate, packed item, place, in-yard material and inventory
// record for the active project and stores them. One client throughout, so
// every page comes from the project the refresh started in.
async function runRefresh(): Promise<LoadReference> {
  const guard = contextGuard();
  if (!guard.projectId) throw new Error('Select a project first.');
  const started = Date.now();
  const client = getProjectClient();
  // Places are shared: outside shops and vendors belong to no project.
  const shared = { from: (table: string) => supabase.from(table) };
  // Each download tries 022's columns again, in case it has been deployed since.
  before022 = false;
  const units = fetchAll<any>(client, 'handling_unit_overview', unitColumns()).catch((error: Error) => {
    if (!missingLoads(error.message)) throw error;
    before022 = true;
    return fetchAll<any>(client, 'handling_unit_overview', UNIT_COLUMNS_021);
  });
  const trips = fetchLoads(client).catch((error: Error) => {
    if (!missingLoads(error.message)) throw error;
    return NO_LOADS;
  });
  const [unitRows, items, places, materials, records, loads] = await Promise.all([
    units,
    fetchAll<any>(client, 'handling_unit_items', ITEM_COLUMNS),
    fetchAll<Place>(shared, 'places', PLACE_COLUMNS, query => query.eq('is_active', true).or(`project_id.is.null,project_id.eq.${guard.projectId}`)),
    fetchAll<any>(client, 'materials', MATERIAL_COLUMNS, query => query.eq('status', 'in_yard').gt('current_quantity', 0)),
    readRecords(columns => fetchAll<any>(client, 'inventory_records', columns)),
    trips,
  ]);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  const data: LoadReference = {
    units: unitRows.map(toUnit), items: items.map(toItem), places,
    materials: materials.map(toMaterial).filter((m): m is YardMaterial => !!m), counted: records.map(toRecord),
    ...loads,
    savedAt: new Date().toISOString(),
  };
  for (const [key, rows] of [[KEYS.units, data.units], [KEYS.items, data.items], [KEYS.places, data.places], [KEYS.materials, data.materials], [KEYS.counted, data.counted],
    [KEYS.trips, data.loads], [KEYS.tripStops, data.stops], [KEYS.tripLines, data.lines], [KEYS.tripCompanies, data.companies]] as const) {
    await writeRows(key, rows as unknown[], guard.current);
  }
  // Changes accepted while this download ran may be missing from it.
  const applied = await withApplied(async (all) => {
    const kept = all.filter(entry => entry.at >= started);
    if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
    await setCache(KEYS.applied, kept);
    return kept;
  });
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  await setCache(KEYS.savedAt, data.savedAt);
  return applyChanges(data, applied.map(entry => entry.action));
}

// A refresh already running for the same account and project is shared.
let inflight: { key: string; promise: Promise<LoadReference> } | null = null;
export function refreshLoad(): Promise<LoadReference> {
  const { user, activeProject } = useAuthStore.getState();
  const key = `${user?.id}:${activeProject?.id}`;
  if (inflight?.key === key) return inflight.promise;
  const promise = runRefresh().finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { key, promise };
  return promise;
}

// Online first, falling back to what this device saved last time.
export async function loadLoad(): Promise<{ data: LoadReference; source: 'online' | 'cache'; error?: string }> {
  if (useNetworkStore.getState().isOnline) {
    try {
      return { data: await refreshLoad(), source: 'online' };
    } catch (error: any) {
      return { data: await readCachedLoad(), source: 'cache', error: error?.message ?? 'Could not refresh' };
    }
  }
  return { data: await readCachedLoad(), source: 'cache' };
}

type Rows = { data: any[] | null; error: { message?: string } | null };
async function readRowsOnline(query: PromiseLike<Rows>) {
  const { data, error } = await withTimeout<Rows>(query);
  if (error) throw new Error(error.message ?? 'Lookup failed');
  return data ?? [];
}
// What the server says now about crates: each one with every crate in the
// same outermost crate, so nesting, loops and depth are judged afresh.
export async function lookupCratesOnline(codes: string[]): Promise<HandlingUnit[]> {
  const client = getProjectClient();
  const wanted = [...new Set(codes.map(crateCode))];
  const rows = await readRowsOnline(client.from('handling_unit_overview').select(unitColumns()).in('code', wanted));
  const tops = [...new Set(rows.map((row: any) => row.top_code ?? row.code))];
  const trees = tops.length ? await readRowsOnline(client.from('handling_unit_overview').select(unitColumns()).in('top_code', tops)) : [];
  const byCode = new Map([...rows, ...trees].map((row: any) => [row.code, toUnit(row)]));
  return [...byCode.values()];
}
// What the server says now about one scanned tag or crate, for when the
// device's copy refuses it (or doesn't know it) and may be out of date.
// `alsoCrates`: the crate being packed, whose surroundings matter too.
export async function lookupTagOnline(raw: string, alsoCrates: string[] = []): Promise<Pick<LoadReference, 'units' | 'items' | 'materials' | 'counted'>> {
  const client = getProjectClient();
  const read = readRowsOnline;
  if (looksLikeCrate(raw)) {
    return { units: await lookupCratesOnline([raw, ...alsoCrates]), items: [], materials: [], counted: [] };
  }
  // Whatever its capitals: the server's spelling comes back.
  const tag = raw.trim();
  const [items, materials, records] = await Promise.all([
    read(whereTag(client.from('handling_unit_items').select(ITEM_COLUMNS), 'tag', tag)),
    read(whereTag(client.from('materials').select(MATERIAL_COLUMNS.replace('qr_codes(', 'qr_codes!inner(')).eq('status', 'in_yard').gt('current_quantity', 0), 'qr_codes.code_value', tag)),
    readRecords(columns => read(whereTag(client.from('inventory_records').select(columns), 'qr_code', tag))),
  ]);
  return {
    units: [], items: items.map(toItem), counted: records.map(toRecord),
    materials: materials.map(toMaterial).filter((m): m is YardMaterial => !!m),
  };
}

// "In crate HU-… at …" for an item, for material and count views: the server
// when it answers, otherwise the device's copy, with `pending` changes over it.
export async function packedInNow(tag: string, pending: LoadAction[]): Promise<{ code: string; text: string } | null> {
  let ref = await readCachedLoad();
  if (useNetworkStore.getState().isOnline) {
    try {
      ref = mergeFresh(ref, tag, await lookupTagOnline(tag));
      const holder = ref.items.find(item => item.tag === tag.trim())?.unit_code;
      if (holder) ref = mergeFresh(ref, holder, await lookupTagOnline(holder));
    } catch { /* The device's copy answers. */ }
  }
  return packedInText(indexLoad(applyChanges(ref, pending)), tag);
}

// Where a loose item is now from the load it last went on or came off: "On
// load L-0003 (to Gulf Machine)", "Delivered to Gulf Machine on L-0003" or
// "Missing from L-0003". The server when it answers, otherwise the copy.
export async function itemOnLoadNow(tag: string, pending: LoadAction[]): Promise<{ loadId: string; text: string } | null> {
  const wanted = tag.trim();
  let line: LoadLine | undefined;
  if (useNetworkStore.getState().isOnline && !before022) {
    try {
      const rows = await readRowsOnline(whereTag(getProjectClient().from('load_line_overview').select(LINE_COLUMNS), 'tag', wanted).eq('is_current_position', true).limit(1));
      line = rows[0];
    } catch { /* The device's copy answers. */ }
  }
  const local = indexLoads(applyChanges(await readCachedLoad(), pending)).position.get(wanted);
  // A change saved here and not yet uploaded is newer than the server's answer;
  // otherwise the server's line wins. Each line's time is when it last moved.
  const moved = (l: LoadLine) => l.off_at ?? l.on_at ?? '';
  if (local && (!line || local.id.startsWith('local-') || moved(local) > moved(line))) line = local;
  if (!line) return null;
  const number = line.load_number ?? 'a new load';
  const text = line.status === 'on_board' ? `On load ${number}${line.dropoff_place ? ` (to ${line.dropoff_place})` : ''}`
    : line.status === 'delivered' ? `Delivered to ${line.delivered_place ?? 'its stop'} on ${number}`
    : line.status === 'missing' ? `Missing from ${number}` : '';
  return text ? { loadId: line.load_id, text } : null;
}

// Kept until the next download, so the crate shows its new contents after
// the change leaves the queue.
async function recordApplied(action: LoadAction, context: OperationContext) {
  const at = Date.now();
  await withApplied(async (applied) => {
    const { user, activeProject } = useAuthStore.getState();
    if (user?.id !== context.userId || activeProject?.id !== context.projectId) return;
    await setCache(KEYS.applied, [...applied, { at, action }].slice(-MAX_APPLIED));
  });
}

// One pack session through apply_field_operation. Replaying the same
// operation returns the same result, so a retry after a lost reply is safe.
export async function submitPack(payload: PackQueuePayload, context: OperationContext) {
  const result = await applyOperation('pack', payload.pack, context);
  if (!result?.code) throw new Error('The crate was not confirmed by the server. It will retry.');
  await recordApplied({ type: 'pack', payload }, context).catch(() => {});
  return result as { id: string; code: string; status: string; created: boolean; item_count: number; unit_count: number };
}
// A load operation through apply_field_operation, sent unchanged. A partial
// load_on or load_off may turn some pieces down: each goes back in the queue,
// ahead of the load's later steps, as a step of its own waiting for a
// decision; only the pieces taken are laid over the device's copy.
export async function submitLoadOperation(type: LoadOperation, payload: LoadQueuePayload<any>, context: OperationContext) {
  const result = await applyOperation(type, payload.op, context);
  if (!result || typeof result !== 'object') throw new Error('The load change was not confirmed by the server. It will retry.');
  const refused: RefusedPiece[] = Array.isArray(result.refused) ? result.refused : [];
  let applied = payload;
  if (refused.length && (type === 'load_on' || type === 'load_off')) {
    const split = splitRefused(type, payload, refused, context.operationId);
    await queueRefused(context.operationId, context, split.steps.map(step => ({ ...step, action: step.action as QueueAction })));
    applied = split.applied;
  }
  await recordApplied({ type, payload: applied } as LoadAction, context).catch(() => {});
  return result;
}
// A licence uploaded (number and photos): on file on this device's copy until
// the next download says so too. Only the load, never a licence detail.
export async function noteLicenceOnFile(loadId: string, context: OperationContext) {
  await recordApplied({ type: 'licence', payload: { loadId, label: '', photos: [], complete: true } }, context).catch(() => {});
}
// A crate moved without opening it, and a loose item's place corrected.
export async function submitMove(payload: MoveQueuePayload, context: OperationContext) {
  const result = await applyOperation('move', payload.move, context);
  if (!result?.code) throw new Error('The move was not confirmed by the server. It will retry.');
  await recordApplied({ type: 'move', payload }, context).catch(() => {});
  return result;
}
export async function submitRelocate(payload: RelocateQueuePayload, context: OperationContext) {
  const result = await applyOperation('relocate', payload.relocate, context);
  if (!result?.tag) throw new Error('The new location was not confirmed by the server. It will retry.');
  return result;
}
export async function submitUnpack(payload: UnpackOperationPayload, context: OperationContext) {
  const result = await applyOperation('unpack', payload, context);
  if (!result?.code) throw new Error('The unpack was not confirmed by the server. It will retry.');
  await recordApplied({ type: 'unpack', payload }, context).catch(() => {});
  return result as { id: string; code: string; status: string; items_released: number; units_released: number };
}

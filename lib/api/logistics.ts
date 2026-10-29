import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { getCached, setCache } from '@/lib/sync/readCache';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchAll, withTimeout } from './inventory';
import { applyOperation, type OperationContext } from './operations';
import {
  applyPending, crateCode, indexLoad, looksLikeCrate, mergeFresh, packedInText,
  type CountedItem, type HandlingUnit, type LoadAction, type LoadReference, type PackQueuePayload, type Place, type UnitItem,
  type UnpackOperationPayload, type YardMaterial,
} from '@/lib/logistics/crates';

// Crates for Scan, the Crate screen and Pack (migration 021): every crate and
// what it holds, the places a crate can be, and the tags that may be packed
// (in-yard materials and inventory records). Cached per user and project in
// chunks like Count's tags, so finding and packing work with no signal.

const KEYS = {
  units: 'load_units', items: 'load_items', places: 'load_places', materials: 'load_materials', counted: 'load_counted',
  savedAt: 'load_saved_at',
  // Packs and unpacks the server accepted since the last download.
  applied: 'load_applied',
};
// One large AsyncStorage value can't be read back on Android (about 2 MB a row).
const CHUNK = 500;
const MAX_APPLIED = 500;
const UNIT_COLUMNS = 'id,code,kind,description,is_high_value,status,parent_id,parent_code,top_code,place_id,place_name,site_map_id,zone_id,location,item_count,unit_count';
const ITEM_COLUMNS = 'unit_code,tag,name,quantity,uom,material_id,inventory_uid';
const PLACE_COLUMNS = 'id,kind,name,project_id,city,state';
const MATERIAL_COLUMNS = 'id,material_type,size,grade,current_quantity,qr_codes(code_value)';
const RECORD_COLUMNS = 'uid,qr_code,inventory_item,quantity,uom,count_status';

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
const toRecord = (row: any): CountedItem => ({ uid: row.uid, tag: String(row.qr_code).trim(), name: row.inventory_item, quantity: row.quantity, uom: row.uom, status: row.count_status });

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
  const [units, items, places, materials, counted, savedAt, applied] = await Promise.all([
    readRows<HandlingUnit>(KEYS.units), readRows<UnitItem>(KEYS.items), readRows<Place>(KEYS.places),
    readRows<YardMaterial>(KEYS.materials), readRows<CountedItem>(KEYS.counted),
    getCached<string>(KEYS.savedAt), getCached<Applied[]>(KEYS.applied),
  ]);
  return applyPending({ units, items, places, materials, counted, savedAt: savedAt ?? null }, (applied ?? []).map(entry => entry.action));
}

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
  const [units, items, places, materials, records] = await Promise.all([
    fetchAll<any>(client, 'handling_unit_overview', UNIT_COLUMNS),
    fetchAll<any>(client, 'handling_unit_items', ITEM_COLUMNS),
    fetchAll<Place>(shared, 'places', PLACE_COLUMNS, query => query.eq('is_active', true).or(`project_id.is.null,project_id.eq.${guard.projectId}`)),
    fetchAll<any>(client, 'materials', MATERIAL_COLUMNS, query => query.eq('status', 'in_yard').gt('current_quantity', 0)),
    fetchAll<any>(client, 'inventory_records', RECORD_COLUMNS),
  ]);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  const data: LoadReference = {
    units: units.map(toUnit), items: items.map(toItem), places,
    materials: materials.map(toMaterial).filter((m): m is YardMaterial => !!m), counted: records.map(toRecord),
    savedAt: new Date().toISOString(),
  };
  for (const [key, rows] of [[KEYS.units, data.units], [KEYS.items, data.items], [KEYS.places, data.places], [KEYS.materials, data.materials], [KEYS.counted, data.counted]] as const) {
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
  return applyPending(data, applied.map(entry => entry.action));
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
  const rows = await readRowsOnline(client.from('handling_unit_overview').select(UNIT_COLUMNS).in('code', wanted));
  const tops = [...new Set(rows.map((row: any) => row.top_code ?? row.code))];
  const trees = tops.length ? await readRowsOnline(client.from('handling_unit_overview').select(UNIT_COLUMNS).in('top_code', tops)) : [];
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
  const tag = raw.trim();
  const [items, materials, records] = await Promise.all([
    read(client.from('handling_unit_items').select(ITEM_COLUMNS).eq('tag', tag)),
    read(client.from('materials').select(MATERIAL_COLUMNS.replace('qr_codes(', 'qr_codes!inner(')).eq('status', 'in_yard').gt('current_quantity', 0).eq('qr_codes.code_value', tag)),
    read(client.from('inventory_records').select(RECORD_COLUMNS).eq('qr_code', tag)),
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
  return packedInText(indexLoad(applyPending(ref, pending)), tag);
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
export async function submitUnpack(payload: UnpackOperationPayload, context: OperationContext) {
  const result = await applyOperation('unpack', payload, context);
  if (!result?.code) throw new Error('The unpack was not confirmed by the server. It will retry.');
  await recordApplied({ type: 'unpack', payload }, context).catch(() => {});
  return result as { id: string; code: string; status: string; items_released: number; units_released: number };
}

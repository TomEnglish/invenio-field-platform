import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { getCached, setCache } from '@/lib/sync/readCache';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { useAuthStore } from '@/stores/authStore';
import { findItemByTag, type CountOperationPayload, type InventoryItem } from '@/lib/inventory/count';
import type { InventoryCategory } from '@/lib/inventory/categories';
import { areaPathLabel, buildAreaTree, linkedLocation, type MapArea } from '@/lib/inventory/areas';

// Reference data for the Count tab. Everything is cached per user and project
// (lib/sync/readCache) and site-plan images are downloaded to the device, so
// counting works with no signal once the tab has loaded online.

export interface SiteMap {
  id: string;
  name: string;
  storage_path: string | null;
  image_width: number | null;
  image_height: number | null;
  updated_at: string | null;
  // The yard or site the plan draws (022); none on a plan not yet tied to a place.
  place_id?: string | null;
}
// An area on a site plan; areas nest through parent_id (migration 020).
export interface SiteMapZone extends MapArea {
  color: string | null;
}
export interface CountReference {
  categories: InventoryCategory[];
  maps: SiteMap[];
  zones: SiteMapZone[];
  items: InventoryItem[];
  // Map id → image on this device (or a short-lived signed URL on web).
  images: Record<string, string>;
  savedAt: string | null;
}


const KEYS = {
  categories: 'count_categories', maps: 'count_site_maps', zones: 'count_site_map_zones',
  images: 'count_site_map_images', savedAt: 'count_saved_at',
  // Tags are stored in chunks: one large AsyncStorage value cannot be read
  // back on Android (about 2 MB per row).
  itemChunks: 'count_item_chunks', itemChunk: (index: number) => `count_items_${index}`,
  // Counts saved on this device since the last download.
  localItems: 'count_items_local',
};
const PAGE = 1000;
const ITEM_CHUNK = 500;
const LOOKUP_TIMEOUT_MS = 5000;
const MAP_COLUMNS = 'id,name,storage_path,image_width,image_height,updated_at,is_active';
export const ITEM_COLUMNS = 'id,uid,qr_code,inventory_item,item_description,part_number,quantity,uom,condition,count_status,category_id,site_map_id,pin_x,pin_y,zone_id,location,counted_at';
export const EMPTY_REFERENCE: CountReference = { categories: [], maps: [], zones: [], items: [], images: {}, savedAt: null };
const NULL_FIELDS = {
  item_description: null, part_number: null, quantity: null, uom: null, condition: null, category_id: null,
  site_map_id: null, pin_x: null, pin_y: null, zone_id: null, location: null, counted_at: null,
};

// A weak signal can look online; tag lookups then fall back to the cache.
// A tag matched whatever its capitals (022: tags are unique per project,
// ignoring case): an ILIKE pattern that matches only this text.
export const likeExactly = (text: string) => text.replace(/[\\%_]/g, char => `\\${char}`);
// PostgREST reads * in a pattern as a wildcard, with no escape: a tag with
// one is matched exactly as written instead.
export const whereTag = <Q extends { ilike: (column: string, pattern: string) => Q; eq: (column: string, value: string) => Q }>(query: Q, column: string, tag: string): Q =>
  (tag.includes('*') ? query.eq(column, tag) : query.ilike(column, likeExactly(tag)));
export function withTimeout<T>(work: PromiseLike<T>, ms = LOOKUP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server took too long to answer.')), ms);
    Promise.resolve(work).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function contextGuard() {
  const { user, activeProject } = useAuthStore.getState();
  const userId = user?.id, projectId = activeProject?.id;
  return {
    projectId,
    current: () => !!projectId && useAuthStore.getState().user?.id === userId && useAuthStore.getState().activeProject?.id === projectId,
  };
}

// Every page of a table, in id order. Also used by the crate cache.
export type ProjectClient = Pick<ReturnType<typeof getProjectClient>, 'from'>;
export async function fetchAll<T>(client: ProjectClient, table: string, columns: string, filter: (query: any) => any = query => query): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(client.from(table).select(columns)).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

// Nulls are dropped when stored and restored when read, to keep chunks small.
const compact = (item: InventoryItem) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined));
const expand = (item: Partial<InventoryItem>) => ({ ...NULL_FIELDS, ...item }) as InventoryItem;

async function writeItems(items: InventoryItem[]) {
  const previous = (await getCached<number>(KEYS.itemChunks)) ?? 0;
  const chunks = Math.ceil(items.length / ITEM_CHUNK);
  for (let index = 0; index < Math.max(chunks, previous); index++) {
    await setCache(KEYS.itemChunk(index), index < chunks ? items.slice(index * ITEM_CHUNK, (index + 1) * ITEM_CHUNK).map(compact) : []);
  }
  await setCache(KEYS.itemChunks, chunks);
  await setCache(KEYS.localItems, []);
}

function mergeLocal(items: InventoryItem[], local: InventoryItem[]) {
  if (local.length === 0) return items;
  const byTag = new Map(local.map(item => [item.qr_code.trim(), item]));
  const merged = items.map(item => byTag.get(item.qr_code.trim()) ?? item);
  const known = new Set(items.map(item => item.qr_code.trim()));
  return [...merged, ...local.filter(item => !known.has(item.qr_code.trim()))];
}

async function readItems(): Promise<InventoryItem[]> {
  const chunks = (await getCached<number>(KEYS.itemChunks)) ?? 0;
  const parts = await Promise.all(Array.from({ length: chunks }, (_, index) => getCached<Partial<InventoryItem>[]>(KEYS.itemChunk(index))));
  const local = (await getCached<Partial<InventoryItem>[]>(KEYS.localItems)) ?? [];
  return mergeLocal(parts.flatMap(part => part ?? []).map(expand), local.map(expand));
}

const AREA_COLUMNS = 'id,map_id,parent_id,name,shape,color,sort_order,is_active,location_id';
// Before migration 020 (or after a rollback) the nesting columns don't exist;
// areas are then all top-level and in use.
const AREA_COLUMNS_BEFORE_020 = 'id,map_id,name,shape,color,sort_order,location_id';
const missingAreaColumns = (message: string) => /parent_id|is_active/.test(message) && /does not exist|42703|could not find/i.test(message);

// Zones saved by build 5 before migration 020 have no nesting fields.
const withAreaDefaults = (zone: Partial<SiteMapZone>) => ({ parent_id: null, is_active: true, location_id: null, ...zone }) as SiteMapZone;

export async function readCachedReference(): Promise<CountReference> {
  const [categories, maps, zones, items, images, savedAt] = await Promise.all([
    getCached<InventoryCategory[]>(KEYS.categories), getCached<SiteMap[]>(KEYS.maps), getCached<SiteMapZone[]>(KEYS.zones),
    readItems(), getCached<Record<string, string>>(KEYS.images), getCached<string>(KEYS.savedAt),
  ]);
  return {
    categories: categories ?? [], maps: maps ?? [], zones: (zones ?? []).map(withAreaDefaults), items,
    images: Platform.OS === 'web' ? {} : images ?? {}, savedAt: savedAt ?? null,
  };
}

function extension(path: string) {
  const match = /\.(png|jpe?g|webp)$/i.exec(path);
  return match ? match[1].toLowerCase() : 'png';
}

// Downloads the plan once per version (its updated_at) into document storage.
export async function ensureSiteMapImage(map: SiteMap, projectId: string): Promise<string | null> {
  if (!map.storage_path) return null;
  const signed = async () => {
    const { data, error } = await supabase.storage.from('site-plans').createSignedUrl(map.storage_path!, 60 * 60);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Site plan link unavailable');
    return data.signedUrl;
  };
  if (Platform.OS === 'web') return signed();
  const fs = await import('expo-file-system/legacy');
  if (!fs.documentDirectory) throw new Error('Document storage is unavailable.');
  const directory = `${fs.documentDirectory}site-plans/${projectId}/`;
  const version = (map.updated_at ?? '').replace(/[^0-9]/g, '') || '0';
  const target = `${directory}${map.id}-${version}.${extension(map.storage_path)}`;
  if ((await fs.getInfoAsync(target)).exists) return target;
  await fs.makeDirectoryAsync(directory, { intermediates: true });
  const partial = `${target}.${Date.now()}${Math.random().toString(36).slice(2, 8)}.download`;
  try {
    const result = await fs.downloadAsync(await signed(), partial);
    if (result.status !== 200) throw new Error(`Site plan download failed (${result.status})`);
    await fs.moveAsync({ from: partial, to: target });
  } finally {
    await fs.deleteAsync(partial, { idempotent: true }).catch(() => {});
  }
  // Older versions of this plan are no longer needed.
  for (const name of await fs.readDirectoryAsync(directory).catch(() => [] as string[])) {
    if (name.startsWith(`${map.id}-`) && !name.endsWith('.download') && `${directory}${name}` !== target) {
      await fs.deleteAsync(`${directory}${name}`, { idempotent: true }).catch(() => {});
    }
  }
  return target;
}

// Fetches categories, active site plans, zones and every tag for the active
// project, stores them, then downloads plan images. Image failures keep the
// previously downloaded copy. One client is used throughout, so every page
// comes from the project the refresh started in.
async function runRefresh(): Promise<CountReference> {
  const guard = contextGuard();
  if (!guard.projectId) throw new Error('Select a project first.');
  const client = getProjectClient();
  const [categories, maps, zones, items] = await Promise.all([
    fetchAll<InventoryCategory>(client, 'inventory_categories', 'id,parent_id,name,status,sort_order', query => query.neq('status', 'archived')),
    fetchAll<SiteMap & { is_active: boolean }>(client, 'site_maps', `${MAP_COLUMNS},place_id`, query => query.eq('is_active', true)).catch((error: Error) => {
      // Before 022 a plan has no place.
      if (!/place_id/.test(error.message)) throw error;
      return fetchAll<SiteMap & { is_active: boolean }>(client, 'site_maps', MAP_COLUMNS, query => query.eq('is_active', true));
    }),
    fetchAll<SiteMapZone>(client, 'site_map_zones', AREA_COLUMNS).catch((error: Error) => {
      if (!missingAreaColumns(error.message)) throw error;
      return fetchAll<Partial<SiteMapZone>>(client, 'site_map_zones', AREA_COLUMNS_BEFORE_020).then(rows => rows.map(withAreaDefaults));
    }),
    fetchAll<InventoryItem>(client, 'inventory_records', ITEM_COLUMNS),
  ]);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  const activeMaps = maps.map(({ is_active: _active, ...map }) => map);
  const mapIds = new Set(activeMaps.map(map => map.id));
  const activeZones = zones.filter(zone => mapIds.has(zone.map_id));
  const savedAt = new Date().toISOString();
  await Promise.all([setCache(KEYS.categories, categories), setCache(KEYS.maps, activeMaps), setCache(KEYS.zones, activeZones)]);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  await writeItems(items);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  await setCache(KEYS.savedAt, savedAt);
  const previous = (await getCached<Record<string, string>>(KEYS.images)) ?? {};
  const images: Record<string, string> = {};
  for (const map of activeMaps) {
    try {
      const uri = await ensureSiteMapImage(map, guard.projectId);
      if (uri) images[map.id] = uri;
    } catch {
      if (previous[map.id]) images[map.id] = previous[map.id];
    }
  }
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  if (Platform.OS !== 'web') await setCache(KEYS.images, images);
  return { categories, maps: activeMaps, zones: activeZones, items, images, savedAt };
}

// A refresh already running for the same account and project is shared.
let inflight: { key: string; promise: Promise<CountReference> } | null = null;
export function refreshCountReference(): Promise<CountReference> {
  const { user, activeProject } = useAuthStore.getState();
  const key = `${user?.id}:${activeProject?.id}`;
  if (inflight?.key === key) return inflight.promise;
  const promise = runRefresh().finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { key, promise };
  return promise;
}

// Online first, falling back to what this device saved last time.
export async function loadCountReference(): Promise<{ data: CountReference; source: 'online' | 'cache'; error?: string }> {
  if (useNetworkStore.getState().isOnline) {
    try {
      return { data: await refreshCountReference(), source: 'online' };
    } catch (error: any) {
      return { data: await readCachedReference(), source: 'cache', error: error?.message ?? 'Could not refresh' };
    }
  }
  return { data: await readCachedReference(), source: 'cache' };
}

// Tag lookup for Count and Scan. The server is authoritative when it answers
// in time; the cache answers offline (and for legacy tags stored with spaces).
export async function findInventoryByTag(tag: string): Promise<InventoryItem | null> {
  const wanted = tag.trim();
  if (!wanted) return null;
  if (useNetworkStore.getState().isOnline) {
    try {
      const { data, error } = await withTimeout<{ data: any[] | null; error: unknown }>(whereTag(getProjectClient().from('inventory_records').select(ITEM_COLUMNS), 'qr_code', wanted).limit(1));
      if (!error && data?.[0]) return data[0] as InventoryItem;
    } catch { /* Fall back to the cache below. */ }
  }
  return findItemByTag(await readItems(), wanted) ?? null;
}

// Where a counted item is, for the Scan → receiving hand-off: its full area
// path, and the rack location linked to that area or the nearest one above it.
// Uses the cached plan areas; asks the server for that plan's areas when the
// device has none for it, or only a build 5 copy (no nesting or rack links).
export async function countedAreaInfo(item: Pick<InventoryItem, 'zone_id' | 'site_map_id' | 'location'>): Promise<{ path: string | null; locationId: string | null; locationLabel: string | null }> {
  const fallback = { path: item.location?.trim() || null, locationId: null, locationLabel: null };
  if (!item.zone_id) return fallback;
  const cached = (await getCached<Partial<SiteMapZone>[]>(KEYS.zones)) ?? [];
  let flat = cached.some(zone => !('is_active' in zone));
  let zones = cached.map(withAreaDefaults);
  if ((flat || !zones.some(zone => zone.id === item.zone_id)) && item.site_map_id && useNetworkStore.getState().isOnline) {
    try {
      const read = (columns: string) => withTimeout<{ data: any[] | null; error: { message?: string } | null }>(
        getProjectClient().from('site_map_zones').select(columns).eq('map_id', item.site_map_id),
      );
      let { data, error } = await read(AREA_COLUMNS);
      if (error && missingAreaColumns(error.message ?? '')) ({ data, error } = await read(AREA_COLUMNS_BEFORE_020));
      if (!error && data) { zones = data.map(withAreaDefaults); flat = false; }
    } catch { /* Use what the device has. */ }
  }
  const tree = buildAreaTree(zones);
  if (!tree.byId.has(item.zone_id)) return fallback;
  // A build 5 copy knows only the area's own name; the server's stored path is fuller.
  if (flat) return { ...fallback, path: fallback.path ?? areaPathLabel(tree, item.zone_id) };
  const link = linkedLocation(tree, item.zone_id);
  // Labelled with the area that holds the rack link, which may be a parent.
  return { path: areaPathLabel(tree, item.zone_id), locationId: link?.locationId ?? null, locationLabel: link ? areaPathLabel(tree, link.owner.id) : null };
}

// Reflect a saved count in the cached tags straight away, so progress and the
// outstanding list are right offline. The next download replaces it.
export async function recordCountLocally(count: CountOperationPayload, zoneName: string | null): Promise<void> {
  const guard = contextGuard();
  const existing = findItemByTag(await readItems(), count.tag);
  if (existing?.count_status === 'received') return;
  const local = ((await getCached<Partial<InventoryItem>[]>(KEYS.localItems)) ?? []).map(expand);
  const updated: InventoryItem = {
    ...(existing ?? { id: -Date.now(), uid: '', qr_code: count.tag, ...NULL_FIELDS } as InventoryItem),
    inventory_item: count.name, quantity: count.quantity, uom: count.uom, condition: count.condition,
    category_id: count.categoryId ?? existing?.category_id ?? null, site_map_id: count.siteMapId,
    pin_x: count.pin?.x ?? null, pin_y: count.pin?.y ?? null, zone_id: count.zoneId,
    location: zoneName ?? existing?.location ?? null, count_status: 'counted', counted_at: new Date().toISOString(),
  };
  if (count.description) updated.item_description = count.description;
  if (count.partNumber) updated.part_number = count.partNumber;
  const next = [...local.filter(item => item.qr_code.trim() !== count.tag.trim()), updated];
  if (guard.current()) await setCache(KEYS.localItems, next.map(compact));
}

// A saved count that won't go through as it is (the server refused it, or it
// was discarded or reopened from Sync) no longer shows on this device: the tag
// is back to what the last download said, whatever its capitals.
export async function forgetLocalCount(tag: string): Promise<void> {
  const guard = contextGuard();
  const wanted = tag.trim().toLowerCase();
  const local = (await getCached<Partial<InventoryItem>[]>(KEYS.localItems)) ?? [];
  const kept = local.filter(item => (item.qr_code ?? '').trim().toLowerCase() !== wanted);
  if (kept.length !== local.length && guard.current()) await setCache(KEYS.localItems, kept);
}

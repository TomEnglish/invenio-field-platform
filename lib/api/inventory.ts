import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { getCached, setCache } from '@/lib/sync/readCache';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { useAuthStore } from '@/stores/authStore';
import { findItemByTag, type CountOperationPayload, type InventoryItem } from '@/lib/inventory/count';
import type { InventoryCategory } from '@/lib/inventory/categories';
import type { Polygon } from '@/lib/inventory/siteMap';

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
}
export interface SiteMapZone {
  id: string;
  map_id: string;
  name: string;
  shape: Polygon;
  color: string | null;
  sort_order: number;
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
  items: 'count_items', images: 'count_site_map_images', savedAt: 'count_saved_at',
};
const PAGE = 1000;
export const ITEM_COLUMNS = 'id,uid,qr_code,inventory_item,item_description,part_number,quantity,uom,condition,count_status,category_id,site_map_id,pin_x,pin_y,zone_id,location,counted_at';
export const EMPTY_REFERENCE: CountReference = { categories: [], maps: [], zones: [], items: [], images: {}, savedAt: null };

function contextGuard() {
  const { user, activeProject } = useAuthStore.getState();
  const userId = user?.id, projectId = activeProject?.id;
  return {
    projectId,
    current: () => !!projectId && useAuthStore.getState().user?.id === userId && useAuthStore.getState().activeProject?.id === projectId,
  };
}

async function fetchAll<T>(table: string, columns: string, filter: (query: any) => any = query => query): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(getProjectClient().from(table).select(columns)).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function readCachedReference(): Promise<CountReference> {
  const [categories, maps, zones, items, images, savedAt] = await Promise.all([
    getCached<InventoryCategory[]>(KEYS.categories), getCached<SiteMap[]>(KEYS.maps), getCached<SiteMapZone[]>(KEYS.zones),
    getCached<InventoryItem[]>(KEYS.items), getCached<Record<string, string>>(KEYS.images), getCached<string>(KEYS.savedAt),
  ]);
  return {
    categories: categories ?? [], maps: maps ?? [], zones: zones ?? [], items: items ?? [],
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
  const partial = `${target}.download`;
  try {
    const result = await fs.downloadAsync(await signed(), partial);
    if (result.status !== 200) throw new Error(`Site plan download failed (${result.status})`);
    await fs.moveAsync({ from: partial, to: target });
  } finally {
    await fs.deleteAsync(partial, { idempotent: true }).catch(() => {});
  }
  // Older versions of this plan are no longer needed.
  for (const name of await fs.readDirectoryAsync(directory).catch(() => [] as string[])) {
    if (name.startsWith(`${map.id}-`) && `${directory}${name}` !== target) await fs.deleteAsync(`${directory}${name}`, { idempotent: true }).catch(() => {});
  }
  return target;
}

// Fetches categories, active site plans, zones and every tag for the active
// project, stores them, then downloads plan images. Image failures keep the
// previously downloaded copy.
export async function refreshCountReference(): Promise<CountReference> {
  const guard = contextGuard();
  if (!guard.projectId) throw new Error('Select a project first.');
  const [categories, maps, zones, items] = await Promise.all([
    fetchAll<InventoryCategory>('inventory_categories', 'id,parent_id,name,status,sort_order', query => query.neq('status', 'archived')),
    fetchAll<SiteMap & { is_active: boolean }>('site_maps', 'id,name,storage_path,image_width,image_height,updated_at,is_active', query => query.eq('is_active', true)),
    fetchAll<SiteMapZone>('site_map_zones', 'id,map_id,name,shape,color,sort_order'),
    fetchAll<InventoryItem>('inventory_records', ITEM_COLUMNS),
  ]);
  if (!guard.current()) throw new Error('Project changed while loading. Pull to refresh.');
  const activeMaps = maps.map(({ is_active: _active, ...map }) => map);
  const mapIds = new Set(activeMaps.map(map => map.id));
  const activeZones = zones.filter(zone => mapIds.has(zone.map_id));
  const savedAt = new Date().toISOString();
  await Promise.all([
    setCache(KEYS.categories, categories), setCache(KEYS.maps, activeMaps), setCache(KEYS.zones, activeZones),
    setCache(KEYS.items, items), setCache(KEYS.savedAt, savedAt),
  ]);
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

// Tag lookup for Count and Scan. The server is authoritative when reachable;
// the cache answers offline (and for legacy tags stored with spaces).
export async function findInventoryByTag(tag: string): Promise<InventoryItem | null> {
  const wanted = tag.trim();
  if (!wanted) return null;
  if (useNetworkStore.getState().isOnline) {
    try {
      const { data, error } = await getProjectClient().from('inventory_records').select(ITEM_COLUMNS).eq('qr_code', wanted).limit(1);
      if (!error && data?.[0]) return data[0] as InventoryItem;
    } catch { /* Fall back to the cache below. */ }
  }
  return findItemByTag((await getCached<InventoryItem[]>(KEYS.items)) ?? [], wanted) ?? null;
}

export async function zoneNameFor(item: Pick<InventoryItem, 'zone_id' | 'location'>): Promise<string | null> {
  if (item.zone_id) {
    const zone = ((await getCached<SiteMapZone[]>(KEYS.zones)) ?? []).find(z => z.id === item.zone_id);
    if (zone) return zone.name;
  }
  return item.location?.trim() || null;
}

// Reflect a saved count in the cached tag list straight away, so progress and
// the outstanding list are right offline. The next refresh replaces it.
export async function recordCountLocally(count: CountOperationPayload, zoneName: string | null): Promise<void> {
  const guard = contextGuard();
  const items = (await getCached<InventoryItem[]>(KEYS.items)) ?? [];
  const counted_at = new Date().toISOString();
  const existing = findItemByTag(items, count.tag);
  if (existing?.count_status === 'received') return;
  const patch: Partial<InventoryItem> = {
    inventory_item: count.name, quantity: count.quantity, uom: count.uom, condition: count.condition,
    category_id: count.categoryId ?? existing?.category_id ?? null, site_map_id: count.siteMapId,
    pin_x: count.pin?.x ?? null, pin_y: count.pin?.y ?? null, zone_id: count.zoneId,
    location: zoneName ?? existing?.location ?? null, count_status: 'counted', counted_at,
  };
  if (count.description) patch.item_description = count.description;
  if (count.partNumber) patch.part_number = count.partNumber;
  const next = existing
    ? items.map(item => (item === existing ? { ...item, ...patch } : item))
    : [...items, { id: -Date.now(), uid: '', qr_code: count.tag, item_description: null, part_number: null, ...patch } as InventoryItem];
  if (guard.current()) await setCache(KEYS.items, next);
}

import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { withTimeout } from './inventory';
import type { ItemPosition, TagLookup } from '@/lib/logistics/positions';

// Tags and where things are (migration 022): lookup_tag for a scanned code,
// item_positions for where an item is now. A tag is unique per project,
// whatever its capitals, so both match it that way. Each answers null when
// offline, too slow or before 022, and callers fall back to what they did before.

const before022 = (error: { code?: string; message?: string } | null) => !!error && (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || /lookup_tag|item_positions|does not exist|schema cache/i.test(error.message ?? ''));

export async function lookupTag(code: string): Promise<TagLookup | null> {
  const projectId = useAuthStore.getState().activeProject?.id;
  if (!projectId || !code.trim() || !useNetworkStore.getState().isOnline) return null;
  try {
    const { data, error } = await withTimeout<{ data: TagLookup | null; error: { code?: string; message?: string } | null }>(supabase.rpc('lookup_tag', { p_project_id: projectId, p_code: code.trim() }));
    if (error) {
      if (before022(error)) return null;
      throw Object.assign(new Error(error.message ?? 'Lookup failed'), { code: error.code });
    }
    return data ?? null;
  } catch (error: any) {
    // A refusal (a tag too long, a project not this user's) is an answer; anything else falls back.
    if (error?.code === '22023' || error?.code === '42501') throw error;
    return null;
  }
}

export const POSITION_COLUMNS = 'item_kind,material_id,inventory_uid,tag,name,status,is_high_value,hold,crate_code,top_crate_code,load_id,load_number,line_status,position,place_id,place_name,place_kind,area,location_id,location_note';
// Where these materials are now, by material ID (for Inventory and the material page).
export async function positionsOfMaterials(ids: string[]): Promise<Map<string, ItemPosition>> {
  const found = new Map<string, ItemPosition>();
  if (!ids.length || !useNetworkStore.getState().isOnline) return found;
  try {
    const { data, error } = await withTimeout<{ data: ItemPosition[] | null; error: { code?: string; message?: string } | null }>(
      getProjectClient().from('item_positions').select(POSITION_COLUMNS).in('material_id', ids));
    if (error) return found;
    for (const row of data ?? []) if (row.material_id) found.set(row.material_id, row);
  } catch { /* Shown without positions. */ }
  return found;
}

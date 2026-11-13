import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { shortDate, shortTime } from '@/lib/inventory/count';
import { withTimeout } from './inventory';

// The photos stored for an item: those taken when it was received (014's
// inspection_photos) and, when it was counted before that, those from the count
// (019's inventory_photos). Both storage areas are private, so each photo is
// shown through a link that stops working after an hour.
export const PHOTO_LINK_SECONDS = 60 * 60;
// The device keeps what it last found for each item, so reopening the item (or
// the screen reloading after an action) shows those photos at once, offline
// too, while the server is asked again for anything new. A link is used again
// for a little less than its hour, so photos already shown don't download again.
export const PHOTO_KEEP_MS = 50 * 60 * 1000;
const KEPT_ITEMS = 40;
const TYPE_LABELS: Record<string, string> = { general: 'General', damage: 'Damage', delivery_ticket: 'Delivery ticket' };

type Bucket = 'inspection-photos' | 'inventory-photos';
type PhotoRef = { bucket: Bucket; path: string; label: string; short: string; takenAt: string | null };
type Answer<T> = { data: T | null; error: { message?: string } | null };

// label: "Receiving photo: Damage" or "Count photo"; short: "Damage" or "Count", under each thumbnail.
// signedAt: when its link was given, in milliseconds.
export interface ItemPhoto { id: string; uri: string; label: string; short: string; takenAt: string | null; signedAt: number }
// missing: photos the server lists but could not give a link for.
export interface ItemPhotos { photos: ItemPhoto[]; missing: number }

/** "Oct 27, 2026, 2:05 PM", on the device's clock. */
export function photoTakenText(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${shortDate(iso)}, ${date.getFullYear()}, ${shortTime(iso)}`;
}

// Oldest first by the moment taken; a photo with no time goes last.
const taken = (iso: string | null) => { const at = iso ? Date.parse(iso) : NaN; return Number.isNaN(at) ? Infinity : at; };
const byTaken = (a: { takenAt: string | null }, b: { takenAt: string | null }) => { const x = taken(a.takenAt), y = taken(b.takenAt); return x === y ? 0 : x < y ? -1 : 1; };

const kept = new Map<string, ItemPhotos>();
// What was found is kept per account and project, so it is never shown to anyone else.
function keyFor(receivingRecordId: string) {
  const { user, activeProject } = useAuthStore.getState();
  return `${user?.id ?? ''}:${activeProject?.id ?? ''}:${receivingRecordId}`;
}

/** The photos last found for this receipt on this device, for this account and project, or null. */
export function keptItemPhotos(receivingRecordId: string | null | undefined): ItemPhotos | null {
  if (!receivingRecordId) return null;
  return kept.get(keyFor(receivingRecordId)) ?? null;
}

const failed = (error: { message?: string } | null) => new Error(error?.message || 'Photos could not be loaded.');

/**
 * The photos for the item received as this receipt, oldest first: null when the
 * phone is offline, and empty when there is no receipt or no photo. Throws when
 * the server can't answer, so the screen can offer to try again. A photo already
 * found keeps its link while it is fresh, unless it is named in `resign` (its
 * image failed to load), so only new or failed photos download again.
 */
export async function fetchItemPhotos(receivingRecordId: string | null | undefined, { resign = [] }: { resign?: string[] } = {}): Promise<ItemPhotos | null> {
  if (!receivingRecordId) return { photos: [], missing: 0 };
  if (!useNetworkStore.getState().isOnline) return null;
  const key = keyFor(receivingRecordId);
  const project = getProjectClient();
  const [receipt, counted] = await Promise.all([
    withTimeout<Answer<{ storage_path: string; photo_type: string; created_at: string | null }[]>>(
      supabase.from('inspection_photos').select('storage_path,photo_type,created_at').eq('receiving_record_id', receivingRecordId).order('created_at', { ascending: true })),
    withTimeout<Answer<{ uid: string }[]>>(project.from('inventory_records').select('uid').eq('receiving_record_id', receivingRecordId)),
  ]);
  if (receipt.error) throw failed(receipt.error);
  if (counted.error) throw failed(counted.error);
  const uids = (counted.data ?? []).map(row => row.uid).filter(Boolean);
  let countRows: { storage_path: string; created_at: string | null }[] = [];
  if (uids.length) {
    const answer = await withTimeout<Answer<{ storage_path: string; created_at: string | null }[]>>(
      project.from('inventory_photos').select('storage_path,created_at').in('inventory_uid', uids).order('created_at', { ascending: true }));
    if (answer.error) throw failed(answer.error);
    countRows = answer.data ?? [];
  }
  const listed: PhotoRef[] = [
    ...(receipt.data ?? []).map(row => {
      const type = TYPE_LABELS[row.photo_type] ?? 'Photo';
      return { bucket: 'inspection-photos' as const, path: row.storage_path, label: `Receiving photo: ${type}`, short: type, takenAt: row.created_at };
    }),
    ...countRows.map(row => ({ bucket: 'inventory-photos' as const, path: row.storage_path, label: 'Count photo', short: 'Count', takenAt: row.created_at })),
  ].sort(byTaken);
  const reusable = new Map<string, ItemPhoto>();
  for (const photo of kept.get(key)?.photos ?? []) {
    if (!resign.includes(photo.id) && Date.now() - photo.signedAt < PHOTO_KEEP_MS) reusable.set(photo.id, photo);
  }
  const found = await signPhotos(listed, reusable);
  // An answer that arrives after the account or project changed is not kept for the new one.
  if (keyFor(receivingRecordId) === key) {
    kept.delete(key);
    kept.set(key, found);
    while (kept.size > KEPT_ITEMS) kept.delete(kept.keys().next().value as string);
  }
  return found;
}

// Links for every photo not already linked, one request per storage area, matched
// back by path. A listed photo with no path or no link is counted as one that
// could not be opened.
async function signPhotos(listed: PhotoRef[], reusable: Map<string, ItemPhoto>): Promise<ItemPhotos> {
  const refs = listed.filter(ref => !!ref.path);
  const links = new Map<string, { uri: string; signedAt: number }>();
  for (const [id, photo] of reusable) links.set(id, { uri: photo.uri, signedAt: photo.signedAt });
  for (const bucket of ['inspection-photos', 'inventory-photos'] as const) {
    const paths = [...new Set(refs.filter(ref => ref.bucket === bucket && !links.has(`${bucket}/${ref.path}`)).map(ref => ref.path))];
    if (!paths.length) continue;
    const { data, error } = await withTimeout<Answer<{ path: string | null; signedUrl: string | null; error: string | null }[]>>(
      supabase.storage.from(bucket).createSignedUrls(paths, PHOTO_LINK_SECONDS));
    if (error) throw failed(error);
    const signedAt = Date.now();
    for (const entry of data ?? []) if (entry?.path && entry.signedUrl && !entry.error) links.set(`${bucket}/${entry.path}`, { uri: entry.signedUrl, signedAt });
  }
  const photos = refs.flatMap(ref => {
    const link = links.get(`${ref.bucket}/${ref.path}`);
    return link ? [{ id: `${ref.bucket}/${ref.path}`, uri: link.uri, label: ref.label, short: ref.short, takenAt: ref.takenAt, signedAt: link.signedAt }] : [];
  });
  return { photos, missing: listed.length - photos.length };
}

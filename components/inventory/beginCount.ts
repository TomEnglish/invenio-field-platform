import { useAuthStore } from '@/stores/authStore';
import { useCountStore } from '@/stores/countStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { findInventoryByTag, withTimeout, type CountReference } from '@/lib/api/inventory';
import { lookupMaterialByQR } from '@/lib/api/qrcodes';
import { lookupTag } from '@/lib/api/tags';
import { readCachedLoad } from '@/lib/api/logistics';
import { copyCountIssue, countIssue } from '@/lib/logistics/positions';
import { EMPTY_LOAD, indexLoad, looksLikeCrate } from '@/lib/logistics/crates';
import { countStartPrefill, findItemByTag } from '@/lib/inventory/count';
import { locationRule, retiredLocation } from '@/lib/inventory/areas';

// Looks up a scanned (or picked) tag and starts its count. Tags that were
// already received are refused: a count could never link to that receipt.
// So are crate labels, and (022) items packed in a crate, on a truck or
// written off: the server says so through lookup_tag when it answers.
export async function beginCount(code: string, reference: CountReference): Promise<{ started: boolean; message?: string }> {
  const tag = code.trim();
  if (!tag) return { started: false, message: 'The tag was empty. Scan it again.' };
  if (tag.length > 120) return { started: false, message: 'That code is too long to be a tag. Check the label and scan again.' };
  if (looksLikeCrate(tag)) return { started: false, message: 'HU- codes are crate labels; count the items inside the crate.' };
  const { user, activeProject } = useAuthStore.getState();
  const online = useNetworkStore.getState().isOnline;
  const [found, material, server] = await Promise.all([
    findInventoryByTag(tag).catch(() => findItemByTag(reference.items, tag) ?? null),
    // Receipts made before counting began have no inventory row; only the server knows them.
    online ? withTimeout(lookupMaterialByQR(tag)).catch(() => null) : Promise.resolve(null),
    online ? lookupTag(tag).catch(() => null) : Promise.resolve(null),
  ]);
  const now = useAuthStore.getState();
  if (now.user?.id !== user?.id || now.activeProject?.id !== activeProject?.id) return { started: false, message: 'Account or project changed. Scan the tag again.' };
  // Without the server's answer, the device's copy of crates and loads.
  const refused = server ? countIssue(server) : copyCountIssue(indexLoad(await readCachedLoad().catch(() => null) ?? EMPTY_LOAD), tag);
  if (refused) return { started: false, message: refused };
  if (found?.count_status === 'received' || material) {
    return { started: false, message: `Tag ${tag} has already been received, so it doesn't need counting. Scan another tag.` };
  }
  const prefill = countStartPrefill(found, reference.categories, reference.zones);
  // A location is carried into the new count unless the office has retired
  // its plan or area: the record's own, else the one kept from the last count.
  // One missing from the device's copy may be newer than it, so it is kept.
  const rule = locationRule(reference.maps, reference.zones, !!reference.savedAt);
  const kept = useCountStore.getState().location;
  const location = prefill.location && !retiredLocation(prefill.location, rule) ? prefill.location
    : !retiredLocation(kept, rule) ? null
    : { siteMapId: null, pin: null, zoneId: null, zoneName: '' };
  // A tag already counted keeps the spelling it was counted with.
  useCountStore.getState().start(found?.qr_code?.trim() || tag, { ...prefill, location });
  return { started: true };
}

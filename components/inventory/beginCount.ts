import { useAuthStore } from '@/stores/authStore';
import { useCountStore } from '@/stores/countStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { findInventoryByTag, withTimeout, type CountReference } from '@/lib/api/inventory';
import { lookupMaterialByQR } from '@/lib/api/qrcodes';
import { countStartPrefill, findItemByTag } from '@/lib/inventory/count';

// Looks up a scanned (or picked) tag and starts its count. Tags that were
// already received are refused: a count could never link to that receipt.
export async function beginCount(code: string, reference: CountReference): Promise<{ started: boolean; message?: string }> {
  const tag = code.trim();
  if (!tag) return { started: false, message: 'The tag was empty. Scan it again.' };
  if (tag.length > 120) return { started: false, message: 'That code is too long to be a tag. Check the label and scan again.' };
  const { user, activeProject } = useAuthStore.getState();
  const [found, material] = await Promise.all([
    findInventoryByTag(tag).catch(() => findItemByTag(reference.items, tag) ?? null),
    // Receipts made before counting began have no inventory row; only the server knows them.
    useNetworkStore.getState().isOnline ? withTimeout(lookupMaterialByQR(tag)).catch(() => null) : Promise.resolve(null),
  ]);
  const now = useAuthStore.getState();
  if (now.user?.id !== user?.id || now.activeProject?.id !== activeProject?.id) return { started: false, message: 'Account or project changed. Scan the tag again.' };
  if (found?.count_status === 'received' || material) {
    return { started: false, message: `Tag ${tag} has already been received, so it doesn't need counting. Scan another tag.` };
  }
  useCountStore.getState().start(tag, countStartPrefill(found, reference.categories, reference.zones));
  return { started: true };
}

import { addToQueue, type QueueAction } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { newOperationId } from '@/lib/utils/operationId';
import type { LoadOperation } from '@/lib/logistics/loads';

// Queues one load operation (sent unchanged as `op`) and starts an upload
// when online. `label` names the load in Sync: its number, or "New load".
export async function saveLoadChange(type: LoadOperation, op: object, label: string, operationId = newOperationId(), extra: { zoneName?: string } = {}) {
  await addToQueue({ type, payload: { op, label, ...extra } } as QueueAction, operationId);
  if (useNetworkStore.getState().isOnline) void processQueue().catch(() => {});
  return operationId;
}

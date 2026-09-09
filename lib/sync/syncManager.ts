import { useAuthStore } from '@/stores/authStore';
import { getQueue, removeFromQueue, markFailed, belongsToCurrentContext, type QueueItem } from './offlineQueue';
import { submitReceivingRecord } from '../api/receiving';
import { transferMaterial, issueMaterial } from '../api/materials';
import { createShipment } from '../api/shipments';
import { useNetworkStore } from './networkStore';

let syncing = false;

export async function processQueue(): Promise<{ processed: number; failed: number }> {
  if (syncing) return { processed: 0, failed: 0 };
  syncing = true;

  let processed = 0;
  let failed = 0;

  try {
    const queue = await getQueue();
    for (const item of queue) {
      // Skip dead-lettered items
      if (item.deadLetter || !belongsToCurrentContext(item) || !useNetworkStore.getState().isOnline) continue;

      try {
        await processItem(item);
        await removeFromQueue(item.id);
        processed++;
      } catch (e: any) {
        await markFailed(item.id, e?.message ?? 'Unknown error');
        failed++;
        // Continue processing remaining items instead of stopping
      }
    }
  } finally {
    syncing = false;
  }



  return { processed, failed };
}

async function processItem(item: QueueItem): Promise<void> {
  const { action } = item;
  const context = { operationId: item.id, userId: item.userId!, projectId: item.projectId! };

  switch (action.type) {
    case 'receiving': {
      const r = action.payload;
      await submitReceivingRecord({
        qrCodeValue: r.qrCodeValue,
        context,
        material: r.material,
        po: r.po,
        inspection: r.inspection,
        photos: r.photos,
        location: r.location,
        decision: r.decision,
        userId: r.userId,
      });
      break;
    }
    case 'transfer': {
      const t = action.payload;
      await transferMaterial(t.materialId, t.fromLocationId, t.toLocationId, t.movedBy, t.reason, context);
      break;
    }
    case 'issue': {
      const i = action.payload;
      await issueMaterial(i.materialId, i.jobNumber, i.quantity, i.issuedBy, i.workOrder, context);
      break;
    }
    case 'shipment': {
      const s = action.payload;
      await createShipment(s.materialId, s.destination, s.quantity, s.carrier, s.trackingNumber, s.shippedBy, context);
      break;
    }
  }
}

// Subscribe to network changes and auto-sync when coming back online
export function startAutoSync() {
  const network = useNetworkStore.subscribe((state, prev) => {
    if (state.isOnline && !prev.isOnline) {
      // Just came back online — process the queue
      void processQueue().catch(() => {});
    }
  });
  const account = useAuthStore.subscribe((state, prev) => {
    if (state.user && state.activeProject && state.session && useNetworkStore.getState().isOnline &&
      (state.user.id !== prev.user?.id || state.activeProject.id !== prev.activeProject?.id)) void processQueue().catch(() => {});
  });
  return () => { network(); account(); };
}

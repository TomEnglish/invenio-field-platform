import { useAuthStore } from '@/stores/authStore';
import { getQueue, removeFromQueue, markFailed, belongsToCurrentContext, type QueueItem } from './offlineQueue';
import { submitReceivingRecord } from '../api/receiving';
import { transferMaterial, issueMaterial } from '../api/materials';
import { createShipment } from '../api/shipments';
import { useNetworkStore } from './networkStore';

let activeRun: Promise<{ processed: number; failed: number }> | null = null;
let requested = false;
function canSync(item: QueueItem) {
  const access = useAuthStore.getState();
  return belongsToCurrentContext(item) && access.activeProject?.status === 'active'
    && !access.loading && access.accessMode === 'online' && useNetworkStore.getState().isOnline;
}
export function processQueue(): Promise<{ processed: number; failed: number }> {
  requested = true;
  if (activeRun) return activeRun;
  const run = async () => {
    let processed = 0, failed = 0;
    // A concurrent caller may have saved work after the current snapshot was read.
    // Re-read for those submissions, but never retry the same failure in this run.
    const attempted = new Set<string>();
    do {
      requested = false;
      const queue = await getQueue();
      for (const item of queue) {
        if (item.deadLetter || attempted.has(item.id) || !canSync(item)) continue;
        attempted.add(item.id);
        try {
          await processItem(item);
          await removeFromQueue(item.id);
          processed++;
        } catch (error: any) {
          // Waiting for connectivity or the original context is not a failed try.
          if (canSync(item)) { await markFailed(item.id, error?.message ?? 'Unknown error'); failed++; }
        }
      }
    } while (requested);
    return { processed, failed };
  };
  activeRun = run().finally(() => { activeRun = null; });
  return activeRun;
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
    default:
      throw new Error('Unsupported saved submission type. Ask your administrator to review this device.');
  }
}

// Subscribe to network changes and auto-sync when coming back online
export function startAutoSync() {
  const resume = () => {
    const access = useAuthStore.getState();
    if (!access.user || !access.session || access.loading || !useNetworkStore.getState().isOnline) return;
    if (access.accessMode === 'online') void processQueue().catch(() => {});
  };
  const network = useNetworkStore.subscribe((state, prev) => {
    if (state.isOnline && !prev.isOnline) {
      const access = useAuthStore.getState();
      // Revalidate memberships after an offline interval before replaying work.
      if (access.user && !access.loading) void access.loadSession().catch(() => {});
    }
  });
  const account = useAuthStore.subscribe((state, prev) => {
    if (state.user?.id !== prev.user?.id || state.activeProject?.id !== prev.activeProject?.id
        || state.accessMode !== prev.accessMode || (prev.loading && !state.loading)) resume();
  });
  resume();
  return () => { network(); account(); };
}

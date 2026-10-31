import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/stores/authStore';
import { newOperationId } from '@/lib/utils/operationId';
import type { CountOperationPayload, CountPhoto } from '@/lib/inventory/count';
import type { PackQueuePayload, UnpackOperationPayload } from '@/lib/logistics/crates';
import type { LicencePayload, LoadDepartPayload, LoadOffPayload, LoadOnPayload, LoadQueuePayload, LoadSavePayload, StopCompletePayload } from '@/lib/logistics/loads';

const QUEUE_KEY = 'offline_queue';
const MAX_RETRIES = 5;
const listeners = new Set<() => void>();
export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type QueueAction =
  | { type: 'receiving'; payload: any }
  | { type: 'transfer'; payload: { materialId: string; fromLocationId: string | null; toLocationId: string; movedBy: string; reason: string } }
  | { type: 'issue'; payload: { materialId: string; jobNumber: string; quantity: number; issuedBy: string; workOrder?: string } }
  | { type: 'shipment'; payload: { materialId: string; destination: string; quantity: number; carrier?: string; trackingNumber?: string; shippedBy?: string } }
  // `count` is sent to the server unchanged; the labels are only for Sync.
  | { type: 'count'; payload: { count: CountOperationPayload; photos: CountPhoto[]; categoryLabel?: string; zoneName?: string } }
  // One whole pack session, and an unpack, as `apply_field_operation` takes them.
  | { type: 'pack'; payload: PackQueuePayload }
  | { type: 'unpack'; payload: UnpackOperationPayload }
  // Loads (022): each sent to apply_field_operation as `op`.
  | { type: 'load_save'; payload: LoadQueuePayload<LoadSavePayload> }
  | { type: 'load_on'; payload: LoadQueuePayload<LoadOnPayload> }
  | { type: 'load_depart'; payload: LoadQueuePayload<LoadDepartPayload> }
  | { type: 'load_off'; payload: LoadQueuePayload<LoadOffPayload> }
  | { type: 'stop_complete'; payload: LoadQueuePayload<StopCompletePayload> }
  // A driver's licence: recorded outside apply_field_operation, then photos.
  | { type: 'licence'; payload: LicencePayload };

export interface QueueItem {
  id: string;
  userId?: string;
  projectId?: string;
  action: QueueAction;
  createdAt: string;
  retryCount?: number;
  lastError?: string;
  // The server's SQLSTATE (or an app code) for lastError.
  lastErrorCode?: string;
  // Refused: retrying unchanged can't help, so it waits for the crew to retry
  // after sorting it out, fix it or discard it. Not retried automatically.
  refused?: boolean;
  deadLetter?: boolean;
}
// Codes that mean "refused, needs a decision": the server's 22023, and the
// app's own for a licence whose number or photos are no longer on the device.
export const DECISION_CODES = new Set(['22023', 'LICENCE_FORGOTTEN', 'PHOTO_GONE']);

export async function getQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Serialize read/modify/write operations to avoid losing concurrently queued work.
let mutation: Promise<unknown> = Promise.resolve();
function mutate(change: (queue: QueueItem[]) => void) {
  const next = mutation.then(async () => {
    const queue = await getQueue();
    change(queue);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    for (const listener of listeners) { try { listener(); } catch { /* UI observers cannot undo persistence. */ } }
  });
  mutation = next.catch(() => {});
  return next;
}
export function belongsToCurrentContext(item: QueueItem): boolean {
  const { user, activeProject, session } = useAuthStore.getState();
  return !!session && !!user && !!activeProject && item.userId === user.id && item.projectId === activeProject.id;
}
// `before`: put the item ahead of the first queued item it matches (a licence
// goes ahead of its load's departure, which needs it).
export async function addToQueue(action: QueueAction, id = newOperationId(), before?: (item: QueueItem) => boolean): Promise<string> {
  const { user, activeProject, session, loading } = useAuthStore.getState();
  if (loading || !user || !activeProject || !session || activeProject.status !== 'active') throw new Error('An authenticated user and active project are required.');
  const item: QueueItem = { id, userId: user.id, projectId: activeProject.id, action, createdAt: new Date().toISOString(), retryCount: 0, deadLetter: false };
  await mutate((queue) => {
    const old = queue.find((i) => i.id === id);
    if (old) {
      if (old.userId !== item.userId || old.projectId !== item.projectId || JSON.stringify(old.action) !== JSON.stringify(action)) throw new Error('This submission is already queued. Review it in Sync before starting another.');
    } else {
      const at = before ? queue.findIndex(before) : -1;
      if (at >= 0) queue.splice(at, 0, item); else queue.push(item);
    }
  });
  return id;
}
// Rewrites a saved submission in place, e.g. to drop a licence number once
// the server has it. The item keeps its place, ID and retry state.
export async function replaceQueuedAction(id: string, action: QueueAction): Promise<void> {
  await mutate((queue) => { const item = queue.find((i) => i.id === id); if (item) item.action = action; });
}
export async function removeFromQueue(id: string): Promise<void> {
  await mutate((queue) => { const at = queue.findIndex((item) => item.id === id); if (at >= 0) queue.splice(at, 1); });
}
export async function markFailed(id: string, error: string, code?: string): Promise<void> {
  await mutate((queue) => {
    const item = queue.find((i) => i.id === id);
    if (!item) return;
    item.lastError = error;
    item.lastErrorCode = code;
    item.refused = !!code && DECISION_CODES.has(code);
    // A refusal isn't a failed try: it waits for a decision instead.
    if (item.refused) return;
    item.retryCount = (item.retryCount ?? 0) + 1;
    item.deadLetter = item.retryCount >= MAX_RETRIES;
  });
}
export async function retryQueueItem(id: string): Promise<void> {
  await mutate((queue) => {
    const item = queue.find((i) => i.id === id && belongsToCurrentContext(i));
    if (!item) throw new Error('Switch to the original account and project to retry.');
    item.deadLetter = false; item.retryCount = 0; item.lastError = undefined; item.lastErrorCode = undefined; item.refused = false;
  });
}
export async function getQueueStats(): Promise<{ pending: number; deadLetters: number }> {
  const queue = (await getQueue()).filter(belongsToCurrentContext);
  return { pending: queue.filter(i => !i.deadLetter && !i.refused).length, deadLetters: queue.filter(i => i.deadLetter || i.refused).length };
}
export async function getQueueLength(): Promise<number> { return (await getQueueStats()).pending; }

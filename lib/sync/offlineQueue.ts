import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/stores/authStore';
import { newOperationId } from '@/lib/utils/operationId';

const QUEUE_KEY = 'offline_queue';
const MAX_RETRIES = 5;

export type QueueAction =
  | { type: 'receiving'; payload: any }
  | { type: 'transfer'; payload: { materialId: string; fromLocationId: string | null; toLocationId: string; movedBy: string; reason: string } }
  | { type: 'issue'; payload: { materialId: string; jobNumber: string; quantity: number; issuedBy: string; workOrder?: string } }
  | { type: 'shipment'; payload: { materialId: string; destination: string; quantity: number; carrier?: string; trackingNumber?: string; shippedBy?: string } };

export interface QueueItem {
  id: string;
  userId?: string;
  projectId?: string;
  action: QueueAction;
  createdAt: string;
  retryCount?: number;
  lastError?: string;
  deadLetter?: boolean;
}

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
  });
  mutation = next.catch(() => {});
  return next;
}
export function belongsToCurrentContext(item: QueueItem): boolean {
  const { user, activeProject, session } = useAuthStore.getState();
  return !!session && !!user && !!activeProject && item.userId === user.id && item.projectId === activeProject.id;
}
export async function addToQueue(action: QueueAction, id = newOperationId()): Promise<string> {
  const { user, activeProject, session } = useAuthStore.getState();
  if (!user || !activeProject || !session || activeProject.status !== 'active') throw new Error('An authenticated user and active project are required.');
  const item: QueueItem = { id, userId: user.id, projectId: activeProject.id, action, createdAt: new Date().toISOString(), retryCount: 0, deadLetter: false };
  await mutate((queue) => {
    const old = queue.find((i) => i.id === id);
    if (old) {
      if (old.userId !== item.userId || old.projectId !== item.projectId || JSON.stringify(old.action) !== JSON.stringify(action)) throw new Error('This submission is already queued. Review it in Sync before starting another.');
    } else queue.push(item);
  });
  return id;
}
export async function removeFromQueue(id: string): Promise<void> {
  await mutate((queue) => { const at = queue.findIndex((item) => item.id === id); if (at >= 0) queue.splice(at, 1); });
}
export async function markFailed(id: string, error: string): Promise<void> {
  await mutate((queue) => {
    const item = queue.find((i) => i.id === id);
    if (!item) return;
    item.retryCount = (item.retryCount ?? 0) + 1;
    item.lastError = error;
    item.deadLetter = item.retryCount >= MAX_RETRIES;
  });
}
export async function retryQueueItem(id: string): Promise<void> {
  await mutate((queue) => {
    const item = queue.find((i) => i.id === id && belongsToCurrentContext(i));
    if (!item) throw new Error('Switch to the original account and project to retry.');
    item.deadLetter = false; item.retryCount = 0; item.lastError = undefined;
  });
}
export async function getQueueStats(): Promise<{ pending: number; deadLetters: number }> {
  const queue = (await getQueue()).filter(belongsToCurrentContext);
  return { pending: queue.filter(i => !i.deadLetter).length, deadLetters: queue.filter(i => i.deadLetter).length };
}
export async function getQueueLength(): Promise<number> { return (await getQueueStats()).pending; }

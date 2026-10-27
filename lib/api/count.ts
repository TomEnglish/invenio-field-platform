import { supabase } from '@/lib/supabase';
import { applyOperation, operationContext, type OperationContext } from './operations';
import type { CountOperationPayload, CountPhoto } from '@/lib/inventory/count';

// Saves one count through apply_field_operation, then uploads its photos under
// the item's uid. Mirrors lib/api/receiving.ts: replaying the same operation
// returns the same uid, so a retry only finishes the photos.
export async function submitCount(input: { count: CountOperationPayload; photos: CountPhoto[]; context: OperationContext }) {
  const { count, photos, context } = input;
  const record = await applyOperation('count', count, context);
  if (!record?.uid) throw new Error('The count was not confirmed by the server. It will retry.');
  const assertContext = () => {
    const active = operationContext(context.operationId);
    if (active.userId !== context.userId || active.projectId !== context.projectId) throw new Error('Return to the original account and project to finish photo uploads.');
  };
  for (const [index, photo] of photos.entries()) {
    assertContext();
    const path = `${record.uid}/${context.operationId}-${index}.jpg`;
    let bytes: ArrayBuffer;
    if (photo.uri.startsWith('file:')) {
      const { File } = await import('expo-file-system');
      bytes = await new File(photo.uri).arrayBuffer();
    } else bytes = await (await fetch(photo.uri)).arrayBuffer();
    assertContext();
    const { error } = await supabase.storage.from('inventory-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Count saved; photo upload will retry: ${error.message}`);
    assertContext();
    const { error: referenceError } = await supabase.rpc('attach_inventory_photo', { p_inventory_uid: record.uid, p_path: path });
    if (referenceError) throw new Error(`Photo reference will retry: ${referenceError.message}`);
  }
  return record as { uid: string; id: number; created: boolean; category_id: string | null; count_status: 'counted' };
}

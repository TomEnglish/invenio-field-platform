import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { replaceQueuedAction } from '@/lib/sync/offlineQueue';
import { operationContext, type OperationContext } from './operations';
import type { LicencePayload } from '@/lib/logistics/loads';

// The driver's licence (migration 022), outside apply_field_operation so the
// number never lands in field_operations. Field staff can't read the number
// or the photos back, so nothing here ever reads them.
//
// 1. record_driver_licence with the queued item's ID as the operation ID; a
//    repeat returns the first answer. The number is then dropped from the
//    queued item straight away, so a photo retry keeps only the photos.
// 2. Each photo goes to driver-licences/<load>/<operation>-<n>.jpg without
//    upsert (upserting needs read access); "already exists" on a retry means
//    the earlier upload landed. Then attach_driver_licence_photo.
// 3. Once every photo is attached, the files on this device are deleted.
export async function submitLicence(payload: LicencePayload, context: OperationContext) {
  const assertContext = () => {
    const active = operationContext(context.operationId);
    if (active.userId !== context.userId || active.projectId !== context.projectId) throw new Error('Return to the original account and project to finish the licence upload.');
  };
  let current = payload;
  if (current.licence) {
    assertContext();
    const { data, error } = await supabase.rpc('record_driver_licence', { p_operation_id: context.operationId, p_load_id: current.loadId, p_licence: current.licence });
    if (error) throw new Error(error.message);
    if (!data?.recorded) throw new Error('The licence was not confirmed by the server. It will retry.');
    current = { ...current, licence: null, recorded: true };
    await replaceQueuedAction(context.operationId, { type: 'licence', payload: current });
  }
  for (const [index, photo] of current.photos.entries()) {
    assertContext();
    const path = `${current.loadId}/${context.operationId}-${index}.jpg`;
    let bytes: ArrayBuffer;
    if (photo.uri.startsWith('file:')) {
      const { File } = await import('expo-file-system');
      bytes = await new File(photo.uri).arrayBuffer();
    } else bytes = await (await fetch(photo.uri)).arrayBuffer();
    const { error } = await supabase.storage.from('driver-licences').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error && !/already exists|duplicate|409/i.test(`${error.message} ${(error as any).statusCode ?? ''}`)) throw new Error(`Licence recorded; photo upload will retry: ${error.message}`);
    const { error: attachError } = await supabase.rpc('attach_driver_licence_photo', { p_load_id: current.loadId, p_path: path });
    if (attachError) throw new Error(`Licence recorded; photo will retry: ${attachError.message}`);
  }
  await deleteLicencePhotos(current);
  return { recorded: true };
}

// The licence photo files on this device, deleted once uploaded or discarded.
export async function deleteLicencePhotos(payload: Pick<LicencePayload, 'photos'>) {
  if (Platform.OS === 'web') return;
  const fs = await import('expo-file-system/legacy');
  for (const photo of payload.photos) if (photo.uri.startsWith('file:')) await fs.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
}

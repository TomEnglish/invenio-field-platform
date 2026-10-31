import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getQueue, removeFromQueue, replaceQueuedAction } from '@/lib/sync/offlineQueue';
import { forgetLicence, forgetLicences, recallLicence } from '@/lib/sync/licenceMemory';
import { operationContext, type OperationContext } from './operations';
import { noteLicenceOnFile } from './logistics';
import type { LicencePayload } from '@/lib/logistics/loads';

// The driver's licence (migration 022), outside apply_field_operation so the
// number never lands in field_operations. Field staff can't read the number
// or the photos back, so nothing here ever reads them. Nothing of it is kept
// on the device longer than it takes to upload:
// 1. The number, state and expiry are in memory only (licenceMemory). If the
//    app closed before upload, the item needs re-entering (LICENCE_FORGOTTEN).
//    record_driver_licence uses the queued item's ID; a repeat returns the
//    first answer. The memory is then cleared and the item marked recorded.
// 2. Photos are temporary files (cache, not backed up). Each goes to
//    driver-licences/<load>/<operation>-<n>.jpg without upsert (upserting
//    needs read access); "already exists" on a retry means it landed. Then
//    attach_driver_licence_photo, then the files are deleted.
// 3. Signing out clears it all (clearLicenceData).
export const LICENCE_PHOTO_DIRECTORY = 'licence-photos';
const coded = (message: string, code?: string) => Object.assign(new Error(message), { code });

export async function submitLicence(payload: LicencePayload, context: OperationContext) {
  const assertContext = () => {
    const active = operationContext(context.operationId);
    if (active.userId !== context.userId || active.projectId !== context.projectId) throw new Error('Return to the original account and project to finish the licence upload.');
  };
  let current = payload;
  if (!current.recorded) {
    const details = recallLicence(context.operationId);
    if (!details) throw coded('The licence number is no longer on this device; record the licence again.', 'LICENCE_FORGOTTEN');
    assertContext();
    const { data, error } = await supabase.rpc('record_driver_licence', {
      p_operation_id: context.operationId, p_load_id: current.loadId, p_licence: { ...details, ...(current.capturedAt ? { capturedAt: current.capturedAt } : {}) },
    });
    if (error) throw coded(error.message, error.code);
    if (!data?.recorded) throw new Error('The licence was not confirmed by the server. It will retry.');
    forgetLicence(context.operationId);
    current = { ...current, recorded: true };
    await replaceQueuedAction(context.operationId, { type: 'licence', payload: current });
  }
  for (const [index, photo] of current.photos.entries()) {
    assertContext();
    const path = `${current.loadId}/${context.operationId}-${index}.jpg`;
    let bytes: ArrayBuffer;
    try {
      if (photo.uri.startsWith('file:')) {
        const { File } = await import('expo-file-system');
        bytes = await new File(photo.uri).arrayBuffer();
      } else bytes = await (await fetch(photo.uri)).arrayBuffer();
    } catch { throw coded('The licence photos are no longer on this device; record the licence again.', 'PHOTO_GONE'); }
    const { error } = await supabase.storage.from('driver-licences').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    const landed = !error || /already exists|duplicate|409/i.test(`${error.message} ${(error as any).statusCode ?? ''}`);
    // Storage refuses a fifth file in the folder, and counts one that landed
    // before a lost reply: attaching says whether it is there.
    const refused = !landed && /row-level security|security policy|unauthori[sz]ed|403/i.test(`${error.message} ${(error as any).statusCode ?? ''}`);
    if (!landed && !refused) throw new Error(`Licence recorded; photo upload will retry: ${error.message}`);
    const { error: attachError } = await supabase.rpc('attach_driver_licence_photo', { p_load_id: current.loadId, p_path: path });
    if (attachError && refused) throw coded(`Licence recorded; storage refused the photo: ${error!.message}`, 'PHOTO_REFUSED');
    if (attachError) throw coded(`Licence recorded; photo will retry: ${attachError.message}`, attachError.code);
  }
  await deleteLicencePhotos(current);
  await noteLicenceOnFile(current.loadId, context);
  return { recorded: true };
}

// The licence photo files on this device, deleted once uploaded or discarded.
export async function deleteLicencePhotos(payload: Pick<LicencePayload, 'photos'>) {
  if (Platform.OS === 'web') return;
  const fs = await import('expo-file-system/legacy');
  for (const photo of payload.photos) if (photo.uri.startsWith('file:')) await fs.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
}

// At sign-out: every queued licence (any account), its photos, the folder they
// live in, and anything held in memory. A licence not yet uploaded is lost;
// it is recorded again at the next check-in.
export async function clearLicenceData() {
  forgetLicences();
  for (const item of await getQueue().catch(() => [])) {
    if (item.action?.type !== 'licence') continue;
    await deleteLicencePhotos(item.action.payload).catch(() => {});
    await removeFromQueue(item.id).catch(() => {});
  }
  if (Platform.OS === 'web') return;
  const fs = await import('expo-file-system/legacy');
  if (fs.cacheDirectory) await fs.deleteAsync(`${fs.cacheDirectory}${LICENCE_PHOTO_DIRECTORY}/`, { idempotent: true }).catch(() => {});
}

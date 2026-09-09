import { supabase } from '@/lib/supabase';
import { applyOperation, operationContext, type OperationContext } from './operations';
import type { DecisionStepData, InspectionStepData, LocationStepData, MaterialStepData, POStepData } from '@/lib/utils/validation';
import type { PhotoEntry } from '@/stores/receivingStore';

export async function submitReceivingRecord(input: {
  qrCodeValue: string; material: MaterialStepData; po: POStepData;
  inspection: InspectionStepData; photos: PhotoEntry[]; location: LocationStepData;
  decision: DecisionStepData; userId: string; context: OperationContext;
}) {
  const { photos, context, userId, ...payload } = input;
  const record = await applyOperation('receiving', payload, context);
  const assertContext = () => {
    const active = operationContext(context.operationId);
    if (active.userId !== context.userId || active.projectId !== context.projectId) throw new Error('Return to the original account and project to finish photo uploads.');
  };
  for (const [index, photo] of photos.entries()) {
    assertContext();
    const path = `${record.id}/${context.operationId}-${index}-${photo.photo_type}.jpg`;
    // A data URI survives browser restarts. Native photos live in document storage.
    let bytes: ArrayBuffer;
    if (photo.uri.startsWith('file:')) {
      const { File } = await import('expo-file-system');
      bytes = await new File(photo.uri).arrayBuffer();
    } else bytes = await (await fetch(photo.uri)).arrayBuffer();
    assertContext();
    const { error } = await supabase.storage.from('inspection-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Receipt saved; photo upload will retry: ${error.message}`);
    assertContext();
    const { error: referenceError } = await supabase.rpc('attach_inspection_photo', { p_record_id: record.id, p_path: path, p_type: photo.photo_type });
    if (referenceError) throw new Error(`Photo reference will retry: ${referenceError.message}`);
  }
  return record;
}

import { useReceivingStore, type PhotoEntry } from '@/stores/receivingStore';
import { persistPhoto } from './persistPhoto';

export async function savePhotoToDraft(uri: string, photoType: PhotoEntry['photo_type'], operationId: string) {
  const check = () => {
    if (useReceivingStore.getState().operationId !== operationId) throw new Error('The receiving draft changed while saving this photo. Return to the original receipt and add it again.');
  };
  check();
  const savedUri = await persistPhoto(uri);
  check();
  useReceivingStore.getState().addPhoto({ uri: savedUri, photo_type: photoType });
}

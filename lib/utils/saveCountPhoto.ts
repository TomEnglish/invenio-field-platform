import { useCountStore } from '@/stores/countStore';
import { persistPhoto } from './persistPhoto';

export async function saveCountPhoto(uri: string, operationId: string) {
  const check = () => {
    if (useCountStore.getState().operationId !== operationId) throw new Error('The count changed while saving this photo. Return to the original item and add it again.');
  };
  check();
  const savedUri = await persistPhoto(uri);
  check();
  useCountStore.getState().addPhoto({ uri: savedUri });
}

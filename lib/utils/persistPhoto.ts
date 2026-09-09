import { Platform } from 'react-native';
import { compressPhoto } from './compressPhoto';
import { newOperationId } from './operationId';

export async function persistPhoto(uri: string): Promise<string> {
  const compressed = await compressPhoto(uri);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(compressed)).blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not save photo on this device.'));
      reader.readAsDataURL(blob);
    });
  }
  const fs = await import('expo-file-system/legacy');
  if (!fs.documentDirectory) throw new Error('Photo document storage is unavailable.');
  const directory = `${fs.documentDirectory}receiving-photos/`;
  await fs.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${newOperationId()}.jpg`;
  await fs.copyAsync({ from: compressed, to: destination });
  return destination;
}

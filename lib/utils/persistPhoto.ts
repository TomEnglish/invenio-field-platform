import { Platform } from 'react-native';
import { compressPhoto } from './compressPhoto';
import { newOperationId } from './operationId';

// Copies a photo into document storage. For licence photos: `temporary` uses
// the cache folder instead (not backed up), and `discardSources` deletes the
// camera's original and the compressed copy, so no other copy stays.
export async function persistPhoto(uri: string, options: { directory?: string; temporary?: boolean; discardSources?: boolean } = {}): Promise<string> {
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
  const base = options.temporary ? fs.cacheDirectory : fs.documentDirectory;
  if (!base) throw new Error('Photo document storage is unavailable.');
  const directory = `${base}${options.directory ?? 'receiving-photos'}/`;
  await fs.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${newOperationId()}.jpg`;
  await fs.copyAsync({ from: compressed, to: destination });
  if (options.discardSources) {
    for (const source of new Set([uri, compressed])) if (source.startsWith('file:') && source !== destination) await fs.deleteAsync(source, { idempotent: true }).catch(() => {});
  }
  return destination;
}

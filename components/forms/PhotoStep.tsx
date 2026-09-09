import { savePhotoToDraft } from '@/lib/utils/savePhotoToDraft';
import { useRef, useState } from 'react';
import { View, ScrollView, Text, Image, StyleSheet, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/components/ui/Button';
import { useReceivingStore } from '@/stores/receivingStore';
import type { PhotoType } from '@/types/database';
import { colors } from '@/lib/design/tokens';

const PHOTO_TYPES: { value: PhotoType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'damage', label: 'Damage' },
  { value: 'delivery_ticket', label: 'Delivery Ticket' },
];

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export function PhotoStep({ onNext, onBack }: Props) {
  const { photos, removePhoto } = useReceivingStore();
  const [selectedType, setSelectedType] = useState<PhotoType>('general');

  const [busy, setBusy] = useState(false);
  const capturing = useRef(false);
  const capture = async (camera: boolean) => {
    if (capturing.current) return;
    capturing.current = true; setBusy(true);
    const operationId = useReceivingStore.getState().operationId;
    const photoType = selectedType;
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Allow camera access in device Settings, or choose a photo from the library.');
      }
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
        mediaTypes: ['images'], quality: 0.7, allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) await savePhotoToDraft(result.assets[0].uri, photoType, operationId);
    } catch (error: any) { Alert.alert('Photo not saved', error.message || 'Please try again.'); }
    finally { capturing.current = false; setBusy(false); }
  };

  const handleRemove = (index: number) => {
    Alert.alert('Remove Photo', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePhoto(index) },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Photos</Text>

      <Text style={styles.label}>Photo Type</Text>
      <View style={styles.row}>
        {PHOTO_TYPES.map((t) => (
          <Button
            key={t.value}
            title={t.label}
            variant={selectedType === t.value ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setSelectedType(t.value)}
            style={styles.typeButton}
          />
        ))}
      </View>

      <View style={styles.row}>
        <Button title="Take Photo" onPress={() => capture(true)} disabled={busy} style={{ flex: 1 }} />
        <Button title="From Library" variant="secondary" onPress={() => capture(false)} disabled={busy} style={{ flex: 1 }} />
      </View>

      {photos.length > 0 && (
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View key={index} style={styles.photoCard}>
              <Image source={{ uri: photo.uri }} style={styles.photo} />
              <Text style={styles.photoType}>{photo.photo_type}</Text>
              <Button
                title="Remove"
                disabled={busy}
                variant="danger"
                onPress={() => handleRemove(index)}
                style={styles.removeButton}
              />
            </View>
          ))}
        </View>
      )}

      <Text style={styles.hint}>
        {busy ? 'Saving photo on this device…' : photos.length === 0
          ? 'No photos added yet (optional)'
          : `${photos.length} photo(s) attached`}
      </Text>

      <Button title="Next" disabled={busy} onPress={onNext} style={{ marginTop: 16 }} />
      <Button title="Back" disabled={busy} variant="secondary" onPress={onBack} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typeButton: { flex: 1, paddingVertical: 8 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  photoCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: '100%', height: 120 },
  photoType: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 4,
  },
  removeButton: { paddingVertical: 6, borderRadius: 0 },
  hint: { fontSize: 13, color: colors.textSubtle, textAlign: 'center' },
});

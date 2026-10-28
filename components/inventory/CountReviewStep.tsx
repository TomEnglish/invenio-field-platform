import { useRef, useState } from 'react';
import { ScrollView, View, Text, Image, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/components/ui/Button';
import { useCountStore } from '@/stores/countStore';
import { saveCountPhoto } from '@/lib/utils/saveCountPhoto';
import { COUNT_CONDITIONS, categoryAvailabilityIssue, countReviewIssue, type AreaRule } from '@/lib/inventory/count';
import type { InventoryCategory } from '@/lib/inventory/categories';
import { colors, radius, space, fontSize, fontWeight } from '@/lib/design/tokens';

interface Props { categories: InventoryCategory[]; treeKnown: boolean; areaRule?: AreaRule; onEdit: (step: number) => void; onSubmit: () => void; submitting: boolean; error?: string }

// Step 4: photo, then the receiving-style review with Edit per section.
export function CountReviewStep({ categories, treeKnown, areaRule, onEdit, onSubmit, submitting, error }: Props) {
  const draft = useCountStore();
  const issue = countReviewIssue(draft, areaRule) ?? categoryAvailabilityIssue(draft.category, categories, treeKnown);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const capturing = useRef(false);

  const capture = async (camera: boolean) => {
    if (capturing.current) return;
    capturing.current = true; setBusy(true); setPhotoError('');
    const operationId = useCountStore.getState().operationId;
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Allow camera access in device Settings, or choose a photo from the library.');
      }
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
      if (!result.canceled && result.assets[0]) await saveCountPhoto(result.assets[0].uri, operationId);
    } catch (e: any) { setPhotoError(e?.message || 'Photo not saved. Please try again.'); }
    finally { capturing.current = false; setBusy(false); }
  };

  const { item, category, location } = draft;
  const condition = COUNT_CONDITIONS.find(c => c.value === item.condition)?.label;
  const sections: { title: string; step: number; rows: [string, string | undefined][] }[] = [
    { title: 'Item', step: 0, rows: [['Tag', draft.tag], ['Name', item.name], ['Part number', item.partNumber], ['Quantity', `${item.quantity} ${item.uom}`], ['Condition', condition], ['Description', item.description], ['Notes', item.notes]] },
    { title: 'Category', step: 1, rows: [[category.proposed ? 'Proposed category' : 'Category', category.label || undefined]] },
    { title: 'Location', step: 2, rows: [['Area', location.zoneName || undefined], ['Pin', location.pin ? 'Placed on the site plan' : undefined]] },
  ];

  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title} accessibilityRole="header">Photo</Text>
    <View style={styles.row}>
      <Button title="Take photo" onPress={() => capture(true)} disabled={busy || submitting} style={styles.flex} />
      <Button title="From library" variant="secondary" onPress={() => capture(false)} disabled={busy || submitting} style={styles.flex} />
    </View>
    {draft.photos.length > 0 && <ScrollView horizontal contentContainerStyle={styles.photos}>
      {draft.photos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.photoCard}>
        <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel={`Photo ${index + 1}`} />
        <Button title="Remove" variant="ghost" onPress={() => draft.removePhoto(index)} disabled={busy || submitting} />
      </View>)}
    </ScrollView>}
    <Text style={styles.hint}>{busy ? 'Saving photo on this device…' : draft.photos.length ? `${draft.photos.length} photo(s) attached` : 'A photo is optional but helps the office confirm the item.'}</Text>
    {photoError ? <Text accessibilityRole="alert" style={styles.error}>{photoError}</Text> : null}

    <Text style={styles.title} accessibilityRole="header">Review count</Text>
    <Text style={styles.hint}>Saving keeps this count on the device and uploads it when online, with its photos.</Text>
    {sections.map(section => <View key={section.title} style={styles.section}>
      <View style={styles.heading}><Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text><Button title="Edit" accessibilityLabel={`Edit ${section.title}`} variant="ghost" onPress={() => onEdit(section.step)} disabled={submitting} /></View>
      {section.rows.filter(([, value], index) => index === 0 || (value !== undefined && value.trim() !== '')).map(([label, value]) => <View key={label} style={styles.field}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value?.trim() ? value : 'Not recorded'}</Text></View>)}
    </View>)}
    {issue && <View style={styles.issue}><Text accessibilityRole="alert" style={styles.error}>{issue.message}</Text><Button title={`Review ${sections[issue.step]?.title.toLowerCase() ?? 'item'}`} onPress={() => onEdit(issue.step)} variant="secondary" disabled={submitting} /></View>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button title="Save count" onPress={onSubmit} loading={submitting} disabled={!!issue || busy} />
    <Button title="Back to location" onPress={() => onEdit(2)} variant="secondary" disabled={submitting} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: space[5], gap: space[4], paddingBottom: space[10] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  hint: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  photos: { gap: space[3] },
  photoCard: { width: 120, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  photo: { width: 120, height: 120 },
  section: { padding: space[4], gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary, flexShrink: 1 },
  field: { gap: 2 },
  label: { fontSize: fontSize.xs, color: colors.textMuted },
  value: { fontSize: 15, color: colors.textPrimary },
  issue: { gap: space[3] },
  error: { color: colors.danger, fontSize: fontSize.body },
});

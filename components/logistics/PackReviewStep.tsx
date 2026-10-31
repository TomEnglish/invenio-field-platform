import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { usePackStore } from '@/stores/packStore';
import { kindLabel, packedAfter, type LoadIndex, type PackEntry } from '@/lib/logistics/crates';
import { colors, radius, space, fontSize, fontWeight } from '@/lib/design/tokens';

interface Props {
  index: LoadIndex;
  insideOf: string | null;
  error: string;
  saving: boolean;
  onEdit: (step: number) => void;
  onSave: (seal: boolean) => void;
  onBack: () => void;
}

// Step 5: everything the pack will send, then Seal or Save open. The whole
// session uploads as one change.
export function PackReviewStep({ index, insideOf, error, saving, onEdit, onSave, onBack }: Props) {
  const draft = usePackStore();
  const total = packedAfter(index, draft).length;
  const unchecked = draft.add.filter(entry => entry.unchecked).length;
  const list = (entries: PackEntry[]) => entries.slice(0, 8).map(entry => entry.tag).join(', ') + (entries.length > 8 ? ` and ${entries.length - 8} more` : '');
  const where = insideOf ? `Inside ${insideOf}`
    : [draft.location.placeName, draft.location.zoneName].filter(Boolean).join(' · ') || (draft.before?.where ? `${draft.before.where} (unchanged)` : 'Not set');

  const section = (title: string, step: number, lines: string[]) => (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.heading} accessibilityRole="header">{title}</Text>
        <Button title="Edit" accessibilityLabel={`Edit ${title.toLowerCase()}`} variant="ghost" onPress={() => onEdit(step)} style={styles.edit} />
      </View>
      {lines.filter(Boolean).map(line => <Text key={line} style={styles.text}>{line}</Text>)}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {section('Crate', 1, [
        `${draft.code} · ${kindLabel(draft.kind)}${draft.isHighValue ? ' · High value' : ''}`,
        draft.description.trim(),
      ])}
      {section('Contents', 2, [
        `${total} inside after this`,
        draft.add.length ? `Going in (${draft.add.length}): ${list(draft.add)}` : 'Nothing new going in',
        draft.remove.length ? `Coming out (${draft.remove.length}): ${list(draft.remove)}` : '',
      ])}
      {unchecked ? <Text style={styles.warning}>{unchecked} tag{unchecked === 1 ? ' isn’t' : 's aren’t'} on this device yet; the server checks {unchecked === 1 ? 'it' : 'them'}. If one is refused, the whole pack waits in Sync.</Text> : null}
      {section('Location', 3, [where])}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Seal crate" onPress={() => onSave(true)} loading={saving} disabled={saving} />
      <Button title="Save open" variant="secondary" onPress={() => onSave(false)} disabled={saving} />
      <Text style={styles.muted}>Seal when the crate is closed up. Save open to keep adding later; changing a sealed crate opens it again.</Text>
      <Button title="Back" variant="ghost" onPress={onBack} disabled={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[3], backgroundColor: colors.canvas, flexGrow: 1 },
  section: { gap: space[1], padding: space[3], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  edit: { paddingHorizontal: space[2] },
  text: { fontSize: fontSize.body, color: colors.textPrimary, lineHeight: 20 },
  muted: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  warning: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20 },
  error: { fontSize: fontSize.body, color: colors.danger },
});

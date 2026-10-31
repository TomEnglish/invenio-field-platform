import { View, Text, ScrollView, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { QRScanner, type ScanFeedback } from '@/components/scanning/QRScanner';
import { usePackStore } from '@/stores/packStore';
import { packedAfter, unitName, type LoadIndex, type PackEntry } from '@/lib/logistics/crates';
import { colors, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

interface Props {
  index: LoadIndex;
  onScan: (code: string) => Promise<ScanFeedback | null>;
  onNext: () => void;
  onBack: () => void;
}

// Step 3: scan items and crates in, one after another, and take things out.
// What the crate already holds is listed under what this session adds.
export function PackContentsStep({ index, onScan, onNext, onBack }: Props) {
  const { code, add, remove, dropEntry, takeOut, keep } = usePackStore();
  const current: PackEntry[] = [
    ...(index.children.get(code) ?? []).map(unit => ({ tag: unit.code, name: unitName(unit), crate: true })),
    ...(index.contents.get(code) ?? []).map(item => ({ tag: item.tag.trim(), name: item.name, crate: false })),
  ];
  const leaving = new Set(remove.map(entry => entry.tag));
  // Taken out of the crate's own list (as the device knew it) but still to show.
  const missing = remove.filter(entry => !current.some(c => c.tag === entry.tag));
  const total = packedAfter(index, { code, add, remove }).length;
  const unchecked = add.filter(entry => entry.unchecked).length;
  const refused = add.filter(entry => entry.problem).length;

  const row = (entry: PackEntry, note: string | null, action: { title: string; label: string; onPress: () => void }) => (
    <View key={`${note ?? ''}${entry.tag}`} style={styles.row}>
      <FontAwesome name={entry.crate ? 'archive' : 'tag'} size={14} color={note === 'Taking out' ? colors.textSubtle : colors.brandPrimary} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, note === 'Taking out' && styles.leaving]}>{entry.tag}{note ? ` · ${note}` : ''}</Text>
        {entry.problem ? <Text style={styles.problem}>{entry.problem}</Text> : <Text style={styles.muted} numberOfLines={1}>{entry.name}</Text>}
      </View>
      <Button title={action.title} accessibilityLabel={action.label} variant="ghost" onPress={action.onPress} style={styles.rowAction} />
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.camera}>
        <QRScanner continuous onScan={onScan} countLabel={`${total} in ${code}`} />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {add.length === 0 && current.length === 0 ? <Text style={styles.muted}>Scan each item's tag, or another crate's label to put that crate inside this one.</Text> : null}
        {add.map(entry => row(entry, entry.problem ? 'Can’t go in' : entry.unchecked ? 'New, not checked yet' : 'New', { title: 'Remove', label: `Remove ${entry.tag} from the list`, onPress: () => dropEntry(entry.tag) }))}
        {current.map(entry => leaving.has(entry.tag)
          ? row(entry, 'Taking out', { title: 'Keep', label: `Keep ${entry.tag} in ${code}`, onPress: () => keep(entry.tag) })
          : row(entry, null, { title: 'Take out', label: `Take ${entry.tag} out of ${code}`, onPress: () => takeOut(entry) }))}
        {missing.map(entry => row(entry, 'Taking out', { title: 'Keep', label: `Keep ${entry.tag} in ${code}`, onPress: () => keep(entry.tag) }))}
      </ScrollView>
      {refused ? <Text style={styles.warning} accessibilityRole="alert">The server says {refused === 1 ? 'one tag' : `${refused} tags`} can’t go in. Remove {refused === 1 ? 'it' : 'them'}, or sort {refused === 1 ? 'it' : 'them'} out, before saving.</Text> : null}
      {unchecked ? <Text style={styles.warning}>{unchecked} tag{unchecked === 1 ? ' isn’t' : 's aren’t'} on this device yet. The server checks {unchecked === 1 ? 'it' : 'them'} when this uploads; if one is refused, the pack waits in Sync.</Text> : null}
      <View style={styles.actions}>
        <Button title="Back" variant="secondary" onPress={onBack} style={styles.back} />
        <Button title="Next: location" onPress={onNext} style={styles.next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: space[2], backgroundColor: colors.canvas, paddingBottom: space[4] },
  camera: { flex: 5, minHeight: 260 },
  list: { flex: 4, minHeight: 120, paddingHorizontal: space[4] },
  listContent: { gap: space[1], paddingBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  leaving: { color: colors.textSubtle, textDecorationLine: 'line-through' },
  rowAction: { paddingHorizontal: space[2] },
  muted: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  warning: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20, paddingHorizontal: space[4] },
  problem: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4] },
  back: { flex: 1 },
  next: { flex: 2 },
});

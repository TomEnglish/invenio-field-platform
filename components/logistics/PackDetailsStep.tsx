import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { usePackStore } from '@/stores/packStore';
import { STATUS_LABELS, UNIT_KINDS } from '@/lib/logistics/crates';
import { colors, space, fontSize, fontWeight } from '@/lib/design/tokens';

// Step 2: what the crate is. A label packed before starts with its details.
export function PackDetailsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { before, kind, description, isHighValue, setDetails } = usePackStore();
  const details = { kind, description, isHighValue };
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>
        {before ? `Packed before · ${STATUS_LABELS[before.status] ?? before.status}${before.where ? ` · ${before.where}` : ''}` : 'Not packed before, as far as this device knows. Its first pack makes it a crate.'}
      </Text>
      <Text style={styles.label} accessibilityRole="header">Type</Text>
      <View style={styles.kinds}>
        {UNIT_KINDS.map(option => <Button
          key={option.value}
          title={option.label}
          accessibilityLabel={option.value === kind ? `${option.label}, chosen` : `Choose ${option.label}`}
          variant={option.value === kind ? 'primary' : 'secondary'}
          onPress={() => setDetails({ ...details, kind: option.value })}
          style={styles.kind}
        />)}
      </View>
      <Input
        label="Description (optional)"
        value={description}
        onChangeText={text => setDetails({ ...details, description: text })}
        placeholder="e.g. Pump spares for unit 3"
        maxLength={200}
      />
      <Switch label="High value" value={isHighValue} onChange={value => setDetails({ ...details, isHighValue: value })} />
      <Text style={styles.muted}>Everyone who scans this crate sees that it is high value.</Text>
      <View style={styles.actions}>
        <Button title="Back" variant="secondary" onPress={onBack} style={styles.back} />
        <Button title="Next: scan items" onPress={onNext} style={styles.next} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[3], backgroundColor: colors.canvas, flexGrow: 1 },
  label: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  muted: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  kind: { paddingHorizontal: space[3], paddingVertical: space[2] },
  actions: { flexDirection: 'row', gap: space[2], marginTop: 'auto' },
  back: { flex: 1 },
  next: { flex: 2 },
});

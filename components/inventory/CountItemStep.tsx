import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toast } from '@/components/ui/Toast';
import { useCountStore } from '@/stores/countStore';
import { COUNT_CONDITIONS, COUNT_UNITS, countItemIssue, normaliseQuantity, shortDate, type CountCondition } from '@/lib/inventory/count';
import { colors, space, fontSize, fontWeight } from '@/lib/design/tokens';

interface Props { onNext: () => void; onBack?: () => void }

// Step 1: the matched record or a new tag, then name, part #, quantity, unit
// and condition.
export function CountItemStep({ onNext, onBack }: Props) {
  const { tag, match, item, setItem } = useCountStore();
  const [name, setName] = useState(item.name);
  const [partNumber, setPartNumber] = useState(item.partNumber);
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(item.quantity);
  const [uom, setUom] = useState(item.uom);
  const [condition, setCondition] = useState<CountCondition>(item.condition);
  const [notes, setNotes] = useState(item.notes);
  const [error, setError] = useState('');

  const handleNext = () => {
    const next = { name, partNumber, description, quantity: normaliseQuantity(quantity) ?? quantity, uom: uom.trim().toUpperCase(), condition, notes };
    const issue = countItemIssue(next);
    if (issue) { setError(issue); return; }
    setItem(next);
    setError('');
    onNext();
  };

  const banner = match?.status === 'counted'
    ? { tone: 'warn' as const, title: 'Already counted', message: `${match.name} was counted${match.countedAt ? ` on ${shortDate(match.countedAt)}` : ''}. Saving updates that count.` }
    : match
      ? { tone: 'success' as const, title: 'Expected item found', message: `${match.name} is on the office's list. Check the details, then continue.` }
      : { tone: 'info' as const, title: 'New tag', message: 'This tag is not on the office list. It will be added as a new item.' };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.tag} accessibilityRole="header">Tag {tag}</Text>
        <Toast visible tone={banner.tone} title={banner.title} message={banner.message} />
        <Input label="Item name" required value={name} onChangeText={setName} placeholder="e.g. Lube oil cooler" maxLength={200} />
        <Input label="Part number" value={partNumber} onChangeText={setPartNumber} placeholder="Optional" autoCapitalize="characters" autoCorrect={false} />
        <View style={styles.row}>
          <View style={styles.quantity}><Input label="Quantity" required value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" selectTextOnFocus /></View>
          <View style={styles.unit}><Input label="Unit" required value={uom} onChangeText={setUom} autoCapitalize="characters" autoCorrect={false} maxLength={16} /></View>
        </View>
        <View style={styles.chips}>
          {COUNT_UNITS.map(unit => <Button key={unit} title={unit} variant={uom.trim().toUpperCase() === unit ? 'primary' : 'secondary'} onPress={() => setUom(unit)} style={styles.chip} />)}
        </View>
        <Text style={styles.label}>Condition</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {COUNT_CONDITIONS.map(option => <Button key={option.value} title={option.label} variant={condition === option.value ? 'primary' : 'secondary'} onPress={() => setCondition(option.value)} style={styles.condition} />)}
        </View>
        <Input label="Description" value={description} onChangeText={setDescription} placeholder="Optional" />
        <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional, e.g. stored under tarp" multiline />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Next: category" onPress={handleNext} />
        {onBack ? <Button title="Back" variant="secondary" onPress={onBack} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space[5], paddingBottom: space[10], gap: space[2] },
  tag: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary, marginBottom: space[1] },
  row: { flexDirection: 'row', gap: space[3] },
  quantity: { flex: 1 },
  unit: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2] },
  condition: { flex: 1, paddingHorizontal: space[2] },
  label: { fontSize: fontSize.body, fontWeight: fontWeight.medium, color: colors.textPrimary },
  error: { color: colors.danger, fontSize: fontSize.body },
});

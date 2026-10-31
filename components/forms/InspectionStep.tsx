import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useReceivingStore } from '@/stores/receivingStore';
import type { MaterialCondition } from '@/types/database';
import { CONDITIONS, RECEIVING_STEPS } from '@/lib/utils/receivingLabels';
import { colors } from '@/lib/design/tokens';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export function InspectionStep({ onNext, onBack }: Props) {
  const { inspection, setInspection } = useReceivingStore();

  const [condition, setCondition] = useState<MaterialCondition>(inspection.condition);
  const [damageNotes, setDamageNotes] = useState(inspection.damage_notes ?? '');
  const [inspectionPass, setInspectionPass] = useState(inspection.inspection_pass);

  const handleNext = () => {
    setInspection({
      condition,
      damage_notes: damageNotes || undefined,
      inspection_pass: inspectionPass,
    });
    onNext();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{RECEIVING_STEPS[3]}</Text>

      <Text style={styles.label}>Condition</Text>
      <View style={styles.row}>
        {CONDITIONS.map((c) => (
          <Button
            key={c.value}
            title={c.label}
            variant={condition === c.value ? 'primary' : 'secondary'}
            onPress={() => setCondition(c.value)}
            style={styles.conditionButton}
          />
        ))}
      </View>

      {(condition === 'damaged' || condition === 'mixed') && (
        <Input
          label="Damage Notes"
          value={damageNotes}
          onChangeText={setDamageNotes}
          placeholder="Describe the damage"
          multiline
          numberOfLines={3}
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
      )}

      <Text style={styles.label}>Inspection Pass?</Text>
      <View style={styles.row}>
        <Button
          title="Pass"
          variant={inspectionPass ? 'primary' : 'secondary'}
          onPress={() => setInspectionPass(true)}
          style={styles.conditionButton}
        />
        <Button
          title="Fail"
          variant={!inspectionPass ? 'danger' : 'secondary'}
          onPress={() => setInspectionPass(false)}
          style={styles.conditionButton}
        />
      </View>

      <Button title="Next" onPress={handleNext} style={{ marginTop: 16 }} />
      <Button title="Back" variant="secondary" onPress={onBack} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  conditionButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 8 },
});

import { View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useReceivingStore } from '@/stores/receivingStore';
import { materialStepSchema } from '@/lib/utils/validation';
import { RECEIVING_STEPS } from '@/lib/utils/receivingLabels';
import { MATERIAL_TYPES } from '@/constants/materialTypes';
import { colors } from '@/lib/design/tokens';

const FIELD_LABELS: Record<string, string> = {
  material_type: 'Material Type',
  qty: 'Quantity',
  size: 'Size',
  grade: 'Grade',
  weight: 'Weight',
  description: 'Description',
  spec: 'Spec',
};

interface Props {
  onNext: () => void;
}

export function MaterialStep({ onNext }: Props) {
  const { material, setMaterial } = useReceivingStore();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const scrollRef = useRef<ScrollView>(null);

  const [materialType, setMaterialType] = useState(material.material_type);
  const [qty, setQty] = useState(String(material.qty));
  const [size, setSize] = useState(material.size ?? '');
  const [grade, setGrade] = useState(material.grade ?? '');
  const [weight, setWeight] = useState(material.weight ? String(material.weight) : '');
  const [description, setDescription] = useState(material.description ?? '');
  const [spec, setSpec] = useState(material.spec ?? '');

  const handleNext = () => {
    const data = {
      material_type: materialType,
      qty: parseInt(qty, 10) || 0,
      size: size || undefined,
      grade: grade || undefined,
      weight: weight ? parseFloat(weight) : undefined,
      description: description || undefined,
      spec: spec || undefined,
    };

    const result = materialStepSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((e) => {
        if (e.path[0] != null) {
          const field = String(e.path[0]);
          fieldErrors[field] = e.message;
        }
      });
      setErrors(fieldErrors);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      const messages = result.error.issues.map((e) => {
        const field = e.path[0] != null ? FIELD_LABELS[String(e.path[0])] || String(e.path[0]) : '';
        return `${field}: ${e.message}`;
      }).join('\n');
      Alert.alert('Please Fix', messages);
      return;
    }

    setErrors({});
    setMaterial(result.data);
    onNext();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{RECEIVING_STEPS[0]}</Text>

        <Text style={styles.label}>Material Type</Text>
        <View style={styles.typeGrid}>
          {MATERIAL_TYPES.map((type) => (
            <Button
              key={type}
              title={type}
              variant={materialType === type ? 'primary' : 'secondary'}
              onPress={() => {
                setMaterialType(type);
                setErrors((e) => ({ ...e, material_type: '' }));
              }}
              style={styles.typeButton}
            />
          ))}
        </View>
        {errors.material_type ? (
          <Text style={styles.error}>{errors.material_type}</Text>
        ) : null}

        <Input
          label="Quantity"
          value={qty}
          onChangeText={setQty}
          keyboardType="number-pad"
          error={errors.qty}
        />
        <Input label="Size" value={size} onChangeText={setSize} placeholder='e.g. 4"' error={errors.size} />
        <Input label="Grade" value={grade} onChangeText={setGrade} placeholder="e.g. A106 Gr B" error={errors.grade} />
        <Input
          label="Weight (lbs)"
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          placeholder="Optional"
          error={errors.weight}
        />
        <Input label="Description" value={description} onChangeText={setDescription} placeholder="Optional" error={errors.description} />
        <Input label="Spec" value={spec} onChangeText={setSpec} placeholder="Optional" error={errors.spec} />

        <Button title="Next" onPress={handleNext} style={{ marginTop: 8 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeButton: { paddingVertical: 8, paddingHorizontal: 12 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
});

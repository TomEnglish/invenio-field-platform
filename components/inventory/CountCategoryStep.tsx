import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { CategoryPicker } from '@/components/inventory/CategoryPicker';
import { useCountStore } from '@/stores/countStore';
import { countCategoryIssue } from '@/lib/inventory/count';
import type { InventoryCategory } from '@/lib/inventory/categories';
import { colors, space, fontSize } from '@/lib/design/tokens';

interface Props { categories: InventoryCategory[]; onNext: () => void; onBack: () => void }

// Step 2: choose from the office tree or propose a missing category.
export function CountCategoryStep({ categories, onNext, onBack }: Props) {
  const { category, setCategory } = useCountStore();
  const [error, setError] = useState('');
  const handleNext = () => {
    const issue = countCategoryIssue(category);
    if (issue) { setError(issue); return; }
    setError('');
    onNext();
  };
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <CategoryPicker categories={categories} value={category} onChange={next => { setCategory(next); setError(''); }} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Next: location" onPress={handleNext} />
      <Button title="Back" variant="secondary" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space[5], paddingBottom: space[10], gap: space[3] },
  error: { color: colors.danger, fontSize: fontSize.body },
});

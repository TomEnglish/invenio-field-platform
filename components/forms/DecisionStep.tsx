import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet, Alert } from 'react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useReceivingStore } from '@/stores/receivingStore';
import type { ExceptionType } from '@/types/database';
import { colors } from '@/lib/design/tokens';

type DecisionStatus = 'accepted' | 'partially_accepted' | 'rejected';

const STATUSES: { value: DecisionStatus; label: string; color: string }[] = [
  { value: 'accepted', label: 'Accept', color: colors.success },
  { value: 'partially_accepted', label: 'Partial Accept', color: colors.warn },
  { value: 'rejected', label: 'Reject', color: colors.danger },
];

const EXCEPTION_TYPES: { value: ExceptionType; label: string }[] = [
  { value: 'wrong_type', label: 'Wrong Type' },
  { value: 'wrong_count', label: 'Wrong Count' },
  { value: 'damage', label: 'Damage' },
];

interface Props {
  onNext?: () => void;
  onSubmit?: () => void;
  onBack: () => void;
  submitting?: boolean;
}

export function DecisionStep({ onNext, onSubmit, onBack, submitting }: Props) {
  const { decision, setDecision, inspection, material } = useReceivingStore();

  const [acceptedQty, setAcceptedQty] = useState(String(decision.accepted_qty ?? ''));
  const [status, setStatus] = useState<DecisionStatus>(decision.status);
  const [hasException, setHasException] = useState(decision.has_exception);
  const [exceptionType, setExceptionType] = useState<ExceptionType | undefined>(
    decision.exception_type ?? undefined
  );

  // Auto-flag exception if condition is damaged or inspection failed
  const autoException = inspection.condition === 'damaged' || !inspection.inspection_pass;

  const handleNext = () => {
    const count = Number(acceptedQty);
    if (status === 'partially_accepted' && (!Number.isInteger(count) || count <= 0 || count >= material.qty)) { Alert.alert('Accepted quantity', 'Enter a whole number smaller than the delivered quantity and greater than zero.'); return; }
    const flagException = hasException || autoException;
    setDecision({
      status,
      accepted_qty: status === 'partially_accepted' ? count : undefined,
      has_exception: flagException,
      exception_type: flagException ? exceptionType : undefined,
    });
    if (onNext) onNext();
    else if (onSubmit) onSubmit();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Decision</Text>

      <Text style={styles.label}>Status</Text>
      <View style={styles.row}>
        {STATUSES.map((s) => (
          <Button
            key={s.value}
            title={s.label}
            variant={status === s.value ? 'primary' : 'secondary'}
            onPress={() => setStatus(s.value)}
            style={styles.statusButton}
          />
        ))}
      </View>

      {status === 'partially_accepted' && <Input label={`Accepted quantity (of ${material.qty} delivered)`} value={acceptedQty} onChangeText={setAcceptedQty} keyboardType="numeric" />}
      {autoException && (
        <View style={styles.autoAlert}>
          <Text style={styles.autoAlertText}>
            Exception auto-flagged due to{' '}
            {inspection.condition === 'damaged' ? 'damage' : 'failed inspection'}
          </Text>
        </View>
      )}

      {!autoException && (
        <>
          <Text style={styles.label}>Flag Exception?</Text>
          <View style={styles.row}>
            <Button
              title="No"
              variant={!hasException ? 'primary' : 'secondary'}
              onPress={() => setHasException(false)}
              style={styles.statusButton}
            />
            <Button
              title="Yes"
              variant={hasException ? 'danger' : 'secondary'}
              onPress={() => setHasException(true)}
              style={styles.statusButton}
            />
          </View>
        </>
      )}

      {(hasException || autoException) && (
        <>
          <Text style={styles.label}>Exception Type</Text>
          <View style={styles.row}>
            {EXCEPTION_TYPES.map((t) => (
              <Button
                key={t.value}
                title={t.label}
                variant={exceptionType === t.value ? 'primary' : 'secondary'}
                onPress={() => setExceptionType(t.value)}
                style={styles.statusButton}
              />
            ))}
          </View>
        </>
      )}

      <Button
        title={submitting ? 'Submitting...' : 'Next'}
        onPress={handleNext}
        loading={submitting}
        style={{ marginTop: 16 }}
      />
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
  statusButton: { flex: 1, paddingVertical: 10 },
  autoAlert: {
    backgroundColor: colors.warnSoft,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  autoAlertText: {
    color: colors.warnDeep,
    fontSize: 13,
    fontWeight: '500',
  },
});

import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router, Stack } from 'expo-router';
import { useReceivingStore } from '@/stores/receivingStore';
import { useAuthStore } from '@/stores/authStore';
import { processQueue } from '@/lib/sync/syncManager';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue } from '@/lib/sync/offlineQueue';
import { MaterialStep } from '@/components/forms/MaterialStep';
import { POStep } from '@/components/forms/POStep';
import { InspectionStep } from '@/components/forms/InspectionStep';
import { PhotoStep } from '@/components/forms/PhotoStep';
import { LocationStep } from '@/components/forms/LocationStep';
import { DecisionStep } from '@/components/forms/DecisionStep';
import { colors } from '@/lib/design/tokens';

const STEP_TITLES = [
  'Material Details',
  'PO / Delivery',
  'Photos',
  'Inspection',
  'Decision',
  'Location',
];

export function ReceivingScreenContent() {
  const store = useReceivingStore();
  const user = useAuthStore((s) => s.user);
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [submitting, setSubmitting] = useState(false);

  const goTo = (step: number) => store.setStep(step);

  const handleSubmit = async () => {
    if (!user) return;

    setSubmitting(true);
    try {
      await addToQueue({ type: 'receiving', payload: {
        qrCodeValue: store.qrCodeValue, material: store.material, po: store.po,
        inspection: store.inspection, photos: store.photos, location: store.location,
        decision: store.decision, userId: user.id,
      } }, store.operationId);
      // Queue persistence succeeds before clearing the draft, even for online submissions.
      store.reset();
      if (isOnline) await processQueue();
      Alert.alert('Saved', 'Submission saved. Check Sync for upload progress or any action needed.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: STEP_TITLES[store.step] ?? 'Receiving',
          headerBackTitle: 'Cancel',
        }}
      />

      <View style={styles.stepBar}>
        {STEP_TITLES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.stepDot,
              i <= store.step && styles.stepDotActive,
            ]}
          />
        ))}
      </View>

      <Text style={styles.qrLabel}>QR: {store.qrCodeValue}</Text>

      {store.step === 0 && <MaterialStep onNext={() => goTo(1)} />}
      {store.step === 1 && <POStep onNext={() => goTo(2)} onBack={() => goTo(0)} />}
      {store.step === 2 && <PhotoStep onNext={() => goTo(3)} onBack={() => goTo(1)} />}
      {store.step === 3 && <InspectionStep onNext={() => goTo(4)} onBack={() => goTo(2)} />}
      {store.step === 4 && <DecisionStep onNext={() => goTo(5)} onBack={() => goTo(3)} />}
      {store.step === 5 && (
        <LocationStep onSubmit={handleSubmit} onBack={() => goTo(4)} submitting={submitting} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  stepBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.brandPrimary,
  },
  qrLabel: {
    fontSize: 12,
    color: colors.textSubtle,
    textAlign: 'center',
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
});

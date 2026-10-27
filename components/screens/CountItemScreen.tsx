import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCountStore } from '@/stores/countStore';
import { useAuthStore } from '@/stores/authStore';
import { processQueue } from '@/lib/sync/syncManager';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue, getQueue } from '@/lib/sync/offlineQueue';
import { recordCountLocally } from '@/lib/api/inventory';
import { buildCountPayload, categoryAvailabilityIssue, countReviewIssue } from '@/lib/inventory/count';
import { QRScanner } from '@/components/scanning/QRScanner';
import { CountItemStep } from '@/components/inventory/CountItemStep';
import { CountCategoryStep } from '@/components/inventory/CountCategoryStep';
import { CountLocationStep } from '@/components/inventory/CountLocationStep';
import { CountReviewStep } from '@/components/inventory/CountReviewStep';
import { useCountReference } from '@/components/inventory/useCountReference';
import { beginCount } from '@/components/inventory/beginCount';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { colors } from '@/lib/design/tokens';

const STEP_TITLES = ['Item', 'Category', 'Location', 'Photo & review'];
const REVIEW = STEP_TITLES.length - 1;

// Scan → item → category → location → photo + review, in the shell and review
// pattern of ReceivingScreen. With no tag in the draft it shows the scanner.
export function CountItemScreenContent({ homeRoute }: { homeRoute: string }) {
  const store = useCountStore();
  const { user, activeProject, loading } = useAuthStore();
  const reference = useCountReference({ refresh: false });
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ title: string; synced: boolean } | null>(null);
  const [scanMessage, setScanMessage] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  useEffect(() => { setSaved(null); setEditing(false); setError(''); setScanMessage(''); }, [user?.id, activeProject?.id]);
  // The confirmation belongs to the visit that saved; leaving by the tab bar ends it.
  useFocusEffect(useCallback(() => () => { setSaved(null); setScanMessage(''); }, []));
  const treeKnown = !!reference.data.savedAt;
  const step = Math.max(0, Math.min(store.step, REVIEW));
  const next = (number: number) => { store.setStep(editing ? REVIEW : number); setEditing(false); setError(''); };
  const back = (number: number) => { store.setStep(editing ? REVIEW : number); setEditing(false); };
  const edit = (number: number) => { setEditing(true); store.setStep(number); setError(''); };

  const handleTag = async (code: string) => {
    if (lookingUp) return;
    setLookingUp(true); setScanMessage('');
    try {
      const result = await beginCount(code, reference.data);
      if (!result.started) setScanMessage(result.message ?? 'Scan the tag again.');
      else setEditing(false);
    } finally { setLookingUp(false); }
  };

  const handleSubmit = async () => {
    if (submitLock.current || !user || !activeProject || loading) return;
    const draft = useCountStore.getState();
    const issue = countReviewIssue(draft) ?? categoryAvailabilityIssue(draft.category, reference.data.categories, treeKnown);
    if (issue) { setError(issue.message); return; }
    const accountId = user.id, projectId = activeProject.id, operationId = draft.operationId;
    const sameContext = () => {
      const current = useAuthStore.getState();
      return current.user?.id === accountId && current.activeProject?.id === projectId;
    };
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const count = buildCountPayload(draft);
      const zoneName = draft.location.zoneName || undefined;
      await addToQueue({ type: 'count', payload: { count, photos: draft.photos, categoryLabel: draft.category.label || undefined, zoneName } }, operationId);
      if (sameContext()) await recordCountLocally(count, zoneName ?? null).catch(() => {});
      // Only clear the exact draft that was persisted; keep its category and zone for the next item.
      if (sameContext() && useCountStore.getState().operationId === operationId) useCountStore.getState().countNext();
      if (!sameContext()) return;
      const title = `${count.name} · ${count.tag}`;
      setSaved({ title, synced: false });
      if (useNetworkStore.getState().isOnline) {
        // Saving and uploading are separate outcomes. A failed upload remains in Sync.
        void processQueue().then(async () => {
          const pending = await getQueue();
          if (sameContext() && !pending.some(item => item.id === operationId)) setSaved({ title, synced: true });
        }).catch(() => {});
      }
    } catch (e: any) { if (sameContext()) setError(`Could not save: ${e.message ?? 'Please try again'}. Your count is still here.`); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  if (saved) return <ScrollView contentContainerStyle={styles.confirmation}>
    <Stack.Screen options={{ headerShown: true, title: 'Count saved' }} />
    <Text style={styles.confirmTitle} accessibilityRole="header">{saved.synced ? 'Count synced' : 'Count saved'}</Text>
    <Text style={styles.confirmItem}>{saved.title}</Text>
    <Text style={styles.hint}>{saved.synced ? 'The count and its photos were uploaded.' : 'Saved on this device. It uploads when online; Sync shows anything waiting.'}</Text>
    <Button title="Count next" onPress={() => { setSaved(null); setScanMessage(''); }} />
    <Button title="View Sync" variant="secondary" onPress={() => router.push('/sync')} />
    <Button title="Done" variant="ghost" onPress={() => { setSaved(null); router.replace(homeRoute as any); }} />
  </ScrollView>;

  if (!store.tag) return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: 'Scan a tag' }} />
    <View style={styles.progress}>
      <Text style={styles.hint}>Scan the item's tag. The QR value is the tag number.{store.category.label ? ` Category kept: ${store.category.label}.` : ''}{store.location.zoneName ? ` Zone kept: ${store.location.zoneName}.` : ''}</Text>
      {lookingUp ? <Text style={styles.hint} accessibilityLiveRegion="polite">Looking up tag…</Text> : null}
      <Toast visible={!!scanMessage} tone="warn" title="Can't count this tag" message={scanMessage} />
    </View>
    <QRScanner onScan={handleTag} />
    <View style={styles.footer}><Button title="Back to Count" variant="secondary" onPress={() => router.replace(homeRoute as any)} /></View>
  </View>;

  return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: STEP_TITLES[step], gestureEnabled: !submitting }} />
    <View style={styles.progress}>
      <Text style={styles.stepLabel} accessibilityRole="header">Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}</Text>
      <View style={styles.stepBar} accessibilityRole="progressbar" accessibilityLabel="Count progress" accessibilityValue={{ min: 1, max: STEP_TITLES.length, now: step + 1, text: STEP_TITLES[step] }}>
        {STEP_TITLES.map((title, i) => <View key={title} style={[styles.stepSegment, i <= step && styles.stepActive]} />)}
      </View>
      <Text style={styles.tagLabel}>Tag: {store.tag}</Text>
      {editing && step !== REVIEW && <><Text style={styles.hint}>Continue to keep changes and return to review.</Text><Button title="Cancel edits" variant="ghost" onPress={() => back(REVIEW)} /></>}
    </View>
    {step === 0 && <CountItemStep onNext={() => next(1)} onBack={editing ? undefined : () => router.replace(homeRoute as any)} />}
    {step === 1 && <CountCategoryStep categories={reference.data.categories} treeKnown={treeKnown} onNext={() => next(2)} onBack={() => back(0)} />}
    {step === 2 && <CountLocationStep reference={reference.data} onNext={() => next(3)} onBack={() => back(1)} />}
    {step === 3 && <CountReviewStep categories={reference.data.categories} treeKnown={treeKnown} onEdit={edit} onSubmit={handleSubmit} submitting={submitting || loading} error={error} />}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  progress: { paddingHorizontal: 20, paddingVertical: 12, gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  stepLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary }, stepBar: { flexDirection: 'row', gap: 6 }, stepSegment: { height: 4, flex: 1, borderRadius: 2, backgroundColor: colors.border }, stepActive: { backgroundColor: colors.brandPrimary }, tagLabel: { fontSize: 12, color: colors.textMuted },
  hint: { fontSize: 14, color: colors.textMuted, lineHeight: 20 }, footer: { padding: 16, backgroundColor: colors.surface },
  confirmation: { flexGrow: 1, padding: 24, gap: 16, backgroundColor: colors.canvas, justifyContent: 'center' }, confirmTitle: { fontSize: 26, fontWeight: '600', color: colors.textPrimary }, confirmItem: { fontSize: 18, color: colors.textPrimary },
});

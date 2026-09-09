import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { useReceivingStore } from '@/stores/receivingStore';
import { useAuthStore } from '@/stores/authStore';
import { processQueue } from '@/lib/sync/syncManager';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue, getQueue } from '@/lib/sync/offlineQueue';
import { receivingReviewIssue } from '@/lib/utils/receivingReview';
import { MaterialStep } from '@/components/forms/MaterialStep';
import { POStep } from '@/components/forms/POStep';
import { InspectionStep } from '@/components/forms/InspectionStep';
import { PhotoStep } from '@/components/forms/PhotoStep';
import { LocationStep } from '@/components/forms/LocationStep';
import { DecisionStep } from '@/components/forms/DecisionStep';
import { ReceivingReviewStep } from '@/components/forms/ReceivingReviewStep';
import { Button } from '@/components/ui/Button';
import { colors } from '@/lib/design/tokens';

const STEP_TITLES = ['Material details', 'PO / delivery', 'Photos', 'Inspection', 'Decision', 'Location', 'Review'];
export function ReceivingScreenContent() {
  const store = useReceivingStore();
  const { user, activeProject, loading } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ title: string; synced: boolean } | null>(null);
  useEffect(() => { setSaved(null); setEditing(false); setError(''); }, [user?.id, activeProject?.id]);
  const step = Math.max(0, Math.min(store.step, STEP_TITLES.length - 1));
  const next = (number: number) => { store.setStep(editing ? 6 : number); setEditing(false); setError(''); };
  const back = (number: number) => { store.setStep(editing ? 6 : number); setEditing(false); };
  const edit = (number: number) => { setEditing(true); store.setStep(number); setError(''); };
  const handleSubmit = async () => {
    if (submitLock.current || !user || !activeProject || loading) return;
    const draft = useReceivingStore.getState();
    const issue = receivingReviewIssue(draft);
    if (issue) { setError(issue.message); return; }
    const accountId = user.id, projectId = activeProject.id, operationId = draft.operationId;
    const sameContext = () => {
      const current = useAuthStore.getState();
      return current.user?.id === accountId && current.activeProject?.id === projectId;
    };
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      await addToQueue({ type: 'receiving', payload: {
        qrCodeValue: draft.qrCodeValue, material: draft.material, po: draft.po,
        inspection: draft.inspection, photos: draft.photos, location: draft.location,
        decision: draft.decision, userId: accountId,
      } }, operationId);
      // Only clear the exact draft that was persisted; a project switch may have restored another.
      if (sameContext() && useReceivingStore.getState().operationId === operationId) useReceivingStore.getState().reset();
      if (!sameContext()) return;
      const title = [draft.material.material_type, draft.po.po_number].filter(Boolean).join(' · ');
      setSaved({ title, synced: false });
      if (useNetworkStore.getState().isOnline) {
        // Saving and uploading are separate outcomes. A failed upload remains in Sync.
        void processQueue().then(async () => {
          const pending = await getQueue();
          if (sameContext() && !pending.some(item => item.id === operationId)) setSaved({ title, synced: true });
        }).catch(() => {});
      }
    } catch (e: any) { if (sameContext()) setError(`Could not save: ${e.message ?? 'Please try again'}. Your draft is still available.`); }
    finally { submitLock.current = false; setSubmitting(false); }
  };
  if (saved) return <ScrollView contentContainerStyle={styles.confirmation}>
    <Stack.Screen options={{headerShown:true,title:'Receiving saved'}} />
    <Text style={styles.confirmTitle} accessibilityRole="header">{saved.synced ? 'Receiving synced' : 'Receiving saved'}</Text>
    <Text style={styles.confirmMaterial}>{saved.title}</Text>
    <Text style={styles.hint}>{saved.synced ? 'The receipt and its photos were uploaded successfully.' : 'Your submission was saved for upload. Sync shows any pending uploads or actions needed.'}</Text>
    <Button title="View Sync" onPress={() => router.replace('/sync')} />
    <Button title="Done" variant="secondary" onPress={() => router.back()} />
  </ScrollView>;
  return <View style={styles.container}>
    <Stack.Screen options={{ headerShown:true, title:STEP_TITLES[step], headerBackTitle:'Back', gestureEnabled:!submitting }} />
    <View style={styles.progress}>
      <Text style={styles.stepLabel} accessibilityRole="header">Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}</Text>
      <View style={styles.stepBar} accessibilityRole="progressbar" accessibilityLabel="Receiving progress" accessibilityValue={{min:1,max:STEP_TITLES.length,now:step+1,text:STEP_TITLES[step]}}>
        {STEP_TITLES.map((title, i) => <View key={title} style={[styles.stepSegment,i<=step&&styles.stepActive]} />)}
      </View>
      <Text style={styles.qrLabel}>QR: {store.qrCodeValue}</Text>
      {editing && <><Text style={styles.hint}>{step === 2 ? 'Photo changes are kept as you add or remove them.' : 'Continue to keep changes and return to review.'}</Text><Button title={step === 2 ? "Back to review" : "Cancel edits"} variant="ghost" onPress={() => back(6)} /></>}
    </View>
    {step === 0 && <MaterialStep onNext={() => next(1)} />}
    {step === 1 && <POStep onNext={() => next(2)} onBack={() => back(0)} />}
    {step === 2 && <PhotoStep onNext={() => next(3)} onBack={() => back(1)} />}
    {step === 3 && <InspectionStep onNext={() => next(4)} onBack={() => back(2)} />}
    {step === 4 && <DecisionStep onNext={() => next(5)} onBack={() => back(3)} />}
    {step === 5 && <LocationStep onNext={() => next(6)} nextTitle="Review receiving" onBack={() => back(4)} />}
    {step === 6 && <ReceivingReviewStep onEdit={edit} onSubmit={handleSubmit} submitting={submitting || loading} error={error} />}
  </View>;
}
const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:colors.canvas}, progress:{paddingHorizontal:20,paddingVertical:12,gap:8,backgroundColor:colors.surface,borderBottomWidth:1,borderBottomColor:colors.border},
  stepLabel:{fontSize:15,fontWeight:'600',color:colors.textPrimary},stepBar:{flexDirection:'row',gap:6},stepSegment:{height:4,flex:1,borderRadius:2,backgroundColor:colors.border},stepActive:{backgroundColor:colors.brandPrimary},qrLabel:{fontSize:12,color:colors.textMuted},
  hint:{fontSize:14,color:colors.textMuted,lineHeight:20},confirmation:{flexGrow:1,padding:24,gap:16,backgroundColor:colors.canvas,justifyContent:'center'},confirmTitle:{fontSize:26,fontWeight:'600',color:colors.textPrimary},confirmMaterial:{fontSize:18,color:colors.textPrimary},
});

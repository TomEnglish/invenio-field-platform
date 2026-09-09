import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, Redirect } from 'expo-router';
import { getQueue, subscribeQueue, retryQueueItem, belongsToCurrentContext, type QueueItem } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { queueSummary, queueRecoveryMessage } from '@/lib/sync/queuePresentation';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { Button } from '@/components/ui/Button';
import { colors } from '@/lib/design/tokens';

function SupportDetails({ title = 'Support details', children }: {title?: string; children: ReactNode}) {
  const [expanded,setExpanded] = useState(false);
  return <View><Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded}} onPress={() => setExpanded(!expanded)} style={styles.disclosure}><Text style={styles.link}>{expanded ? '−' : '+'} {title}</Text></Pressable>{expanded && <View style={styles.support}>{children}</View>}</View>;
}
export default function SyncScreen() {
  const { user, activeProject, accessMode, loading } = useAuthStore();
  const online = useNetworkStore(s => s.isOnline);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const refreshRequest = useRef(0);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueError, setQueueError] = useState('');
  const refreshQueue = useCallback(async () => {
    const request = ++refreshRequest.current;
    const current = () => request === refreshRequest.current && useAuthStore.getState().user?.id === user?.id && useAuthStore.getState().activeProject?.id === activeProject?.id;
    try {
      const all = await getQueue();
      if (current()) {
        setItems(all.filter(belongsToCurrentContext));
        setLegacy(all.some(i => !i.userId || !i.projectId));
        setQueueLoaded(true); setQueueError('');
      }
    } catch (e: any) {
      if (current()) { setQueueLoaded(true); setQueueError(`Saved submissions could not be read: ${e.message}. Keep app storage intact and retry.`); }
    }
  }, [user?.id, activeProject?.id]);
  useFocusEffect(useCallback(() => {
    setItems([]); setError(''); setResult(''); setQueueLoaded(false); setQueueError('');
    void refreshQueue();
    const unsubscribe = subscribeQueue(() => { void refreshQueue(); });
    return () => { ++refreshRequest.current; unsubscribe(); };
  }, [refreshQueue]));
  const sync = async (id?: string) => {
    setBusy(true); setError(''); setResult('');
    const accountId = user?.id, projectId = activeProject?.id;
    const sameContext = () => useAuthStore.getState().user?.id === accountId && useAuthStore.getState().activeProject?.id === projectId;
    try {
      if (useAuthStore.getState().accessMode !== 'online') await useAuthStore.getState().loadSession();
      if (!sameContext()) return;
      if (useAuthStore.getState().accessMode !== 'online') throw new Error('Online access could not be verified. Saved work is preserved.');
      if (id) await retryQueueItem(id);
      const completed = await processQueue();
      if (sameContext()) {
        await refreshQueue();
        if (!sameContext()) return;
        setResult(`${completed.processed} submission${completed.processed === 1 ? '' : 's'} synced.${completed.failed ? ` ${completed.failed} need attention below.` : ''}`);
      }
    } catch (e: any) { if (sameContext()) setError(e.message); }
    finally { setBusy(false); }
  };
  if (!user) return <Redirect href="/" />;
  const visible = items.filter(belongsToCurrentContext);
  const canSync = online && !loading && !!activeProject && activeProject.status === 'active';
  return <ScrollView contentContainerStyle={styles.content}>
    <Stack.Screen options={{ headerShown:true,title:'Sync & recovery',headerBackTitle:'Back' }} />
    <Text style={styles.title} accessibilityRole="header">{activeProject?.name ?? 'Select a project'}</Text>
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>{!queueLoaded ? 'Loading saved submissions…' : queueError ? 'Saved submissions unavailable' : `${visible.length} pending submission${visible.length === 1 ? '' : 's'}`}</Text>
      <Text style={styles.muted}>{online ? 'Device online' : 'Device offline'} · Saved work stays on this device until it uploads.</Text>
      <Button title="Sync now" onPress={() => sync()} loading={busy} disabled={!canSync || visible.length === 0} />
    </View>
    {busy && <Text accessibilityLiveRegion="polite" style={styles.muted}>Syncing saved submissions…</Text>}
    {result ? <Text accessibilityLiveRegion="polite" style={styles.text}>{result}</Text> : null}
    {accessMode === 'offline' && <Text style={styles.warning}>Using previously verified access. Uploads wait for online access checks.</Text>}
    {activeProject?.status === 'completed' && <Text style={styles.warning}>This project is completed. Saved submissions are preserved; ask an administrator about any unfinished uploads.</Text>}
    {queueError ? <View style={styles.summary}><Text accessibilityRole="alert" style={styles.error}>{queueError}</Text><Button title="Retry reading saved work" variant="secondary" onPress={() => { void refreshQueue(); }} /></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {legacy && <Text style={styles.warning}>Older submissions with unknown account or project were preserved. Ask your administrator to review this device before clearing app storage.</Text>}
    {queueLoaded && !queueError && visible.length === 0 && <View style={styles.empty}><Text style={styles.summaryTitle}>No pending submissions</Text><Text style={styles.muted}>This project's upload queue is clear. Switch projects to review other saved work.</Text></View>}
    {visible.map(item => {
      const summary = queueSummary(item);
      return <View key={item.id} style={styles.item}>
        <Text style={styles.itemTitle} accessibilityRole="header">{summary.title}</Text>
        <Text style={styles.muted}>{summary.detail}</Text>
        <Text style={item.deadLetter || item.lastError ? styles.warning : styles.status}>{item.deadLetter ? 'Needs attention' : item.lastError ? 'Upload interrupted' : 'Saved on device'}</Text>
        <Text style={styles.muted}>Saved {new Date(item.createdAt).toLocaleString()}</Text>
        <Text style={styles.text}>{queueRecoveryMessage(item)}</Text>
        <Button title={item.lastError || item.deadLetter ? 'Retry upload' : 'Upload now'} accessibilityLabel={`Upload ${summary.title}`} disabled={!canSync || busy} onPress={() => sync(item.id)} variant="secondary" />
        <SupportDetails><Text selectable style={styles.supportText}>Submission: {item.id}</Text><Text selectable style={styles.supportText}>Attempts: {item.retryCount ?? 0}</Text>{item.lastError ? <Text selectable style={styles.supportText}>Last error: {item.lastError}</Text> : null}</SupportDetails>
      </View>;
    })}
    <SupportDetails title="App version & support"><Text selectable style={styles.supportText}>Version {Constants.expoConfig?.version ?? 'unknown'} · Runtime {Updates.runtimeVersion || 'development'} · Channel {Updates.channel || 'development'}</Text><Text selectable style={styles.supportText}>Running update: {Updates.updateId ?? (Updates.isEmbeddedLaunch ? 'Included in the installed app' : 'Development / web')}</Text><Text style={styles.muted}>Share the submission ID, last error, and running update when requesting help.</Text></SupportDetails>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content:{padding:20,gap:16,backgroundColor:colors.canvas,flexGrow:1},title:{fontSize:22,color:colors.textPrimary,fontWeight:'600'},summary:{gap:12},summaryTitle:{fontSize:18,fontWeight:'600',color:colors.textPrimary},text:{fontSize:14,color:colors.textPrimary,lineHeight:20},muted:{fontSize:14,color:colors.textMuted,lineHeight:20},warning:{color:colors.warnDeep,fontSize:14,lineHeight:20},error:{color:colors.danger,fontSize:14},
  empty:{gap:8,paddingVertical:16},item:{padding:16,gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:colors.surface},itemTitle:{fontSize:18,fontWeight:'600',color:colors.textPrimary},status:{fontSize:14,color:colors.brandPrimary,fontWeight:'600'},disclosure:{minHeight:44,justifyContent:'center',paddingVertical:12},link:{color:colors.brandPrimary,fontSize:14,fontWeight:'600'},support:{gap:8,paddingBottom:8},supportText:{fontSize:12,color:colors.textMuted},
});

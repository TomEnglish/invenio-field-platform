import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { Stack, useFocusEffect, Redirect } from 'expo-router';
import { getQueue, subscribeQueue, retryQueueItem, belongsToCurrentContext, type QueueItem } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { Button } from '@/components/ui/Button';
import { colors } from '@/lib/design/tokens';
export default function SyncScreen() {
  const { user, activeProject, accessMode, loading } = useAuthStore();
  const online = useNetworkStore(s => s.isOnline);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const all = await getQueue();
      setItems(all.filter(belongsToCurrentContext));
      setLegacy(all.some(i => !i.userId || !i.projectId));
    } catch (e: any) { setError(e.message); }
  };
  useFocusEffect(useCallback(() => {
    let current = true;
    const refresh = async () => {
      try {
        const all = await getQueue();
        if (current) { setItems(all.filter(belongsToCurrentContext)); setLegacy(all.some(i => !i.userId || !i.projectId)); }
      } catch (e: any) { if (current) setError(e.message); }
    };
    void refresh();
    const unsubscribe = subscribeQueue(() => { void refresh(); });
    return () => { current = false; unsubscribe(); };
  }, [user?.id, activeProject?.id]));
  const sync = async (id?: string) => {
    setBusy(true); setError('');
    try {
      if (useAuthStore.getState().accessMode !== 'online') await useAuthStore.getState().loadSession();
      if (useAuthStore.getState().accessMode !== 'online') throw new Error('Online access could not be verified. Saved work is preserved.');
      if (id) await retryQueueItem(id);
      await processQueue(); await load();
    }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!user) return <Redirect href="/" />;
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16, backgroundColor: colors.canvas, flexGrow: 1 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Sync & recovery', headerBackTitle: 'Back' }} />
    <Text style={{ fontSize: 22, color: colors.textPrimary }}>{activeProject?.name ?? 'Select a project'}</Text>
    <Text style={{ color: colors.textMuted }}>{online ? 'Connected' : 'Offline'} · {items.length} saved submissions in this project. Switch projects to review other work.</Text>
    <Button title="Sync now" onPress={() => sync()} loading={busy} disabled={!online || loading || !activeProject || activeProject.status !== 'active'} />
    {accessMode === 'offline' && <Text style={{ color: colors.warnDeep }}>Using previously verified access for local work. Uploads wait for online access checks.</Text>}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
    {legacy && <Text style={{ color: colors.warnDeep }}>Older submissions with unknown account or project were preserved. Ask your administrator to review this device before clearing app storage.</Text>}
    {items.length === 0 && <Text style={{ color: colors.textMuted }}>No pending submissions in this project.</Text>}
    {items.filter(belongsToCurrentContext).map(item => <View key={item.id} style={{ padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{item.action.type} · {item.deadLetter ? 'Needs attention' : item.lastError ? 'Retry pending' : 'Waiting to upload'}</Text>
      <Text style={{ color: colors.textMuted }}>{new Date(item.createdAt).toLocaleString()}</Text>
      <Text selectable style={{ color: colors.textMuted }}>Submission: {item.id}</Text>
      {item.lastError && <Text style={{ color: colors.danger }}>{item.lastError}</Text>}
      <Button title="Retry this submission" disabled={!online || busy || loading || activeProject?.status !== 'active'} onPress={() => sync(item.id)} />
    </View>)}
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 4 }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>App version</Text>
      <Text selectable style={{ color: colors.textMuted }}>Version {Constants.expoConfig?.version ?? 'unknown'} · Runtime {Updates.runtimeVersion || 'development'} · Channel {Updates.channel || 'development'}</Text>
      <Text selectable style={{ color: colors.textMuted }}>Running update: {Updates.updateId ?? (Updates.isEmbeddedLaunch ? 'Included in the installed app' : 'Development / web')}</Text>
      <Text style={{ color: colors.textMuted }}>Use this update ID to confirm a published update is running on this device.</Text>
    </View>
  </ScrollView>;
}

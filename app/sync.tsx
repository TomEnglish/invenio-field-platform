import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { Stack, useFocusEffect, Redirect } from 'expo-router';
import { getQueue, retryQueueItem, belongsToCurrentContext, type QueueItem } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { Button } from '@/components/ui/Button';
import { colors } from '@/lib/design/tokens';
export default function SyncScreen() {
  const { user, activeProject } = useAuthStore();
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
  useFocusEffect(useCallback(() => { void load(); }, [user?.id, activeProject?.id]));
  const sync = async (id?: string) => {
    setBusy(true); setError('');
    try { if (id) await retryQueueItem(id); await processQueue(); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!user) return <Redirect href="/" />;
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16, backgroundColor: colors.canvas, flexGrow: 1 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Sync & recovery' }} />
    <Text style={{ fontSize: 22, color: colors.textPrimary }}>{activeProject?.name ?? 'Select a project'}</Text>
    <Text style={{ color: colors.textMuted }}>{online ? 'Connected' : 'Offline'} · {items.length} saved submissions in this project. Switch projects to review other work.</Text>
    <Button title="Sync now" onPress={() => sync()} loading={busy} disabled={!online || !activeProject} />
    {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
    {legacy && <Text style={{ color: colors.warnDeep }}>Older submissions with unknown account or project were preserved. Ask your administrator to review this device before clearing app storage.</Text>}
    {items.length === 0 && <Text style={{ color: colors.textMuted }}>No pending submissions in this project.</Text>}
    {items.map(item => <View key={item.id} style={{ padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{item.action.type} · {item.deadLetter ? 'Needs attention' : item.lastError ? 'Retry pending' : 'Waiting to upload'}</Text>
      <Text style={{ color: colors.textMuted }}>{new Date(item.createdAt).toLocaleString()}</Text>
      <Text selectable style={{ color: colors.textMuted }}>Submission: {item.id}</Text>
      {item.lastError && <Text style={{ color: colors.danger }}>{item.lastError}</Text>}
      <Button title="Retry this submission" disabled={!online || busy} onPress={() => sync(item.id)} />
    </View>)}
  </ScrollView>;
}

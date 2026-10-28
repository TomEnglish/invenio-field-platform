import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toast } from '@/components/ui/Toast';
import { useCountReference } from '@/components/inventory/useCountReference';
import { beginCount } from '@/components/inventory/beginCount';
import { useCountStore } from '@/stores/countStore';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { belongsToCurrentContext, getQueue, subscribeQueue, type QueueItem } from '@/lib/sync/offlineQueue';
import { countProgress, outstandingTags, recentCounts, shortDate } from '@/lib/inventory/count';
import { areaPathLabel, buildAreaTree } from '@/lib/inventory/areas';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

const LIST_LIMIT = 50;
type PendingCount = { id: string; tag: string; name: string; zoneName?: string; stuck: boolean };

function pendingCounts(queue: QueueItem[]): PendingCount[] {
  return queue.filter(item => item.action?.type === 'count' && belongsToCurrentContext(item)).map(item => {
    const payload = item.action.payload as { count?: { tag?: string; name?: string }; zoneName?: string };
    return { id: item.id, tag: payload.count?.tag ?? '', name: payload.count?.name ?? 'Inventory count', zoneName: payload.zoneName, stuck: !!item.deadLetter };
  });
}

// Count home: project progress, Scan, the expected tags not yet found,
// recent counts and Continue for a saved draft.
export function CountHomeScreenContent({ countItemRoute }: { countItemRoute: string }) {
  const projectName = useAuthStore(s => s.activeProject?.name);
  const online = useNetworkStore(s => s.isOnline);
  const draft = useCountStore();
  const { data, loading, error, reload } = useCountReference({ refresh: true });
  const [pulling, setPulling] = useState(false);
  const [pending, setPending] = useState<PendingCount[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [opening, setOpening] = useState(false);

  useFocusEffect(useCallback(() => {
    let live = true;
    const refresh = () => { void getQueue().then(queue => { if (live) setPending(pendingCounts(queue)); }).catch(() => {}); };
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => { live = false; unsubscribe(); };
  }, []));

  // Counts the server keeps refusing are not counted as found.
  const pendingTags = pending.filter(p => !p.stuck).map(p => p.tag);
  const progress = countProgress(data.items, pendingTags);
  const outstanding = outstandingTags(data.items, pendingTags, query);
  const recent = recentCounts(data.items.filter(item => !pending.some(p => p.tag === item.qr_code.trim())), 10);
  const areaTree = buildAreaTree(data.zones);
  const zoneName = (id: string | null, fallback: string | null) => (id && areaPathLabel(areaTree, id)) || fallback || '';
  const percent = progress.total ? Math.round((progress.found / progress.total) * 100) : 0;
  const nothingSetUp = !loading && data.items.length === 0 && data.categories.length === 0 && data.maps.length === 0;

  const openTag = async (tag: string) => {
    if (opening) return;
    setOpening(true); setMessage('');
    try {
      const result = await beginCount(tag, data);
      if (result.started) router.push(countItemRoute as any);
      else setMessage(result.message ?? 'This tag cannot be counted.');
    } finally { setOpening(false); }
  };

  const savedAt = data.savedAt ? `${shortDate(data.savedAt)} ${new Date(data.savedAt).toTimeString().slice(0, 5)}` : '';
  const status = loading && !savedAt ? 'Loading count data…'
    : !savedAt ? (online ? 'Count data could not be loaded. Pull down to retry.' : 'Offline · open Count once while online to save categories, site plans and expected tags.')
    : error ? `Could not refresh · using data saved ${savedAt}`
    : online ? `Updated ${savedAt} · saved for offline use` : `Offline · using data saved ${savedAt}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { setPulling(true); void reload(true).finally(() => setPulling(false)); }} />}>
      <Text style={styles.title} accessibilityRole="header">Initial count{projectName ? ` · ${projectName}` : ''}</Text>
      <Text style={styles.muted} accessibilityLiveRegion="polite">{status}</Text>
      {error && !loading ? <Text style={styles.warning}>{error}</Text> : null}

      <Card style={styles.card}>
        <View style={styles.stats} accessibilityRole="summary">
          <Stat label="Expected" value={progress.expected} color={colors.warn} />
          <Stat label="Counted" value={progress.counted} color={colors.brandPrimary} />
          <Stat label="Received" value={progress.received} color={colors.success} />
        </View>
        <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel="Tags found" accessibilityValue={{ min: 0, max: progress.total, now: progress.found }}>
          <View style={[styles.barFill, { width: `${percent}%` }]} />
        </View>
        <Text style={styles.muted}>{progress.found} of {progress.total} tags found{pendingTags.length ? ` · ${pendingTags.length} waiting to sync` : ''}</Text>
      </Card>

      {draft.tag ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Count in progress</Text>
          <Text style={styles.text}>{[draft.tag, draft.item.name].filter(Boolean).join(' · ')}</Text>
          <Button title="Continue" onPress={() => router.push(countItemRoute as any)} />
          <Button title="Discard this item" variant="ghost" onPress={() => useCountStore.getState().countNext()} />
        </Card>
      ) : (
        <Button title="Scan a tag" onPress={() => { setMessage(''); router.push(countItemRoute as any); }} />
      )}
      <Toast visible={!!message} tone="warn" title="Can't count this tag" message={message} onDismiss={() => setMessage('')} />
      {nothingSetUp ? <Text style={styles.muted}>The office hasn't imported expected tags, categories or a site plan yet. You can still count new tags and propose categories.</Text> : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Not found yet ({outstandingTags(data.items, pendingTags).length})</Text>
      <Input label="Search expected tags" value={query} onChangeText={setQuery} placeholder="Tag, name or part #" autoCorrect={false} autoCapitalize="none" />
      {outstanding.length === 0 ? <Text style={styles.muted}>{query ? 'No expected tag matches.' : data.items.length ? 'Every expected tag has been found.' : 'No expected tags on this device.'}</Text> : null}
      {outstanding.slice(0, LIST_LIMIT).map(item => (
        <Pressable key={item.qr_code} accessibilityRole="button" accessibilityLabel={`Count ${item.qr_code} ${item.inventory_item}`} disabled={!!draft.tag || opening}
          onPress={() => { void openTag(item.qr_code); }} style={({ pressed }) => [styles.row, pressed && styles.rowPressed, !!draft.tag && styles.rowDisabled]}>
          <Text style={styles.rowTitle}>{item.qr_code}</Text>
          <Text style={styles.text}>{item.inventory_item}{item.part_number ? ` · ${item.part_number}` : ''}</Text>
        </Pressable>
      ))}
      {outstanding.length > LIST_LIMIT ? <Text style={styles.muted}>Showing {LIST_LIMIT} of {outstanding.length}. Search to narrow the list.</Text> : null}
      {draft.tag && outstanding.length ? <Text style={styles.muted}>Finish or discard the count in progress to start another.</Text> : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Recent counts</Text>
      {pending.length === 0 && recent.length === 0 ? <Text style={styles.muted}>No counts yet.</Text> : null}
      {pending.map(p => (
        <View key={p.id} style={styles.row}>
          <Text style={styles.rowTitle}>{p.name}</Text>
          <Text style={styles.text}>{[p.tag, p.zoneName].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.pending}>{p.stuck ? 'Needs attention in Sync' : 'Waiting to sync'}</Text>
        </View>
      ))}
      {recent.map(item => (
        <View key={item.qr_code} style={styles.row}>
          <Text style={styles.rowTitle}>{item.inventory_item}</Text>
          <Text style={styles.text}>{[item.qr_code, `${Number(item.quantity) || 1} ${item.uom ?? 'EA'}`, zoneName(item.zone_id, item.location), shortDate(item.counted_at)].filter(Boolean).join(' · ')}</Text>
          <Text style={item.count_status === 'received' ? styles.received : styles.counted}>{item.count_status === 'received' ? 'Received' : 'Counted'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={styles.stat}><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.muted}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space[4], paddingBottom: space[10], gap: space[3] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary, marginTop: space[2] },
  text: { fontSize: fontSize.body, color: colors.textPrimary },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  warning: { fontSize: fontSize.sm, color: colors.warnDeep },
  card: { gap: space[3] },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  bar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.raised, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brandPrimary },
  row: { minHeight: touchTarget, padding: space[3], gap: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowPressed: { backgroundColor: colors.raised },
  rowDisabled: { opacity: 0.6 },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  pending: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.warnDeep },
  counted: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.brandPrimary },
  received: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.success },
});

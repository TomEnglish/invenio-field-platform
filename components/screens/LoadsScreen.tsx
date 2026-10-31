import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { newOperationId } from '@/lib/utils/operationId';
import { shortDate } from '@/lib/inventory/count';
import { LOAD_STATUS_LABELS, loadLabel, OPEN_LOADS, type Load } from '@/lib/logistics/loads';
import { colors } from '@/lib/design/tokens';

const ORDER: Record<string, number> = { in_transit: 0, loading: 1, planning: 2 };
const summary = (load: Load) => {
  const pieces = load.status === 'in_transit'
    ? `${load.delivered_count} delivered, ${load.on_board_count} on board${load.missing_count ? `, ${load.missing_count} missing` : ''}`
    : `${load.on_board_count} of ${load.on_board_count + load.planned_count} on board`;
  return [pieces, load.driver_name ? `Driver ${load.driver_name}` : null].filter(Boolean).join(' · ');
};

// The Loads tab: this project's open loads (planning, loading, in transit)
// from the device's copy, and New load. A load made offline shows as "New
// load" until it syncs and gets its number.
export function LoadsScreenContent({ loadRoute, editRoute }: { loadRoute: string; editRoute: string }) {
  const online = useNetworkStore(s => s.isOnline);
  const { loads, data, pending, loading, source, error, reload } = useLoadReference({ refresh: true });
  const [pulling, setPulling] = useState(false);
  const open = [...loads.loads.values()].filter(load => OPEN_LOADS.includes(load.status))
    .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.planned_date ?? '9').localeCompare(b.planned_date ?? '9') || (a.load_number ?? '').localeCompare(b.load_number ?? ''));
  const waiting = new Set(pending.map(item => (item.action.payload as any)?.op?.loadId ?? (item.action.payload as any)?.loadId).filter(Boolean));
  const copyNote = source === 'online' && !error ? '' : data.savedAt ? `${online ? 'Couldn’t refresh' : 'Offline'}: this device's copy from ${shortDate(data.savedAt)}` : online ? '' : 'Offline: no loads saved on this device yet.';

  return <ScrollView
    style={styles.container}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await reload(true); setPulling(false); }} />}
  >
    <Button title="New load" onPress={() => router.push({ pathname: editRoute as any, params: { id: newOperationId(), new: '1' } })} />
    {loading && !data.savedAt ? <Text style={styles.muted}>Loading loads…</Text> : null}
    {!loading && open.length === 0 ? <Text style={styles.muted}>No open loads. Start one with New load, or pull to refresh.</Text> : null}
    {open.map(load => <Pressable key={load.id} accessibilityRole="button" accessibilityLabel={`${loadLabel(load)}, ${LOAD_STATUS_LABELS[load.status]}. Open it.`}
      onPress={() => router.push({ pathname: loadRoute as any, params: { id: load.id } })} style={styles.card}>
      <View style={styles.titleRow}>
        <FontAwesome name="truck" size={16} color={colors.brandPrimary} />
        <Text style={styles.heading}>{loadLabel(load)}</Text>
        <Text style={[styles.badge, load.status === 'in_transit' ? styles.good : null]}>{LOAD_STATUS_LABELS[load.status]}</Text>
        {waiting.has(load.id) ? <Text style={[styles.badge, styles.caution]}>Waiting to upload</Text> : null}
      </View>
      <Text style={styles.text}>{[load.origin_name, load.next_stop].filter(Boolean).join(' → ') || 'No stops yet'}</Text>
      <Text style={styles.muted}>{summary(load)}{load.planned_date ? ` · ${load.planned_date}` : ''}</Text>
    </Pressable>)}
    {copyNote ? <Text style={styles.muted}>{copyNote}</Text> : null}
    {error && source !== 'online' ? <Text style={styles.muted}>{error}</Text> : null}
  </ScrollView>;
}

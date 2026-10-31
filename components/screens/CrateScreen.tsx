import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet, Platform, AccessibilityInfo } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { usePackStore } from '@/stores/packStore';
import { groupRoute } from '@/components/logistics/routes';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue, getQueue, type QueueItem } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { newOperationId } from '@/lib/utils/operationId';
import { quantityText, shortDate } from '@/lib/inventory/count';
import {
  crateCode, isCrateCode, kindLabel, labelIssue, looksLikeCrate, packStart, STATUS_LABELS, unitAncestors, unitLoadText, unitName, unitWhere, unpackIssue,
  type PackQueuePayload,
} from '@/lib/logistics/crates';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

// Changes waiting in Sync that touch this crate.
function waitingFor(code: string, pending: QueueItem[]) {
  return pending.filter(item => {
    if (item.action.type === 'unpack') return crateCode(item.action.payload.unitCode) === code;
    if (item.action.type !== 'pack') return false;
    const { pack } = item.action.payload as PackQueuePayload;
    return crateCode(pack.unitCode) === code || [...(pack.add ?? []), ...(pack.remove ?? [])].some(tag => looksLikeCrate(tag) && crateCode(tag) === code);
  });
}

// One crate: what it is, where it is (or the crate it is inside), what it
// holds, and Pack / Unpack. Works from the device's copy when offline.
export function CrateScreenContent({ crateRoute, packRoute }: { crateRoute: string; packRoute: string }) {
  const { code: param } = useLocalSearchParams<{ code?: string }>();
  const code = crateCode(param ?? '');
  const online = useNetworkStore(s => s.isOnline);
  const { index, known, data, pending, refused, loading, source, error, reload } = useLoadReference({ refresh: true });
  const packing = usePackStore(s => s.code);
  const [pulling, setPulling] = useState(false);
  const [confirmUnpack, setConfirmUnpack] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warn' | 'info'; title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const unpackId = useRef(newOperationId());
  // The screen stays mounted between crates: each one starts clean.
  useEffect(() => { setConfirmUnpack(false); setMessage(null); setBlocked(false); unpackId.current = newOperationId(); }, [code]);
  // VoiceOver has no live regions: say what happened.
  useEffect(() => { if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(`${message.title}. ${message.text}`); }, [message]);

  const unit = index.units.get(code);
  const items = index.contents.get(code) ?? [];
  const inner = index.children.get(code) ?? [];
  const outer = unitAncestors(index, code);
  const waiting = waitingFor(code, pending);
  const turnedDown = waitingFor(code, refused);
  const where = unit ? unitWhere(unit) : '';
  // 022: a crate on a truck or missing (or inside one) can't change; a delivered one can.
  const packIssue = unit ? labelIssue(index, code) : null;
  const canPack = !packIssue;
  const canUnpack = !!unit && !unpackIssue(unit);
  const onLoad = unit ? unitLoadText(unit) : '';
  const open = (next: string) => router.push({ pathname: crateRoute as any, params: { code: next } });

  const pack = () => {
    setMessage(null); setBlocked(false);
    const current = usePackStore.getState();
    if (current.code && current.code !== code) {
      setMessage({ tone: 'warn', title: `You're packing ${current.code}`, text: 'Finish or discard that pack first, then pack this crate.' });
      setBlocked(true);
      return;
    }
    if (!current.code) {
      const issue = labelIssue(index, code);
      if (issue) { setMessage({ tone: 'warn', title: 'Can’t pack this crate', text: issue }); return; }
      const { before, start } = packStart(code, index, known);
      current.begin(code, before, start);
    }
    router.push(packRoute as any);
  };

  const askUnpack = () => {
    setMessage(null); setBlocked(false);
    // A pack draft of this crate would try to take out what the unpack already released.
    if (usePackStore.getState().code === code) {
      setMessage({ tone: 'warn', title: `You're packing ${code}`, text: 'Finish or discard that pack first, then unpack the crate.' });
      setBlocked(true);
      return;
    }
    setConfirmUnpack(true);
  };
  const unpack = async () => {
    if (busy || !canUnpack) return;
    const accountId = useAuthStore.getState().user?.id, projectId = useAuthStore.getState().activeProject?.id;
    const sameContext = () => useAuthStore.getState().user?.id === accountId && useAuthStore.getState().activeProject?.id === projectId;
    const operationId = unpackId.current;
    setBusy(true); setMessage(null);
    try {
      await addToQueue({ type: 'unpack', payload: { unitCode: code } }, operationId);
      unpackId.current = newOperationId();
      setConfirmUnpack(false);
      setMessage({ tone: 'info', title: `${code} unpacked on this device`, text: 'It uploads when online; Sync shows anything waiting.' });
      if (useNetworkStore.getState().isOnline) {
        void processQueue().then(async () => {
          const queue = await getQueue();
          if (!sameContext()) return;
          const left = queue.find(item => item.id === operationId);
          if (!left) setMessage({ tone: 'success', title: `${code} unpacked`, text: 'Everything inside is out where the crate stood.' });
          else if (left.lastError) setMessage({ tone: 'warn', title: 'The server refused the unpack', text: `${left.lastError}. Sync has the details.` });
        }).catch(() => {});
      }
    } catch (e: any) {
      if (sameContext()) setMessage({ tone: 'warn', title: 'Could not save the unpack', text: e.message ?? 'Please try again.' });
    } finally { setBusy(false); }
  };

  const copyNote = source === 'online' && !error
    ? `Up to date${data.savedAt ? ` · ${shortDate(data.savedAt)}` : ''}`
    : data.savedAt ? `${online ? 'Couldn’t refresh' : 'Offline'}: this device's copy from ${shortDate(data.savedAt)}` : online ? '' : 'Offline: no crates saved on this device yet. Open a crate once online.';

  return <ScrollView
    style={styles.container}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await reload(true); setPulling(false); }} />}
  >
    <Stack.Screen options={{ headerShown: true, title: code || 'Crate' }} />
    {!isCrateCode(code) ? <Text style={styles.text}>{code || 'This'} isn't a crate label. Labels read HU- and 4 to 20 letters or numbers.</Text>
    : !unit ? <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">{code}</Text>
      <Text style={styles.text}>{loading && !data.savedAt ? 'Looking for this crate…'
        : source === 'online' && !error ? 'This label hasn’t been packed yet. Pack it to start using it.'
        : 'This crate isn’t on this device’s copy. It may be new, or packed since the copy was saved.'}</Text>
      <Button title="Pack this crate" onPress={pack} disabled={!canPack} />
    </View>
    : <>
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">{code}</Text>
          <Text style={[styles.badge, unit.status === 'sealed' ? styles.sealed : styles.neutral]}>{STATUS_LABELS[unit.status] ?? unit.status}</Text>
          {unit.is_high_value ? <Text style={[styles.badge, styles.highValue]}>High value</Text> : null}
        </View>
        <Text style={styles.text}>{[kindLabel(unit.kind), unit.description].filter(Boolean).join(' · ')}</Text>
        <View style={styles.where}>
          <FontAwesome name="map-marker" size={16} color={colors.textMuted} />
          <View style={styles.whereText}>
            {outer[0] ? <Pressable accessibilityRole="button" accessibilityLabel={`Inside ${outer[0].code}. Open it.`} onPress={() => open(outer[0].code)} style={styles.link}>
              <Text style={styles.linkText}>Inside {outer[0].code}</Text>
            </Pressable> : null}
            {onLoad && unit.load_id ? <Pressable accessibilityRole="button" accessibilityLabel={`${onLoad}. Open the load.`} onPress={() => router.push({ pathname: groupRoute('load') as any, params: { id: unit.load_id! } })} style={styles.link}>
              <Text style={styles.linkText}>{onLoad}</Text>
            </Pressable> : null}
            <Text style={styles.text}>{where
              ? (unit.status === 'delivered' && !outer[0] ? `Delivered to ${where}` : unit.load_line_status === 'on_board' || unit.load_line_status === 'missing' ? `Last at ${where}` : outer[0] ? `At ${where}` : where)
              : outer[0] || onLoad ? '' : 'Location not recorded'}</Text>
          </View>
        </View>
      </View>

      {turnedDown.length ? <View style={styles.refused}>
        <Text style={styles.warning} accessibilityRole="alert">The server refused {turnedDown.length === 1 ? 'a change' : `${turnedDown.length} changes`} to this crate, so {turnedDown.length === 1 ? 'it isn’t' : 'they aren’t'} shown here. Sync has the reason.</Text>
        <Button title="View Sync" variant="ghost" onPress={() => router.push('/sync')} />
      </View> : null}
      {waiting.length ? <View style={styles.waiting}>
        <Text style={styles.text}>{waiting.length} change{waiting.length === 1 ? '' : 's'} to this crate {waiting.length === 1 ? 'is' : 'are'} waiting to upload, and already show here.</Text>
        <Button title="View Sync" variant="ghost" onPress={() => router.push('/sync')} />
      </View> : null}

      <View style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">Contents · {items.length} item{items.length === 1 ? '' : 's'}{inner.length ? `, ${inner.length} crate${inner.length === 1 ? '' : 's'}` : ''}</Text>
        {items.length === 0 && inner.length === 0 ? <Text style={styles.muted}>Nothing is packed in this crate.</Text> : null}
        {inner.map(child => <Pressable key={child.code} accessibilityRole="button" accessibilityLabel={`${child.code}, ${unitName(child)}. Open it.`} onPress={() => open(child.code)} style={styles.row}>
          <FontAwesome name="archive" size={16} color={colors.brandPrimary} />
          <View style={styles.rowText}><Text style={styles.rowTitle}>{child.code}</Text><Text style={styles.muted}>{unitName(child)}</Text></View>
          <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
        </Pressable>)}
        {items.map(item => <View key={item.tag} style={styles.row}>
          <View style={styles.rowText}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>Tag {item.tag} · {quantityText(item.quantity)} {item.uom}</Text></View>
        </View>)}
      </View>

      <View style={styles.actions}>
        {canPack ? <Button title={packing === code ? 'Continue packing' : 'Pack / add items'} onPress={pack} /> : <Text style={styles.muted}>{packIssue ?? `This crate is ${STATUS_LABELS[unit.status]?.toLowerCase() ?? unit.status}; it can’t be changed here.`}</Text>}
        {canUnpack && (confirmUnpack ? <View style={styles.confirm}>
          <Text accessibilityRole="alert" style={styles.warning}>Unpack {code}? Its {items.length} item{items.length === 1 ? '' : 's'}{inner.length ? ` and ${inner.length} crate${inner.length === 1 ? '' : 's'}` : ''} come out where it stands, and the label can be packed again.</Text>
          <Button title="Unpack crate" variant="danger" loading={busy} onPress={unpack} />
          <Button title="Keep it packed" variant="ghost" disabled={busy} onPress={() => setConfirmUnpack(false)} />
        </View> : <Button title="Unpack…" variant="secondary" onPress={askUnpack} />)}
      </View>
    </>}
    {message ? <Toast visible tone={message.tone} title={message.title} message={message.text} onDismiss={() => { setMessage(null); setBlocked(false); }} /> : null}
    {blocked && packing ? <Button title={`Continue packing ${packing}`} variant="secondary" onPress={() => router.push(packRoute as any)} /> : null}
    {copyNote ? <Text style={styles.muted}>{copyNote}</Text> : null}
    {error && source !== 'online' ? <Text style={styles.muted}>{error}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space[5], gap: space[4], flexGrow: 1 },
  section: { gap: space[2] },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  heading: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  text: { fontSize: fontSize.body, color: colors.textPrimary, lineHeight: 20 },
  muted: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  warning: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20 },
  badge: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.pill, overflow: 'hidden' },
  neutral: { backgroundColor: colors.raised, color: colors.textPrimary },
  sealed: { backgroundColor: colors.successSoft, color: colors.successDeep },
  highValue: { backgroundColor: colors.warnSoft, color: colors.warnDeep },
  where: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  whereText: { flex: 1, gap: space[1] },
  link: { minHeight: touchTarget, justifyContent: 'center' },
  linkText: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.brandPrimary },
  waiting: { gap: space[2], padding: space[3], borderRadius: radius.lg, backgroundColor: colors.brandPrimarySoft },
  refused: { gap: space[2], padding: space[3], borderRadius: radius.lg, backgroundColor: colors.warnSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: touchTarget, paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  actions: { gap: space[2] },
  confirm: { gap: space[2] },
});

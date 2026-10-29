import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, AccessibilityInfo } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { usePackStore } from '@/stores/packStore';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue, getQueue } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { lookupCratesOnline, lookupTagOnline } from '@/lib/api/logistics';
import { areaRequired, locationRule } from '@/lib/inventory/areas';
import {
  applyPending, buildPackPayload, classifyScan, crateCode, indexLoad, isCrateCode, labelIssue, looksLikeCrate, mergeFresh, packedAfter, packReviewIssue, packStart,
  type LoadAction, type LoadReference,
} from '@/lib/logistics/crates';
import { QRScanner, type ScanFeedback } from '@/components/scanning/QRScanner';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { useCountReference } from '@/components/inventory/useCountReference';
import { PackDetailsStep } from '@/components/logistics/PackDetailsStep';
import { PackContentsStep } from '@/components/logistics/PackContentsStep';
import { CrateLocationStep } from '@/components/logistics/CrateLocationStep';
import { PackReviewStep } from '@/components/logistics/PackReviewStep';
import { Button } from '@/components/ui/Button';
import { colors, space, fontSize, fontWeight, radius } from '@/lib/design/tokens';

const STEP_TITLES = ['Crate label', 'Details', 'Items', 'Location', 'Review'];
const REVIEW = STEP_TITLES.length - 1;
// Unchecked tags verified when saving online; more wait for the server's own check.
const VERIFY_ON_SAVE = 50;
type Fresh = { tag: string; at: number; rows: Pick<LoadReference, 'units' | 'items' | 'materials' | 'counted'> };
type Saved = { code: string; sealed: boolean; total: number; state: 'saved' | 'synced' | 'refused'; reason?: string };
const savedText = (saved: Saved) => (saved.state === 'synced' ? 'Uploaded.'
  : saved.state === 'refused' ? `The server refused it: ${saved.reason}. It waits in Sync; sort that out and retry, or discard it there.`
  : 'Saved on this device. It uploads when online; Sync shows anything waiting.');

// Pack a crate: scan its label, set its details, scan items and crates in,
// say where it is, then seal it or save it open. The whole session is queued
// as one `pack` under the draft's operation ID, so it works offline. Online,
// the device's copy is refreshed when it is old, the server is asked about
// any tag the copy refuses or doesn't know, and every tag the copy accepts is
// checked with the server in the background, since one refusal holds back
// the whole pack.
export function PackScreenContent({ crateRoute, homeRoute }: { crateRoute: string; homeRoute: string }) {
  const store = usePackStore();
  const { user, activeProject } = useAuthStore();
  const load = useLoadReference({ refresh: true });
  const countReference = useCountReference({ refresh: false });
  // What the server said about single tags since the copy was saved.
  const fresh = useRef<Fresh[]>([]);
  const [freshVersion, setFreshVersion] = useState(0);
  const sources = useRef({ base: load.base, pending: load.pending });
  sources.current = { base: load.base, pending: load.pending };
  // What the server has (the copy, newer answers over it), then with saved changes laid over that.
  const buildKnown = () => {
    const savedAt = Date.parse(sources.current.base.savedAt ?? '') || 0;
    return fresh.current.filter(entry => entry.at > savedAt).reduce((ref, entry) => mergeFresh(ref, entry.tag, entry.rows), sources.current.base);
  };
  const build = () => indexLoad(applyPending(buildKnown(), sources.current.pending.map(item => item.action as LoadAction)));
  const index = useMemo(build, [load.base, load.pending, freshVersion]);
  const remember = (tag: string, rows: Fresh['rows']) => {
    fresh.current = [...fresh.current.filter(entry => entry.tag !== tag), { tag, at: Date.now(), rows }];
    setFreshVersion(v => v + 1);
  };
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const verifying = useRef(new Set<Promise<unknown>>());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => { setSaved(null); setError(''); fresh.current = []; setFreshVersion(v => v + 1); }, [user?.id, activeProject?.id]);
  // The confirmation belongs to the visit that saved; leaving by the tab bar ends it.
  useFocusEffect(useCallback(() => () => { setSaved(null); }, []));
  // VoiceOver has no live regions: say how the save went.
  useEffect(() => { if (saved && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(`${saved.code} ${saved.sealed ? 'sealed' : 'saved open'}. ${savedText(saved)}`); }, [saved?.state, saved?.code]);
  // A draft whose operation is already queued was saved (the account or project
  // changed while it was saving): start the next one fresh.
  useEffect(() => {
    const operationId = store.operationId;
    if (!operationId || !store.code) return;
    let live = true;
    void getQueue().then(queue => {
      if (live && queue.some(item => item.id === operationId) && usePackStore.getState().operationId === operationId) usePackStore.getState().reset();
    }).catch(() => {});
    return () => { live = false; };
  }, [store.operationId]);

  const treeKnown = !!countReference.data.savedAt;
  const rule = useMemo(() => locationRule(countReference.data.maps, countReference.data.zones, treeKnown), [countReference.data.maps, countReference.data.zones, treeKnown]);
  const areasLive = treeKnown ? areaRequired(rule, null) : null;
  const step = store.code ? Math.max(1, Math.min(store.step, REVIEW)) : 0;
  const insideOf = store.code ? index.units.get(store.code)?.parent_code ?? null : null;
  const go = (next: number) => { store.setStep(next); setError(''); };
  // Scans are handled one at a time, in the order they were read.
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(work);
    chain.current = run.catch(() => {});
    return run;
  };

  // The label: online, the server says what the crate is now, so a crate
  // packed on another device isn't treated as new.
  const handleLabel = (raw: string) => inTurn(async (): Promise<ScanFeedback | null> => {
    if (usePackStore.getState().code) return null;
    if (isCrateCode(raw) && useNetworkStore.getState().isOnline) {
      try { remember(crateCode(raw), { units: await lookupCratesOnline([raw]), items: [], materials: [], counted: [] }); } catch { /* The copy answers. */ }
    }
    const issue = labelIssue(build(), raw);
    if (issue) return { tone: 'warn', message: issue };
    const code = crateCode(raw);
    const { before, start } = packStart(code, build(), indexLoad(buildKnown()));
    usePackStore.getState().begin(code, before, start);
    return { tone: 'ok', message: `${code} ready to pack.` };
  });

  // A tag already on the list, checked with the server: marked if it says no.
  const verifyEntry = async (raw: string, operationId: string) => {
    const crate = looksLikeCrate(raw), tag = crate ? crateCode(raw) : raw.trim();
    const rows = await lookupTagOnline(raw, crate ? [usePackStore.getState().code] : []);
    remember(tag, rows);
    const now = usePackStore.getState();
    if (now.operationId !== operationId || !now.add.some(entry => entry.tag === tag)) return;
    const verdict = classifyScan(build(), { ...now, add: now.add.filter(entry => entry.tag !== tag) }, raw, true);
    if (verdict?.kind === 'refuse') now.markEntry(tag, { problem: verdict.message, unchecked: false });
    else if (verdict?.kind === 'add') now.markEntry(tag, { problem: undefined, unchecked: false, name: verdict.entry.name });
  };
  const verifyLater = (raw: string, operationId: string) => {
    const run = verifyEntry(raw, operationId).catch(() => {});
    verifying.current.add(run);
    void run.finally(() => verifying.current.delete(run));
  };

  // When the device's copy refuses a tag or doesn't know it, the server is
  // asked before answering; a tag it accepts is checked in the background.
  const handleItem = (raw: string) => inTurn(async (): Promise<ScanFeedback | null> => {
    const draft = usePackStore.getState();
    let verdict = classifyScan(build(), draft, raw);
    if (!verdict) return null;
    const online = useNetworkStore.getState().isOnline;
    const unsure = (verdict.kind === 'refuse' && verdict.recheck) || (verdict.kind === 'add' && !!verdict.entry.unchecked);
    let asked = false;
    if (unsure && online) {
      try {
        const crate = looksLikeCrate(raw);
        remember(crate ? crateCode(raw) : raw.trim(), await lookupTagOnline(raw, crate ? [draft.code] : []));
        verdict = classifyScan(build(), usePackStore.getState(), raw, true) ?? verdict;
        asked = true;
      } catch { /* Keep the device's answer; the server checks on upload. */ }
    }
    const now = usePackStore.getState();
    if (now.code !== draft.code || now.operationId !== draft.operationId) return null;
    switch (verdict.kind) {
      case 'add':
        now.addEntry(verdict.entry);
        if (online && !asked) verifyLater(raw, draft.operationId);
        return { tone: verdict.entry.unchecked ? 'info' : 'ok', message: verdict.message };
      case 'keep': now.keep(verdict.tag); return { tone: 'ok', message: verdict.message };
      case 'already': return { tone: 'info', message: verdict.message };
      default: return { tone: 'warn', message: verdict.message };
    }
  });

  const save = async (seal: boolean) => {
    if (lock.current || !user || !activeProject) return;
    const accountId = user.id, projectId = activeProject.id, operationId = usePackStore.getState().operationId;
    const sameContext = () => useAuthStore.getState().user?.id === accountId && useAuthStore.getState().activeProject?.id === projectId;
    lock.current = true; setSaving(true); setError('');
    try {
      // Every scan read before Save is in the pack, and checked if it can be.
      await chain.current;
      await Promise.allSettled([...verifying.current]);
      if (useNetworkStore.getState().isOnline) {
        const unchecked = usePackStore.getState().add.filter(entry => entry.unchecked).slice(0, VERIFY_ON_SAVE);
        await Promise.allSettled(unchecked.map(entry => verifyEntry(entry.tag, operationId)));
      }
      const draft = usePackStore.getState();
      if (draft.operationId !== operationId || !sameContext()) return;
      const issue = packReviewIssue(build(), draft, seal, areasLive);
      if (issue) { setError(issue.message); return; }
      const pack = buildPackPayload(draft, seal);
      await addToQueue({ type: 'pack', payload: {
        pack,
        ...(pack.zoneId && draft.location.zoneName ? { zoneName: draft.location.zoneName } : {}),
        ...(pack.placeId && draft.location.placeName ? { placeName: draft.location.placeName } : {}),
      } }, operationId);
      const total = packedAfter(build(), draft).length;
      // Only clear the exact draft that was queued.
      if (usePackStore.getState().operationId === operationId) usePackStore.getState().reset();
      if (!sameContext()) return;
      const result = { code: draft.code, sealed: seal, total };
      setSaved({ ...result, state: 'saved' });
      if (useNetworkStore.getState().isOnline) {
        // Saving and uploading are separate outcomes. A refused pack stays in Sync.
        void processQueue().then(async () => {
          const left = (await getQueue()).find(item => item.id === operationId);
          if (!sameContext()) return;
          if (!left) setSaved(current => (current?.code === result.code ? { ...result, state: 'synced' } : current));
          else if (left.lastError) setSaved(current => (current?.code === result.code ? { ...result, state: 'refused', reason: left.lastError } : current));
        }).catch(() => {});
      }
    } catch (e: any) { if (sameContext()) setError(`Could not save: ${e.message ?? 'Please try again'}. Your pack is still here.`); }
    finally { lock.current = false; setSaving(false); }
  };

  if (saved) return <ScrollView contentContainerStyle={styles.confirmation}>
    <Stack.Screen options={{ headerShown: true, title: 'Crate saved' }} />
    <Text style={styles.confirmTitle} accessibilityRole="header">{saved.code} {saved.sealed ? 'sealed' : 'saved open'}</Text>
    <Text style={styles.confirmItem}>{saved.total} inside</Text>
    <Text style={saved.state === 'refused' ? styles.warning : styles.hint} accessibilityLiveRegion="polite">{savedText(saved)}</Text>
    <Button title="Pack another crate" onPress={() => setSaved(null)} />
    <Button title="View crate" variant="secondary" onPress={() => { const code = saved.code; setSaved(null); router.push({ pathname: crateRoute as any, params: { code } }); }} />
    {saved.state === 'refused' ? <Button title="View Sync" variant="secondary" onPress={() => router.push('/sync')} /> : null}
    <Button title="Done" variant="ghost" onPress={() => { setSaved(null); router.replace(homeRoute as any); }} />
  </ScrollView>;

  if (step === 0) return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: 'Pack a crate' }} />
    <View style={styles.progress}>
      <Text style={styles.hint}>Scan the crate’s label (HU-…). A new label becomes a crate the first time it is packed.</Text>
    </View>
    <QRScanner continuous onScan={handleLabel} actions={<Button title="Back to Scan" variant="ghost" onPress={() => router.replace(homeRoute as any)} />} />
  </View>;

  return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: STEP_TITLES[step], gestureEnabled: !saving }} />
    <View style={styles.progress}>
      <Text style={styles.stepLabel} accessibilityRole="header">Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}</Text>
      <View style={styles.stepBar} accessibilityRole="progressbar" accessibilityLabel="Packing progress" accessibilityValue={{ min: 1, max: STEP_TITLES.length, now: step + 1, text: STEP_TITLES[step] }}>
        {STEP_TITLES.map((title, i) => <View key={title} style={[styles.stepSegment, i <= step && styles.stepActive]} />)}
      </View>
      <View style={styles.codeRow}>
        <Text style={styles.code}>Crate: {store.code}</Text>
        {confirmDiscard ? null : <Button title="Discard pack…" variant="ghost" onPress={() => setConfirmDiscard(true)} style={styles.discard} />}
      </View>
      {confirmDiscard ? <View style={styles.confirm}>
        <Text style={styles.warning} accessibilityRole="alert">Discard this pack? Nothing from it is saved, and this can’t be undone.</Text>
        <View style={styles.confirmActions}>
          <Button title="Discard pack" variant="danger" onPress={() => { usePackStore.getState().reset(); setConfirmDiscard(false); }} style={styles.flex} />
          <Button title="Keep packing" variant="secondary" onPress={() => setConfirmDiscard(false)} style={styles.flex} />
        </View>
      </View> : null}
    </View>
    {step === 1 && <PackDetailsStep onNext={() => go(2)} onBack={() => router.replace(homeRoute as any)} />}
    {step === 2 && <PackContentsStep index={index} onScan={handleItem} onNext={() => go(3)} onBack={() => go(1)} />}
    {step === 3 && <CrateLocationStep reference={countReference.data} places={load.data.places} rule={rule} insideOf={insideOf} onNext={() => go(4)} onBack={() => go(2)} />}
    {step === 4 && <PackReviewStep index={index} insideOf={insideOf} error={error} saving={saving} onEdit={go} onSave={save} onBack={() => go(3)} />}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  progress: { paddingHorizontal: space[5], paddingVertical: space[3], gap: space[2], backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  stepLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  stepBar: { flexDirection: 'row', gap: 6 },
  stepSegment: { height: 4, flex: 1, borderRadius: radius.sm, backgroundColor: colors.border },
  stepActive: { backgroundColor: colors.brandPrimary },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  code: { fontSize: fontSize.sm, color: colors.textMuted },
  discard: { paddingHorizontal: space[2] },
  confirm: { gap: space[2] },
  confirmActions: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  hint: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  warning: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20 },
  confirmation: { flexGrow: 1, padding: space[6], gap: space[4], backgroundColor: colors.canvas, justifyContent: 'center' },
  confirmTitle: { fontSize: 26, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  confirmItem: { fontSize: 18, color: colors.textPrimary },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { QRScanner, type ScanFeedback } from '@/components/scanning/QRScanner';
import { AreaList } from '@/components/inventory/AreaList';
import { useCountReference } from '@/components/inventory/useCountReference';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { useScanBatch } from '@/components/logistics/useScanBatch';
import { saveLoadChange } from '@/components/logistics/saveLoadChange';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { useAuthStore } from '@/stores/authStore';
import { newOperationId } from '@/lib/utils/operationId';
import { activeAreas, areaPathLabel, buildAreaTree } from '@/lib/inventory/areas';
import { applyLoadPending, canFinishStop, capturedNow, classifyUnload, indexLoads, loadLabel, officeFinishes, unloadChecklist, unloadStops, STOP_KINDS } from '@/lib/logistics/loads';
import { unresolvedFor } from '@/lib/sync/queuePresentation';
import { colors } from '@/lib/design/tokens';

type Area = { zoneId: string; siteMapId: string; zoneName: string } | null;
// `at`: when the first of these scans was made (022's capturedAt).
type Batch = { pieces: string[]; area: Area; at: string };

// Unload at a stop: choose the stop, then scan pieces off against what is due
// there. A piece due elsewhere comes off marked as the wrong stop; one not on
// the truck's list comes off as an extra. An area can be chosen only at this
// project's own yard or site. Saved as partial load_off batches (a piece the
// server turns down waits in Sync on its own); Finish stop sends
// stop_complete, after warning that unscanned pieces due here become missing.
// Until the load is closed, pieces can still be scanned off at a finished stop.
export function UnloadScreenContent() {
  const { id = '', stopId: param } = useLocalSearchParams<{ id?: string; stopId?: string }>();
  const projectId = useAuthStore(s => s.activeProject?.id);
  const office = useAuthStore(s => s.user?.role !== 'field_worker');
  const { loads, index, data, pending, refused } = useLoadReference({ refresh: true });
  const count = useCountReference({ refresh: false });
  const load = loads.loads.get(id);
  const label = loadLabel(load);
  const [stopId, setStopId] = useState<string | null>(param || null);
  // Any stop until the load is closed; a finished one takes late scans only.
  const stops = unloadStops(loads, id);
  const stop = stops.find(s => s.id === stopId);
  const ownPlace = !!stop && data.places.some(place => place.id === stop.place_id && place.project_id === projectId);
  // The office finishes stops at shops and vendors; there, a crew only scans off.
  const finishable = canFinishStop(stop, office);
  const officeOnly = !finishable && officeFinishes(stop) && stop?.status !== 'done';
  // Finishing behind scans the server hasn't taken would mark those pieces missing.
  const stuck = unresolvedFor([...pending, ...refused], id);
  const [area, setArea] = useState<Area>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const finishId = useRef(newOperationId());
  const [saveError, setSaveError] = useState('');
  // The screen stays mounted between visits: each starts from the stop asked for, with no area or prompt.
  const restart = () => { setStopId(param || null); setArea(null); setFinishing(false); setSaveError(''); finishId.current = newOperationId(); };
  useEffect(restart, [id, param]);
  useFocusEffect(useCallback(() => () => restart(), [id, param]));
  const opFor = (pieces: string[], where: Area, at: string) => ({ loadId: id, stopId: stopId!, pieces, ...(where ? { zoneId: where.zoneId, siteMapId: where.siteMapId } : {}), partial: true, capturedAt: at });
  const { batch, update, flush, error } = useScanBatch<Batch>({
    empty: () => ({ pieces: [], area, at: '' }),
    count: b => b.pieces.length,
    merge: (failed, since) => ({ pieces: [...failed.pieces, ...since.pieces.filter(p => !failed.pieces.includes(p))], area: failed.area, at: failed.at || since.at }),
    save: async b => { await saveLoadChange('load_off', opFor(b.pieces, b.area, b.at), label, undefined, b.area ? { zoneName: b.area.zoneName } : {}); },
  });
  const view = useMemo(() => (batch.pieces.length && stopId
    ? indexLoads(applyLoadPending(data, [{ type: 'load_off', payload: { op: opFor(batch.pieces, batch.area, batch.at), zoneName: batch.area?.zoneName } }])) : loads), [data, loads, batch, stopId]);
  const list = stopId ? unloadChecklist(view, id, stopId) : null;
  const maps = count.data.maps;
  const shownMap = maps.find(m => m.id === mapId) ?? maps[0] ?? null;
  const areas = useMemo(() => (shownMap ? activeAreas(count.data.zones.filter(zone => zone.map_id === shownMap.id)) : []), [count.data.zones, shownMap?.id]);
  const tree = useMemo(() => buildAreaTree(areas), [areas]);

  // A new area starts a new batch: every piece in a load_off shares one area.
  const chooseArea = async (next: Area) => { await flush(); setArea(next); update(b => ({ ...b, area: next })); };
  const onScan = async (raw: string): Promise<ScanFeedback | null> => {
    if (!stopId) return null;
    const scan = classifyUnload(index, view, id, stopId, raw);
    if (!scan) return null;
    if (scan.kind === 'refuse' || scan.kind === 'already') return { tone: scan.kind === 'already' ? 'info' : 'warn', message: scan.message };
    // A code this device doesn't know goes on its own: if the server refuses it, the rest still go.
    if (scan.kind === 'extra' && scan.unchecked) {
      try {
        await flush();
        await saveLoadChange('load_off', opFor([scan.tag], area, capturedNow()), label, undefined, area ? { zoneName: area.zoneName } : {});
        setSaveError('');
      } catch (e: any) { setSaveError(`Could not save ${scan.tag}: ${e?.message ?? 'Please try again'}. Scan it again.`); }
      return { tone: 'info', message: `${scan.message} It isn't on this device; the server checks it.` };
    }
    update(b => ({ ...b, area, at: b.at || capturedNow(), pieces: b.pieces.includes(scan.tag) ? b.pieces : [...b.pieces, scan.tag] }));
    return { tone: scan.kind === 'due' || scan.kind === 'found' ? 'ok' : 'info', message: scan.message };
  };
  const finish = async () => {
    if (saving || !stopId || !finishable || stuck.length) return;
    setSaving(true);
    try {
      // Every scan off is saved before the stop is finished, or nothing is.
      if (!(await flush())) return;
      await saveLoadChange('stop_complete', { loadId: id, stopId, capturedAt: capturedNow() }, label, finishId.current);
      finishId.current = newOperationId();
      setFinishing(false);
      router.back();
    } catch (e: any) { setSaveError(`Could not finish the stop: ${e?.message ?? 'Please try again'}.`); }
    finally { setSaving(false); }
  };

  if (!load) return <View style={styles.container}><Stack.Screen options={{ headerShown: true, title: 'Unload' }} /><Text style={[styles.muted, { padding: 20 }]}>This load isn’t on this device.</Text></View>;
  if (!stopId || !stop) return <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <Stack.Screen options={{ headerShown: true, title: `Unload ${label}` }} />
    <Text style={styles.heading} accessibilityRole="header">Which stop are you at?</Text>
    {stops.map(s => <Button key={s.id} title={`${s.seq}. ${s.place_name} · ${STOP_KINDS.find(k => k.value === s.kind)?.label} · ${s.status === 'done' ? 'Done: late scans only' : `${s.due_count} due`}`} variant={s.status === 'done' ? 'ghost' : 'secondary'} onPress={() => setStopId(s.id)} />)}
    {stops.length === 0 ? <Text style={styles.muted}>{load.status === 'closed' || load.status === 'cancelled' ? `${label} is ${load.status}; nothing more comes off it.` : 'This load has no stops to unload at.'}</Text> : null}
    {stops.length > 0 && stops.every(s => s.status === 'done') ? <Text style={styles.muted}>Every stop on this load is done. A piece that turns up can still be scanned off where it is.</Text> : null}
  </ScrollView>;

  return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: `Unload at ${stop.place_name}` }} />
    <View style={styles.camera}><QRScanner continuous onScan={onScan} countLabel={list ? `${list.offCount} of ${list.total} off here` : undefined} /></View>
    <ScrollView style={styles.list} contentContainerStyle={{ gap: 4, paddingBottom: 8 }}>
      {ownPlace ? <View style={styles.section}>
        <Text style={styles.rowTitle}>{area ? `Area: ${area.zoneName}` : 'Area (optional): where these pieces go in the yard'}</Text>
        {area ? <Button title="Clear area" variant="ghost" onPress={() => chooseArea(null)} /> : null}
        {maps.length > 1 ? <View style={styles.chips}>{maps.map(m => <Button key={m.id} title={m.name} variant={m.id === shownMap?.id ? 'primary' : 'secondary'} onPress={() => setMapId(m.id)} style={styles.chip} />)}</View> : null}
        {areas.length ? <AreaList areas={areas} selectedId={area?.zoneId ?? null} reveal={null} style={{ minHeight: 150 }}
          onSelect={zone => chooseArea({ zoneId: zone.id, siteMapId: zone.map_id, zoneName: areaPathLabel(tree, zone.id) })} /> : null}
      </View> : null}
      {list?.due.map(line => {
        const off = line.status === 'delivered';
        return <View key={line.id} style={styles.row} accessible accessibilityLabel={`${line.tag}, ${line.name}: ${off ? 'off' : line.status === 'missing' ? 'missing' : 'not off yet'}`}>
          <FontAwesome name={off ? 'check-circle' : line.status === 'missing' ? 'question-circle' : 'circle-o'} size={18} color={off ? colors.success : colors.textSubtle} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{line.tag}{line.status === 'missing' ? ' · Missing' : ''}{line.is_high_value ? ' · High value' : ''}</Text>
            <Text style={styles.muted} numberOfLines={1}>{line.name}</Text>
          </View>
        </View>;
      })}
      {list?.extras.map(line => <View key={line.id} style={styles.row}>
        <FontAwesome name="exclamation-circle" size={18} color={colors.warnDeep} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{line.tag} · {line.flag === 'extra' ? 'Extra' : 'Wrong stop'}</Text>
          <Text style={styles.muted} numberOfLines={1}>{line.flag === 'extra' ? 'Not on this truck’s list' : `Was due at ${line.dropoff_place ?? 'another stop'}`}</Text>
        </View>
      </View>)}
      {list && list.total === 0 && list.extras.length === 0 ? <Text style={styles.muted}>Nothing is due here. Scan anything that comes off.</Text> : null}
      {error || saveError ? <Text style={styles.error} accessibilityRole="alert">{error || saveError}</Text> : null}
      {officeOnly ? <Text style={styles.muted}>{stop.place_name} is an outside shop or vendor: scan off what you hand over, and the office confirms the stop.</Text> : null}
      {stop.status === 'done' ? <Text style={styles.muted}>This stop is finished. A piece scanned off now is recorded here; one that was missing is found.</Text> : null}
      {finishable && stuck.length ? <View style={styles.refused}>
        <Text style={styles.warning} accessibilityRole="alert">An earlier step for {label} hasn't uploaded. Retry or discard it in Sync before finishing this stop.</Text>
        <Button title="View Sync" variant="ghost" onPress={() => router.push('/sync')} />
      </View> : null}
      {finishing && finishable ? <View style={styles.refused}>
        <Text style={styles.warning} accessibilityRole="alert">{list?.waiting.length
          ? `${list.waiting.length} piece${list.waiting.length === 1 ? '' : 's'} due here ${list.waiting.length === 1 ? 'hasn’t' : 'haven’t'} been scanned off and will be marked missing: ${list.waiting.map(l => l.tag).join(', ')}.`
          : 'Everything due here is off.'} Finish {stop.place_name}?</Text>
        <View style={styles.pair}>
          <Button title="Finish stop" variant={list?.waiting.length ? 'danger' : 'primary'} onPress={finish} loading={saving} style={styles.flex} />
          <Button title="Keep scanning" variant="secondary" onPress={() => setFinishing(false)} style={styles.flex} disabled={saving} />
        </View>
      </View> : null}
    </ScrollView>
    <View style={styles.footer}>
      <Button title="Done for now" variant="secondary" onPress={async () => { if (await flush()) router.back(); }} style={styles.flex} />
      {finishable ? <Button title="Finish stop…" disabled={stuck.length > 0} onPress={async () => { if (await flush()) setFinishing(true); }} style={styles.flex} /> : null}
    </View>
  </View>;
}

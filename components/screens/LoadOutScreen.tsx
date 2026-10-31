import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { QRScanner, type ScanFeedback } from '@/components/scanning/QRScanner';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { useScanBatch } from '@/components/logistics/useScanBatch';
import { saveLoadChange } from '@/components/logistics/saveLoadChange';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { groupRoute } from '@/components/logistics/routes';
import {
  applyLoadPending, checklistText, classifyLoadOn, dropoffChoices, indexLoads, loadChecklist, loadLabel,
  type LoadLine, type LoadOnPiece, type LoadStop,
} from '@/lib/logistics/loads';
import { colors } from '@/lib/design/tokens';

type Batch = { pieces: LoadOnPiece[]; undo: string[] };
const codeOf = (piece: LoadOnPiece) => (typeof piece === 'string' ? piece : piece.code);

// Load out (or pick up at a stop after leaving, with `stopId`): scan pieces on
// against the planned list, "12 of 14 on board". A piece that isn't planned
// asks where it comes off. Tap a piece on board to take it off again. Scans
// are saved as load_on operations in small batches; a piece this device
// doesn't know goes on its own, so a refusal doesn't hold back the rest.
export function LoadOutScreenContent() {
  const { id = '', stopId } = useLocalSearchParams<{ id?: string; stopId?: string }>();
  const at = stopId || null;
  const { loads, index, data } = useLoadReference({ refresh: true });
  const load = loads.loads.get(id);
  const label = loadLabel(load);
  const stop = at ? (loads.stops.get(id) ?? []).find(s => s.id === at) : undefined;
  const [asking, setAsking] = useState<{ tag: string; name: string; unchecked: boolean } | null>(null);
  const [saveError, setSaveError] = useState('');
  const opFor = (batch: Batch) => ({ loadId: id, pieces: batch.pieces, ...(batch.undo.length ? { undo: batch.undo } : {}), ...(at ? { stopId: at } : {}) });
  const { batch, update, flush, error } = useScanBatch<Batch>({
    empty: () => ({ pieces: [], undo: [] }),
    count: b => b.pieces.length + b.undo.length,
    merge: (failed, since) => ({ pieces: [...failed.pieces, ...since.pieces], undo: [...failed.undo, ...since.undo] }),
    save: async b => { await saveLoadChange('load_on', opFor(b), label); },
  });
  // Unsaved scans count too.
  const view = useMemo(() => (batch.pieces.length || batch.undo.length
    ? indexLoads(applyLoadPending(data, [{ type: 'load_on', payload: { op: opFor(batch) } }])) : loads), [data, loads, batch]);
  const list = loadChecklist(view, id, at);
  const choices = dropoffChoices(view, id, at);

  const onScan = async (raw: string): Promise<ScanFeedback | null> => {
    const scan = classifyLoadOn(index, view, id, raw, at);
    if (!scan) return null;
    if (scan.kind === 'planned') {
      if (batch.undo.includes(scan.tag)) update(b => ({ ...b, undo: b.undo.filter(code => code !== scan.tag) }));
      else update(b => ({ ...b, pieces: [...b.pieces, scan.tag] }));
      return { tone: 'ok', message: scan.message };
    }
    if (scan.kind === 'unplanned') { setAsking(scan); return { tone: 'info', message: scan.message }; }
    return { tone: scan.kind === 'already' ? 'info' : 'warn', message: scan.message };
  };
  const chooseDropoff = async (dropoff: LoadStop) => {
    if (!asking) return;
    const piece = { code: asking.tag, dropoffStopId: dropoff.id };
    setAsking(null);
    if (asking.unchecked) {
      try {
        await flush();
        await saveLoadChange('load_on', { loadId: id, pieces: [piece], ...(at ? { stopId: at } : {}) }, label);
        setSaveError('');
      } catch (e: any) { setSaveError(`Could not save ${piece.code}: ${e?.message ?? 'Please try again'}. Scan it again.`); }
    } else update(b => ({ ...b, pieces: [...b.pieces, piece] }));
  };
  const takeOff = (line: LoadLine) => {
    if (batch.pieces.some(piece => codeOf(piece) === line.tag)) update(b => ({ ...b, pieces: b.pieces.filter(piece => codeOf(piece) !== line.tag) }));
    else update(b => (b.undo.includes(line.tag) ? b : { ...b, undo: [...b.undo, line.tag] }));
  };
  // Leaving (or going on to Depart) waits until every scan is saved.
  const leave = async (next?: () => void) => { if (await flush()) (next ? next() : router.back()); };

  if (!load) return <View style={styles.container}><Stack.Screen options={{ headerShown: true, title: 'Load out' }} /><Text style={[styles.muted, { padding: 20 }]}>This load isn’t on this device.</Text></View>;
  return <View style={styles.container}>
    <Stack.Screen options={{ headerShown: true, title: stop ? `Pick up at ${stop.place_name}` : `Load out ${label}` }} />
    <View style={styles.camera}><QRScanner continuous onScan={onScan} countLabel={checklistText(list)} /></View>
    {asking ? <View style={[styles.note, { margin: 16 }]}>
      <Text style={styles.rowTitle}>{asking.tag} isn’t planned on {label}. Where does it come off?</Text>
      {asking.unchecked ? <Text style={styles.muted}>It isn’t on this device either; the server checks it when this uploads.</Text> : null}
      {choices.length === 0 ? <Text style={styles.warning}>There is no drop-off stop {at ? 'after this one' : 'yet'}. Add one in Edit load.</Text> : null}
      <View style={styles.chips}>{choices.map(choice => <Button key={choice.id} title={`${choice.seq}. ${choice.place_name}`} onPress={() => chooseDropoff(choice)} style={styles.chip} />)}</View>
      <Button title="Leave it off" variant="ghost" onPress={() => setAsking(null)} />
    </View> : null}
    <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
      {list.total === 0 ? <Text style={styles.muted}>Nothing is planned to go on here. Scan pieces to add them.</Text> : null}
      {list.lines.map(line => {
        const on = line.status === 'on_board';
        return <Pressable key={line.id} disabled={!on} accessibilityRole="button" accessibilityState={{ checked: on }}
          accessibilityLabel={on ? `${line.tag}, on board. Take it off.` : `${line.tag}, not on board yet`} onPress={() => takeOff(line)} style={styles.row}>
          <FontAwesome name={on ? 'check-circle' : 'circle-o'} size={18} color={on ? colors.success : colors.textSubtle} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{line.tag}{line.added_in_field ? ' · Added here' : ''}{line.is_high_value ? ' · High value' : ''}</Text>
            <Text style={styles.muted} numberOfLines={1}>{line.name} · to {line.dropoff_place ?? 'a later stop'}</Text>
          </View>
          {on ? <Text style={styles.muted}>Take off</Text> : null}
        </Pressable>;
      })}
      {error || saveError ? <Text style={styles.error} accessibilityRole="alert">{error || saveError}</Text> : null}
    </ScrollView>
    <View style={styles.footer}>
      <Button title="Done" variant="secondary" onPress={() => leave()} style={styles.flex} />
      {!at && (load.status === 'planning' || load.status === 'loading')
        ? <Button title="Depart…" onPress={() => leave(() => router.replace({ pathname: groupRoute('load-depart') as any, params: { id } }))} style={styles.flex} /> : null}
    </View>
  </View>;
}

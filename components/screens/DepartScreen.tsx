import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { saveLoadChange } from '@/components/logistics/saveLoadChange';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { groupRoute } from '@/components/logistics/routes';
import { newOperationId } from '@/lib/utils/operationId';
import { capturedNow, departCheck, loadLabel, OVERRIDE_MAX } from '@/lib/logistics/loads';
import { unresolvedFor } from '@/lib/sync/queuePresentation';

// The truck leaves: a last look at the planned pieces that will stay behind,
// the driver's name and licence (required), then load_depart. Office staff
// can let it leave without the licence, giving a reason. Marking everything
// loaded without scanning is for the office's own pages, so it isn't offered here.
export function DepartScreenContent() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const office = useAuthStore(s => s.user?.role !== 'field_worker');
  const { loads, pending, refused } = useLoadReference({ refresh: false });
  const load = loads.loads.get(id);
  const [override, setOverride] = useState<{ id: string; open: boolean; reason: string }>({ id, open: false, reason: '' });
  const leaving = override.id === id && override.open;
  const reason = leaving ? override.reason : null;
  const check = departCheck(loads, id, office, reason);
  // Leaving behind a step the server hasn't taken would leave its pieces behind too.
  const stuck = unresolvedFor([...pending, ...refused], id);
  const issue = stuck.length ? `An earlier step for ${loadLabel(load)} hasn't uploaded. Retry or discard it in Sync before the truck leaves.` : check.issue;
  const behind = check.behind;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // One departure per load and visit: the screen stays mounted between loads.
  const operationId = useRef(newOperationId());
  useEffect(() => { operationId.current = newOperationId(); setError(''); }, [id]);
  useFocusEffect(useCallback(() => () => { operationId.current = newOperationId(); setError(''); setOverride({ id: '', open: false, reason: '' }); }, []));

  const depart = async () => {
    if (saving || issue) return;
    setSaving(true); setError('');
    try {
      await saveLoadChange('load_depart', { loadId: id, ...(reason !== null && check.licenceMissing ? { overrideReason: reason.trim() } : {}), capturedAt: capturedNow() }, loadLabel(load), operationId.current);
      operationId.current = newOperationId();
      router.back();
    } catch (e: any) { setError(`Could not save: ${e.message ?? 'Please try again'}.`); }
    finally { setSaving(false); }
  };

  return <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <Stack.Screen options={{ headerShown: true, title: `Depart ${loadLabel(load)}` }} />
    <Text style={styles.title} accessibilityRole="header">Ready to leave?</Text>
    <Text style={styles.text}>{load?.on_board_count ?? 0} on board{load?.driver_name ? ` · Driver ${load.driver_name}` : ''}</Text>
    {behind.length ? <View style={styles.refused}>
      <Text style={styles.warning} accessibilityRole="alert">{behind.length} planned piece{behind.length === 1 ? '' : 's'} will stay behind:</Text>
      {behind.map(line => <Text key={line.id} style={styles.text}>{line.tag} · {line.name}</Text>)}
    </View> : <Text style={styles.muted}>Everything planned is on board.</Text>}
    {issue ? <Text style={styles.error} accessibilityRole="alert">{issue}</Text> : null}
    {stuck.length ? <Button title="View Sync" variant="secondary" onPress={() => router.push('/sync')} /> : null}
    {issue && !stuck.length && load && (!load.driver_name || check.licenceMissing) ? <Button title="Driver check-in" variant="secondary" onPress={() => router.push({ pathname: groupRoute('load-checkin') as any, params: { id } })} /> : null}
    {office && check.licenceMissing && load?.driver_name && !stuck.length ? (leaving ? <View style={styles.refused}>
      <Text style={styles.warning}>Leaving without the driver’s licence is recorded on the load with your name and the reason.</Text>
      <Input label="Reason" required value={override.reason} onChangeText={text => setOverride({ id, open: true, reason: text })} maxLength={OVERRIDE_MAX} multiline placeholder="e.g. Driver's licence checked by phone with the carrier" />
      <Button title="Keep the licence requirement" variant="ghost" onPress={() => setOverride({ id, open: false, reason: '' })} />
    </View> : <Button title="Leave without the licence (office)…" variant="ghost" onPress={() => setOverride({ id, open: true, reason: '' })} />) : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    <Button title={leaving && check.licenceMissing ? 'Depart without the licence' : 'Depart'} onPress={depart} loading={saving} disabled={!!issue} />
    <Button title="Back" variant="ghost" onPress={() => router.back()} disabled={saving} />
  </ScrollView>;
}

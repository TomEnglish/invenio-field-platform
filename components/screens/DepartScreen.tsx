import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { saveLoadChange } from '@/components/logistics/saveLoadChange';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { groupRoute } from '@/components/logistics/routes';
import { newOperationId } from '@/lib/utils/operationId';
import { departCheck, loadLabel } from '@/lib/logistics/loads';
import { unresolvedFor } from '@/lib/sync/queuePresentation';

// The truck leaves: a last look at the planned pieces that will stay behind,
// the driver's name (required), then load_depart. Marking everything loaded
// without scanning is for the office only, so it isn't offered here.
export function DepartScreenContent() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const { loads, pending, refused } = useLoadReference({ refresh: false });
  const load = loads.loads.get(id);
  const check = departCheck(loads, id);
  // Leaving behind a step the server hasn't taken would leave its pieces behind too.
  const stuck = unresolvedFor([...pending, ...refused], id);
  const issue = stuck.length ? `An earlier step for ${loadLabel(load)} hasn't uploaded. Retry or discard it in Sync before the truck leaves.` : check.issue;
  const behind = check.behind;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // One departure per load and visit: the screen stays mounted between loads.
  const operationId = useRef(newOperationId());
  useEffect(() => { operationId.current = newOperationId(); setError(''); }, [id]);
  useFocusEffect(useCallback(() => () => { operationId.current = newOperationId(); setError(''); }, []));

  const depart = async () => {
    if (saving || issue) return;
    setSaving(true); setError('');
    try {
      await saveLoadChange('load_depart', { loadId: id }, loadLabel(load), operationId.current);
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
    {issue && !stuck.length && load && (!load.driver_name || (!load.licence_recorded_at && !load.licence_waiting)) ? <Button title="Driver check-in" variant="secondary" onPress={() => router.push({ pathname: groupRoute('load-checkin') as any, params: { id } })} /> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    <Button title="Depart" onPress={depart} loading={saving} disabled={!!issue} />
    <Button title="Back" variant="ghost" onPress={() => router.back()} disabled={saving} />
  </ScrollView>;
}

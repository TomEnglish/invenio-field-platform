import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { saveLoadChange } from '@/components/logistics/saveLoadChange';
import { groupRoute } from '@/components/logistics/routes';
import { useAuthStore } from '@/stores/authStore';
import { newOperationId } from '@/lib/utils/operationId';
import { capturedNow, isoDate, loadEditIssue, loadLabel, loadSavePayload, stopReached, stopRights, STOP_KINDS, type LoadEditDraft } from '@/lib/logistics/loads';

const parseDate = (text: string) => { const [y, m, d] = text.split('-').map(Number); return text ? new Date(y, m - 1, d) : null; };

// New or edit load: where it starts, its stops in order (each a drop-off, a
// pick-up or both), the date and the truck. Saved as one load_save; a new
// load's ID (and its stops') are made here, so it works offline. The office
// plans stops, except on a load a crew started; once the truck has left, only
// office staff change them, and only the ones it hasn't reached.
export function LoadEditScreenContent() {
  const { id = '', new: isNew } = useLocalSearchParams<{ id?: string; new?: string }>();
  const projectId = useAuthStore(s => s.activeProject?.id);
  const office = useAuthStore(s => s.user?.role !== 'field_worker');
  const { loads, data, loading } = useLoadReference({ refresh: false });
  const load = loads.loads.get(id);
  const beforeStops = loads.stops.get(id) ?? [];
  const departed = !!load && !['planning', 'loading'].includes(load.status);
  const rights = stopRights(isNew ? undefined : load, office);
  // A stop the truck has reached stays where it is, as it is.
  const fixed = (stopId: string) => rights !== 'all' && (rights === 'none' || stopReached(beforeStops.find(stop => stop.id === stopId)));
  // The draft belongs to one load and one visit (the screen stays mounted).
  const [state, setState] = useState<{ id: string; draft: LoadEditDraft } | null>(null);
  const draft = state?.id === id ? state.draft : null;
  const setDraft = (next: LoadEditDraft) => setState({ id, draft: next });
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const operationId = useRef(newOperationId());
  useFocusEffect(useCallback(() => () => { setState(null); setError(''); operationId.current = newOperationId(); }, []));
  const places = [...data.places].sort((a, b) => a.name.localeCompare(b.name));
  const options = places.map(place => ({ value: place.id, label: [place.name, place.city].filter(Boolean).join(' · ') }));
  const placeName = (placeId: string) => places.find(place => place.id === placeId)?.name ?? 'Place not on this device';

  // Start from the load, or for a new one from the project's own yard when it has exactly one.
  useEffect(() => {
    if (draft || (loading && !data.savedAt)) return;
    const yards = data.places.filter(place => place.project_id === projectId && place.kind === 'yard');
    setDraft({
      originPlaceId: load?.origin_place_id ?? (yards.length === 1 ? yards[0].id : null),
      plannedDate: load?.planned_date ?? '', truckType: load?.truck_type ?? '', truckNumber: load?.truck_number ?? '',
      trailerNumber: load?.trailer_number ?? '', bolNumber: load?.bol_number ?? '', notes: load?.notes ?? '',
      stops: beforeStops.map(stop => ({ id: stop.id, placeId: stop.place_id, kind: stop.kind, plannedDate: stop.planned_date })),
    });
  }, [loading, data.savedAt, load?.id, id, !!draft]);

  if (!draft) return <View style={styles.container}><Stack.Screen options={{ headerShown: true, title: isNew ? 'New load' : 'Edit load' }} /><Text style={[styles.muted, { padding: 20 }]}>Loading places…</Text></View>;
  const set = (patch: Partial<LoadEditDraft>) => setDraft({ ...draft, ...patch });
  const setStops = (stops: LoadEditDraft['stops']) => set({ stops });
  const move = (index: number, by: number) => {
    const stops = draft.stops.slice();
    const [stop] = stops.splice(index, 1);
    stops.splice(index + by, 0, stop);
    setStops(stops);
  };

  const save = async () => {
    if (saving) return;
    const issue = loadEditIssue(draft, rights, loads.lines.get(id) ?? [], beforeStops);
    if (issue) { setError(issue); return; }
    setSaving(true); setError('');
    try {
      const op = loadSavePayload(id, draft, load, beforeStops, rights);
      if (Object.keys(op).length > 1) await saveLoadChange('load_save', { ...op, capturedAt: capturedNow() }, loadLabel(load), operationId.current);
      operationId.current = newOperationId();
      if (isNew) router.replace({ pathname: groupRoute('load') as any, params: { id } });
      else router.back();
    } catch (e: any) { setError(`Could not save: ${e.message ?? 'Please try again'}.`); }
    finally { setSaving(false); }
  };

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <Stack.Screen options={{ headerShown: true, title: isNew ? 'New load' : `Edit ${loadLabel(load)}` }} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Select label="Starts at" required value={draft.originPlaceId ?? undefined} options={options} placeholder="Choose a yard, site or shop" searchable={places.length > 8}
        onChange={placeId => set({ originPlaceId: placeId })} />
      <DatePicker label="Planned date" value={parseDate(draft.plannedDate)} onChange={date => set({ plannedDate: date ? isoDate(date) : '' })} placeholder="Not set" />

      <View style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">Stops</Text>
        {rights === 'none' ? <Text style={styles.muted}>{departed ? 'The truck has left; only the office can change its stops now.' : 'The office plans this load’s stops. Ask the office to change them.'}</Text>
          : rights === 'pending' ? <Text style={styles.muted}>The truck has left: only the stops it hasn’t reached can change.</Text> : null}
        {draft.stops.map((stop, index) => <View key={stop.id} style={styles.card}>
          <Text style={styles.rowTitle}>{index + 1}. {placeName(stop.placeId)}{rights === 'pending' && fixed(stop.id) ? ' · Reached' : ''}</Text>
          <View style={styles.chips}>
            {STOP_KINDS.map(kind => <Button key={kind.value} title={kind.label} disabled={fixed(stop.id)}
              accessibilityLabel={stop.kind === kind.value ? `${kind.label}, chosen` : `Make stop ${index + 1} a ${kind.label.toLowerCase()}`}
              variant={stop.kind === kind.value ? 'primary' : 'secondary'} style={styles.chip}
              onPress={() => setStops(draft.stops.map((s, i) => (i === index ? { ...s, kind: kind.value } : s)))} />)}
          </View>
          {fixed(stop.id) ? null : <View style={styles.chips}>
            <Button title="Up" variant="ghost" disabled={index === 0 || fixed(draft.stops[index - 1].id)} accessibilityLabel={`Move stop ${index + 1} up`} onPress={() => move(index, -1)} style={styles.chip} />
            <Button title="Down" variant="ghost" disabled={index === draft.stops.length - 1 || fixed(draft.stops[index + 1].id)} accessibilityLabel={`Move stop ${index + 1} down`} onPress={() => move(index, 1)} style={styles.chip} />
            <Button title="Remove" variant="ghost" accessibilityLabel={`Remove stop ${index + 1}`} onPress={() => setStops(draft.stops.filter((_, i) => i !== index))} style={styles.chip} />
          </View>}
        </View>)}
        {rights === 'none' ? null : <Select label="Add a stop" value={adding} options={options} placeholder="Choose a place" searchable={places.length > 8}
          onChange={placeId => { setStops([...draft.stops, { id: newOperationId(), placeId, kind: 'dropoff' }]); setAdding(undefined); }} />}
      </View>

      <Input label="Truck type" value={draft.truckType} onChangeText={text => set({ truckType: text })} maxLength={60} placeholder="e.g. Flatbed" />
      <View style={styles.pair}>
        <Input label="Truck number" value={draft.truckNumber} onChangeText={text => set({ truckNumber: text })} maxLength={40} style={styles.flex} />
        <Input label="Trailer number" value={draft.trailerNumber} onChangeText={text => set({ trailerNumber: text })} maxLength={40} style={styles.flex} />
      </View>
      <Input label="Bill of lading number" value={draft.bolNumber} onChangeText={text => set({ bolNumber: text })} maxLength={60} />
      <Input label="Notes" value={draft.notes} onChangeText={text => set({ notes: text })} maxLength={2000} multiline />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title={isNew ? 'Save load' : 'Save changes'} onPress={save} loading={saving} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} disabled={saving} />
    </ScrollView>
  </KeyboardAvoidingView>;
}

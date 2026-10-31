import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AreaList } from '@/components/inventory/AreaList';
import { useCountReference } from '@/components/inventory/useCountReference';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { newOperationId } from '@/lib/utils/operationId';
import { lookupTag } from '@/lib/api/tags';
import { activeAreas, areaPathLabel, buildAreaTree } from '@/lib/inventory/areas';
import { crateCode, moveIssue, unitWhere } from '@/lib/logistics/crates';
import { capturedNow } from '@/lib/logistics/loads';
import { holdText, OWN_PLACE_KINDS, plansAt, positionText, type TagLookup } from '@/lib/logistics/positions';

type Area = { zoneId: string; siteMapId: string; zoneName: string } | null;

// Where something is now, corrected (022): a crate moved without opening it
// (`move`, keeping its seal), or a loose item put right without counting it
// again (`relocate`, the only way to correct a received item's place). A
// place, then an area from a site plan drawn for it. Saved to the queue, so
// it works offline.
export function RelocateScreenContent() {
  const { code: crateParam, tag: tagParam } = useLocalSearchParams<{ code?: string; tag?: string }>();
  const code = crateParam ? crateCode(crateParam) : '';
  const tag = !code ? (tagParam ?? '').trim() : '';
  const office = useAuthStore(s => s.user?.role !== 'field_worker');
  const { index, data } = useLoadReference({ refresh: false });
  const count = useCountReference({ refresh: false });
  const unit = code ? index.units.get(code) : undefined;
  const [item, setItem] = useState<TagLookup | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [area, setArea] = useState<Area>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const operationId = useRef(newOperationId());
  // The screen stays mounted between visits: each starts clean.
  const restart = () => { setPlaceId(null); setMapId(null); setArea(null); setReason(''); setError(''); operationId.current = newOperationId(); };
  useEffect(restart, [code, tag]);
  useFocusEffect(useCallback(() => () => restart(), [code, tag]));
  // An item's place now, from the server when it answers.
  useEffect(() => {
    let live = true;
    setItem(null);
    if (tag) void lookupTag(tag).then(found => { if (live) setItem(found); }).catch(() => {});
    return () => { live = false; };
  }, [tag]);

  const places = useMemo(() => [...data.places].sort((a, b) => a.name.localeCompare(b.name)), [data.places]);
  const options = places.map(place => ({ value: place.id, label: [place.name, place.city].filter(Boolean).join(' · ') }));
  const chosen = places.find(place => place.id === placeId) ?? null;
  const plans = plansAt(count.data.maps, chosen);
  const shownMap = plans.find(m => m.id === mapId) ?? plans[0] ?? null;
  const areas = useMemo(() => (shownMap ? activeAreas(count.data.zones.filter(zone => zone.map_id === shownMap.id)) : []), [count.data.zones, shownMap?.id]);
  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  const issue = code ? (unit ? moveIssue(unit) : null) : item?.kind === 'written_off' ? `${tag} was written off on a load; an administrator can undo that.`
    : item?.position === 'in_crate' ? `${tag} is packed in ${item.crate_code}; move the crate instead, or take it out first.`
    : item?.position === 'on_load' || item?.position === 'missing' ? `${tag} is on load ${item.load_number ?? '?'}; it gets a place when it comes off.` : null;
  const now = code ? (unit ? unitWhere(unit) || 'Location not recorded' : 'This crate isn’t on this device yet.') : item?.position ? positionText(item as any) : '';
  const held = !office && item?.hold ? holdText(item.hold) : null;

  const choosePlace = (id: string) => {
    setPlaceId(id); setMapId(null);
    // An area belongs to one place's plan: one chosen elsewhere goes.
    const place = places.find(p => p.id === id);
    if (area && !plansAt(count.data.maps, place).some(map => map.id === area.siteMapId)) setArea(null);
  };
  const chooseArea = (zoneId: string) => {
    if (!shownMap) return;
    setArea({ zoneId, siteMapId: shownMap.id, zoneName: areaPathLabel(tree, zoneId) });
    // A plan drawn for a place names it, so the area is checked where it is.
    if (shownMap.place_id && shownMap.place_id !== placeId && places.some(p => p.id === shownMap.place_id)) setPlaceId(shownMap.place_id);
  };

  const save = async () => {
    if (saving) return;
    if (issue) { setError(issue); return; }
    if (!placeId && !area) { setError(`Choose where ${code ? 'the crate' : 'it'} is now.`); return; }
    // An area on a plan not tied to a place is checked against the place it is at now.
    const at = places.find(p => p.id === (placeId ?? (code ? unit?.place_id : item?.place_id)));
    if (area && !placeId && at && !OWN_PLACE_KINDS.has(at.kind)) { setError(`It was last at ${at.name}. Choose the yard or site it is at now, then the area.`); return; }
    // A sealed crate keeps its seal only with an area where its place has a plan with areas.
    const target = places.find(p => p.id === (placeId ?? unit?.place_id));
    const planned = plansAt(count.data.maps, target).some(map => activeAreas(count.data.zones.filter(zone => zone.map_id === map.id)).length > 0);
    if (code && unit?.status === 'sealed' && !area && planned) { setError(`${code} is sealed: choose the area where it is now.`); return; }
    if (reason.trim().length > 500) { setError('Keep the reason to 500 characters.'); return; }
    setSaving(true); setError('');
    const where = { ...(placeId ? { placeId } : {}), ...(area ? { zoneId: area.zoneId, siteMapId: area.siteMapId } : {}), capturedAt: capturedNow() };
    const labels = { placeName: chosen?.name, zoneName: area?.zoneName };
    try {
      if (code) await addToQueue({ type: 'move', payload: { move: { unitCode: code, ...where }, ...labels } }, operationId.current);
      else await addToQueue({ type: 'relocate', payload: { relocate: { tag: item?.code ?? tag, ...where, ...(reason.trim() ? { reason: reason.trim() } : {}) }, name: item?.name ?? undefined, ...labels } }, operationId.current);
      operationId.current = newOperationId();
      if (useNetworkStore.getState().isOnline) void processQueue().catch(() => {});
      router.back();
    } catch (e: any) { setError(`Could not save: ${e?.message ?? 'Please try again'}.`); }
    finally { setSaving(false); }
  };

  const title = code ? `Move ${code}` : `Correct where ${tag} is`;
  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <Stack.Screen options={{ headerShown: true, title }} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {now ? <Text style={styles.text}>Now: {now}</Text> : null}
      <Text style={styles.muted}>{code ? 'The crate moves as it is: nothing is unpacked, and a sealed crate stays sealed.' : 'This records where the item really is, without counting it again.'}</Text>
      {held ? <Text style={styles.warning}>{tag} is {held}: until the office releases it, it can only go to a hold area.</Text> : null}
      {issue ? <Text style={styles.error} accessibilityRole="alert">{issue}</Text> : <>
        <Select label="Place" value={placeId ?? undefined} options={options} placeholder="Choose a yard, site or shop" searchable={places.length > 8} onChange={choosePlace} />
        {chosen && plans.length === 0 ? <Text style={styles.muted}>{chosen.name} has no site plan on this device, so no area is needed.</Text> : null}
        {plans.length > 1 ? <View style={styles.chips}>{plans.map(m => <Button key={m.id} title={m.name} variant={m.id === shownMap?.id ? 'primary' : 'secondary'} onPress={() => setMapId(m.id)} style={styles.chip} />)}</View> : null}
        {area ? <View style={styles.pair}>
          <Text style={[styles.rowTitle, styles.flex]}>Area: {area.zoneName}</Text>
          <Button title="Clear area" variant="ghost" onPress={() => setArea(null)} />
        </View> : null}
        {areas.length ? <AreaList areas={areas} selectedId={area?.zoneId ?? null} reveal={null} style={{ minHeight: 180 }} onSelect={zone => chooseArea(zone.id)} /> : null}
        {!code ? <Input label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={500} multiline placeholder="e.g. Found on rack 4, not rack 2" /> : null}
      </>}
      {error && error !== issue ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title={code ? 'Save the move' : 'Save the location'} onPress={save} loading={saving} disabled={!!issue} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} disabled={saving} />
    </ScrollView>
  </KeyboardAvoidingView>;
}

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, AccessibilityInfo } from 'react-native';
import { Button } from '@/components/ui/Button';
import { SiteMapPicker } from '@/components/inventory/SiteMapPicker';
import { AreaList } from '@/components/inventory/AreaList';
import { useCountStore } from '@/stores/countStore';
import type { CountReference, SiteMapZone } from '@/lib/api/inventory';
import { activeAreas, areaPathLabel, areaRequired, buildAreaTree, staleLocation, type LocationRule } from '@/lib/inventory/areas';
import { countLocationIssue } from '@/lib/inventory/count';
import { pointInPolygon } from '@/lib/inventory/siteMap';
import { colors, space, fontSize, fontWeight } from '@/lib/design/tokens';

interface Props { reference: CountReference; rule: LocationRule | undefined; onNext: () => void; onBack: () => void; nextTitle?: string }

const NO_LOCATION = { siteMapId: null, pin: null, zoneId: null, zoneName: '' };

// Step 3: the location. The area list and the site plan are one tree: picking
// from the list zooms the plan to the area; tapping the plan chooses the
// smallest area under the finger and opens the list to it. An area is
// required when the plan has areas; the pin stays optional.
export function CountLocationStep({ reference, rule, onNext, onBack, nextTitle = 'Next: photo & review' }: Props) {
  const { location, setLocation, mapView, setMapView } = useCountStore();
  const [focus, setFocus] = useState<{ areaId: string; nonce: number } | null>(null);
  const [reveal, setReveal] = useState<{ areaId: string; nonce: number } | null>(null);
  const [error, setError] = useState('');
  const allAreas = useMemo(() => buildAreaTree(reference.zones), [reference.zones]);

  // A plan or area reopened from Sync (or restored with an old draft) may have
  // been retired, or the area may be on another plan; clear it so the crew can
  // choose again, and refresh the path in case an area was renamed or moved.
  useEffect(() => {
    if (!rule) return;
    const current = useCountStore.getState().location;
    const stale = staleLocation(current, rule);
    if (stale === 'plan') {
      setLocation(NO_LOCATION);
      setError('The office has retired the site plan chosen before. Choose the location again.');
    } else if (stale) {
      setLocation({ ...current, zoneId: null, zoneName: '' });
      setError(stale === 'area' ? 'The office has retired the area chosen before. Choose the location again.' : 'The area chosen before is on a different site plan. Choose the location again.');
    } else if (current.zoneId) {
      const label = areaPathLabel(allAreas, current.zoneId);
      if (label && label !== current.zoneName) setLocation({ ...current, zoneName: label });
    }
  }, [rule, allAreas]);
  const maps = reference.maps;
  const map = maps.find(m => m.id === location.siteMapId) ?? maps[0] ?? null;
  const areas = useMemo(() => (map ? activeAreas(reference.zones.filter(zone => zone.map_id === map.id)) : []), [reference.zones, map?.id]);
  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  const onThisMap = location.siteMapId === map?.id;
  const selected = onThisMap && location.zoneId && tree.byId.has(location.zoneId) ? location.zoneId : null;
  const path = selected ? areaPathLabel(tree, selected) : '';

  const chooseMap = (id: string) => {
    // A new plan starts fitted; coming back also starts fitted, not zoomed to an area no longer chosen.
    if (id !== map?.id) { setLocation({ siteMapId: id, pin: null, zoneId: null, zoneName: '' }); setFocus(null); setMapView(null); setError(''); }
  };
  // Always possible, even with no plan on this device: start the location over.
  const clearLocation = () => { setLocation(NO_LOCATION); setFocus(null); setError(''); };
  const hasLocation = !!(location.siteMapId || location.zoneId || location.pin);
  // From the list: keep the pin only if it is on this plan and inside the area.
  const chooseArea = (area: SiteMapZone) => {
    if (!map) return;
    const pin = onThisMap && location.pin && pointInPolygon(location.pin, area.shape) ? location.pin : null;
    setLocation({ siteMapId: map.id, pin, zoneId: area.id, zoneName: areaPathLabel(tree, area.id) });
    setFocus(current => ({ areaId: area.id, nonce: (current?.nonce ?? 0) + 1 }));
    setError('');
  };
  const required = areaRequired(rule, location.siteMapId);
  const handleNext = () => {
    const issue = countLocationIssue(location, rule);
    // Another plan has areas, this one has none: a pin here names the plan.
    if (issue && required && !location.zoneId && areas.length === 0) { setError('Choose a location: drop a pin on this plan, or switch to a plan with areas and pick one.'); return; }
    if (issue) { setError(issue); return; }
    setError('');
    onNext();
  };

  const status = !map ? ''
    : selected ? `${path}${onThisMap && location.pin ? ' · pin placed' : ''}`
    : areas.length ? (onThisMap && location.pin ? 'The pin is outside the marked areas. Choose an area from the list.' : 'Choose a location: pick an area below or tap it on the plan.')
    : onThisMap && location.pin ? 'Pin dropped.'
    : required ? 'Drop a pin on this plan, or switch to a plan with areas and pick one.' : 'Tap the plan to drop a pin, or skip the location.';
  const canSkip = !required && !location.zoneId && !location.pin;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {maps.length > 1 ? (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
          {maps.map(m => <Button key={m.id} title={m.name} variant={m.id === map?.id ? 'primary' : 'secondary'} onPress={() => chooseMap(m.id)} style={styles.chip} />)}
        </ScrollView>
      ) : null}
      {map ? (
        <View style={styles.map}>
          <SiteMapPicker
            key={map.id}
            map={map}
            imageUri={reference.images[map.id] ?? null}
            zones={areas}
            pin={onThisMap ? location.pin : null}
            zoneId={selected}
            focus={focus}
            initialView={mapView?.mapId === map.id ? mapView.view : null}
            onViewChange={view => setMapView({ mapId: map.id, view })}
            onChange={({ pin, zone }) => {
              const label = zone ? areaPathLabel(tree, zone.id) : '';
              setLocation({ siteMapId: map.id, pin, zoneId: zone?.id ?? null, zoneName: label });
              if (zone) setReveal(current => ({ areaId: zone.id, nonce: (current?.nonce ?? 0) + 1 }));
              setError('');
              // VoiceOver has no live regions: say what the tap chose.
              if (pin) AccessibilityInfo.announceForAccessibility(zone ? `${label} chosen` : areas.length ? 'Pin dropped outside the marked areas' : 'Pin dropped');
            }}
          />
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.text}>No site plan has been uploaded for this project yet. You can skip the location; the office can place the item later.</Text>
        </View>
      )}
      <View style={styles.statusRow}>
        <Text style={[selected ? styles.chosen : styles.status, styles.statusText]} accessibilityLiveRegion="polite">
          {map ? status : hasLocation ? `Saved location: ${location.zoneName || 'a pin on a site plan that is not on this device'}` : ''}
        </Text>
        {hasLocation ? <Button title="Clear location" variant="ghost" onPress={clearLocation} style={styles.clear} /> : null}
      </View>
      {areas.length > 0 ? <AreaList areas={areas} selectedId={selected} reveal={reveal} onSelect={chooseArea} style={styles.list} /> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.actions}>
        <Button title="Back" variant="secondary" onPress={onBack} style={styles.back} />
        <Button title={canSkip && map ? 'Skip location' : nextTitle} onPress={handleNext} style={styles.next} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space[4], gap: space[2], backgroundColor: colors.canvas },
  strip: { flexGrow: 0 },
  chips: { gap: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2] },
  map: { flex: 5, minHeight: 210 },
  list: { flex: 4, minHeight: 150 },
  empty: { flex: 1, justifyContent: 'center', padding: space[4] },
  text: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statusText: { flex: 1 },
  clear: { paddingHorizontal: space[2] },
  status: { fontSize: fontSize.body, color: colors.textMuted },
  chosen: { fontSize: fontSize.body, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  error: { color: colors.danger, fontSize: fontSize.body },
  actions: { flexDirection: 'row', gap: space[2] },
  back: { flex: 1 },
  next: { flex: 2 },
});

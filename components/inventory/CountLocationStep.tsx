import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Button } from '@/components/ui/Button';
import { SiteMapPicker } from '@/components/inventory/SiteMapPicker';
import { AreaList } from '@/components/inventory/AreaList';
import { useCountStore } from '@/stores/countStore';
import type { CountReference, SiteMapZone } from '@/lib/api/inventory';
import { activeAreas, areaPathLabel, buildAreaTree } from '@/lib/inventory/areas';
import { countLocationIssue, type AreaRule } from '@/lib/inventory/count';
import { pointInPolygon } from '@/lib/inventory/siteMap';
import { colors, space, fontSize } from '@/lib/design/tokens';

interface Props { reference: CountReference; areaRule: AreaRule; onNext: () => void; onBack: () => void; nextTitle?: string }

// Step 3: the location. The area list and the site plan are one tree: picking
// from the list zooms the plan to the area; tapping the plan chooses the
// smallest area under the finger and opens the list to it. An area is
// required once the project's plan has areas; the pin stays optional.
export function CountLocationStep({ reference, areaRule, onNext, onBack, nextTitle = 'Next: photo & review' }: Props) {
  const { location, setLocation, mapView, setMapView } = useCountStore();
  const [focus, setFocus] = useState<{ areaId: string; nonce: number } | null>(null);
  const [reveal, setReveal] = useState<{ areaId: string; nonce: number } | null>(null);
  const [error, setError] = useState('');
  const maps = reference.maps;
  const map = maps.find(m => m.id === location.siteMapId) ?? maps[0] ?? null;
  const areas = useMemo(() => (map ? activeAreas(reference.zones.filter(zone => zone.map_id === map.id)) : []), [reference.zones, map?.id]);
  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  const onThisMap = location.siteMapId === map?.id;
  const selected = onThisMap && location.zoneId && tree.byId.has(location.zoneId) ? location.zoneId : null;
  const path = selected ? areaPathLabel(tree, selected) : '';

  const chooseMap = (id: string) => {
    if (id !== map?.id) { setLocation({ siteMapId: id, pin: null, zoneId: null, zoneName: '' }); setError(''); }
  };
  // From the list: keep the pin only if it is on this plan and inside the area.
  const chooseArea = (area: SiteMapZone) => {
    if (!map) return;
    const pin = onThisMap && location.pin && pointInPolygon(location.pin, area.shape) ? location.pin : null;
    setLocation({ siteMapId: map.id, pin, zoneId: area.id, zoneName: areaPathLabel(tree, area.id) });
    setFocus(current => ({ areaId: area.id, nonce: (current?.nonce ?? 0) + 1 }));
    setError('');
  };
  const handleNext = () => {
    const issue = countLocationIssue(location, areaRule);
    if (issue) { setError(issue); return; }
    setError('');
    onNext();
  };

  const status = !map ? ''
    : selected ? `${path}${onThisMap && location.pin ? ' · pin placed' : ''}`
    : areas.length ? (onThisMap && location.pin ? 'The pin is outside the marked areas. Choose an area from the list.' : 'Choose a location: pick an area below or tap it on the plan.')
    : onThisMap && location.pin ? 'Pin dropped.' : 'Tap the plan to drop a pin, or skip the location.';
  const canSkip = !areaRule?.required && !location.zoneId && !location.pin;

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
              setLocation({ siteMapId: map.id, pin, zoneId: zone?.id ?? null, zoneName: zone ? areaPathLabel(tree, zone.id) : '' });
              if (zone) setReveal(current => ({ areaId: zone.id, nonce: (current?.nonce ?? 0) + 1 }));
              setError('');
            }}
          />
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.text}>No site plan has been uploaded for this project yet. You can skip the location; the office can place the item later.</Text>
        </View>
      )}
      {map ? <Text style={selected ? styles.chosen : styles.status} accessibilityLiveRegion="polite">{status}</Text> : null}
      {areas.length > 0 ? <AreaList areas={areas} selectedId={selected} reveal={reveal} onSelect={chooseArea} style={styles.list} /> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.actions}>
        <Button title={canSkip && map ? 'Skip location' : nextTitle} onPress={handleNext} />
        <Button title="Back" variant="secondary" onPress={onBack} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space[4], gap: space[2], backgroundColor: colors.canvas },
  strip: { flexGrow: 0 },
  chips: { gap: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2] },
  map: { flex: 5, minHeight: 220 },
  list: { flex: 4, minHeight: 180 },
  empty: { flex: 1, justifyContent: 'center', padding: space[4] },
  text: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20, textAlign: 'center' },
  status: { fontSize: fontSize.body, color: colors.textMuted },
  chosen: { fontSize: fontSize.body, color: colors.textPrimary, fontWeight: '600' },
  error: { color: colors.danger, fontSize: fontSize.body },
  actions: { gap: space[2] },
});

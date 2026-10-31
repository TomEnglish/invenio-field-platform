import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, AccessibilityInfo } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SiteMapPicker } from '@/components/inventory/SiteMapPicker';
import { AreaList } from '@/components/inventory/AreaList';
import { usePackStore } from '@/stores/packStore';
import type { CountReference, SiteMapZone } from '@/lib/api/inventory';
import { activeAreas, areaPathLabel, areaRequired, buildAreaTree, type LocationRule } from '@/lib/inventory/areas';
import { NO_PACK_LOCATION, type Place } from '@/lib/logistics/crates';
import { colors, space, fontSize, fontWeight } from '@/lib/design/tokens';

interface Props {
  reference: CountReference;
  places: Place[];
  rule: LocationRule | undefined;
  // The crate this one is inside, if any: then it goes where that crate goes.
  insideOf: string | null;
  onNext: () => void;
  onBack: () => void;
}

// Step 4: where the crate is, in the Count location step's pattern: a place,
// then an area from the list or by tapping the plan. Sealing a crate that
// isn't inside another needs an area once the project has areas.
export function CrateLocationStep({ reference, places, rule, insideOf, onNext, onBack }: Props) {
  const { location, setLocation, before } = usePackStore();
  const maps = reference.maps;
  const [shownMap, setShownMap] = useState<string | null>(location.siteMapId);
  const [focus, setFocus] = useState<{ areaId: string; nonce: number } | null>(null);
  const [reveal, setReveal] = useState<{ areaId: string; nonce: number } | null>(null);
  const [hint, setHint] = useState('');
  const map = maps.find(m => m.id === shownMap) ?? maps.find(m => m.id === location.siteMapId) ?? maps[0] ?? null;
  const areas = useMemo(() => (map ? activeAreas(reference.zones.filter(zone => zone.map_id === map.id)) : []), [reference.zones, map?.id]);
  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  const selected = location.zoneId && tree.byId.has(location.zoneId) ? location.zoneId : null;
  const imageUri = map ? reference.images[map.id] ?? null : null;
  const needed = areaRequired(rule, null) && !before?.zoneId;
  const options = useMemo(() => [...places].sort((a, b) => a.name.localeCompare(b.name))
    .map(place => ({ value: place.id, label: [place.name, place.city].filter(Boolean).join(' · ') })), [places]);

  const chooseArea = (area: SiteMapZone, from: 'list' | 'plan') => {
    if (!map) return;
    const label = areaPathLabel(tree, area.id);
    setLocation({ ...location, siteMapId: map.id, zoneId: area.id, zoneName: label });
    if (from === 'list') setFocus(current => ({ areaId: area.id, nonce: (current?.nonce ?? 0) + 1 }));
    else setReveal(current => ({ areaId: area.id, nonce: (current?.nonce ?? 0) + 1 }));
    setHint('');
  };
  const chosen = !!(location.placeId || location.zoneId);

  if (insideOf) return (
    <View style={styles.container}>
      <Text style={styles.text}>{`This crate is inside ${insideOf}, so it is wherever ${insideOf} is. Take it out of ${insideOf} to give it a place of its own.`}</Text>
      <View style={styles.actions}>
        <Button title="Back" variant="secondary" onPress={onBack} style={styles.back} />
        <Button title="Next: review" onPress={onNext} style={styles.next} />
      </View>
    </View>
  );

  const status = location.zoneId ? [location.placeName, location.zoneName].filter(Boolean).join(' · ')
    : location.placeId ? `${location.placeName}.${needed && areas.length ? ' Choose an area too; sealing needs one.' : ''}`
    : before?.where ? `Now at ${before.where}. Choose an area to move it.`
    : needed ? `Choose the area where this crate is${areas.length ? `: pick it from the list${imageUri ? ' or tap it on the plan' : ''}` : ''}. Sealing needs one.`
    : 'Choose where this crate is, or go on without a location.';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {places.length ? <Select
        label="Place"
        value={location.placeId ?? undefined}
        options={options}
        placeholder="Choose a yard, site or shop (optional)"
        searchable={places.length > 8}
        onChange={id => setLocation({ ...location, placeId: id, placeName: places.find(place => place.id === id)?.name ?? '' })}
      /> : null}
      {maps.length > 1 ? (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
          {maps.map(m => <Button key={m.id} title={m.name} accessibilityLabel={m.id === map?.id ? `${m.name}, shown` : `Show ${m.name}`} variant={m.id === map?.id ? 'primary' : 'secondary'} onPress={() => { setShownMap(m.id); setFocus(null); }} style={styles.chip} />)}
        </ScrollView>
      ) : null}
      {map && imageUri ? (
        <View style={styles.map}>
          <SiteMapPicker
            key={map.id}
            map={map}
            imageUri={imageUri}
            zones={areas}
            pin={null}
            zoneId={selected}
            focus={focus}
            onChange={({ zone }) => {
              if (zone) chooseArea(zone, 'plan');
              else setHint('Tap inside a marked area, or pick one from the list.');
              const said = zone ? `${areaPathLabel(tree, zone.id)} chosen` : 'No area there';
              // VoiceOver has no live regions; TalkBack reads the status line.
              if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(said);
            }}
          />
        </View>
      ) : null}
      <View style={styles.statusRow}>
        <Text style={[location.zoneId ? styles.chosen : styles.status, styles.statusText]} accessibilityLiveRegion="polite">{hint || status}</Text>
        {chosen ? <Button title="Clear" variant="ghost" onPress={() => { setLocation(NO_PACK_LOCATION); setFocus(null); setHint(''); }} style={styles.clear} /> : null}
      </View>
      {areas.length > 0 ? <AreaList areas={areas} selectedId={selected} reveal={reveal} onSelect={area => chooseArea(area, 'list')} style={styles.list} />
        : maps.length === 0 ? <Text style={styles.text}>No site plan with areas is on this device. The office can place the crate later.</Text> : null}
      <View style={styles.actions}>
        <Button title="Back" variant="secondary" onPress={onBack} style={styles.back} />
        <Button title="Next: review" onPress={onNext} style={styles.next} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space[4], gap: space[2], backgroundColor: colors.canvas },
  strip: { flexGrow: 0 },
  chips: { gap: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2] },
  map: { flex: 4, minHeight: 180 },
  list: { flex: 4, minHeight: 150 },
  text: { fontSize: fontSize.body, color: colors.textPrimary, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statusText: { flex: 1 },
  clear: { paddingHorizontal: space[2] },
  status: { fontSize: fontSize.body, color: colors.textMuted },
  chosen: { fontSize: fontSize.body, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  actions: { flexDirection: 'row', gap: space[2], marginTop: 'auto' },
  back: { flex: 1 },
  next: { flex: 2 },
});

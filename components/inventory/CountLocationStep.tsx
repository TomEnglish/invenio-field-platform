import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { SiteMapPicker } from '@/components/inventory/SiteMapPicker';
import { useCountStore } from '@/stores/countStore';
import type { CountReference, SiteMapZone } from '@/lib/api/inventory';
import { pointInPolygon } from '@/lib/inventory/siteMap';
import { colors, space, fontSize } from '@/lib/design/tokens';

interface Props { reference: CountReference; onNext: () => void; onBack: () => void; nextTitle?: string }

// Step 3: drop a pin on the site plan (or just pick a zone). Location is
// optional; a pin always belongs to the plan it was placed on.
export function CountLocationStep({ reference, onNext, onBack, nextTitle = 'Next: photo & review' }: Props) {
  const { location, setLocation, mapView, setMapView } = useCountStore();
  const maps = reference.maps;
  const map = maps.find(m => m.id === location.siteMapId) ?? maps[0] ?? null;
  const zones = map ? reference.zones.filter(zone => zone.map_id === map.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) : [];
  const zone = zones.find(z => z.id === location.zoneId) ?? null;

  const chooseMap = (id: string) => {
    if (id !== map?.id) setLocation({ siteMapId: id, pin: null, zoneId: null, zoneName: '' });
  };
  const chooseZone = (next: SiteMapZone | null) => {
    // Keep the pin only if it is on this plan and inside the chosen zone.
    const pin = next && location.siteMapId === map?.id && location.pin && pointInPolygon(location.pin, next.shape) ? location.pin : null;
    setLocation({ siteMapId: map?.id ?? null, pin, zoneId: next?.id ?? null, zoneName: next?.name ?? '' });
  };

  const status = !map ? '' : location.pin
    ? zone ? `Pin dropped in ${zone.name}.` : 'Pin dropped outside the marked zones.'
    : zone ? `${zone.name} chosen without a pin.` : 'Tap the plan to drop a pin, or choose a zone.';

  return (
    <View style={styles.container}>
      {maps.length > 1 ? (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
          {maps.map(m => <Button key={m.id} title={m.name} variant={m.id === map?.id ? 'primary' : 'secondary'} onPress={() => chooseMap(m.id)} style={styles.chip} />)}
        </ScrollView>
      ) : null}
      {map ? (
        <SiteMapPicker
          key={map.id}
          map={map}
          imageUri={reference.images[map.id] ?? null}
          zones={zones}
          pin={location.siteMapId === map.id ? location.pin : null}
          zoneId={location.siteMapId === map.id ? location.zoneId : null}
          initialView={mapView?.mapId === map.id ? mapView.view : null}
          onViewChange={view => setMapView({ mapId: map.id, view })}
          onChange={({ pin, zone: hit }) => setLocation({ siteMapId: map.id, pin, zoneId: hit?.id ?? null, zoneName: hit?.name ?? '' })}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.text}>No site plan has been uploaded for this project yet. You can skip the location; the office can place the item later.</Text>
        </View>
      )}
      {map ? <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text> : null}
      {zones.length > 0 ? (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false} accessibilityLabel="Zones">
          <Button title="No zone" variant={!location.zoneId ? 'primary' : 'secondary'} onPress={() => chooseZone(null)} style={styles.chip} />
          {zones.map(z => <Button key={z.id} title={z.name} variant={z.id === location.zoneId ? 'primary' : 'secondary'} onPress={() => chooseZone(z)} style={styles.chip} />)}
        </ScrollView>
      ) : null}
      <View style={styles.actions}>
        <Button title={location.pin || location.zoneId || !map ? nextTitle : 'Skip location'} onPress={onNext} />
        <Button title="Back" variant="secondary" onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space[4], gap: space[3], backgroundColor: colors.canvas },
  strip: { flexGrow: 0 },
  chips: { gap: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2] },
  empty: { flex: 1, justifyContent: 'center', padding: space[4] },
  text: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20, textAlign: 'center' },
  status: { fontSize: fontSize.body, color: colors.textPrimary },
  actions: { gap: space[2] },
});

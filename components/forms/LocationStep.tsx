import { useState, useEffect } from 'react';
import { View, ScrollView, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Button } from '@/components/ui/Button';
import { useReceivingStore } from '@/stores/receivingStore';
import { getProjectClient } from '@/lib/supabaseProject';
import type { Location } from '@/types/database';
import { colors } from '@/lib/design/tokens';

interface Props {
  onNext?: () => void;
  onSubmit?: () => void;
  onBack: () => void;
  submitting?: boolean;
  nextTitle?: string;
}

export function LocationStep({ onNext, onSubmit, onBack, submitting, nextTitle = 'Next' }: Props) {
  const { location, locationLabel, setLocation } = useReceivingStore();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState(location.location_id);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const { data, error: err } = await getProjectClient().from('locations').select('*').order('zone').order('row').order('rack');
      if (err) throw err;
      setLocations(data as Location[]);
    } catch {
      setError('Locations could not be loaded. Connect and retry, or keep the location already saved in this draft.');
    }
    setLoading(false);
  };

  const handleNext = () => {
    if (!selected) {
      setError('Please select a location');
      return;
    }
    const chosen = locations.find(loc => loc.id === selected);
    setLocation({ location_id: selected }, chosen ? `${chosen.zone} · Row ${chosen.row}, Rack ${chosen.rack}` : locationLabel);
    if (onNext) onNext();
    else if (onSubmit) onSubmit();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Loading locations...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Storage Location</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {selected && !locations.some(loc => loc.id === selected) && <Text style={styles.savedLocation}>Saved location: {locationLabel || 'Previously selected yard location'}</Text>}
      {error ? <Button title="Retry loading locations" variant="secondary" onPress={() => { setError(''); setLoading(true); void loadLocations(); }} /> : null}
      {locations.length === 0 ? (
        <Text style={styles.hint}>
          No locations configured. Ask an office admin to add yard locations.
        </Text>
      ) : (
        locations.map((loc) => (
          <TouchableOpacity
            key={loc.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === loc.id }}
            style={[styles.locationCard, selected === loc.id && styles.locationSelected]}
            onPress={() => {
              setSelected(loc.id);
              setError('');
            }}
          >
            <Text style={[styles.locationText, selected === loc.id && styles.locationTextSelected]}>
              {loc.zone} - Row {loc.row}, Rack {loc.rack}
            </Text>
            {loc.is_hold_area && <Text style={styles.holdBadge}>HOLD AREA</Text>}
          </TouchableOpacity>
        ))
      )}

      <Button title={submitting ? 'Submitting...' : (onSubmit ? 'Submit' : nextTitle)} onPress={handleNext} loading={submitting} style={{ marginTop: 16 }} />
      <Button title="Back" variant="secondary" onPress={onBack} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: 16 },
  error: { color: colors.danger, fontSize: 14, marginBottom: 8 },
  savedLocation: { fontSize: 15, color: colors.textPrimary, paddingVertical: 12 },
  hint: { fontSize: 14, color: colors.textSubtle, textAlign: 'center' },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimarySoft,
  },
  locationText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  locationTextSelected: {
    color: colors.brandPrimary,
  },
  holdBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});

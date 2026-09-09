import { Button } from '@/components/ui/Button';
import {
  fetchExceptions,
  resolveException,
  type ExceptionRecord,
} from '@/lib/api/exceptions';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '@/lib/design/tokens';

export default function ExceptionsScreen() {
  const user = useAuthStore((s) => s.user);
  const activeProject = useAuthStore((s) => s.activeProject);
  const [exceptions, setExceptions] = useState<ExceptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchExceptions(showResolved);
      setExceptions(data);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [showResolved, activeProject?.id])
  );

  const handleResolve = (id: string, resolution: 'hold' | 'return_to_vendor') => {
    const label = resolution === 'hold' ? 'Keep open on hold' : 'Return to Vendor';
    Alert.alert('Update Exception', `Confirm: ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await resolveException(id, resolution, user?.id);
            load();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderItem = ({ item }: { item: ExceptionRecord }) => {
    const isExpanded = expandedId === item.id;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.badge, item.exception_resolved && styles.badgeResolved]}>
              <Text style={styles.badgeText}>
                {item.exception_resolved ? 'RESOLVED' : item.exception_type?.toUpperCase().replaceAll('_', ' ') ?? 'EXCEPTION'}
              </Text>
            </View>
            <Text style={styles.cardTitle}>{item.material_type}</Text>
            <Text style={styles.cardSubtitle}>Qty: {item.qty}</Text>
          </View>
          <FontAwesome name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSubtle} />
        </View>

        {isExpanded && (
          <View style={styles.details}>
            <DetailRow label="Condition" value={item.condition} />
            {item.damage_notes && <DetailRow label="Damage Notes" value={item.damage_notes} />}
            {item.vendor && <DetailRow label="Vendor" value={item.vendor} />}
            {item.po_number && <DetailRow label="PO #" value={item.po_number} />}
            {item.location_zone && (
              <DetailRow
                label="Location"
                value={`${item.location_zone} - Row ${item.location_row}, Rack ${item.location_rack}`}
              />
            )}
            <DetailRow label="Reported By" value={item.created_by_name ?? 'Unknown'} />
            <DetailRow label="Date" value={formatDate(item.created_at)} />

            {item.exception_resolved ? (
              <View style={styles.resolvedBanner}>
                <Text style={styles.resolvedText}>
                  Resolved: {item.exception_resolution === 'hold' ? 'Moved to Hold' : 'Returned to Vendor'}
                </Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <Button
                  title="Hold"
                  onPress={() => handleResolve(item.id, 'hold')}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Return to Vendor"
                  variant="danger"
                  onPress={() => handleResolve(item.id, 'return_to_vendor')}
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        <Button
          title="Open"
          variant={!showResolved ? 'primary' : 'secondary'}
          onPress={() => setShowResolved(false)}
          style={styles.filterButton}
        />
        <Button
          title="All"
          variant={showResolved ? 'primary' : 'secondary'}
          onPress={() => setShowResolved(true)}
          style={styles.filterButton}
        />
      </View>

      <FlatList
        data={exceptions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="check-circle" size={48} color={colors.borderStrong} />
            <Text style={styles.emptyText}>
              {showResolved ? 'No exceptions found' : 'No open exceptions'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterButton: { flex: 1, paddingVertical: 8 },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderLeft: { flex: 1 },
  badge: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  badgeResolved: { backgroundColor: colors.successSoft },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.dangerDeep },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cardSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  details: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.raised, paddingTop: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: { fontSize: 13, color: colors.textMuted },
  detailValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '500', flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  resolvedBanner: {
    backgroundColor: colors.successSoft,
    borderRadius: 6,
    padding: 10,
    marginTop: 12,
  },
  resolvedText: { color: colors.successDeep, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textSubtle, marginTop: 12 },
});

import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { fetchMaterials, type MaterialWithLocation } from '@/lib/api/materials';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { getCached, setCache } from '@/lib/sync/readCache';
import { colors } from '@/lib/design/tokens';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'in_yard', label: 'In Yard' },
  { value: 'issued', label: 'Issued' },
  { value: 'depleted', label: 'Depleted' },
];

export default function InventoryScreen() {
  const [materials, setMaterials] = useState<MaterialWithLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const offsetRef = useRef(0);

  const isOnline = useNetworkStore((s) => s.isOnline);

  const load = async () => {
    setLoading(true);
    offsetRef.current = 0;
    const context = useAuthStore.getState();
    const stillCurrent = () => context.user?.id === useAuthStore.getState().user?.id && context.activeProject?.id === useAuthStore.getState().activeProject?.id;
    setMaterials([]);
    const cacheKey = `materials_${statusFilter}_${search}`;
    try {
      const result = await fetchMaterials({
        status: statusFilter || undefined,
        search: search || undefined,
        offset: 0,
      });
      if (!stillCurrent()) return;
      setMaterials(result.data);
      setHasMore(result.hasMore);
      offsetRef.current = result.data.length;
      await setCache(cacheKey, result.data);
    } catch (e: any) {
      if (!stillCurrent()) return;
      const cached = !useNetworkStore.getState().isOnline ? await getCached<MaterialWithLocation[]>(cacheKey) : null;
      if (cached) {
        setMaterials(cached);
        setHasMore(false);
      } else {
        Alert.alert('Error', e.message);
      }
    }
    setLoading(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchMaterials({
        status: statusFilter || undefined,
        search: search || undefined,
        offset: offsetRef.current,
      });
      setMaterials((prev) => [...prev, ...result.data]);
      setHasMore(result.hasMore);
      offsetRef.current += result.data.length;
    } catch {}
    setLoadingMore(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [statusFilter, search])
  );

  const statusColor = (status: string) => {
    switch (status) {
      case 'in_yard': return colors.success;
      case 'issued': return colors.warn;
      case 'shipped': return colors.brandPrimary;
      case 'depleted': return colors.textSubtle;
      default: return colors.textMuted;
    }
  };

  const renderItem = ({ item }: { item: MaterialWithLocation }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/(field)/material-detail' as any, params: { id: item.id } })}
      activeOpacity={0.7}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{item.material_type}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
            {item.status.replaceAll('_', ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.cardDetails}>
        {item.size && <Text style={styles.detail}>Size: {item.size}</Text>}
        {item.grade && <Text style={styles.detail}>Grade: {item.grade}</Text>}
        <Text style={styles.detail}>Qty: {item.current_quantity}/{item.qty}</Text>
      </View>

      {item.location_zone && (
        <Text style={styles.location}>
          <FontAwesome name="map-marker" size={12} color={colors.textSubtle} />
          {'  '}{item.location_zone} - Row {item.location_row}, Rack {item.location_rack}
        </Text>
      )}

      {item.qr_code_value && (
        <Text style={styles.qrCode}>QR: {item.qr_code_value}</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by type, grade, or QR code..."
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              title={f.label}
              variant={statusFilter === f.value ? 'primary' : 'secondary'}
              onPress={() => setStatusFilter(f.value)}
              style={styles.filterButton}
            />
          ))}
        </View>
      </ScrollView>

      <FlatList
        data={materials}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 12 }} /> : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="cubes" size={48} color={colors.borderStrong} />
            <Text style={styles.emptyText}>No materials found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  searchBar: {
    padding: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    backgroundColor: colors.raised,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
  filterScroll: {
    flexShrink: 0,
    flexGrow: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterButton: { flexShrink: 0, paddingVertical: 8, paddingHorizontal: 16 },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: { fontSize: 10, fontWeight: '700' },
  cardDetails: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  detail: { fontSize: 13, color: colors.textMuted },
  location: { fontSize: 12, color: colors.textSubtle, marginTop: 6 },
  qrCode: { fontSize: 11, color: colors.borderStrong, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textSubtle, marginTop: 12 },
});

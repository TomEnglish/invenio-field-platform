import { EditMaterialModal } from '@/components/modals/EditMaterialModal';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { fetchMaterials, type MaterialWithLocation } from '@/lib/api/materials';
import { applyOperation, operationContext } from '@/lib/api/operations';
import { newOperationId } from '@/lib/utils/operationId';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';
import { colors, radius, space, fontSize, fontWeight, tint } from '@/lib/design/tokens';

const STATUS_FILTERS = [
  { value: '',         label: 'All' },
  { value: 'in_yard',  label: 'In Yard' },
  { value: 'issued',   label: 'Issued' },
  { value: 'shipped',  label: 'Shipped' },
  { value: 'depleted', label: 'Depleted' },
];

const statusColor = (status: string): string => {
  switch (status) {
    case 'in_yard':  return colors.success;
    case 'issued':   return colors.warn;
    case 'shipped':  return colors.brandPrimary;
    case 'depleted': return colors.textSubtle;
    default:         return colors.textMuted;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  const c = statusColor(status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: tint(c, 0.12) }]}>
      <Text style={[styles.statusText, { color: c }]}>
        {status.replaceAll('_', ' ').toUpperCase()}
      </Text>
    </View>
  );
};

export default function MaterialsScreen() {
  const { activeProject, user } = useAuthStore();
  const [reason, setReason] = useState('');
  const operationId = useRef(newOperationId());
  const [materials, setMaterials] = useState<MaterialWithLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const offsetRef = useRef(0);

  // Edit modal state
  const [editItem, setEditItem] = useState<MaterialWithLocation | null>(null);
  const [editType, setEditType] = useState('');
  const [editSize, setEditSize] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    offsetRef.current = 0;
    try {
      const result = await fetchMaterials({
        status: statusFilter || undefined,
        search: search || undefined,
        offset: 0,
      });
      setMaterials(result.data);
      setHasMore(result.hasMore);
      offsetRef.current = result.data.length;
    } catch (e: any) {
      Alert.alert('Error', e.message);
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
    }, [statusFilter, search, activeProject?.id])
  );

  const openEdit = (item: MaterialWithLocation) => {
    if (user?.role !== 'admin') return;
    setReason(''); operationId.current = newOperationId();
    setEditItem(item);
    setEditType(item.material_type);
    setEditSize(item.size ?? '');
    setEditGrade(item.grade ?? '');
    setEditSpec(item.spec ?? '');
    setEditWeight(item.weight ? String(item.weight) : '');
  };

  const handleSave = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await applyOperation('correct_material', { materialId: editItem.id, reason, changes: {
        material_type: editType, size: editSize || null, grade: editGrade || null,
        spec: editSpec || null, weight: editWeight ? Number(editWeight) : null,
      } }, operationContext(operationId.current));
      setEditItem(null);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  // Column config — adopts the DataTable primitive (v0.6.0 reviewer asked
  // for at least one real consumer of DataTable; this is it).
  const columns: DataTableColumn<MaterialWithLocation>[] = [
    {
      key: 'material_type',
      header: 'Material',
      width: 180,
      render: (m) => (
        <View>
          <Text style={styles.cellPrimary} numberOfLines={1}>{m.material_type}</Text>
          {m.size || m.grade ? (
            <Text style={styles.cellSecondary} numberOfLines={1}>
              {[m.size, m.grade].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: 90,
      align: 'right',
      render: (m) => (
        <Text style={[styles.cellPrimary, { textAlign: 'right' }]}>
          {m.current_quantity}
          <Text style={styles.cellSecondary}> / {m.qty}</Text>
        </Text>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      width: 200,
      render: (m) =>
        m.location_zone ? (
          <Text style={styles.cellPrimary} numberOfLines={1}>
            {m.location_zone} · R{m.location_row}/Rk{m.location_rack}
          </Text>
        ) : (
          <Text style={styles.cellSecondary}>—</Text>
        ),
    },
  ];

  return (
    <View style={styles.container}>
      {/* Search bar — DataTable doesn't bundle global search; this stays at the screen level */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search materials..."
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (
            layoutMeasurement.height + contentOffset.y >=
            contentSize.height - 200
          ) {
            loadMore();
          }
        }}
        scrollEventThrottle={16}
      >
        <DataTable
          columns={columns}
          data={materials}
          rowKey={(m) => m.id}
          loading={loading}
          skeletonRows={6}
          filters={STATUS_FILTERS}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
          visibleCount={
            materials.length
              ? `Showing ${materials.length}${hasMore ? '+' : ''}`
              : undefined
          }
          emptyState={{
            title: 'No materials found',
            caption: search || statusFilter
              ? 'Try clearing the filter or search.'
              : 'No materials in this project yet.',
          }}
          onRowPress={openEdit}
        />
        {loadingMore ? (
          <View style={styles.loadingMore}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.loadingMoreText}>Loading more…</Text>
          </View>
        ) : null}
      </ScrollView>

      <EditMaterialModal
        editItem={editItem}
        reason={reason}
        setReason={setReason}
        editType={editType}
        setEditType={setEditType}
        editSize={editSize}
        setEditSize={setEditSize}
        editGrade={editGrade}
        setEditGrade={setEditGrade}
        editSpec={editSpec}
        setEditSpec={setEditSpec}
        editWeight={editWeight}
        setEditWeight={setEditWeight}
        saving={saving}
        onSave={handleSave}
        onCancel={() => setEditItem(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  searchBar: {
    padding: space[3],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2] + 2,
    fontSize: fontSize.body + 1,
    color: colors.textPrimary,
  } as TextStyle,
  body: { flex: 1 },
  bodyContent: { padding: space[3], gap: space[3] },
  cellPrimary: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  } as TextStyle,
  cellSecondary: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
  } as TextStyle,
  statusBadge: {
    paddingHorizontal: space[2] + 2,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 10,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: 0.6,
  } as TextStyle,
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingVertical: space[4],
  },
  loadingMoreText: { fontSize: fontSize.sm, color: colors.textMuted },
});

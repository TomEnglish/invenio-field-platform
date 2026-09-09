import { AdminEditModal, type ColumnConfig } from '@/components/modals/AdminEditModal';
import { Button } from '@/components/ui/Button';
import { deleteRecord, fetchTableData, insertRecord, updateRecord } from '@/lib/api/admin';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, tint } from '@/lib/design/tokens';

// ---------------------------------------------------------------------------
// Table configurations
// ---------------------------------------------------------------------------

interface TableConfig {
  key: string;
  label: string;
  columns: ColumnConfig[];
  searchColumns: string[];
  canInsert: boolean;
  canDelete: boolean;
  idField: string;
  orderBy: string;
  orderAsc: boolean;
}

const TABLE_CONFIGS: TableConfig[] = [
  {
    key: "materials", label: "Materials", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["material_type","size","grade","spec"],
    columns: [
      {key: "material_type",label: "Type",editable: true,type: "text"},
      {key: "size",label: "Size",editable: true,type: "text"},
      {key: "grade",label: "Grade",editable: true,type: "text"},
      {key: "spec",label: "Spec",editable: true,type: "text"},
      {key: "qty",label: "Qty",editable: false,type: "number"},
      {key: "current_quantity",label: "Current Qty",editable: false,type: "number"},
      {key: "weight",label: "Weight",editable: true,type: "number"},
      {key: "status",label: "Status",editable: false,type: "enum",options: ["in_yard","issued","shipped","depleted"]},
      {key: "created_at",label: "Created",editable: false,type: "date"}
    ],
  },
  {
    key: "receiving_records", label: "Receiving Records", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["material_type","vendor","po_number","grade"],
    columns: [
      {key: "material_type",label: "Type",editable: false,type: "text"},
      {key: "qty",label: "Qty",editable: false,type: "number"},
      {key: "size",label: "Size",editable: false,type: "text"},
      {key: "grade",label: "Grade",editable: false,type: "text"},
      {key: "status",label: "Status",editable: false,type: "enum",options: ["pending","accepted","partially_accepted","rejected"]},
      {key: "vendor",label: "Vendor",editable: false,type: "text"},
      {key: "po_number",label: "PO #",editable: false,type: "text"},
      {key: "condition",label: "Condition",editable: false,type: "enum",options: ["good","damaged","mixed"]},
      {key: "inspection_pass",label: "Insp. Pass",editable: false,type: "boolean"},
      {key: "has_exception",label: "Exception",editable: false,type: "boolean"},
      {key: "exception_type",label: "Exception Type",editable: false,type: "text"},
      {key: "exception_resolved",label: "Resolved",editable: false,type: "boolean"},
      {key: "exception_resolution",label: "Resolution",editable: false,type: "enum",options: ["","hold","return_to_vendor"]},
      {key: "created_at",label: "Created",editable: false,type: "date"}
    ],
  },
  {
    key: "locations", label: "Locations", idField: "id", orderBy: "zone", orderAsc: true, canInsert: true, canDelete: false, searchColumns: ["zone","row","rack"],
    columns: [
      {key: "zone",label: "Zone",editable: true,type: "text"},
      {key: "row",label: "Row",editable: true,type: "text"},
      {key: "rack",label: "Rack",editable: true,type: "text"},
      {key: "is_hold_area",label: "Hold Area",editable: true,type: "boolean"},
      {key: "capacity",label: "Capacity",editable: true,type: "number"},
      {key: "created_at",label: "Created",editable: false,type: "date"}
    ],
  },
  {
    key: "qr_codes", label: "QR Codes", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["code_value"],
    columns: [
      {key: "code_value",label: "Code",editable: false,type: "text"},
      {key: "entity_type",label: "Entity Type",editable: false,type: "enum",options: ["item","pallet","shipment"]},
      {key: "entity_id",label: "Entity ID",editable: false,type: "text"},
      {key: "created_at",label: "Created",editable: false,type: "date"}
    ],
  },
  {
    key: "material_movements", label: "Material Movements", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["reason"],
    columns: [
      {key: "material_id",label: "Material ID",editable: false,type: "text"},
      {key: "from_location_id",label: "From Location",editable: false,type: "text"},
      {key: "to_location_id",label: "To Location",editable: false,type: "text"},
      {key: "reason",label: "Reason",editable: false,type: "text"},
      {key: "moved_by",label: "Moved By",editable: false,type: "text"},
      {key: "created_at",label: "Date",editable: false,type: "date"}
    ],
  },
  {
    key: "material_issues", label: "Material Issues", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["job_number","work_order"],
    columns: [
      {key: "material_id",label: "Material ID",editable: false,type: "text"},
      {key: "job_number",label: "Job #",editable: false,type: "text"},
      {key: "work_order",label: "Work Order",editable: false,type: "text"},
      {key: "quantity_issued",label: "Qty Issued",editable: false,type: "number"},
      {key: "issued_by",label: "Issued By",editable: false,type: "text"},
      {key: "created_at",label: "Date",editable: false,type: "date"}
    ],
  },
  {
    key: "shipments_out", label: "Shipments Out", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["destination","carrier","tracking_number"],
    columns: [
      {key: "material_id",label: "Material ID",editable: false,type: "text"},
      {key: "destination",label: "Destination",editable: false,type: "text"},
      {key: "carrier",label: "Carrier",editable: false,type: "text"},
      {key: "tracking_number",label: "Tracking #",editable: false,type: "text"},
      {key: "quantity_shipped",label: "Qty",editable: false,type: "number"},
      {key: "created_at",label: "Date",editable: false,type: "date"}
    ],
  },
  {
    key: "purchase_orders", label: "Purchase Orders", idField: "id", orderBy: "id", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["purchase_order_id","po_description","supplier","item_description"],
    columns: [
      {key: "purchase_order_id",label: "PO ID",editable: false,type: "text"},
      {key: "po_description",label: "Description",editable: false,type: "text"},
      {key: "supplier",label: "Supplier",editable: false,type: "text"},
      {key: "status",label: "Status",editable: false,type: "enum",options: ["Sent","Follow-Up Document Created","Finished","Canceled"]},
      {key: "item_description",label: "Item",editable: false,type: "text"},
      {key: "ordered_quantity",label: "Qty",editable: false,type: "number"},
      {key: "net_value",label: "Net Value",editable: false,type: "number"},
      {key: "delivery_date_from",label: "Delivery Date",editable: false,type: "date"},
      {key: "created_at",label: "Created",editable: false,type: "date"},
      {key: "item_status",label: "Item Status",editable: false,type: "text"},
      {key: "delivery_status",label: "Delivery Status",editable: false,type: "text"},
      {key: "category",label: "Category",editable: false,type: "text"},
      {key: "sub_category",label: "Sub-Category",editable: false,type: "text"}
    ],
  },
  {
    key: "shipments", label: "Shipments (Inbound)", idField: "id", orderBy: "id", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["shipment_number","supplier","po_number","part_description"],
    columns: [
      {key: "shipment_number",label: "Shipment #",editable: false,type: "text"},
      {key: "supplier",label: "Supplier",editable: false,type: "text"},
      {key: "status",label: "Status",editable: false,type: "text"},
      {key: "category",label: "Category",editable: false,type: "text"},
      {key: "po_number",label: "PO #",editable: false,type: "text"},
      {key: "eta",label: "ETA",editable: false,type: "date"},
      {key: "delivery_date",label: "Delivered",editable: false,type: "date"},
      {key: "part_description",label: "Description",editable: false,type: "text"},
      {key: "num_pieces",label: "Pieces",editable: false,type: "number"}
    ],
  },
  {
    key: "material_links", label: "Material Links", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["po_id","install_tag","po_description","install_discipline"],
    columns: [
      {key: "po_id",label: "PO ID",editable: false,type: "text"},
      {key: "po_description",label: "PO Description",editable: false,type: "text"},
      {key: "install_tag",label: "Install Tag",editable: false,type: "text"},
      {key: "install_discipline",label: "Discipline",editable: false,type: "text"},
      {key: "material_status",label: "Status",editable: false,type: "enum",options: ["ordered","shipped","received","installed"]},
      {key: "quantity",label: "Qty",editable: false,type: "number"},
      {key: "uom",label: "UOM",editable: false,type: "text"},
      {key: "notes",label: "Notes",editable: false,type: "text"},
      {key: "created_at",label: "Created",editable: false,type: "date"}
    ],
  },
  {
    key: "delivery_dates", label: "Delivery Dates", idField: "id", orderBy: "delivery_date", orderAsc: true, canInsert: false, canDelete: false, searchColumns: ["package_description","tag_number","supplier_name","po_number"],
    columns: [
      {key: "package_description",label: "Package",editable: false,type: "text"},
      {key: "tag_number",label: "Tag #",editable: false,type: "text"},
      {key: "supplier_name",label: "Supplier",editable: false,type: "text"},
      {key: "po_number",label: "PO #",editable: false,type: "text"},
      {key: "delivery_date",label: "Delivery Date",editable: false,type: "date"},
      {key: "delivery_date_notes",label: "Notes",editable: false,type: "text"}
    ],
  },
  {
    key: "audit_log", label: "Audit Log", idField: "id", orderBy: "created_at", orderAsc: false, canInsert: false, canDelete: false, searchColumns: ["action","entity_type"],
    columns: [
      {key: "action",label: "Action",editable: false,type: "text"},
      {key: "entity_type",label: "Entity Type",editable: false,type: "text"},
      {key: "entity_id",label: "Entity ID",editable: false,type: "text"},
      {key: "user_id",label: "User ID",editable: false,type: "text"},
      {key: "details",label: "Details",editable: false,type: "text"},
      {key: "created_at",label: "Date",editable: false,type: "date"}
    ],
  },
  {
    key: "project_schedule", label: "Project Schedule", idField: "id", orderBy: "start_date", orderAsc: true, canInsert: false, canDelete: false, searchColumns: ["activity_id","activity_name","category"],
    columns: [
      {key: "activity_id",label: "Activity ID",editable: false,type: "text"},
      {key: "activity_name",label: "Activity",editable: false,type: "text"},
      {key: "start_date",label: "Start",editable: false,type: "date"},
      {key: "finish_date",label: "Finish",editable: false,type: "date"},
      {key: "status",label: "Status",editable: false,type: "text"},
      {key: "percent_complete",label: "% Complete",editable: false,type: "number"},
      {key: "category",label: "Category",editable: false,type: "text"},
      {key: "is_critical",label: "Critical",editable: false,type: "boolean"},
      {key: "is_milestone",label: "Milestone",editable: false,type: "boolean"}
    ],
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENUM_COLORS: Record<string, string> = {
  in_yard: colors.success,
  issued: colors.warn,
  shipped: colors.brandPrimary,
  depleted: colors.textSubtle,
  pending: colors.warn,
  inspecting: colors.brandPrimary,
  completed: colors.success,
  rejected: colors.danger,
  draft: colors.textSubtle,
  submitted: colors.warn,
  acknowledged: colors.brandPrimary,
  received: colors.success,
  closed: colors.textMuted,
  in_transit: colors.brandPrimary,
  delivered: colors.success,
  not_started: colors.textSubtle,
  in_progress: colors.warn,
  on_hold: colors.danger,
};

function badgeColor(value: string): string {
  return ENUM_COLORS[value] ?? colors.textMuted;
}

function formatValue(value: any, type: string): string {
  if (value == null) return '-';
  if (type === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'date') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Screen component
// ---------------------------------------------------------------------------

export function AdminScreen() {
  const { activeProject, user } = useAuthStore();
  const [selectedTable, setSelectedTable] = useState(TABLE_CONFIGS[0]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const offsetRef = useRef(0);

  // Modal state
  const [editRecord, setEditRecord] = useState<Record<string, any> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (user?.role !== 'admin') return;
    setLoading(true);
    offsetRef.current = 0;
    try {
      const result = await fetchTableData(selectedTable.key, {
        offset: 0,
        search: search || undefined,
        searchColumns: selectedTable.searchColumns,
        orderBy: selectedTable.orderBy,
        orderAsc: selectedTable.orderAsc,
      });
      setRecords(result.data);
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
      const result = await fetchTableData(selectedTable.key, {
        offset: offsetRef.current,
        search: search || undefined,
        searchColumns: selectedTable.searchColumns,
        orderBy: selectedTable.orderBy,
        orderAsc: selectedTable.orderAsc,
      });
      setRecords((prev) => [...prev, ...result.data]);
      setHasMore(result.hasMore);
      offsetRef.current += result.data.length;
    } catch {}
    setLoadingMore(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [selectedTable.key, search, activeProject?.id])
  );

  const switchTable = (config: TableConfig) => {
    setSelectedTable(config);
    setSearch('');
  };

  const openEdit = (record: Record<string, any>) => {
    setEditRecord(record);
    setIsNew(false);
    setModalVisible(true);
  };

  const openNew = () => {
    setEditRecord(null);
    setIsNew(true);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditRecord(null);
    setIsNew(false);
  };

  const handleSave = async (changes: Record<string, any>) => {
    setSaving(true);
    try {
      if (isNew) {
        await insertRecord(selectedTable.key, changes);
      } else if (editRecord) {
        await updateRecord(
          selectedTable.key,
          selectedTable.idField,
          editRecord[selectedTable.idField],
          changes
        );
      }
      closeModal();
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!editRecord) return;
    Alert.alert('Confirm Delete', 'Are you sure you want to delete this record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await deleteRecord(
              selectedTable.key,
              selectedTable.idField,
              editRecord[selectedTable.idField]
            );
            closeModal();
            load();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
          setSaving(false);
        },
      },
    ]);
  };

  // Show first 5 columns in the card
  if (user?.role !== 'admin') return <Text style={{ padding: 20, color: colors.textMuted }}>Administrator access required.</Text>;

  const displayColumns = selectedTable.columns.slice(0, 5);

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
      {displayColumns.map((col) => {
        const value = item[col.key];
        const isEnum = col.type === 'enum';
        const isBool = col.type === 'boolean';

        return (
          <View key={col.key} style={styles.cardRow}>
            <Text style={styles.cardLabel}>{col.label}</Text>
            {isEnum && value ? (
              <View style={[styles.statusBadge, { backgroundColor: tint(badgeColor(value), 0.12) }]}>
                <Text style={[styles.statusText, { color: badgeColor(value) }]}>
                  {String(value).replaceAll('_', ' ').toUpperCase()}
                </Text>
              </View>
            ) : isBool ? (
              <View style={[styles.statusBadge, { backgroundColor: value ? colors.successSoft : colors.raised }]}>
                <Text style={[styles.statusText, { color: value ? colors.success : colors.textSubtle }]}>
                  {value ? 'YES' : 'NO'}
                </Text>
              </View>
            ) : (
              <Text style={styles.cardValue} numberOfLines={1}>
                {formatValue(value, col.type)}
              </Text>
            )}
          </View>
        );
      })}
      <Text style={styles.editHint}>{selectedTable.columns.some(c => c.editable) ? 'Tap to edit' : 'Tap to view'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder={`Search ${selectedTable.label}...`}
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Table picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterRow}>
          {TABLE_CONFIGS.map((tc) => (
            <Button
              key={tc.key}
              title={tc.label}
              variant={selectedTable.key === tc.key ? 'primary' : 'secondary'}
              onPress={() => switchTable(tc)}
              style={styles.filterButton}
            />
          ))}
        </View>
      </ScrollView>

      {/* Add button */}
      {selectedTable.canInsert && (
        <TouchableOpacity style={styles.addBar} onPress={openNew} activeOpacity={0.7}>
          <FontAwesome name="plus-circle" size={18} color={colors.brandPrimary} />
          <Text style={styles.addText}>Add {selectedTable.label} record</Text>
        </TouchableOpacity>
      )}

      {/* Records list */}
      <FlatList
        data={records}
        keyExtractor={(item, index) => item[selectedTable.idField] ?? String(index)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 12 }} /> : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="database" size={48} color={colors.borderStrong} />
            <Text style={styles.emptyText}>No records found</Text>
          </View>
        }
      />

      {/* Edit/Create modal */}
      <AdminEditModal
        visible={modalVisible}
        tableName={selectedTable.label}
        columns={selectedTable.columns}
        record={editRecord}
        isNew={isNew}
        onSave={handleSave}
        onDelete={handleDelete}
        onCancel={closeModal}
        saving={saving}
        canDelete={false}
        correction={selectedTable.key === 'materials'}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  addBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addText: { fontSize: 14, fontWeight: '600', color: colors.brandPrimary },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  cardLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', flex: 1 },
  cardValue: { fontSize: 13, color: colors.textPrimary, flex: 2, textAlign: 'right' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: '700' },
  editHint: { fontSize: 11, color: colors.borderStrong, marginTop: 4, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textSubtle, marginTop: 12 },
});

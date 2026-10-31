import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import {
  fetchMaterialById,
  transferMaterial,
  issueMaterial,
  type MaterialWithLocation,
} from '@/lib/api/materials';
import {
  createShipment,
  fetchShipmentHistory,
  type ShipmentRecord,
} from '@/lib/api/shipments';
import { getProjectClient } from '@/lib/supabaseProject';
import { processQueue } from '@/lib/sync/syncManager';
import { newOperationId } from '@/lib/utils/operationId';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { addToQueue } from '@/lib/sync/offlineQueue';
import type { Location } from '@/types/database';
import { colors } from '@/lib/design/tokens';
import { PackedInNote } from '@/components/logistics/PackedInNote';
import { groupRoute } from '@/components/logistics/routes';
import { positionsOfMaterials } from '@/lib/api/tags';
import { materialActions, positionText, type ItemPosition } from '@/lib/logistics/positions';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const opId = useRef(newOperationId());
  const saveAction = async (action: Parameters<typeof addToQueue>[0]) => {
    await addToQueue(action, opId.current);
    opId.current = newOperationId();
    if (isOnline) await processQueue();
  };
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [material, setMaterial] = useState<MaterialWithLocation | null>(null);
  const [loading, setLoading] = useState(true);
  // Where it is now (022's item_positions) and what that allows; Ship Out is the office's.
  const office = user?.role !== 'field_worker';
  const [position, setPosition] = useState<ItemPosition | null>(null);
  const actions = materialActions(position, office);

  // Transfer state
  const [showTransfer, setShowTransfer] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Issue state
  const [showIssue, setShowIssue] = useState(false);
  const [jobNumber, setJobNumber] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [issuing, setIssuing] = useState(false);

  // Ship Out state
  const [showShipOut, setShowShipOut] = useState(false);
  const [destination, setDestination] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shipQty, setShipQty] = useState('');
  const [shipping, setShipping] = useState(false);

  // Shipment history
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);

  useEffect(() => {
    loadMaterial();
    if (id) loadShipments();
  }, [id]);

  const loadMaterial = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await fetchMaterialById(id);
      setMaterial(data);
      setPosition((await positionsOfMaterials([id])).get(id) ?? null);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setLoading(false);
  };

  const loadShipments = async () => {
    if (!id) return;
    try {
      const data = await fetchShipmentHistory(id);
      setShipments(data);
    } catch {}
  };

  const handleShipOut = async () => {
    if (!material) return;
    if (!destination) {
      Alert.alert('Error', 'Destination is required');
      return;
    }
    const qty = Number(shipQty);
    if (!Number.isInteger(qty) || qty <= 0) {
      Alert.alert('Error', 'Enter a valid quantity');
      return;
    }
    setShipping(true);
    try {
      await saveAction({ type: 'shipment', payload: { materialId: material.id, destination, quantity: qty, carrier: carrier || undefined, trackingNumber: trackingNumber || undefined, shippedBy: user?.id } });
      setShowShipOut(false);
      loadMaterial(); loadShipments();
      Alert.alert('Saved', 'Check Sync for submission progress or any action needed.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setShipping(false);
  };

  const openTransfer = async () => {
    const { data } = await getProjectClient()
      .from('locations')
      .select('*')
      .order('zone')
      .order('row')
      .order('rack');
    // Held stock goes, for crews, only to a hold area.
    setLocations(((data as Location[]) ?? []).filter(loc => !actions.holdOnly || loc.is_hold_area));
    setSelectedLocation('');
    setTransferReason('');
    setShowTransfer(true);
  };

  const handleTransfer = async () => {
    if (!material || !user || !selectedLocation) return;
    setTransferring(true);
    try {
      await saveAction({ type: 'transfer', payload: { materialId: material.id, fromLocationId: material.location_id, toLocationId: selectedLocation, movedBy: user.id, reason: transferReason } });
      setShowTransfer(false);
      loadMaterial();
      Alert.alert('Saved', 'Check Sync for submission progress or any action needed.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setTransferring(false);
  };

  const handleIssue = async () => {
    if (!material || !user) return;
    if (!jobNumber) {
      Alert.alert('Error', 'Job number is required');
      return;
    }
    const qty = Number(issueQty);
    if (!Number.isInteger(qty) || qty <= 0) {
      Alert.alert('Error', 'Enter a valid quantity');
      return;
    }
    setIssuing(true);
    try {
      await saveAction({ type: 'issue', payload: { materialId: material.id, jobNumber, quantity: qty, issuedBy: user.id, workOrder: workOrder || undefined } });
      setShowIssue(false);
      loadMaterial();
      Alert.alert('Saved', 'Check Sync for submission progress or any action needed.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setIssuing(false);
  };

  if (loading || !material) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: 'Material' }} />
        <Text style={styles.loadingText}>{loading ? 'Loading...' : 'Material not found'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: true, title: material.material_type }} />

      <View style={styles.header}>
        <Text style={styles.title}>{material.material_type}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{material.status.replaceAll('_', ' ').toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <DetailRow label="Quantity" value={`${material.current_quantity} / ${material.qty}`} />
        {material.size && <DetailRow label="Size" value={material.size} />}
        {material.grade && <DetailRow label="Grade" value={material.grade} />}
        {material.weight && <DetailRow label="Weight" value={`${material.weight} lbs`} />}
        {material.spec && <DetailRow label="Spec" value={material.spec} />}
        {material.qr_code_value && <DetailRow label="QR Code" value={material.qr_code_value} />}
        {material.location_zone ? (
          <DetailRow
            label="Rack"
            value={`${material.location_zone} - Row ${material.location_row}, Rack ${material.location_rack}`}
          />
        ) : position ? <DetailRow label="Rack" value="Not on a yard rack" /> : null}
        {position ? <DetailRow label="Where" value={positionText(position)} /> : null}
        <DetailRow label="Received" value={new Date(material.created_at).toLocaleDateString()} />
      </View>

      {position?.crate_code && position.position === 'in_crate' ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${positionText(position)}. Open the crate.`} style={styles.positionLink}
          onPress={() => router.push({ pathname: groupRoute('crate') as any, params: { code: position.top_crate_code ?? position.crate_code! } })}>
          <FontAwesome name="archive" size={16} color={colors.brandPrimary} />
          <Text style={styles.positionText}>{positionText(position)}</Text>
        </TouchableOpacity>
      ) : position?.load_id && (position.position === 'on_load' || position.position === 'missing') ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${positionText(position)}. Open the load.`} style={styles.positionLink}
          onPress={() => router.push({ pathname: groupRoute('load') as any, params: { id: position.load_id! } })}>
          <FontAwesome name="truck" size={16} color={colors.brandPrimary} />
          <Text style={styles.positionText}>{positionText(position)}</Text>
        </TouchableOpacity>
      ) : !position ? <PackedInNote tag={material.qr_code_value} /> : null}

      {material.status === 'in_yard' && material.current_quantity > 0 && (actions.transfer || actions.issue || (office && actions.ship) || actions.holdOnly) ? (
        <View style={styles.noteBox}>
          {[...new Set([actions.transfer, actions.issue, office ? actions.ship : null].filter(Boolean))].map(why => <Text key={why} style={styles.noteText}>{why}</Text>)}
          {actions.holdOnly ? <Text style={styles.noteText}>Until the office releases it, it can only be transferred to a hold area.</Text> : null}
          {position?.position === 'in_crate' && !actions.issue ? <Text style={styles.noteText}>Issuing all of it takes it out of {position.crate_code}; issuing part leaves the rest packed and opens the crate.</Text> : null}
        </View>
      ) : null}

      {material.status === 'in_yard' && material.current_quantity > 0 && (
        <View style={styles.actions}>
          <Button title="Transfer" onPress={openTransfer} disabled={!!actions.transfer} style={{ flex: 1 }} />
          <Button
            title="Issue"
            disabled={!!actions.issue}
            variant="secondary"
            onPress={() => {
              setJobNumber('');
              setWorkOrder('');
              setIssueQty('');
              setShowIssue(true);
            }}
            style={{ flex: 1 }}
          />
          {office ? <Button
            title="Ship Out"
            disabled={!!actions.ship}
            variant="secondary"
            onPress={() => {
              setDestination('');
              setCarrier('');
              setTrackingNumber('');
              setShipQty('');
              setShowShipOut(true);
            }}
            style={{ flex: 1 }}
          /> : null}
        </View>
      )}
      {/* Only once the server says where it is: before migration 022 there is no relocate. */}
      {material.status === 'in_yard' && material.current_quantity > 0 && material.qr_code_value && position && !actions.relocate ? (
        <Button title="Correct where it is" variant="ghost" onPress={() => router.push({ pathname: groupRoute('relocate') as any, params: { tag: material.qr_code_value! } })} />
      ) : null}

      {/* Transfer Modal */}
      <Modal visible={showTransfer} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Transfer Material</Text>
            <Text style={styles.availableText}>
              From: {material.location_zone ? `${material.location_zone} - Row ${material.location_row}, Rack ${material.location_rack}` : 'not on a yard rack'}
            </Text>

            <Text style={styles.label}>New Location</Text>
            <ScrollView style={styles.locationList}>
              {locations.map((loc) => (
                <TouchableOpacity
                  key={loc.id}
                  style={[
                    styles.locationCard,
                    selectedLocation === loc.id && styles.locationSelected,
                  ]}
                  onPress={() => setSelectedLocation(loc.id)}
                >
                  <Text style={styles.locationText}>
                    {loc.zone} - Row {loc.row}, Rack {loc.rack}
                  </Text>
                  {loc.is_hold_area && <Text style={styles.holdBadge}>HOLD</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Input
              label="Reason (optional)"
              value={transferReason}
              onChangeText={setTransferReason}
              placeholder="Why is this being moved?"
            />

            <Button title="Confirm Transfer" onPress={handleTransfer} loading={transferring} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowTransfer(false)}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>

      {/* Issue Modal */}
      <Modal visible={showIssue} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Issue to Job</Text>
            <Text style={styles.availableText}>
              Available: {material.current_quantity}
            </Text>

            <Input
              label="Job Number"
              value={jobNumber}
              onChangeText={setJobNumber}
              placeholder="JOB-12345"
            />
            <Input
              label="Work Order (optional)"
              value={workOrder}
              onChangeText={setWorkOrder}
              placeholder="WO-67890"
            />
            <Input
              label="Quantity to Issue"
              value={issueQty}
              onChangeText={setIssueQty}

              placeholder={`Max: ${material.current_quantity}`}
            />

            <Button title="Confirm Issue" onPress={handleIssue} loading={issuing} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowIssue(false)}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>

      {/* Ship Out Modal */}
      <Modal visible={showShipOut} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ship Out</Text>
            <Text style={styles.availableText}>
              Available: {material.current_quantity}
            </Text>

            <Input
              label="Destination"
              value={destination}
              onChangeText={setDestination}
              placeholder="Site name or address"
            />
            <Input
              label="Carrier (optional)"
              value={carrier}
              onChangeText={setCarrier}
              placeholder="e.g. FedEx, UPS"
            />
            <Input
              label="Tracking Number (optional)"
              value={trackingNumber}
              onChangeText={setTrackingNumber}
              placeholder="Tracking #"
            />
            <Input
              label="Quantity to Ship"
              value={shipQty}
              onChangeText={setShipQty}

              placeholder={`Max: ${material.current_quantity}`}
            />

            <Button title="Confirm Shipment" onPress={handleShipOut} loading={shipping} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowShipOut(false)}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>

      {/* Shipment History */}
      {shipments.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>Shipment History</Text>
          {shipments.map((s) => (
            <View key={s.id} style={styles.historyCard}>
              <View style={styles.historyRow}>
                <Text style={styles.historyDest}>{s.destination}</Text>
                <Text style={styles.historyQty}>x{s.quantity_shipped}</Text>
              </View>
              {s.carrier && <Text style={styles.historyDetail}>Carrier: {s.carrier}</Text>}
              {s.tracking_number && <Text style={styles.historyDetail}>Tracking: {s.tracking_number}</Text>}
              <Text style={styles.historyDate}>{new Date(s.created_at).toLocaleDateString()}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
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
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 15, color: colors.textSubtle },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  positionLink: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandPrimarySoft, marginBottom: 12 },
  positionText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  noteBox: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: colors.warnSoft, marginBottom: 12 },
  noteText: { fontSize: 14, color: colors.warnDeep, lineHeight: 20 },
  statusBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.successDeep },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.raised,
  },
  detailLabel: { fontSize: 14, color: colors.textMuted },
  detailValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 10 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: 8 },
  locationList: { maxHeight: 200, marginBottom: 12 },
  locationCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimarySoft },
  locationText: { fontSize: 14, color: colors.textPrimary },
  holdBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  availableText: { fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  historySection: { marginTop: 20 },
  historyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyDest: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  historyQty: { fontSize: 14, fontWeight: '600', color: colors.brandPrimary },
  historyDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  historyDate: { fontSize: 11, color: colors.textSubtle, marginTop: 4 },
});

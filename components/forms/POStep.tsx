import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useReceivingStore } from '@/stores/receivingStore';
import { RECEIVING_STEPS } from '@/lib/utils/receivingLabels';
import { colors } from '@/lib/design/tokens';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export function POStep({ onNext, onBack }: Props) {
  const { po, setPO } = useReceivingStore();

  const [vendor, setVendor] = useState(po.vendor ?? '');
  const [poNumber, setPONumber] = useState(po.po_number ?? '');
  const [deliveryTicket, setDeliveryTicket] = useState(po.delivery_ticket ?? '');
  const [carrier, setCarrier] = useState(po.carrier ?? '');

  const handleNext = () => {
    setPO({
      vendor: vendor || undefined,
      po_number: poNumber || undefined,
      delivery_ticket: deliveryTicket || undefined,
      carrier: carrier || undefined,
    });
    onNext();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{RECEIVING_STEPS[1]}</Text>

      <Input label="Vendor" value={vendor} onChangeText={setVendor} placeholder="Vendor name" />
      <Input label="PO Number" value={poNumber} onChangeText={setPONumber} placeholder="PO-12345" />
      <Input
        label="Delivery Ticket #"
        value={deliveryTicket}
        onChangeText={setDeliveryTicket}
        placeholder="DT-67890"
      />
      <Input label="Carrier" value={carrier} onChangeText={setCarrier} placeholder="Trucking company" />

      <Button title="Next" onPress={handleNext} style={{ marginTop: 8 }} />
      <Button title="Back" variant="secondary" onPress={onBack} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: 16 },
});

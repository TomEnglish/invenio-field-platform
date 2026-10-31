import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { QRScanner } from '@/components/scanning/QRScanner';
import { useReceivingStore } from '@/stores/receivingStore';
import { lookupMaterialByQR } from '@/lib/api/qrcodes';
import { lookupTag } from '@/lib/api/tags';
import { scanRoute } from '@/lib/logistics/positions';
import { countedAreaInfo, findInventoryByTag } from '@/lib/api/inventory';
import { receivingPrefill } from '@/lib/inventory/count';
import { crateCode, looksLikeCrate } from '@/lib/logistics/crates';
import { usePackStore } from '@/stores/packStore';
import { Button } from '@/components/ui/Button';
import { colors, fontSize } from '@/lib/design/tokens';

interface ScanScreenProps {
  materialDetailRoute: string;
  receivingRoute: string;
  crateRoute: string;
  packRoute: string;
}

export function ScanScreenContent({ materialDetailRoute, receivingRoute, crateRoute, packRoute }: ScanScreenProps) {
  const { setQRCode, reset } = useReceivingStore();
  const packing = usePackStore(s => s.code);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  // A tag that was counted but not yet received starts its receipt from the
  // count (online, or from the Count tab's cache when offline), including the
  // rack location linked to its area or the nearest area above it.
  const startReceiving = async (code: string) => {
    reset();
    setQRCode(code, null);
    const counted = await findInventoryByTag(code).catch(() => null);
    const fromCount = counted?.count_status === 'counted' && useReceivingStore.getState().qrCodeValue === code ? counted : null;
    if (fromCount) {
      useReceivingStore.getState().setMaterial(receivingPrefill(fromCount));
      useReceivingStore.getState().setCountedFrom({ countedAt: fromCount.counted_at, zoneName: fromCount.location?.trim() || null });
    }
    router.push(receivingRoute as any);
    // The area path and its rack may need the server: fill them in once known,
    // unless this receipt has moved on or a location was already chosen.
    if (fromCount) void countedAreaInfo(fromCount).then(area => {
      const receiving = useReceivingStore.getState();
      if (receiving.qrCodeValue !== code || !receiving.countedFrom) return;
      if (area.path) receiving.setCountedFrom({ countedAt: fromCount.counted_at, zoneName: area.path });
      if (area.locationId && !receiving.location.location_id) receiving.setLocation({ location_id: area.locationId }, area.locationLabel ?? area.path ?? '');
    }).catch(() => {});
  };

  const handleScan = async (code: string) => {
    if (checking) return;
    setMessage('');
    // A crate label (any case) opens the crate from the device's copy, even offline.
    if (looksLikeCrate(code)) {
      router.push({ pathname: crateRoute as any, params: { code: crateCode(code) } });
      return;
    }
    setChecking(true);

    try {
      // The server says what the tag is in this project (022), and receiving
      // opens only when it may start. Offline (or before 022), a received tag
      // opens its material and anything else starts a receipt the server checks.
      const found = await lookupTag(code).catch((e: any) => { setMessage(e?.message ?? 'That code could not be checked.'); return undefined; });
      if (found === undefined) return;
      if (found) {
        const route = scanRoute(found);
        if (route.to === 'crate') router.push({ pathname: crateRoute as any, params: { code: route.code } });
        else if (route.to === 'material') router.push({ pathname: materialDetailRoute as any, params: { id: route.materialId } });
        else if (route.to === 'receive') await startReceiving(found.code);
        else setMessage(route.message);
        return;
      }
      let result: Awaited<ReturnType<typeof lookupMaterialByQR>> = null;
      try { result = await lookupMaterialByQR(code); } catch { /* Offline: continue to receiving. */ }

      if (result) {
        router.push({ pathname: materialDetailRoute as any, params: { id: result.materialId } });
      } else {
        await startReceiving(code);
      }
    } finally {
      setChecking(false);
    }
  };

  return <QRScanner onScan={handleScan} actions={<>
    {message ? <Text style={styles.message} accessibilityRole="alert">{message}</Text> : null}
    <Button title={packing ? `Continue packing ${packing}` : 'Pack a crate'} variant="secondary" onPress={() => router.push(packRoute as any)} />
  </>} />;
}

const styles = StyleSheet.create({
  message: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20, marginTop: 8 },
});

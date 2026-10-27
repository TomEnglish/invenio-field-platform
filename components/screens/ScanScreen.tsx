import { useState } from 'react';
import { router } from 'expo-router';
import { QRScanner } from '@/components/scanning/QRScanner';
import { useReceivingStore } from '@/stores/receivingStore';
import { lookupMaterialByQR } from '@/lib/api/qrcodes';
import { findInventoryByTag, zoneNameFor } from '@/lib/api/inventory';
import { receivingPrefill } from '@/lib/inventory/count';

interface ScanScreenProps {
  materialDetailRoute: string;
  receivingRoute: string;
}

export function ScanScreenContent({ materialDetailRoute, receivingRoute }: ScanScreenProps) {
  const { setQRCode, reset } = useReceivingStore();
  const [checking, setChecking] = useState(false);

  // A tag that was counted but not yet received starts its receipt from the
  // count (online, or from the Count tab's cache when offline).
  const startReceiving = async (code: string) => {
    reset();
    setQRCode(code, null);
    const counted = await findInventoryByTag(code).catch(() => null);
    if (counted?.count_status === 'counted') {
      const receiving = useReceivingStore.getState();
      if (receiving.qrCodeValue === code) {
        receiving.setMaterial(receivingPrefill(counted));
        receiving.setCountedFrom({ countedAt: counted.counted_at, zoneName: await zoneNameFor(counted).catch(() => null) });
      }
    }
    router.push(receivingRoute as any);
  };

  const handleScan = async (code: string) => {
    if (checking) return;
    setChecking(true);

    try {
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

  return <QRScanner onScan={handleScan} />;
}

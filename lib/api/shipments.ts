import { applyOperation, type OperationContext } from './operations';
import { getProjectClient } from '@/lib/supabaseProject';

export interface ShipmentRecord {
  id: string;
  destination: string;
  carrier: string | null;
  tracking_number: string | null;
  quantity_shipped: number;
  created_at: string;
}

export async function createShipment(materialId: string, destination: string, quantity: number, carrier?: string, trackingNumber?: string, shippedBy?: string, context?: OperationContext) {
  return applyOperation('shipment', { materialId, destination, quantity, carrier, trackingNumber }, context);
}

export async function fetchShipmentHistory(materialId: string): Promise<ShipmentRecord[]> {
  const client = getProjectClient();

  const { data, error } = await client
    .from('shipments_out')
    .select('*')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ShipmentRecord[];
}

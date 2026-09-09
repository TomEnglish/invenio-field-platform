import { getProjectClient } from '@/lib/supabaseProject';
import { applyOperation } from './operations';

export interface ExceptionRecord {
  id: string;
  material_type: string;
  qty: number;
  vendor: string | null;
  po_number: string | null;
  condition: string;
  damage_notes: string | null;
  exception_type: string | null;
  exception_resolved: boolean;
  exception_resolution: string | null;
  has_exception: boolean;
  created_at: string;
  created_by_name: string | null;
  location_zone: string | null;
  location_row: string | null;
  location_rack: string | null;
}

export async function fetchExceptions(showResolved = false) {
  const client = getProjectClient();

  let query = client.from('receiving_records')
    .select(`
      id,
      material_type,
      qty,
      vendor,
      po_number,
      condition,
      damage_notes,
      exception_type,
      exception_resolved,
      exception_resolution,
      has_exception,
      created_at,
      users!receiving_records_created_by_fkey ( full_name ),
      locations ( zone, row, rack )
    `)
    // No need for `.eq('project_id', ...)` anymore!
    .eq('has_exception', true)
    .order('created_at', { ascending: false });

  if (!showResolved) {
    query = query.eq('exception_resolved', false);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  return (data ?? []).map((r: any) => ({
    id: r.id,
    material_type: r.material_type,
    qty: r.qty,
    vendor: r.vendor,
    po_number: r.po_number,
    condition: r.condition,
    damage_notes: r.damage_notes,
    exception_type: r.exception_type,
    exception_resolved: r.exception_resolved,
    exception_resolution: r.exception_resolution,
    has_exception: r.has_exception,
    created_at: r.created_at,
    created_by_name: r.users?.full_name ?? null,
    location_zone: r.locations?.zone ?? null,
    location_row: r.locations?.row ?? null,
    location_rack: r.locations?.rack ?? null,
  })) as ExceptionRecord[];
}

export async function resolveException(
  id: string,
  resolution: 'hold' | 'return_to_vendor',
  userId?: string
) {
  return applyOperation('exception', { id, resolution });
}

import { applyOperation, type OperationContext } from './operations';
import { getProjectClient } from '@/lib/supabaseProject';

export interface MaterialWithLocation {
  id: string;
  material_type: string;
  size: string | null;
  grade: string | null;
  qty: number;
  current_quantity: number;
  weight: number | null;
  spec: string | null;
  status: string;
  qr_code_id: string;
  location_id: string | null;
  created_at: string;
  qr_code_value: string | null;
  location_zone: string | null;
  location_row: string | null;
  location_rack: string | null;
}

const PAGE_SIZE = 20;

export async function fetchMaterials(filters?: {
  status?: string;
  material_type?: string;
  search?: string;
  offset?: number;
  limit?: number;
}): Promise<{ data: MaterialWithLocation[]; hasMore: boolean }> {
  const limit = filters?.limit ?? PAGE_SIZE;
  const offset = filters?.offset ?? 0;

  const client = getProjectClient();

  let query = client.from('materials')
    .select(`
      *,
      qr_codes ( code_value ),
      locations ( zone, row, rack )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.material_type) {
    query = query.eq('material_type', filters.material_type);
  }
  if (filters?.search) {
    query = query.or(`material_type.ilike.%${filters.search}%,grade.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const results = (data ?? []).map((m: any) => ({
    id: m.id,
    material_type: m.material_type,
    size: m.size,
    grade: m.grade,
    qty: m.qty,
    current_quantity: m.current_quantity,
    weight: m.weight,
    spec: m.spec,
    status: m.status,
    qr_code_id: m.qr_code_id,
    location_id: m.location_id,
    created_at: m.created_at,
    qr_code_value: m.qr_codes?.code_value ?? null,
    location_zone: m.locations?.zone ?? null,
    location_row: m.locations?.row ?? null,
    location_rack: m.locations?.rack ?? null,
  })) as MaterialWithLocation[];

  const hasMore = results.length > limit;
  return { data: hasMore ? results.slice(0, limit) : results, hasMore };
}

export async function fetchMaterialById(id: string) {
  const client = getProjectClient();

  const { data, error } = await client.from('materials')
    .select(`
      *,
      qr_codes ( code_value ),
      locations ( zone, row, rack )
    `)
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);

  const m = data as any;
  return {
    id: m.id,
    material_type: m.material_type,
    size: m.size,
    grade: m.grade,
    qty: m.qty,
    current_quantity: m.current_quantity,
    weight: m.weight,
    spec: m.spec,
    status: m.status,
    qr_code_id: m.qr_code_id,
    location_id: m.location_id,
    created_at: m.created_at,
    qr_code_value: m.qr_codes?.code_value ?? null,
    location_zone: m.locations?.zone ?? null,
    location_row: m.locations?.row ?? null,
    location_rack: m.locations?.rack ?? null,
  } as MaterialWithLocation;
}

export async function transferMaterial(materialId: string, fromLocationId: string | null, toLocationId: string, movedBy: string, reason?: string, context?: OperationContext) {
  return applyOperation('transfer', { materialId, fromLocationId, toLocationId, reason }, context);
}
export async function issueMaterial(materialId: string, jobNumber: string, quantity: number, issuedBy: string, workOrder?: string, context?: OperationContext) {
  return applyOperation('issue', { materialId, jobNumber, quantity, workOrder }, context);
}

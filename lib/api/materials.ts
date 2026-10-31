import { applyOperation, type OperationContext } from './operations';
import { likeExactly } from './inventory';
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
// Materials matched by their QR code in one search, newest first: enough to
// narrow by typing, short enough for the request.
const CODE_MATCHES = 100;
// The longest search text used: a tag is at most 120 characters.
export const SEARCH_MAX = 120;
// A value in a PostgREST `or` list, quoted so commas, dots and brackets in what
// was typed stay text.
const orValue = (text: string) => `"${text.replace(/["\\]/g, char => `\\${char}`)}"`;

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
  // Type, grade or QR code containing the text, whatever its capitals. A
  // material's code is in qr_codes, so the materials whose code matches are
  // found first, with the same filters. ILIKE's % and _ are escaped; PostgREST
  // reads * as a wildcard and has no escape for it.
  const search = filters?.search?.trim().slice(0, SEARCH_MAX);
  if (search) {
    const pattern = `%${likeExactly(search)}%`;
    let byCode = client.from('materials').select('id, qr_codes!inner(code_value)').ilike('qr_codes.code_value', pattern);
    if (filters?.status) byCode = byCode.eq('status', filters.status);
    if (filters?.material_type) byCode = byCode.eq('material_type', filters.material_type);
    const { data: coded, error: codeError } = await byCode.order('created_at', { ascending: false }).limit(CODE_MATCHES);
    if (codeError) throw new Error(codeError.message);
    const ids = (coded ?? []).map((material: { id: string }) => material.id);
    query = query.or([
      `material_type.ilike.${orValue(pattern)}`, `grade.ilike.${orValue(pattern)}`,
      ...(ids.length ? [`id.in.(${ids.join(',')})`] : []),
    ].join(','));
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

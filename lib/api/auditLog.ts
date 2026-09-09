import { getProjectClient } from '@/lib/supabaseProject';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any>;
  created_at: string;
}

export async function fetchAuditLog(limit = 50): Promise<AuditEntry[]> {
  const { data, error } = await getProjectClient()
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEntry[];
}

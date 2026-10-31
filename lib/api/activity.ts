import { supabase } from '@/lib/supabase';
import { getProjectClient } from '@/lib/supabaseProject';
import { describeActivity, type ActivityItem, type ActivityRow } from '@/lib/activityText';
import { readCachedLoad } from './logistics';

export type { ActivityItem } from '@/lib/activityText';
type Page = { data: ActivityItem[]; hasMore: boolean; next?: string };

// Project activity. Crews no longer read audit_log (022):
// list_project_activity gives everyone on the project what happened, to what,
// by whom and when, with safe details only and no licence events. Paged by
// time: `before` is the oldest entry shown so far. Before 022, receipts,
// transfers and issues are read from their own tables as they were.
export async function fetchRecentActivity(userId?: string, options?: { before?: string; limit?: number }): Promise<Page> {
  const client = getProjectClient();
  const limit = options?.limit ?? 50;
  // Someone's own entries are picked out of a wider page.
  const ask = userId ? 200 : limit;
  const { data, error } = await supabase.rpc('list_project_activity', { p_project_id: client.projectId, p_before: options?.before ?? null, p_limit: ask });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /list_project_activity|schema cache/i.test(error.message ?? '')) return fetchTableActivity(userId, options);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as ActivityRow[];
  // The details never carry a load's number: the device's copy names it.
  const cached = await readCachedLoad().catch(() => null);
  const loads = new Map((cached?.loads ?? []).map(load => [load.id, load.load_number]));
  return {
    data: rows.filter(row => !userId || row.user_id === userId).map(row => describeActivity(row, loads)),
    hasMore: rows.length === ask, next: rows[rows.length - 1]?.created_at,
  };
}

async function fetchTableActivity(userId?: string, options?: { before?: string; limit?: number }): Promise<Page> {
  const client = getProjectClient();
  const limit = options?.limit ?? 50;
  const perTable = limit + 1;
  const older = (query: any) => (options?.before ? query.lt('created_at', options.before) : query);
  const items: ActivityItem[] = [];

  // Fetch recent receiving records
  let recvQuery = older(client
    .from('receiving_records')
    .select('id, material_type, qty, status, created_at, users!receiving_records_created_by_fkey ( full_name )'))
    .order('created_at', { ascending: false })
    .limit(perTable);
  if (userId) recvQuery = recvQuery.eq('created_by', userId);
  const { data: receivings } = await recvQuery;

  for (const r of receivings ?? []) {
    const rec = r as any;
    const who = rec.users?.full_name;
    items.push({
      id: `recv-${r.id}`,
      type: 'receiving',
      description: `Received ${r.material_type}`,
      detail: `Qty: ${r.qty} — ${r.status}${who ? ` — ${who}` : ''}`,
      created_at: r.created_at,
    });
  }

  // Fetch recent transfers
  let moveQuery = older(client
    .from('material_movements')
    .select(`
      id, reason, created_at,
      materials ( material_type ),
      to_location:locations!material_movements_to_location_id_fkey ( zone, row, rack ),
      users!material_movements_moved_by_fkey ( full_name )
    `))
    .order('created_at', { ascending: false })
    .limit(perTable);
  if (userId) moveQuery = moveQuery.eq('moved_by', userId);
  const { data: transfers } = await moveQuery;

  for (const t of transfers ?? []) {
    const m = t as any;
    const toLoc = m.to_location;
    const who = m.users?.full_name;
    items.push({
      id: `move-${t.id}`,
      type: 'transfer',
      description: `Transferred ${m.materials?.material_type ?? 'material'}`,
      detail: (toLoc ? `To ${toLoc.zone} - Row ${toLoc.row}, Rack ${toLoc.rack}` : 'Moved') + (who ? ` — ${who}` : ''),
      created_at: t.created_at,
    });
  }

  // Fetch recent issues
  let issueQuery = older(client
    .from('material_issues')
    .select(`
      id, job_number, quantity_issued, created_at,
      materials ( material_type ),
      users!material_issues_issued_by_fkey ( full_name )
    `))
    .order('created_at', { ascending: false })
    .limit(perTable);
  if (userId) issueQuery = issueQuery.eq('issued_by', userId);
  const { data: issues } = await issueQuery;

  for (const i of issues ?? []) {
    const m = i as any;
    const who = m.users?.full_name;
    items.push({
      id: `issue-${i.id}`,
      type: 'issue',
      description: `Issued ${m.materials?.material_type ?? 'material'}`,
      detail: `Qty: ${i.quantity_issued} to Job ${i.job_number}${who ? ` — ${who}` : ''}`,
      created_at: i.created_at,
    });
  }

  // Sort all by date, most recent first
  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const sliced = items.slice(0, limit + 1);
  const hasMore = sliced.length > limit;
  const data = hasMore ? sliced.slice(0, limit) : sliced;
  return { data, hasMore, next: data[data.length - 1]?.created_at };
}

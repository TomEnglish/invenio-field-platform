// One line of project activity from list_project_activity (022): what
// happened, to what, by whom. Only the safe details the server passes on are
// read (never licence events). Pure, for the Activity tab and tests.

export type ActivityType = 'receiving' | 'transfer' | 'issue' | 'count' | 'crate' | 'load' | 'other';
export interface ActivityRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any> | null;
}
export interface ActivityItem { id: string; type: ActivityType; description: string; detail: string; created_at: string }

const list = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const words = (action: string) => {
  const text = action.replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Change';
};

// `loads`: load numbers by ID, from the device's copy, since the details never carry them.
export function describeActivity(row: ActivityRow, loads: Map<string, string | null> = new Map()): ActivityItem {
  const d = row.details ?? {};
  const tag = d.tag ?? d.code;
  const load = (row.entity_id && loads.get(row.entity_id)) || 'a load';
  const who = row.user_name ? ` — ${row.user_name}` : '';
  const item = (type: ActivityType, description: string, detail: (string | number | null | undefined | false)[]) => ({
    id: row.id, type, description, created_at: row.created_at, detail: `${detail.filter(Boolean).join(' · ') || words(row.action)}${who}`,
  });
  switch (row.action) {
    case 'receiving_created': return item('receiving', `Received ${tag ?? 'material'}`, [d.qty != null && `Qty: ${d.qty}`, d.accepted_qty != null && d.accepted_qty !== d.qty && `${d.accepted_qty} accepted`, d.status && String(d.status).replace(/_/g, ' ')]);
    case 'inventory_counted': return item('count', `Counted ${tag ?? 'an item'}`, [d.created ? 'First count' : 'Counted again']);
    case 'material_transferred': return item('transfer', `Transferred ${tag ?? 'material'}`, [d.reason]);
    case 'item_relocated': return item('transfer', `Corrected where ${tag ?? 'an item'} is`, [d.reason]);
    case 'material_issued': return item('issue', `Issued ${tag ?? 'material'}`, [d.qty != null && `Qty: ${d.qty}`]);
    case 'shipment_created': return item('issue', `Shipped out ${tag ?? 'material'}`, [d.qty != null && `Qty: ${d.qty}`]);
    case 'material_corrected': return item('other', `Corrected ${tag ?? 'material'}`, [d.reason]);
    case 'handling_unit_packed': return item('crate', d.created ? 'Packed a new crate' : 'Packed a crate', [list(d.added) && `${list(d.added)} in`, list(d.removed) && `${list(d.removed)} out`]);
    case 'handling_unit_unpacked': return item('crate', 'Unpacked a crate', [d.items_released != null && plural(Number(d.items_released), 'item'), d.units_released ? plural(Number(d.units_released), 'crate') : null]);
    case 'handling_unit_moved': return item('crate', `Moved ${tag ?? 'a crate'}`, []);
    case 'load_saved': return item('load', d.created ? `Started ${load}` : `Changed ${load}`, []);
    case 'load_planned': return item('load', `Planned ${load}`, [list(d.added) && `${list(d.added)} planned`, list(d.removed) && `${list(d.removed)} taken off`, list(d.moved_from) && `${list(d.moved_from)} moved from other loads`]);
    case 'load_loaded': return item('load', `Loaded ${load}`, [list(d.on) && `${list(d.on)} on`, list(d.undone) && `${list(d.undone)} taken off`, list(d.moved_from) && `${list(d.moved_from)} moved from other loads`]);
    case 'load_departed': return item('load', `${load[0].toUpperCase()}${load.slice(1)} left`, [d.not_loaded ? `${d.not_loaded} left behind` : null]);
    case 'load_unloaded': return item('load', `Unloaded ${load}`, [list(d.pieces) && `${list(d.pieces)} off`, d.corrected ? `${d.corrected} moved to this stop` : null]);
    case 'load_stop_completed': return item('load', `Finished a stop on ${load}`, [d.delivered ? `${d.delivered} delivered` : null, d.missing ? `${d.missing} missing` : null, d.not_picked_up ? `${d.not_picked_up} not picked up` : null]);
    default: return item(row.action.startsWith('load') || row.action.startsWith('line_') ? 'load' : row.action.startsWith('handling_unit') ? 'crate' : 'other', words(row.action), [d.reason]);
  }
}

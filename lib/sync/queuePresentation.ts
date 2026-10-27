import type { QueueItem } from './offlineQueue';

export function queueSummary(item: QueueItem): { title: string; detail: string } {
  const payload = item.action?.payload ?? {};
  const names = { receiving:'Receiving', transfer:'Material transfer', issue:'Material issue', shipment:'Outbound shipment', count:'Inventory count' };
  const kind = names[item.action?.type] || 'Saved submission';
  if (item.action?.type === 'receiving') {
    const po = payload.po?.po_number;
    return { title: payload.material?.material_type || kind, detail: [kind,po ? (/^PO(?:\b|[-_])/i.test(po) ? po : `PO ${po}`) : 'PO not recorded',payload.material?.qty != null ? `${payload.material.qty} delivered` : null,payload.po?.vendor].filter(Boolean).join(' · ') };
  }
  if (item.action?.type === 'count') {
    const count = payload.count ?? {};
    const quantity = count.quantity ? [count.quantity, count.uom].filter(Boolean).join(' ') : null;
    return { title: count.name || kind, detail: [kind, count.tag ? `Tag ${count.tag}` : 'Tag not recorded', quantity, payload.zoneName].filter(Boolean).join(' · ') };
  }
  const data = payload as Record<string, unknown>;
  const detail = [data.jobNumber ? `Job ${data.jobNumber}` : null, data.destination, data.quantity != null ? `Quantity ${data.quantity}` : null, data.reason].filter(Boolean).join(' · ');
  return { title: kind, detail: detail || 'Saved for this project' };
}
export function queueRecoveryMessage(item: QueueItem): string {
  const error = item.lastError || '';
  const count = item.action?.type === 'count';
  if (count && /already been received/i.test(error)) return 'This tag was received before the count uploaded, so the count cannot be applied. Share the support details with your office.';
  if (/photo/i.test(error)) return `The ${count ? 'count' : 'receipt'} may already be saved. Retry to finish attaching its photos; the same submission will be reused.`;
  if (/access|permission|jwt|sign.in|unauthorized|account|project/i.test(error)) return 'Verify your sign-in and project access, then retry. Your saved submission is preserved.';
  if (/unsupported|unknown.*type/i.test(error)) return 'Ask an administrator to review this saved submission. Keep it on this device.';
  if (item.deadLetter) return 'Automatic retries have stopped. Check the support details with your administrator before retrying.';
  if (/network|fetch|connect|timeout/i.test(error)) return 'Check your connection and retry when online. Your saved submission is preserved.';
  return error ? 'The upload could not complete. Retry when online; if it fails again, share the support details with your administrator.' : 'Saved on this device. Uploads start when online access is verified.';
}

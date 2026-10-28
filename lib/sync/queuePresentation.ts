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
// A count the server refused will be refused again on every retry. Sync then
// offers to reopen it in Count ("fix") or, for a received tag, only to
// discard it. Photo, connection and sign-in failures are retried instead.
export function countRecoveryAction(item: QueueItem): 'fix' | 'discard' | null {
  const error = item.lastError || '';
  if (item.action?.type !== 'count' || !error || /photo/i.test(error)) return null;
  if (/already been received/i.test(error)) return 'discard';
  if (/network|fetch|connect|timeout|took too long|reconnect|jwt|sign.in|unauthori[sz]ed|access|permission|account or project changed|not confirmed|unsupported/i.test(error)) return null;
  return 'fix';
}
export function queueRecoveryMessage(item: QueueItem): string {
  const error = item.lastError || '';
  const count = item.action?.type === 'count';
  if (count && /already been received/i.test(error)) return 'This tag was received before the count uploaded, so the count cannot be applied. Discard it; the receipt already records the tag.';
  if (count && /choose a location/i.test(error)) return 'Every count now needs a location. Fix it in Count and choose an area, or discard it.';
  if (count && /no longer in use/i.test(error)) return 'The office retired the site plan or area this count uses. Fix it in Count to choose the location again, or discard it.';
  if (count && /(category|zone|area|site map) is (unavailable|inactive)/i.test(error)) return 'The office archived or changed the category, zone or site plan this count uses, so the server refused it. Fix it in Count to choose again, or discard it.';
  if (countRecoveryAction(item) === 'fix') return 'The server refused this count. Fix it in Count, or discard it. Retrying unchanged will be refused again.';
  if (/photo/i.test(error)) return `The ${count ? 'count' : 'receipt'} may already be saved. Retry to finish attaching its photos; the same submission will be reused.`;
  if (/access|permission|jwt|sign.in|unauthorized|account|project/i.test(error)) return 'Verify your sign-in and project access, then retry. Your saved submission is preserved.';
  if (/unsupported|unknown.*type/i.test(error)) return 'Ask an administrator to review this saved submission. Keep it on this device.';
  if (item.deadLetter) return 'Automatic retries have stopped. Check the support details with your administrator before retrying.';
  if (/network|fetch|connect|timeout/i.test(error)) return 'Check your connection and retry when online. Your saved submission is preserved.';
  return error ? 'The upload could not complete. Retry when online; if it fails again, share the support details with your administrator.' : 'Saved on this device. Uploads start when online access is verified.';
}
